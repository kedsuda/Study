<?php

namespace App\Http\Controllers;

use App\Models\LearningNotification;
use App\Models\NotificationEmailSetting;
use App\Models\Schedule;
use App\Models\Subject;
use App\Models\StudyCalendarEvent;
use App\Models\StudyLog;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        if (! $this->hasNotificationTable()) {
            return response()->json([]);
        }

        $this->ensureDailyScheduleNotifications($request->user());

        $notifications = LearningNotification::where('user_id', $request->user()->id)
            ->where(function ($query) {
                $query->whereNull('status')
                    ->orWhere('status', '!=', 'dismissed');
            })
            ->orderBy('notify_at', 'desc')
            ->get()
            ->filter(fn (LearningNotification $notification) => $this->isStudyNotification($notification))
            ->values();

        return response()->json($this->serializeNotifications($notifications, $request->user()));
    }

    public function store(Request $request): JsonResponse
    {
        if (! $this->hasNotificationTable()) {
            return response()->json(['message' => 'Notification table is missing'], 200);
        }

        $validated = $request->validate([
            'subject_id' => 'nullable|exists:subjects,id',
            'study_log_id' => 'nullable|exists:study_logs,id',
            'calendar_event_id' => 'nullable|exists:study_calendar_events,id',
            'type' => 'required|string',
            'title' => 'required|string',
            'message' => 'required|string',
            'notify_at' => 'required|date',
            'channel' => 'nullable|in:in_app,email,push,line',
        ]);

        $userId = $request->user()->id;
        $timezone = $this->resolveTimezone($request->user());
        $subjectId = $validated['subject_id'] ?? null;
        $studyLogId = $validated['study_log_id'] ?? null;
        $calendarEventId = $validated['calendar_event_id'] ?? null;

        if ($subjectId && ! $this->subjectBelongsToUser($subjectId, $userId)) {
            return response()->json(['message' => 'ไม่พบรายวิชาที่เลือก'], 422);
        }

        if ($studyLogId && ! $this->studyLogBelongsToUser($studyLogId, $userId)) {
            return response()->json(['message' => 'ไม่พบบันทึกการเรียนที่เลือก'], 422);
        }

        if ($calendarEventId && ! $this->calendarEventBelongsToUser($calendarEventId, $userId)) {
            return response()->json(['message' => 'ไม่พบตารางที่เลือก'], 422);
        }

        $notifyAt = Carbon::parse($validated['notify_at'], $timezone)->timezone($timezone);
        $notifyAtUtc = $notifyAt->copy()->utc();
        $title = $this->fitNotificationTitle($validated['title']);
        $message = $this->fitNotificationBody($validated['message']);

        $notification = LearningNotification::create([
            'user_id' => $userId,
            'subject_id' => $subjectId,
            'study_log_id' => $studyLogId,
            'calendar_event_id' => $calendarEventId,
            'title' => $title,
            'body' => $message,
            'notify_at' => $notifyAtUtc,
            // Always keep in-app as the primary channel.
            'channel' => $validated['channel'] ?? 'in_app',
            'status' => 'pending',
            'metadata' => [
                'type' => $validated['type'],
                'is_read' => false,
                'deliveries' => [
                    'in_app' => true,
                    'email' => true,
                ],
            ],
        ]);

        return response()->json($this->serializeNotification($notification, $request->user()), 201);
    }

    public function createScheduleNotification(Request $request): JsonResponse
    {
        if (! $this->hasNotificationTable()) {
            return response()->json(['message' => 'Notification table is missing'], 200);
        }

        $validated = $request->validate([
            'date' => 'required|date',
            'title' => 'nullable|string',
            'notify_time' => 'nullable|string',
        ]);

        $user = $request->user();
        $timezone = $this->resolveTimezone($user);
        $date = Carbon::parse($validated['date'], $timezone)->startOfDay();
        $notifyAt = $this->resolveNotifyAtForDate($user, $date, $validated['notify_time'] ?? null);
        $this->persistNotifyTime($user, $validated['notify_time'] ?? null);

        [$title, $message] = $this->buildScheduleCopy($user->id, $date, false, $timezone);
        $notification = $this->upsertScheduleNotification(
            $user->id,
            'schedule_day',
            $notifyAt,
            $validated['title'] ?? $title,
            $message
        );

        return response()->json($this->serializeNotification($notification, $user), 201);
    }

    public function createScheduleRange(Request $request): JsonResponse
    {
        if (! $this->hasNotificationTable()) {
            return response()->json(['message' => 'Notification table is missing'], 200);
        }

        $validated = $request->validate([
            'days' => 'required|integer|min:1|max:30',
            'subject_id' => 'nullable|exists:subjects,id',
            'title' => 'nullable|string',
            'notify_time' => 'nullable|string',
        ]);

        $user = $request->user();
        $timezone = $this->resolveTimezone($user);
        $days = (int) $validated['days'];
        $subjectId = $validated['subject_id'] ?? null;

        if ($subjectId && ! $this->subjectBelongsToUser($subjectId, $user->id)) {
            return response()->json(['message' => 'ไม่พบรายวิชาที่เลือก'], 422);
        }

        [$title, $message, $notifyAt] = $this->buildRangeScheduleCopy(
            $user->id,
            $days,
            $subjectId,
            $validated['title'] ?? null,
            $timezone
        );

        $notifyAt = $this->resolveNotifyAtForDate($user, $notifyAt, $validated['notify_time'] ?? null);
        $this->persistNotifyTime($user, $validated['notify_time'] ?? null);

        $notification = $this->upsertScheduleNotification(
            $user->id,
            'schedule_range',
            $notifyAt,
            $title,
            $message,
            $subjectId
        );

        return response()->json($this->serializeNotification($notification, $user), 201);
    }

    public function markAsRead(LearningNotification $notification): JsonResponse
    {
        if (! $this->hasNotificationTable()) {
            return response()->json([], 200);
        }

        $this->authorizeNotification($notification, request()->user()->id);
        $metadata = $this->mergeMetadata($notification->metadata, ['is_read' => true]);
        $notification->update(['metadata' => $metadata]);
        return response()->json($this->serializeNotification($notification, request()->user()));
    }

    public function markAsDelivered(LearningNotification $notification): JsonResponse
    {
        if (! $this->hasNotificationTable()) {
            return response()->json([], 200);
        }

        $user = request()->user();
        $this->authorizeNotification($notification, $user->id);

        // Preserve the first moment the alert was actually shown.  notify_at is
        // only the scheduled time and may be different when the app was closed.
        if (! $notification->delivered_at) {
            // `learning_notifications` stores instants in UTC.  Without this
            // conversion a Bangkok time is written as though it were UTC and
            // comes back seven hours later on the next API request.
            $notification->update(['delivered_at' => Carbon::now($this->resolveTimezone($user))->utc()]);
        }

        return response()->json($this->serializeNotification($notification, $user));
    }

    public function unread(Request $request): JsonResponse
    {
        if (! $this->hasNotificationTable()) {
            return response()->json(['unread_count' => 0]);
        }

        // Keep the bell badge in sync even when the client only asks for its
        // unread count instead of loading the full notifications page.
        $this->ensureDailyScheduleNotifications($request->user());

        $count = LearningNotification::where('user_id', $request->user()->id)
            ->where(function ($query) {
                $query->whereNull('status')
                    ->orWhere('status', '!=', 'dismissed');
            })
            ->get(['id', 'metadata'])
            ->filter(fn (LearningNotification $notification) => $this->isStudyNotification($notification))
            ->filter(fn (LearningNotification $notification) => ! data_get($notification->metadata, 'is_read', false))
            ->count();

        return response()->json(['unread_count' => $count]);
    }

    public function destroy(LearningNotification $notification): JsonResponse
    {
        if (! $this->hasNotificationTable()) {
            return response()->json(status: 204);
        }

        $this->authorizeNotification($notification, request()->user()->id);
        $type = data_get($notification->metadata, 'type');
        if (in_array($type, ['today_schedule', 'tomorrow_schedule'], true)) {
            $metadata = $this->mergeMetadata($notification->metadata, [
                'is_read' => true,
                'dismissed_at' => Carbon::now()->toIso8601String(),
            ]);
            $notification->update([
                'status' => 'dismissed',
                'metadata' => $metadata,
            ]);
            return response()->json(status: 204);
        }

        $notification->delete();
        return response()->json(status: 204);
    }

    public function updateTime(Request $request, LearningNotification $notification): JsonResponse
    {
        if (! $this->hasNotificationTable()) {
            return response()->json([], 200);
        }

        $this->authorizeNotification($notification, request()->user()->id);

        $validated = $request->validate([
            'notify_time' => 'nullable|string',
            'notify_date' => 'nullable|date',
        ]);

        $notifyTime = $validated['notify_time'] ?? null;
        $notifyDate = $validated['notify_date'] ?? null;

        if (! $notifyTime && ! $notifyDate) {
            return response()->json(['message' => 'ต้องระบุวันหรือเวลาอย่างน้อยหนึ่งรายการ'], 422);
        }

        $timezone = $this->resolveTimezone($request->user());
        $current = $notification->notify_at
            ? $notification->notify_at->timezone($timezone)
            : Carbon::now($timezone);

        $dateValue = $notifyDate ? Carbon::parse($notifyDate, $timezone)->toDateString() : $current->toDateString();

        $timeValue = $notifyTime ? $this->normalizeTimeString($notifyTime) : $current->format('H:i:s');
        if (! $timeValue) {
            return response()->json(['message' => 'รูปแบบเวลาไม่ถูกต้อง'], 422);
        }

        $notifyAt = Carbon::parse($dateValue.' '.$timeValue, $timezone);
        $notifyAtUtc = $notifyAt->copy()->utc();
        $nextBody = $notification->body;
        if (data_get($notification->metadata, 'type') === 'subject_reminder') {
            $subjectName = trim((string) ($notification->subject?->name ?? 'รายวิชา'));
            $nextBody = $this->buildSubjectReminderBody($notifyAt, $subjectName);
        }
        $metadata = $this->mergeMetadata($notification->metadata, [
            'custom_notify_at' => $notifyAt->toIso8601String(),
        ]);
        $notification->update([
            'notify_at' => $notifyAtUtc,
            'body' => $this->fitNotificationBody($nextBody),
            'metadata' => $metadata,
        ]);

        if ($notifyTime && in_array($notification->type, ['today_schedule', 'tomorrow_schedule'], true)) {
            $settings = $this->resolveEmailSettings($request->user());
            $settings?->update(['send_time' => $this->formatSendTimeForStorage($timeValue)]);
        }

        return response()->json($this->serializeNotification($notification, $request->user()));
    }

    public function settings(Request $request): JsonResponse
    {
        if (! Schema::hasTable((new NotificationEmailSetting())->getTable())) {
            return response()->json([
                'send_time' => '00:00:00',
                'timezone' => 'Asia/Bangkok',
                'email_enabled' => true,
            ]);
        }

        $settings = $this->resolveEmailSettings($request->user());

        return response()->json([
            'send_time' => $this->normalizeTimeString($settings?->send_time) ?: '00:00:00',
            'timezone' => $settings?->timezone ?: 'Asia/Bangkok',
            'email_enabled' => (bool) ($settings?->email_enabled ?? true),
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        if (! Schema::hasTable((new NotificationEmailSetting())->getTable())) {
            return response()->json(['message' => 'Notification settings table is missing'], 200);
        }

        $validated = $request->validate([
            'send_time' => 'required|string',
        ]);

        $time = $this->normalizeTimeString($validated['send_time']);
        if (! $time) {
            return response()->json(['message' => 'รูปแบบเวลาไม่ถูกต้อง'], 422);
        }

        $settings = $this->resolveEmailSettings($request->user());
        $settings?->update(['send_time' => $this->formatSendTimeForStorage($time)]);
        $this->updateScheduleNotificationTimes($request->user(), $time);

        return response()->json([
            'send_time' => $time,
        ]);
    }

    private function ensureDailyScheduleNotifications(User $user): void
    {
        if (! $this->hasNotificationTable()) {
            return;
        }

        $timezone = $this->resolveTimezone($user);
        $today = Carbon::now($timezone)->startOfDay();
        $tomorrow = $today->copy()->addDay();
        $notifyAtToday = $this->resolveNotifyAtForDate($user, $today, null);
        $notifyAtTomorrow = $this->resolveNotifyAtForDate($user, $tomorrow, null);

        $this->upsertDailyScheduleNotification($user, $today, $notifyAtToday, 'today_schedule', false, 'วันนี้');
        $this->upsertDailyScheduleNotification($user, $tomorrow, $notifyAtTomorrow, 'tomorrow_schedule', true, 'พรุ่งนี้');
    }

    private function buildScheduleCopy(
        int $userId,
        Carbon $date,
        bool $isTomorrow,
        string $timezone,
        ?string $relativeLabel = null
    ): array
    {
        $dayNameTh = $this->thaiDayName($date);
        $events = $this->classScheduleForDate($userId, $date, $timezone);

        $dateLabel = $relativeLabel ?: ($isTomorrow ? 'พรุ่งนี้' : $date->format('d M Y'));
        $title = $isTomorrow
            ? 'แจ้งเตือนเรียนพรุ่งนี้'
            : ($relativeLabel === 'วันนี้' ? 'แจ้งเตือนเรียนวันนี้' : "แจ้งเตือนเรียน {$dayNameTh}");
        $message = $events->isEmpty()
            ? "{$dateLabel} ({$dayNameTh}) คุณไม่มีตารางเรียน"
            : $this->buildCompactScheduleMessage($dateLabel, $dayNameTh, $events, $timezone);

        return [$title, $message];
    }

    private function buildRangeScheduleCopy(
        int $userId,
        int $days,
        ?int $subjectId,
        ?string $customTitle,
        string $timezone
    ): array {
        $start = Carbon::now($timezone)->addDay()->startOfDay();
        $end = $start->copy()->addDays($days - 1)->endOfDay();
        $events = $this->calendarEventsForRange($userId, $start, $end, $subjectId);
        $eventsByDate = $events->groupBy(function ($event) use ($timezone) {
            return $event->start_time->timezone($timezone)->toDateString();
        });

        $lines = [];
        for ($i = 0; $i < $days; $i++) {
            $day = $start->copy()->addDays($i);
            $dayKey = $day->toDateString();
            $dayTh = $this->thaiDayName($day);
            $label = $day->isSameDay($start) ? 'พรุ่งนี้' : $day->format('d M');

            $matches = $eventsByDate->get($dayKey, collect());
            if ($matches->isEmpty()) {
                $lines[] = "{$label} ({$dayTh}) ว่าง";
                continue;
            }

            $parts = $matches->map(fn ($event) => $this->formatEventLabel($event, $timezone))
                ->values()
                ->all();

            $lines[] = $this->fitNotificationBody("{$label} ({$dayTh}): ".implode('; ', $parts), 220);
        }

        $title = $customTitle ?: "ตารางเรียน {$days} วันข้างหน้า";
        $message = $this->fitNotificationBody(implode(' | ', $lines), 240);

        return [$title, $message, $start->copy()->startOfDay()];
    }

    private function authorizeNotification(LearningNotification $notification, int $userId): void
    {
        abort_unless($notification->user_id === $userId, 403, 'Unauthorized');
    }

    private function calendarEventsForDate(int $userId, Carbon $date, string $timezone, ?int $subjectId = null)
    {
        if (! $this->hasCalendarTable()) {
            return collect();
        }

        $start = $date->copy()->startOfDay();
        $end = $date->copy()->endOfDay();

        return $this->safeCalendarQuery($userId, $start, $end, $subjectId);
    }

    /**
     * Returns both dated calendar classes and recurring rows from the legacy
     * schedules table.  The latter is important for timetables that repeat
     * every week and therefore do not have a calendar event for every date.
     */
    private function classScheduleForDate(int $userId, Carbon $date, string $timezone)
    {
        $calendarEvents = $this->calendarEventsForDate($userId, $date, $timezone);
        $recurringSchedules = $this->recurringSchedulesForDate($userId, $date);
        $recurringSubjects = $this->recurringSubjectsForDate($userId, $date);

        return $calendarEvents
            ->concat($recurringSchedules)
            ->concat($recurringSubjects)
            ->unique(function ($item) use ($timezone) {
                // Subjects are returned directly here, so their identifier is
                // `id` rather than `subject_id` like calendar/schedule rows.
                // Normalize both shapes before removing duplicate class slots.
                $subjectId = $item instanceof Subject
                    ? (int) $item->getKey()
                    : (int) ($item->subject_id ?? 0);

                return $subjectId.'|'.$this->scheduleItemStartTime($item, $timezone);
            })
            ->sortBy(fn ($item) => $this->scheduleItemStartTime($item, $timezone))
            ->values();
    }

    private function recurringSchedulesForDate(int $userId, Carbon $date)
    {
        if (! Schema::hasTable((new Schedule())->getTable())) {
            return collect();
        }

        try {
            $scheduleTable = (new Schedule())->getTable();
            $subjectTable = (new Subject())->getTable();
            $query = Schedule::withoutGlobalScopes()
                ->with('subject')
                ->whereHas('subject', fn ($subjectQuery) => $subjectQuery
                    ->withoutGlobalScopes()
                    ->where("{$subjectTable}.user_id", $userId));

            if (Schema::hasColumn($scheduleTable, 'schedule_type')) {
                $query->where(function ($scheduleQuery) {
                    $scheduleQuery->whereNull('schedule_type')
                        ->orWhere('schedule_type', 'class');
                });
            }

            return $query->get()
                ->filter(fn (Schedule $schedule) => $this->scheduleMatchesDate($schedule, $date))
                ->values();
        } catch (\Throwable $e) {
            return collect();
        }
    }

    /**
     * The timetable page treats a subject's start_date as the weekday on which
     * that subject recurs.  Reuse that same convention for today's and
     * tomorrow's notifications instead of only matching one dated calendar
     * event.
     */
    private function recurringSubjectsForDate(int $userId, Carbon $date)
    {
        $subjectTable = (new Subject())->getTable();

        if (! Schema::hasTable($subjectTable) || ! Schema::hasColumn($subjectTable, 'start_date')) {
            return collect();
        }

        try {
            return Subject::withoutGlobalScopes()
                ->where('user_id', $userId)
                ->whereNotNull('start_date')
                ->get()
                ->filter(function (Subject $subject) use ($date) {
                    try {
                        return Carbon::parse($subject->start_date)->dayOfWeek === $date->dayOfWeek;
                    } catch (\Throwable $e) {
                        return false;
                    }
                })
                ->values();
        } catch (\Throwable $e) {
            return collect();
        }
    }

    private function scheduleMatchesDate(Schedule $schedule, Carbon $date): bool
    {
        if ($this->scheduleDayMatchesDate($schedule->day_of_week, $date)) {
            return true;
        }

        // Older imported timetable rows can contain relative labels such as
        // "วันนี้".  Their stored start time still has the original weekday,
        // which is the stable value to use for a repeating timetable.
        try {
            return $schedule->start_time && Carbon::parse($schedule->start_time)->dayOfWeek === $date->dayOfWeek;
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function scheduleDayMatchesDate(mixed $dayOfWeek, Carbon $date): bool
    {
        $day = Str::lower(trim((string) $dayOfWeek));
        $day = preg_replace('/^วัน/u', '', $day) ?? $day;
        $englishDay = Str::lower($date->format('l'));
        $thaiDays = [
            'monday' => 'จันทร์',
            'tuesday' => 'อังคาร',
            'wednesday' => 'พุธ',
            'thursday' => 'พฤหัสบดี',
            'friday' => 'ศุกร์',
            'saturday' => 'เสาร์',
            'sunday' => 'อาทิตย์',
        ];

        return $day === $englishDay || $day === Str::lower($thaiDays[$englishDay] ?? '');
    }

    private function calendarEventsForRange(int $userId, Carbon $start, Carbon $end, ?int $subjectId = null)
    {
        if (! $this->hasCalendarTable()) {
            return collect();
        }

        return $this->safeCalendarQuery($userId, $start, $end, $subjectId);
    }

    private function safeCalendarQuery(int $userId, Carbon $start, Carbon $end, ?int $subjectId = null)
    {
        try {
            $this->syncStudyLogEvents($userId, $start, $end);
            $events = StudyCalendarEvent::with(['subject', 'studyLog'])
                ->where('user_id', $userId)
                ->when($subjectId, fn ($q) => $q->where('subject_id', $subjectId))
                ->whereBetween('start_time', [$start, $end])
                ->orderBy('start_time')
                ->get();

            return $events
                ->filter(fn (StudyCalendarEvent $event) => $this->isSubjectClassEvent($event))
                ->reject(fn (StudyCalendarEvent $event) => $this->isSummaryEvent($event))
                ->values();
        } catch (\Throwable $e) {
            return collect();
        }
    }

    private function hasNotificationTable(): bool
    {
        return Schema::hasTable((new LearningNotification())->getTable());
    }

    private function hasCalendarTable(): bool
    {
        return Schema::hasTable((new StudyCalendarEvent())->getTable());
    }

    private function subjectBelongsToUser(int $subjectId, int $userId): bool
    {
        return Subject::where('id', $subjectId)->where('user_id', $userId)->exists();
    }

    private function studyLogBelongsToUser(int $studyLogId, int $userId): bool
    {
        return StudyLog::where('id', $studyLogId)
            ->whereHas('subject', fn ($query) => $query->where('user_id', $userId))
            ->exists();
    }

    private function calendarEventBelongsToUser(int $eventId, int $userId): bool
    {
        return StudyCalendarEvent::where('id', $eventId)
            ->where('user_id', $userId)
            ->exists();
    }

    private function syncStudyLogEvents(int $userId, Carbon $start, Carbon $end): void
    {
        if (! $this->hasCalendarTable()) {
            return;
        }

        if (! Schema::hasTable((new StudyLog())->getTable())) {
            return;
        }

        StudyCalendarEvent::where('user_id', $userId)
            ->whereNotNull('study_log_id')
            ->whereDoesntHave('studyLog')
            ->delete();

        $logs = StudyLog::query()
            ->whereHas('subject', fn ($query) => $query->where('user_id', $userId))
            ->whereDate('log_date', '>=', $start->toDateString())
            ->whereDate('log_date', '<=', $end->toDateString())
            ->get();

        foreach ($logs as $log) {
            if ($this->isSummaryLog($log)) {
                StudyCalendarEvent::where('study_log_id', $log->id)
                    ->where('user_id', $userId)
                    ->delete();
                continue;
            }

            $existing = StudyCalendarEvent::where('study_log_id', $log->id)
                ->where('user_id', $userId)
                ->first();

            if ($existing && data_get($existing->metadata, 'source') === 'subject') {
                continue;
            }

            $startTime = Carbon::parse($log->log_date)->startOfDay();
            $metadata = [
                'source' => 'study_log',
                'all_day' => true,
            ];

            if (! is_null($log->duration_minutes)) {
                $metadata['duration_minutes'] = $log->duration_minutes;
            }

            $eventPayload = [
                'user_id' => $userId,
                'subject_id' => $log->subject_id,
                'study_log_id' => $log->id,
                'title' => $log->title,
                'description' => $log->note,
                'start_time' => $startTime,
                'end_time' => null,
                'status' => 'planned',
                'metadata' => $metadata,
            ];

            if (Schema::hasColumn((new StudyCalendarEvent())->getTable(), 'event_type')) {
                $eventPayload['event_type'] = 'class';
            }

            StudyCalendarEvent::updateOrCreate(
                ['study_log_id' => $log->id, 'user_id' => $userId],
                $eventPayload
            );
        }
    }

    private function resolveEmailSettings(User $user): ?NotificationEmailSetting
    {
        if (! Schema::hasTable((new NotificationEmailSetting())->getTable())) {
            return null;
        }

        $existing = NotificationEmailSetting::where('user_id', $user->id)->first();
        if ($existing) {
            return $existing;
        }

        $payload = [
            'user_id' => $user->id,
            'email_enabled' => true,
            'email_address' => $user->email,
            'digest_type' => 'daily',
            'days_ahead' => 1,
            'send_time' => $this->formatSendTimeForStorage('00:00:00'),
            'timezone' => 'Asia/Bangkok',
        ];

        try {
            return NotificationEmailSetting::create($payload);
        } catch (QueryException $e) {
            if (strpos($e->getMessage(), "Field 'id' doesn't have a default value") === false) {
                throw $e;
            }
            $nextId = (int) NotificationEmailSetting::withoutGlobalScopes()->max('id') + 1;
            $payload['id'] = $nextId > 0 ? $nextId : 1;
            return NotificationEmailSetting::create($payload);
        }
    }

    private function resolveTimezone(User $user): string
    {
        $settings = $this->resolveEmailSettings($user);
        return $settings?->timezone ?: 'Asia/Bangkok';
    }

    private function normalizeTimeString(?string $time): ?string
    {
        if (! $time) {
            return null;
        }

        $time = trim($time);
        if (preg_match('/(?:^|\s|T)(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/', $time, $matches)) {
            $hour = (int) $matches[1];
            $minute = (int) $matches[2];
            $second = isset($matches[3]) ? (int) $matches[3] : 0;

            if ($hour < 0 || $hour > 23 || $minute < 0 || $minute > 59 || $second < 0 || $second > 59) {
                return null;
            }

            return sprintf('%02d:%02d:%02d', $hour, $minute, $second);
        }

        return null;
    }

    private function resolveNotifyAtForDate(User $user, Carbon $date, ?string $notifyTime): Carbon
    {
        $timezone = $this->resolveTimezone($user);
        $settings = $this->resolveEmailSettings($user);
        $time = $this->normalizeTimeString($notifyTime)
            ?: $this->normalizeTimeString($settings?->send_time)
            ?: '00:00:00';

        return Carbon::parse($date->toDateString().' '.$time, $timezone);
    }

    private function persistNotifyTime(User $user, ?string $notifyTime): void
    {
        $time = $this->normalizeTimeString($notifyTime);
        if (! $time) {
            return;
        }

        $settings = $this->resolveEmailSettings($user);
        $settings?->update(['send_time' => $this->formatSendTimeForStorage($time)]);
    }

    private function formatSendTimeForStorage(string $time): string
    {
        $table = (new NotificationEmailSetting())->getTable();
        $columnType = '';
        try {
            $columnType = Schema::getColumnType($table, 'send_time');
        } catch (\Throwable $e) {
            $columnType = '';
        }

        if (in_array($columnType, ['datetime', 'timestamp'], true)) {
            return Carbon::today('Asia/Bangkok')->format('Y-m-d').' '.$time;
        }

        return $time;
    }

    private function updateScheduleNotificationTimes(User $user, string $time): void
    {
        if (! $this->hasNotificationTable()) {
            return;
        }

        $timezone = $this->resolveTimezone($user);
        $types = ['today_schedule', 'tomorrow_schedule', 'schedule_range', 'schedule_day'];

        $notifications = LearningNotification::where('user_id', $user->id)
            ->get()
            ->filter(function (LearningNotification $notification) use ($types) {
                $type = data_get($notification->metadata, 'type');
                return $type && in_array($type, $types, true);
            })
            ->values();

        foreach ($notifications as $notification) {
            $current = $notification->notify_at
                ? $notification->notify_at->timezone($timezone)
                : Carbon::now($timezone);

            $notifyAt = Carbon::parse($current->toDateString().' '.$time, $timezone);
            $notification->update(['notify_at' => $notifyAt->utc()]);
        }
    }

    private function thaiDayName(Carbon $date): string
    {
        $dayMap = [
            'Monday' => 'จันทร์',
            'Tuesday' => 'อังคาร',
            'Wednesday' => 'พุธ',
            'Thursday' => 'พฤหัสบดี',
            'Friday' => 'ศุกร์',
            'Saturday' => 'เสาร์',
            'Sunday' => 'อาทิตย์',
        ];

        $dayNameEn = $date->format('l');
        return $dayMap[$dayNameEn] ?? $dayNameEn;
    }

    private function formatEventLabel(mixed $event, string $timezone): string
    {
        $baseLabel = $event instanceof Subject
            ? $event->name
            : ($event->subject?->name ?: ($event->title ?: 'กิจกรรมไม่ระบุ'));
        $eventType = $event instanceof Schedule || $event instanceof Subject
            ? 'class'
            : (string) ($event->event_type ?? data_get($event->metadata, 'type') ?? '');
        $typeLabel = match ($eventType) {
            'class' => 'เรียน',
            'exam' => 'สอบ',
            'other' => 'กิจกรรม',
            default => '',
        };
        $label = $typeLabel !== '' ? "{$typeLabel}: {$baseLabel}" : $baseLabel;

        $description = trim((string) ($event->description ?? ''));
        if (data_get($event->metadata, 'all_day')) {
            return $description !== '' ? "{$label} ({$description})" : $label;
        }

        $start = $this->scheduleItemStartTime($event, $timezone);
        $end = $this->scheduleItemEndTime($event, $timezone);
        $time = $start;

        if ($end) {
            $time = $start ? "{$start}-{$end}" : $end;
        }

        $line = $time ? "{$label} เวลา {$time}" : "{$label} เวลา ไม่ระบุ";
        $room = $this->scheduleItemRoom($event);
        $line .= ' ห้อง '.($room !== '' ? $room : 'ไม่ระบุ');

        return $description !== '' ? "{$line} ({$description})" : $line;
    }

    private function scheduleItemStartTime(mixed $item, string $timezone): string
    {
        return $this->formatScheduleTime($item->start_time ?? null, $timezone);
    }

    private function scheduleItemEndTime(mixed $item, string $timezone): string
    {
        return $this->formatScheduleTime($item->end_time ?? null, $timezone);
    }

    private function formatScheduleTime(mixed $value, string $timezone): string
    {
        if ($value instanceof \DateTimeInterface) {
            return Carbon::instance($value)->timezone($timezone)->format('H:i');
        }

        $raw = trim((string) $value);
        if ($raw === '') {
            return '';
        }

        if (preg_match('/(?:^|[ T])(\d{1,2}:\d{2})(?::\d{2})?$/', $raw, $matches)) {
            return str_pad($matches[1], 5, '0', STR_PAD_LEFT);
        }

        try {
            return Carbon::parse($raw, $timezone)->format('H:i');
        } catch (\Throwable $e) {
            return '';
        }
    }

    private function scheduleItemRoom(mixed $item): string
    {
        $room = trim((string) ($item->room ?? ''));
        if ($room !== '') {
            return $room;
        }

        $room = trim((string) ($item->location ?? ''));
        if ($room !== '') {
            return $room;
        }

        $metadataRoom = data_get($item->metadata, 'room');
        if (is_string($metadataRoom) && trim($metadataRoom) !== '') {
            return trim($metadataRoom);
        }

        return trim((string) ($item->subject?->room ?? ''));
    }

    private function upsertScheduleNotification(
        int $userId,
        string $type,
        Carbon $notifyAt,
        string $title,
        string $message,
        ?int $subjectId = null,
        string $channel = 'email'
    ): LearningNotification {
        // Keep DATETIME values in UTC.  All API output is converted back to the
        // user's configured timezone in serializeNotification().
        $storedNotifyAt = $notifyAt->copy()->utc();
        $query = LearningNotification::where('user_id', $userId)
            ->where('channel', $channel)
            ->whereDate('notify_at', $storedNotifyAt->toDateString());

        if ($subjectId) {
            $query->where('subject_id', $subjectId);
        }

        $notification = $query->get()
            ->first(fn (LearningNotification $candidate) => data_get($candidate->metadata, 'type') === $type);
        $metadata = $this->mergeMetadata($notification?->metadata, ['type' => $type]);
        if (! array_key_exists('is_read', $metadata)) {
            $metadata['is_read'] = false;
        }

        if ($notification) {
            $notification->update([
                'subject_id' => $subjectId,
                'title' => $this->fitNotificationTitle($title),
                'body' => $this->fitNotificationBody($message),
                'notify_at' => $storedNotifyAt,
                'status' => $notification->status ?? 'pending',
                'metadata' => $metadata,
            ]);
            return $notification;
        }

        return LearningNotification::create([
            'user_id' => $userId,
            'subject_id' => $subjectId,
            'study_log_id' => null,
            'calendar_event_id' => null,
            'title' => $this->fitNotificationTitle($title),
            'body' => $this->fitNotificationBody($message),
            'notify_at' => $storedNotifyAt,
            'channel' => $channel,
            'status' => 'pending',
            'metadata' => $metadata,
        ]);
    }

    private function upsertDailyScheduleNotification(
        User $user,
        Carbon $date,
        Carbon $notifyAt,
        string $type,
        bool $isTomorrow,
        string $relativeLabel
    ): void {
        $timezone = $this->resolveTimezone($user);
        if ($this->isDailyScheduleDismissedForDate($user->id, $type, $notifyAt->toDateString(), $timezone)) {
            return;
        }

        [$title, $message] = $this->buildScheduleCopy($user->id, $date, $isTomorrow, $timezone, $relativeLabel);

        $sameTypeNotifications = LearningNotification::where('user_id', $user->id)
            ->get()
            ->filter(fn (LearningNotification $candidate) => data_get($candidate->metadata, 'type') === $type)
            ->values();

        $notification = $sameTypeNotifications
            ->sortByDesc(fn (LearningNotification $candidate) => $candidate->updated_at?->timestamp ?? 0)
            ->first();

        $sameTypeNotifications
            ->filter(fn (LearningNotification $candidate) => ! $notification || $candidate->id !== $notification->id)
            ->each
            ->delete();

        $metadata = $this->mergeMetadata($notification?->metadata, ['type' => $type]);
        if (! array_key_exists('is_read', $metadata)) {
            $metadata['is_read'] = false;
        }

        $resolvedNotifyAt = $this->resolveStoredNotifyAt($metadata, $notifyAt, $timezone)->utc();

        if ($notification) {
            $notification->update([
                'title' => $this->fitNotificationTitle($title),
                'body' => $this->fitNotificationBody($message),
                'notify_at' => $resolvedNotifyAt,
                'status' => $notification->status ?? 'pending',
                'metadata' => $metadata,
            ]);
        } else {
            $notification = LearningNotification::create([
                'user_id' => $user->id,
                'subject_id' => null,
                'study_log_id' => null,
                'calendar_event_id' => null,
                'title' => $this->fitNotificationTitle($title),
                'body' => $this->fitNotificationBody($message),
                'notify_at' => $resolvedNotifyAt,
                'channel' => 'in_app',
                'status' => 'pending',
                'metadata' => $metadata,
            ]);
        }

    }

    private function mergeMetadata(?array $metadata, array $updates): array
    {
        $metadata = is_array($metadata) ? $metadata : [];

        return array_merge($metadata, $updates);
    }

    private function serializeNotifications($notifications, User $user): array
    {
        return collect($notifications)
            ->map(fn (LearningNotification $notification) => $this->serializeNotification($notification, $user))
            ->values()
            ->all();
    }

    private function serializeNotification(LearningNotification $notification, User $user): array
    {
        $payload = $notification->toArray();
        $timezone = $this->resolveTimezone($user);
        // The timezone offset is deliberately included.  A plain date-time
        // string makes browsers interpret the same notification differently
        // depending on the visitor's computer timezone.
        $payload['notify_at'] = $notification->notify_at?->timezone($timezone)->toIso8601String();
        $payload['delivered_at'] = $notification->delivered_at?->timezone($timezone)->toIso8601String();

        return $payload;
    }

    private function resolveStoredNotifyAt(array $metadata, Carbon $defaultNotifyAt, string $timezone): Carbon
    {
        $custom = data_get($metadata, 'custom_notify_at');
        if (! is_string($custom) || trim($custom) === '') {
            return $defaultNotifyAt;
        }

        try {
            return Carbon::parse($custom, $timezone);
        } catch (\Throwable $e) {
            return $defaultNotifyAt;
        }
    }

    private function buildCompactScheduleMessage(
        string $dateLabel,
        string $dayNameTh,
        $events,
        string $timezone
    ): string {
        $labels = $events
            ->map(fn ($event) => $this->formatEventLabel($event, $timezone))
            ->filter(fn ($label) => $label !== '')
            ->values();

        $items = $labels->map(fn ($label) => "- {$label}")->implode("\n");

        return $this->fitNotificationBody(
            "{$dateLabel} ({$dayNameTh}) คุณมี {$labels->count()} รายการ\n{$items}",
            1000
        );
    }

    private function fitNotificationTitle(string $value, int $fallback = 150): string
    {
        return $this->fitNotificationText('title', $value, $fallback);
    }

    private function fitNotificationBody(string $value, int $fallback = 240): string
    {
        return $this->fitNotificationText('body', $value, $fallback);
    }

    private function fitNotificationText(string $column, string $value, int $fallback): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        $limit = $this->resolveNotificationColumnLength($column) ?: $fallback;
        if ($limit <= 0) {
            return $value;
        }

        if (mb_strlen($value) <= $limit) {
            return $value;
        }

        $suffix = $limit > 3 ? '...' : '';
        $sliceLength = max(1, $limit - mb_strlen($suffix));

        return rtrim(mb_substr($value, 0, $sliceLength)).$suffix;
    }

    private function resolveNotificationColumnLength(string $column): ?int
    {
        static $cache = [];

        if (array_key_exists($column, $cache)) {
            return $cache[$column];
        }

        try {
            $database = DB::getDatabaseName();
            $row = DB::table('information_schema.COLUMNS')
                ->select('CHARACTER_MAXIMUM_LENGTH', 'DATA_TYPE')
                ->where('TABLE_SCHEMA', $database)
                ->where('TABLE_NAME', (new LearningNotification())->getTable())
                ->where('COLUMN_NAME', $column)
                ->first();

            if (! $row) {
                return $cache[$column] = null;
            }

            $dataType = strtolower((string) ($row->DATA_TYPE ?? ''));
            if (in_array($dataType, ['text', 'mediumtext', 'longtext'], true)) {
                return $cache[$column] = null;
            }

            $maxLength = (int) ($row->CHARACTER_MAXIMUM_LENGTH ?? 0);
            return $cache[$column] = $maxLength > 0 ? $maxLength : null;
        } catch (\Throwable $e) {
            return $cache[$column] = null;
        }
    }

    private function isSummaryEvent(StudyCalendarEvent $event): bool
    {
        if ($this->isSummaryText($event->title) || $this->isSummaryText($event->description)) {
            return true;
        }

        if ($event->study_log_id) {
            if (! $event->studyLog) {
                return true;
            }

            if ($this->isSummaryLog($event->studyLog)) {
                return true;
            }
        }

        return false;
    }

    private function isSubjectClassEvent(StudyCalendarEvent $event): bool
    {
        if (! $event->subject_id) {
            return false;
        }

        $eventType = Str::lower((string) ($event->event_type ?? data_get($event->metadata, 'type') ?? ''));
        if ($eventType !== '' && $eventType !== 'class') {
            return false;
        }

        $source = Str::lower((string) data_get($event->metadata, 'source', ''));
        if ($source !== '' && ! in_array($source, ['subject', 'study_log'], true)) {
            return false;
        }

        return true;
    }

    private function isSummaryLog(?StudyLog $log): bool
    {
        if (! $log) {
            return false;
        }

        if ($log->isSummary()) {
            return true;
        }

        return $this->isSummaryText($log->title) || $this->isSummaryText($log->note);
    }

    private function isSummaryText(?string $text): bool
    {
        $value = trim((string) $text);
        if ($value === '') {
            return false;
        }

        $lower = Str::lower($value);
        if (Str::startsWith($lower, ['สรุป', 'summary'])) {
            return true;
        }

        return Str::contains($lower, [
            'สรุปเอกสาร',
            'สรุปเสียง',
            'อัปโหลดไฟล์เพื่อสรุป',
            'อัปโหลดเสียงเพื่อสรุป',
            'summary',
        ]);
    }

    private function isStudyNotification(LearningNotification $notification): bool
    {
        $type = data_get($notification->metadata, 'type');

        return in_array($type, [
            'today_schedule',
            'tomorrow_schedule',
            'schedule_day',
            'schedule_range',
            'subject_reminder',
        ], true);
    }

    private function isDailyScheduleDismissedForDate(int $userId, string $type, string $date, string $timezone): bool
    {
        return LearningNotification::where('user_id', $userId)
            ->where('status', 'dismissed')
            ->get(['notify_at', 'metadata'])
            ->contains(fn (LearningNotification $item) => data_get($item->metadata, 'type') === $type
                && $item->notify_at?->timezone($timezone)->toDateString() === $date);
    }

    private function buildSubjectReminderBody(Carbon $notifyAt, string $subjectName): string
    {
        $dateLabel = $notifyAt->copy()->locale('th')->translatedFormat('j M Y');
        $timeLabel = $notifyAt->format('H:i');

        return "แจ้งเตือนว่า {$dateLabel} เวลา {$timeLabel} น. มีเรียนวิชา \"{$subjectName}\"";
    }
}
