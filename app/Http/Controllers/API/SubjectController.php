<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Requests\SubjectRequest;
use App\Http\Resources\SubjectResource;
use App\Models\CareerRecommendation;
use App\Models\FileAttachment;
use App\Models\LearningNotification;
use App\Models\Lesson;
use App\Models\MoodLog;
use App\Models\Quiz;
use App\Models\Schedule;
use App\Models\Semester;
use App\Models\StudyCalendarEvent;
use App\Models\StudyLog;
use App\Models\StudyNotification;
use App\Models\Subject;
use App\Models\Summary;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Throwable;


use Illuminate\Http\Request;

class SubjectController extends Controller

{
    public function __construct()
    {
        // ✅ บังคับต้องล็อกอินด้วย token ทุก action
        $this->middleware('auth:sanctum');
    }

    public function index(): AnonymousResourceCollection
    {
        $user = request()->user();
        $includeAll = request()->boolean('include_all') || request()->boolean('all');
        $canViewAll = $includeAll && $user && $user->role === 'admin';

        $query = Subject::withoutGlobalScope('user')->withCount('studyLogs');

        if ($canViewAll) {
            $query->orderBy('user_id')->orderByDesc('updated_at');
        } else {
            $query->where('user_id', $user->id)->orderByDesc('updated_at');
        }

        if ($this->canUseSemesterColumn()) {
            $query->with('semester');
        }

        if (request()->boolean('include_study_logs')) {
            $query->with(['studyLogs' => fn ($q) => $q->latest('log_date')]);
        }

        $subjects = $query->get();
        return SubjectResource::collection($subjects);
    }

    public function store(SubjectRequest $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validated();

        // If semester is enabled but client omitted it, auto-pick the current semester.
        if ($this->canUseSemesterColumn() && empty($data['semester_id'])) {
            $data['semester_id'] = $this->resolveCurrentSemesterId();
        }

        if ($this->findDuplicateSubject($user->id, $data)) {
            return response()->json(['message' => 'วิชาซ้ำในภาคเรียนนี้ กรุณาใช้ชื่อวิชาอื่นหรือแก้ไขวิชาเดิม'], 422);
        }

        $timing = $this->resolveScheduleTiming($data);
        if (isset($timing['error'])) {
            return response()->json(['message' => $timing['error']], 422);
        }

        $conflict = $this->findScheduleConflict($user->id, $data, $timing);
        if ($conflict) {
            return response()->json(['message' => $this->scheduleConflictMessage($conflict)], 422);
        }

        $eventConflict = $this->findCalendarScheduleConflict($user->id, $data, $timing);
        if ($eventConflict) {
            return response()->json(['message' => $this->calendarScheduleConflictMessage($eventConflict)], 422);
        }

        $subjectPayload = $this->filterSchedulePayload($data);
        $subject = $user->subjects()->create($subjectPayload);
        $this->syncSubjectCalendarEvent($subject, $user, $data, $timing);

        $subject = $subject->fresh()->loadCount('studyLogs');
        if ($this->canUseSemesterColumn()) {
            $subject->load('semester');
        }

        return response()->json(new SubjectResource($subject), 201);
    }

    public function show(Subject $subject): SubjectResource
    {
        $this->authorizeSubject($subject);
        if ($this->canUseSemesterColumn()) {
            $subject->load('semester');
        }
        return new SubjectResource($subject->loadCount('studyLogs'));
    }

    public function update(SubjectRequest $request, Subject $subject): SubjectResource|JsonResponse
    {
        $this->authorizeSubject($subject);
        $user = $request->user();
        $data = $request->validated();
        if ($this->canUseSemesterColumn() && ! array_key_exists('semester_id', $data)) {
            $data['semester_id'] = $subject->semester_id;
        }

        if ($this->findDuplicateSubject($user->id, $data, $subject->id)) {
            return response()->json(['message' => 'วิชาซ้ำในภาคเรียนนี้ กรุณาใช้ชื่อวิชาอื่นหรือแก้ไขวิชาเดิม'], 422);
        }

        $timing = $this->resolveScheduleTiming($data);
        if (isset($timing['error'])) {
            return response()->json(['message' => $timing['error']], 422);
        }

        $conflict = $this->findScheduleConflict($user->id, $data, $timing, $subject->id);
        if ($conflict) {
            return response()->json(['message' => $this->scheduleConflictMessage($conflict)], 422);
        }

        $eventConflict = $this->findCalendarScheduleConflict($user->id, $data, $timing, $subject->id);
        if ($eventConflict) {
            return response()->json(['message' => $this->calendarScheduleConflictMessage($eventConflict)], 422);
        }

        $subjectPayload = $this->filterSchedulePayload($data);
        $subject->update($subjectPayload);
        $this->syncSubjectCalendarEvent($subject, $user, $data, $timing);

        $subject = $subject->fresh()->loadCount('studyLogs');
        if ($this->canUseSemesterColumn()) {
            $subject->load('semester');
        }

        return new SubjectResource($subject);
    }

    public function destroy(Request $request, Subject $subject): JsonResponse
    {
        $this->authorizeSubject($subject);

        return $this->destroySubjectIfUnused($subject);
    }

    public function destroyById(Request $request): JsonResponse
    {
        $user = $request->user();
        $subjectId = (int) ($request->input('subject_id') ?? $request->input('id', 0));

        if (! $user || $subjectId <= 0) {
            return response()->json(['message' => 'Not found'], 404);
        }

        $subject = Subject::withoutGlobalScopes()
            ->where('id', $subjectId)
            ->where('user_id', $user->id)
            ->first();

        if (! $subject) {
            return response()->json(['message' => 'Not found'], 404);
        }

        return $this->destroySubjectIfUnused($subject);
    }

    /**
     * A subject may only be deleted when no other saved data refers to it.
     * This guard deliberately runs on the server so a client cannot bypass it.
     */
    private function destroySubjectIfUnused(Subject $subject): JsonResponse
    {
        $linkedRecords = $this->linkedSubjectRecords($subject->id);

        if ($linkedRecords !== []) {
            return response()->json([
                'message' => 'ไม่สามารถลบวิชา "'.$subject->name.'" ได้ เนื่องจากยังเชื่อมโยงกับ: '.implode(', ', $linkedRecords),
                'linked_records' => $linkedRecords,
            ], 422);
        }

        $subject->delete();

        return response()->json(['message' => 'ลบรายวิชาเรียบร้อยแล้ว']);
    }

    /** @return array<int, string> */
    private function linkedSubjectRecords(int $subjectId): array
    {
        $relations = [
            ['table' => 'study_logs', 'column' => 'subject_id', 'label' => 'บันทึกการเรียน'],
            ['table' => 'study_calendar_events', 'column' => 'subject_id', 'label' => 'ตารางเรียน'],
            ['table' => 'learning_notifications', 'column' => 'subject_id', 'label' => 'การแจ้งเตือนการเรียน'],
            ['table' => 'study_notifications', 'column' => 'subject_id', 'label' => 'การแจ้งเตือน'],
            ['table' => 'mood_logs', 'column' => 'subject_id', 'label' => 'บันทึกอารมณ์'],
            ['table' => 'career_recommendations', 'column' => 'subject_id', 'label' => 'คำแนะนำอาชีพ'],
            ['table' => 'quizzes', 'column' => 'subject_id', 'label' => 'แบบฝึกหัด'],
            ['table' => 'lessons', 'column' => 'subject_id', 'label' => 'บทเรียน'],
            ['table' => 'schedules', 'column' => 'subject_id', 'label' => 'ตารางเรียน'],
            ['table' => 'learning_goal_targets', 'column' => 'subject_id', 'label' => 'เป้าหมายการเรียน'],
            ['table' => 'subjects_archives', 'column' => 'original_subject_id', 'label' => 'ประวัติรายวิชา'],
        ];

        $linked = [];
        foreach ($relations as $relation) {
            if (! $this->hasTableSafe($relation['table']) || ! $this->hasColumnSafe($relation['table'], $relation['column'])) {
                continue;
            }

            if (DB::table($relation['table'])->where($relation['column'], $subjectId)->exists()) {
                $linked[] = $relation['label'];
            }
        }

        return array_values(array_unique($linked));
    }

    private function authorizeSubject(Subject $subject): void
    {
        abort_unless($subject->user_id === request()->user()->id, 403, 'Unauthorized');
    }

    private function findDuplicateSubject(int $userId, array $data, ?int $ignoreSubjectId = null): ?Subject
    {
        $name = trim((string) ($data['name'] ?? ''));
        if ($name === '') {
            return null;
        }

        $query = Subject::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name, 'UTF-8')]);

        if ($ignoreSubjectId) {
            $query->where('id', '<>', $ignoreSubjectId);
        }

        if ($this->hasColumnSafe((new Subject())->getTable(), 'semester_id')) {
            $semesterId = $data['semester_id'] ?? null;
            if ($semesterId !== null && $semesterId !== '') {
                $query->where('semester_id', (int) $semesterId);
            } else {
                $query->whereNull('semester_id');
            }
        }

        return $query->first();
    }

    private function deleteSubject(Subject $subject): void
    {
        DB::transaction(function () use ($subject) {
            $subjectId = $subject->id;
            $studyLogTable = (new StudyLog())->getTable();
            $studyLogIds = collect();

            if ($this->hasTableSafe($studyLogTable)) {
                $studyLogIds = StudyLog::where('subject_id', $subjectId)->pluck('id');
            }

            if ($studyLogIds->isNotEmpty()) {
                if ($this->hasTableSafe((new FileAttachment())->getTable())) {
                    FileAttachment::whereIn('study_log_id', $studyLogIds)->delete();
                }
                if ($this->hasTableSafe((new Summary())->getTable())) {
                    Summary::whereIn('study_log_id', $studyLogIds)->delete();
                }
                if ($this->hasTableSafe((new StudyCalendarEvent())->getTable())) {
                    StudyCalendarEvent::whereIn('study_log_id', $studyLogIds)->delete();
                }
                if ($this->hasTableSafe((new LearningNotification())->getTable())) {
                    LearningNotification::whereIn('study_log_id', $studyLogIds)->delete();
                }
            }

            if ($this->hasTableSafe((new StudyCalendarEvent())->getTable())) {
                StudyCalendarEvent::where('subject_id', $subjectId)->delete();
            }
            if ($this->hasTableSafe((new LearningNotification())->getTable())) {
                LearningNotification::where('subject_id', $subjectId)->delete();
            }
            if ($this->hasTableSafe((new StudyNotification())->getTable())) {
                StudyNotification::where('subject_id', $subjectId)->delete();
            }
            if ($this->hasTableSafe((new MoodLog())->getTable())) {
                MoodLog::where('subject_id', $subjectId)->delete();
            }
            if ($this->hasTableSafe((new CareerRecommendation())->getTable())) {
                CareerRecommendation::where('subject_id', $subjectId)->delete();
            }
            if ($this->hasTableSafe((new Quiz())->getTable())) {
                Quiz::where('subject_id', $subjectId)->delete();
            }
            if ($this->hasTableSafe((new Lesson())->getTable())) {
                Lesson::where('subject_id', $subjectId)->delete();
            }
            if ($this->hasTableSafe((new Schedule())->getTable())) {
                Schedule::where('subject_id', $subjectId)->delete();
            }
            if ($this->hasTableSafe($studyLogTable)) {
                StudyLog::where('subject_id', $subjectId)->delete();
            }

            $subject->delete();
        });
    }

    private function resolveScheduleTiming(array $data): array
    {
        $startDate = $data['start_date'] ?? null;
        $startTime = $data['start_time'] ?? null;
        $endTime = $data['end_time'] ?? null;

        $startAt = null;
        $endAt = null;
        $allDay = true;

        if ($startDate) {
            $timezone = config('app.timezone', 'Asia/Bangkok');
            $startAt = $startTime
                ? Carbon::parse($startDate . ' ' . $startTime, $timezone)
                : Carbon::parse($startDate, $timezone)->startOfDay();

            if ($startTime) {
                $allDay = false;
            }

            if ($endTime) {
                if (! $startTime) {
                    return ['error' => 'ต้องระบุเวลาเริ่มก่อนเวลาเลิก'];
                }

                $endAt = Carbon::parse($startDate . ' ' . $endTime, $timezone);
                if ($endAt->lessThanOrEqualTo($startAt)) {
                    return ['error' => 'เวลาเลิกต้องมากกว่าเวลาเริ่ม'];
                }
            }
        }

        return [
            'start_date' => $startDate,
            'start_at' => $startAt,
            'end_at' => $endAt,
            'all_day' => $allDay,
        ];
    }

    private function findScheduleConflict(int $userId, array $data, array $timing, ?int $ignoreSubjectId = null): ?Subject
    {
        $startAt = $timing['start_at'] ?? null;
        $endAt = $timing['end_at'] ?? null;

        if (! $startAt || ! $endAt || ($timing['all_day'] ?? true)) {
            return null;
        }

        $subjectTable = (new Subject())->getTable();
        if (
            ! $this->hasColumnSafe($subjectTable, 'start_date') ||
            ! $this->hasColumnSafe($subjectTable, 'start_time') ||
            ! $this->hasColumnSafe($subjectTable, 'end_time')
        ) {
            return null;
        }

        $query = Subject::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->whereNotNull('start_date')
            ->whereNotNull('start_time')
            ->whereNotNull('end_time');

        if ($ignoreSubjectId) {
            $query->where('id', '<>', $ignoreSubjectId);
        }

        if ($this->hasColumnSafe($subjectTable, 'semester_id')) {
            $semesterId = $data['semester_id'] ?? null;
            if ($semesterId !== null && $semesterId !== '') {
                $query->where('semester_id', (int) $semesterId);
            }
        }

        $timezone = config('app.timezone', 'Asia/Bangkok');
        $newDate = $startAt->copy()->timezone($timezone)->startOfDay();
        $newStart = $startAt->format('H:i:s');
        $newEnd = $endAt->format('H:i:s');

        foreach ($query->get() as $subject) {
            try {
                $existingDate = Carbon::parse((string) $subject->start_date, $timezone)->startOfDay();
            } catch (Throwable $error) {
                continue;
            }

            if (! $existingDate->isSameDay($newDate)) {
                continue;
            }

            $existingStart = $this->timeOnlyString($subject->start_time);
            $existingEnd = $this->timeOnlyString($subject->end_time);
            if (! $existingStart || ! $existingEnd) {
                continue;
            }

            if ($newStart < $existingEnd && $existingStart < $newEnd) {
                return $subject;
            }
        }

        return null;
    }

    private function scheduleConflictMessage(Subject $conflict): string
    {
        $timeRange = trim(($this->formatTimeForMessage($conflict->start_time) ?? '') . '-' . ($this->formatTimeForMessage($conflict->end_time) ?? ''), '-');
        $detail = $timeRange !== '' ? " เวลา {$timeRange}" : '';

        return "เวลานี้ซ้อนกับวิชา {$conflict->name}{$detail} กรุณาเลือกเวลาอื่น เพราะซ้อนกับวิชาอื่น";
    }

    private function findCalendarScheduleConflict(int $userId, array $data, array $timing, ?int $ignoreSubjectId = null): ?StudyCalendarEvent
    {
        $startAt = $timing['start_at'] ?? null;
        $endAt = $timing['end_at'] ?? null;

        if (! $startAt || ! $endAt || ($timing['all_day'] ?? true)) {
            return null;
        }

        if (! $this->hasTableSafe((new StudyCalendarEvent())->getTable())) {
            return null;
        }

        $query = StudyCalendarEvent::with('subject')
            ->where('user_id', $userId)
            ->whereNotNull('end_time')
            ->where('start_time', '<', $endAt)
            ->where('end_time', '>', $startAt);

        $semesterId = $this->calendarConflictSemesterId($data);

        foreach ($query->get() as $event) {
            if ($ignoreSubjectId && (int) $event->subject_id === (int) $ignoreSubjectId) {
                continue;
            }

            $eventSemesterId = $event->subject?->semester_id;
            if ($semesterId !== null && $eventSemesterId !== null && (int) $eventSemesterId !== $semesterId) {
                continue;
            }

            $metadata = is_array($event->metadata) ? $event->metadata : [];
            if ((bool) ($metadata['all_day'] ?? false)) {
                continue;
            }

            $eventType = $this->calendarEventType($event);
            if ($eventType !== 'class') {
                continue;
            }

            return $event;
        }

        return null;
    }

    private function calendarConflictSemesterId(array $data): ?int
    {
        if (! $this->hasColumnSafe((new Subject())->getTable(), 'semester_id')) {
            return null;
        }

        $semesterId = $data['semester_id'] ?? null;
        if ($semesterId === null || $semesterId === '') {
            return null;
        }

        return (int) $semesterId;
    }

    private function calendarScheduleConflictMessage(StudyCalendarEvent $conflict): string
    {
        $timezone = config('app.timezone', 'Asia/Bangkok');
        $title = trim((string) ($conflict->subject?->name ?: $conflict->title));
        $timeRange = trim(
            ($conflict->start_time ? $conflict->start_time->copy()->timezone($timezone)->format('H:i') : '')
            . '-'
            . ($conflict->end_time ? $conflict->end_time->copy()->timezone($timezone)->format('H:i') : ''),
            '-'
        );
        $detail = $timeRange !== '' ? " เวลา {$timeRange}" : '';

        return "เวลานี้ซ้อนกับวิชา {$title}{$detail} กรุณาเลือกเวลาอื่น เพราะซ้อนกับวิชาอื่น";
    }

    private function calendarEventType(StudyCalendarEvent $event): string
    {
        $metadata = is_array($event->metadata) ? $event->metadata : [];
        $metadataType = is_string($metadata['type'] ?? null) ? strtolower((string) $metadata['type']) : null;
        if (in_array($metadataType, ['class', 'exam', 'other'], true)) {
            return $metadataType;
        }

        $columnType = is_string($event->event_type ?? null) ? strtolower((string) $event->event_type) : null;
        if (in_array($columnType, ['class', 'exam', 'other'], true)) {
            return $columnType;
        }

        return 'class';
    }

    private function timeOnlyString(mixed $value): ?string
    {
        if ($value instanceof Carbon) {
            return $value->format('H:i:s');
        }

        $raw = is_string($value) ? trim($value) : (string) $value;
        if ($raw === '') {
            return null;
        }

        if (str_contains($raw, ' ')) {
            $raw = explode(' ', $raw)[1] ?? $raw;
        }

        if (str_contains($raw, 'T')) {
            $raw = explode('T', $raw)[1] ?? $raw;
        }

        $raw = str_replace('.', ':', preg_replace('/Z$|[+-]\d{2}:?\d{2}$/', '', $raw) ?? $raw);
        if (! preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/', $raw, $matches)) {
            return null;
        }

        return sprintf('%02d:%02d:%02d', (int) $matches[1], (int) $matches[2], (int) ($matches[3] ?? 0));
    }

    private function formatTimeForMessage(mixed $value): ?string
    {
        $time = $this->timeOnlyString($value);
        if (! $time) {
            return null;
        }

        return substr($time, 0, 5);
    }

    private function syncSubjectCalendarEvent(Subject $subject, $user, array $data, array $timing): void
    {
        if (! $this->hasTableSafe((new StudyCalendarEvent())->getTable())) {
            return;
        }

        try {
            $eventBase = StudyCalendarEvent::where('subject_id', $subject->id)
                ->where('user_id', $user->id);

            try {
                $existingEvent = (clone $eventBase)
                    ->where('metadata->source', 'subject')
                    ->first();
            } catch (Throwable $metadataError) {
                $existingEvent = (clone $eventBase)
                    ->where('metadata', 'like', '%"source":"subject"%')
                    ->first();
            }

            if ($timing['start_date']) {
                $room = array_key_exists('room', $data) ? $data['room'] : $subject->room;
                $payload = [
                    'user_id' => $user->id,
                    'subject_id' => $subject->id,
                    'study_log_id' => $existingEvent?->study_log_id,
                    'title' => $subject->name,
                    'description' => null,
                    'start_time' => $timing['start_at'],
                    'end_time' => $timing['end_at'],
                    'status' => 'planned',
                    'metadata' => [
                        'type' => 'class',
                        'all_day' => $timing['all_day'],
                        'source' => 'subject',
                        'room' => $room,
                    ],
                ];

                if ($this->hasColumnSafe((new StudyCalendarEvent())->getTable(), 'event_type')) {
                    $payload['event_type'] = 'class';
                }

                if ($this->hasColumnSafe((new StudyCalendarEvent())->getTable(), 'room')) {
                    $payload['room'] = $room;
                }

                if ($existingEvent) {
                    $existingEvent->update($payload);
                } else {
                    StudyCalendarEvent::create($payload);
                }
            } elseif ($existingEvent) {
                $existingEvent->delete();
            }
        } catch (Throwable $eventError) {
            report($eventError);
        }
    }

    private function filterSchedulePayload(array $data): array
    {
        $table = (new Subject())->getTable();

        if (! $this->hasColumnSafe($table, 'semester_id')) {
            unset($data['semester_id']);
        } elseif (array_key_exists('semester_id', $data) && $data['semester_id'] === '') {
            $data['semester_id'] = null;
        }

        if (! $this->hasColumnSafe($table, 'start_date')) {
            unset($data['start_date']);
        }

        if (! $this->hasColumnSafe($table, 'start_time')) {
            unset($data['start_time']);
        }

        if (! $this->hasColumnSafe($table, 'end_time')) {
            unset($data['end_time']);
        }

        if (! $this->hasColumnSafe($table, 'room')) {
            unset($data['room']);
        }

        $startDateType = $this->getColumnType($table, 'start_date');
        $startTimeType = $this->getColumnType($table, 'start_time');
        $endTimeType = $this->getColumnType($table, 'end_time');

        $normalizedStartDate = $this->normalizeDateForColumn($data['start_date'] ?? null, $startDateType);
        if (array_key_exists('start_date', $data)) {
            $data['start_date'] = $normalizedStartDate;
        }

        if (array_key_exists('start_time', $data)) {
            $data['start_time'] = $this->normalizeTimeForColumn($data['start_time'], $startTimeType, $normalizedStartDate);
        }

        if (array_key_exists('end_time', $data)) {
            $data['end_time'] = $this->normalizeTimeForColumn($data['end_time'], $endTimeType, $normalizedStartDate);
        }

        return $data;
    }

    private function normalizeDateForColumn(mixed $value, ?string $columnType): ?string
    {
        $raw = is_string($value) ? trim($value) : '';
        if ($raw === '') {
            return null;
        }

        $parsed = Carbon::parse($raw, config('app.timezone', 'Asia/Bangkok'));
        if ($this->isDateTimeColumn($columnType)) {
            return $parsed->startOfDay()->format('Y-m-d H:i:s');
        }

        return $parsed->format('Y-m-d');
    }

    private function normalizeTimeForColumn(mixed $value, ?string $columnType, ?string $normalizedDate): ?string
    {
        $raw = is_string($value) ? trim($value) : '';
        if ($raw === '') {
            return null;
        }

        $normalized = str_replace('.', ':', $raw);
        if (! preg_match('/^\d{1,2}:\d{2}(?::\d{2})?$/', $normalized)) {
            return null;
        }

        [$hourRaw, $minuteRaw, $secondRaw] = array_pad(explode(':', $normalized), 3, '00');
        $hour = (int) $hourRaw;
        $minute = (int) $minuteRaw;
        $second = (int) $secondRaw;

        if ($hour < 0 || $hour > 23 || $minute < 0 || $minute > 59 || $second < 0 || $second > 59) {
            return null;
        }

        $time = sprintf('%02d:%02d:%02d', $hour, $minute, $second);
        if (! $this->isDateTimeColumn($columnType)) {
            return $time;
        }

        $datePart = $normalizedDate
            ? Carbon::parse($normalizedDate, config('app.timezone', 'Asia/Bangkok'))->format('Y-m-d')
            : Carbon::now(config('app.timezone', 'Asia/Bangkok'))->format('Y-m-d');

        return $datePart . ' ' . $time;
    }

    private function getColumnType(string $table, string $column): ?string
    {
        try {
            $row = DB::selectOne(
                'SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
                [$table, $column]
            );
            return isset($row->DATA_TYPE) ? strtolower((string) $row->DATA_TYPE) : null;
        } catch (Throwable $error) {
            return null;
        }
    }

    private function isDateTimeColumn(?string $columnType): bool
    {
        return in_array($columnType, ['datetime', 'timestamp'], true);
    }

    private function resolveCurrentSemesterId(): ?int
    {
        if (! $this->hasTableSafe((new Semester())->getTable())) {
            return null;
        }

        $timezone = config('app.timezone', 'Asia/Bangkok');
        $now = Carbon::now($timezone);
        $beYear = (int) $now->year + 543;
        $month = (int) $now->month;

        // Typical Thai academic year:
        // - Semester 1: Jun-Oct (academic_year = current BE year)
        // - Semester 2: Nov-Mar (academic_year = BE year (Nov-Dec) or previous BE year (Jan-Mar))
        // - Summer: Apr-May (academic_year = previous BE year)
        if ($month >= 6 && $month <= 10) {
            $semester = 1;
            $academicYear = $beYear;
        } elseif ($month >= 11 || $month <= 3) {
            $semester = 2;
            $academicYear = $month <= 3 ? $beYear - 1 : $beYear;
        } else {
            $semester = 3;
            $academicYear = $beYear - 1;
        }

        $record = Semester::query()->firstOrCreate([
            'semester' => $semester,
            'academic_year' => $academicYear,
        ]);

        return $record?->semester_id ? (int) $record->semester_id : null;
    }

    private function canUseSemesterColumn(): bool
    {
        return $this->hasColumnSafe((new Subject())->getTable(), 'semester_id')
            && $this->hasTableSafe((new Semester())->getTable());
    }

    private function hasTableSafe(string $table): bool
    {
        static $cache = [];
        if (array_key_exists($table, $cache)) {
            return $cache[$table];
        }

        try {
            $exists = DB::selectOne(
                'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
                [$table]
            ) !== null;
        } catch (Throwable $error) {
            $exists = false;
        }

        $cache[$table] = $exists;
        return $exists;
    }

    private function hasColumnSafe(string $table, string $column): bool
    {
        $key = $table . '.' . $column;
        static $cache = [];
        if (array_key_exists($key, $cache)) {
            return $cache[$key];
        }

        try {
            $exists = DB::selectOne(
                'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
                [$table, $column]
            ) !== null;
        } catch (Throwable $error) {
            $exists = false;
        }

        $cache[$key] = $exists;
        return $exists;
    }
}

