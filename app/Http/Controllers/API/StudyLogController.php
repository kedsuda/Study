<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Requests\StudyLogRequest;
use App\Http\Resources\StudyLogResource;
use App\Models\LearningNotification;
use App\Models\NotificationEmailSetting;
use App\Models\StudyCalendarEvent;
use App\Models\StudyLog;
use App\Models\Subject;
use App\Models\User;
use App\Models\AudioSummary;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class StudyLogController extends Controller
{
    public function index(Subject $subject): AnonymousResourceCollection
    {
        $this->authorizeSubject($subject);
        $relations = ['files', 'summaries'];
        if (Schema::hasTable((new AudioSummary())->getTable())) {
            $relations[] = 'audioSummaries';
        }
        $logs = $subject->studyLogs()->with($relations)->orderByDesc('log_date')->get();
        return StudyLogResource::collection($logs);
    }

    public function store(StudyLogRequest $request, Subject $subject): JsonResponse
    {
        $this->authorizeSubject($subject);

        $payload = $request->validated();
        if (Schema::hasColumn((new StudyLog())->getTable(), 'user_id')) {
            $payload['user_id'] = $request->user()->id; // ✅ สำคัญ
        }
        if (Schema::hasColumn((new StudyLog())->getTable(), 'log_type')) {
            $payload['log_type'] = $payload['log_type']
                ?? ($request->boolean('is_summary') ? StudyLog::TYPE_DOCUMENT_SUMMARY : StudyLog::TYPE_STUDY);
        }

        $manualId = $this->resolveManualStudyLogId();
        if ($manualId !== null) {
            $payload['id'] = $manualId;
        }

        $log = $subject->studyLogs()->create($payload);

        if (! $this->shouldSkipCalendar($request, $log)) {
            $calendarEvent = $this->syncCalendarEvent($request->user(), $subject, $log);
            $this->createStudyLogNotification($request->user(), $subject, $log, $calendarEvent);
        }

        $relations = ['files', 'summaries'];
        if (Schema::hasTable((new AudioSummary())->getTable())) {
            $relations[] = 'audioSummaries';
        }
        return response()->json(new StudyLogResource($log->load($relations)), 201);
    }


    public function show(Subject $subject, StudyLog $studyLog): StudyLogResource
    {
        $this->authorizeSubject($subject);
        $this->authorizeStudyLog($subject, $studyLog);
        $relations = ['files', 'summaries'];
        if (Schema::hasTable((new AudioSummary())->getTable())) {
            $relations[] = 'audioSummaries';
        }
        return new StudyLogResource($studyLog->load($relations));
    }

    public function update(StudyLogRequest $request, Subject $subject, StudyLog $studyLog): StudyLogResource
    {
        $this->authorizeSubject($subject);
        $this->authorizeStudyLog($subject, $studyLog);
        $studyLog->update($request->validated());
        if ($this->shouldSkipCalendar($request, $studyLog)) {
            $this->deleteCalendarEvent($studyLog, $request->user()->id);
        } else {
            $this->syncCalendarEvent(request()->user(), $subject, $studyLog);
        }
        $relations = ['files', 'summaries'];
        if (Schema::hasTable((new AudioSummary())->getTable())) {
            $relations[] = 'audioSummaries';
        }
        return new StudyLogResource($studyLog->fresh()->load($relations));
    }

    public function destroy(Subject $subject, StudyLog $studyLog): JsonResponse
    {
        $this->authorizeSubject($subject);
        $this->authorizeStudyLog($subject, $studyLog);
        $this->deleteCalendarEvent($studyLog, request()->user()->id);
        $studyLog->delete();
        return response()->json(status: 204);
    }

    private function authorizeSubject(Subject $subject): void
    {
        abort_unless($subject->user_id === request()->user()->id, 403, 'Unauthorized');
    }

    private function authorizeStudyLog(Subject $subject, StudyLog $studyLog): void
    {
        abort_unless($studyLog->subject_id === $subject->id, 404, 'Study log not found');
    }

    private function syncCalendarEvent(User $user, Subject $subject, StudyLog $log): ?StudyCalendarEvent
    {
        if (! Schema::hasTable((new StudyCalendarEvent())->getTable())) {
            return null;
        }

        if ($this->isSummaryLog($log)) {
            $this->deleteCalendarEvent($log, $user->id);
            return null;
        }

        $existing = StudyCalendarEvent::where('study_log_id', $log->id)
            ->where('user_id', $user->id)
            ->first();

        if ($existing && data_get($existing->metadata, 'source') === 'subject') {
            return $existing;
        }

        $timezone = $this->resolveTimezone($user);
        $start = Carbon::parse($log->log_date, $timezone)->startOfDay();

        $metadata = [
            'source' => 'study_log',
            'all_day' => true,
        ];

        if (! is_null($log->duration_minutes)) {
            $metadata['duration_minutes'] = $log->duration_minutes;
        }

        $eventPayload = [
            'user_id' => $user->id,
            'subject_id' => $subject->id,
            'study_log_id' => $log->id,
            'title' => $log->title,
            'description' => $log->note,
            'start_time' => $start,
            'end_time' => null,
            'status' => 'planned',
            'metadata' => $metadata,
        ];

        if (Schema::hasColumn((new StudyCalendarEvent())->getTable(), 'event_type')) {
            $eventPayload['event_type'] = 'class';
        }

        return StudyCalendarEvent::updateOrCreate(
            ['study_log_id' => $log->id, 'user_id' => $user->id],
            $eventPayload
        );
    }

    private function shouldSkipCalendar(StudyLogRequest $request, StudyLog $log): bool
    {
        return $request->boolean('is_summary') || $this->isSummaryLog($log);
    }

    private function isSummaryLog(StudyLog $log): bool
    {
        if ($log->isSummary()) {
            return true;
        }

        $title = trim((string) $log->title);
        if ($title === '') {
            return false;
        }

        $lower = Str::lower($title);
        return Str::startsWith($lower, ['สรุป', 'summary']);
    }

    private function deleteCalendarEvent(StudyLog $log, int $userId): void
    {
        if (! Schema::hasTable((new StudyCalendarEvent())->getTable())) {
            return;
        }

        StudyCalendarEvent::where('study_log_id', $log->id)
            ->where('user_id', $userId)
            ->delete();
    }

    private function createStudyLogNotification(
        User $user,
        Subject $subject,
        StudyLog $log,
        ?StudyCalendarEvent $calendarEvent
    ): ?LearningNotification {
        if (! Schema::hasTable((new LearningNotification())->getTable())) {
            return null;
        }

        $timezone = $this->resolveTimezone($user);
        $dateLabel = Carbon::parse($log->log_date, $timezone)->format('d M Y');

        $title = "บันทึกการเรียนใหม่: {$subject->name}";
        $lines = [
            "วันที่ {$dateLabel}",
            "หัวข้อ: {$log->title}",
        ];

        if (! is_null($log->duration_minutes)) {
            $lines[] = "ระยะเวลา: {$log->duration_minutes} นาที";
        }

        if ($log->note) {
            $lines[] = "บันทึก: {$log->note}";
        }

        $message = implode("\n", $lines);

        $notification = LearningNotification::create([
            'user_id' => $user->id,
            'subject_id' => $subject->id,
            'study_log_id' => $log->id,
            'calendar_event_id' => $calendarEvent?->id,
            'title' => $title,
            'body' => $message,
            'notify_at' => now(),
            'channel' => 'email',
            'status' => 'pending',
            'metadata' => [
                'type' => 'study_log_created',
                'is_read' => false,
            ],
        ]);

        return $notification;
    }

    private function resolveEmailSettings(User $user): ?NotificationEmailSetting
    {
        if (! Schema::hasTable((new NotificationEmailSetting())->getTable())) {
            return null;
        }

        return NotificationEmailSetting::firstOrCreate(
            ['user_id' => $user->id],
            [
                'email_enabled' => true,
                'email_address' => $user->email,
                'digest_type' => 'daily',
                'days_ahead' => 1,
                'send_time' => '20:00:00',
                'timezone' => 'Asia/Bangkok',
            ]
        );
    }

    private function resolveTimezone(User $user): string
    {
        $settings = $this->resolveEmailSettings($user);
        return $settings?->timezone ?: 'Asia/Bangkok';
    }

    private function resolveManualStudyLogId(): ?int
    {
        $table = (new StudyLog())->getTable();
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'id')) {
            return null;
        }

        if ($this->hasAutoIncrement($table, 'id')) {
            return null;
        }

        $maxId = StudyLog::withoutGlobalScopes()->max('id');
        $nextId = (int) ($maxId ?? 0) + 1;

        return $nextId > 0 ? $nextId : 1;
    }

    private function hasAutoIncrement(string $table, string $column): bool
    {
        try {
            $database = DB::getDatabaseName();
            if (! $database) {
                return false;
            }

            $row = DB::table('information_schema.columns')
                ->select('extra')
                ->where('table_schema', $database)
                ->where('table_name', $table)
                ->where('column_name', $column)
                ->first();

            $extra = is_object($row) ? ($row->extra ?? '') : '';
            return stripos((string) $extra, 'auto_increment') !== false;
        } catch (\Throwable $e) {
            return false;
        }
    }
}
