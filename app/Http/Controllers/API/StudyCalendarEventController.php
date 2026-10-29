<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Resources\StudyCalendarEventResource;
use App\Models\StudyCalendarEvent;
use App\Models\StudyLog;
use App\Models\Subject;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class StudyCalendarEventController extends Controller
{
    private const EVENT_TYPES = ['class', 'exam', 'other'];
    private const CALENDAR_TIMEZONE = 'Asia/Bangkok';

    public function __construct()
    {
        // ✅ บังคับต้องล็อกอินก่อนทุก action
        $this->middleware('auth:sanctum');
    }

    public function index(Request $request): JsonResponse
    {
        if (! $this->hasCalendarTable()) {
            return response()->json([]);
        }

        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        // ✅ parse ช่วงเวลา (ถ้ามี) แล้ว sync log -> event
        $start = $request->filled('start')
            ? Carbon::parse($request->input('start'), self::CALENDAR_TIMEZONE)->startOfDay()
            : null;
        $end = $request->filled('end')
            ? Carbon::parse($request->input('end'), self::CALENDAR_TIMEZONE)->endOfDay()
            : null;

        // ✅ สำคัญ: อัปเดต event จาก study_log ให้ล่าสุด ก่อนส่งกลับ
        // (ถ้าไม่ต้องการ behavior นี้ สามารถคอมเมนต์บรรทัดนี้ได้)
        $this->syncStudyLogEvents($user, $start, $end);

        // ✅ Model มี Global scope user อยู่แล้ว (แต่ใส่ where user_id ซ้ำได้ไม่เสียหาย)
        $query = StudyCalendarEvent::with(['subject', 'studyLog'])
            ->where('user_id', $user->id);

        if ($start) {
            $query->where('start_time', '>=', $start);
        }

        if ($end) {
            // ใช้ start_time เป็นหลักจะ “ตรงกว่า” เพราะ event ส่วนใหญ่มี end_time null
            $query->where('start_time', '<=', $end);
        }

        return response()->json(
            StudyCalendarEventResource::collection($query->orderBy('start_time')->get())
        );
    }

    public function store(Request $request): JsonResponse
    {
        if (! $this->hasCalendarTable()) {
            return response()->json(['message' => 'Calendar table is missing'], 200);
        }

        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        $validated = $this->validateEvent($request, true);
        $subjectId = $validated['subject_id'] ?? null;

        if ($subjectId && ! $this->subjectBelongsToUser($subjectId, $user->id)) {
            return response()->json(['message' => 'ไม่พบรายวิชาที่เลือก'], 422);
        }

        $eventType = $this->resolveEventType($validated);
        $allDay = (bool) ($validated['all_day'] ?? false);
        $requestedSource = is_string($request->input('source')) ? Str::lower(trim((string) $request->input('source'))) : null;
        $source = $requestedSource === 'subject' ? 'subject' : 'manual';
        $shouldSyncSubject = $subjectId && $eventType === 'class' && $source === 'subject';

        $startAt = Carbon::parse($validated['start_time'], self::CALENDAR_TIMEZONE);
        $endAt = array_key_exists('end_time', $validated) && $validated['end_time']
            ? Carbon::parse($validated['end_time'], self::CALENDAR_TIMEZONE)
            : null;

        if ($endAt && $endAt->lessThanOrEqualTo($startAt)) {
            return response()->json(['message' => 'เวลาเลิกต้องมากกว่าเวลาเริ่ม'], 422);
        }

        $conflict = $this->findClassTimeConflict($user->id, $startAt, $endAt, $allDay, $eventType);
        if ($conflict) {
            return response()->json(['message' => $this->classTimeConflictMessage($conflict)], 422);
        }

        $subjectConflict = $this->findSubjectTimeConflict(
            $user->id,
            $startAt,
            $endAt,
            $allDay,
            $eventType,
            $shouldSyncSubject ? (int) $subjectId : null
        );
        if ($subjectConflict) {
            return response()->json(['message' => $this->subjectTimeConflictMessage($subjectConflict)], 422);
        }

        // ✅ metadata เป็น array ตรง ๆ (model cast จะจัดการให้)
        $metadata = [
            'type' => $eventType,
            'all_day' => $allDay,
            'source' => $source,
        ];
        if (array_key_exists('room', $validated)) {
            $metadata['room'] = $validated['room'];
        }
        if ($eventType === 'exam') {
            if (array_key_exists('exam_topic', $validated)) {
                $metadata['exam_topic'] = $validated['exam_topic'];
            }
            if (array_key_exists('exam_scope', $validated)) {
                $metadata['exam_scope'] = $validated['exam_scope'];
            }
            if (array_key_exists('exam_hours', $validated)) {
                $metadata['exam_hours'] = $validated['exam_hours'];
            }
        }

        $eventPayload = [
            'user_id' => $user->id, // 🔒 ใช้ auth เท่านั้น
            'subject_id' => $subjectId,
            'study_log_id' => null,
            'title' => $validated['title'],
            'description' => $validated['description'] ?? null,
            'start_time' => $startAt,
            'end_time' => $endAt,
            'status' => $validated['status'] ?? 'planned',
            'metadata' => $metadata,
        ];
        if (Schema::hasColumn((new StudyCalendarEvent())->getTable(), 'room')) {
            $eventPayload['room'] = $validated['room'] ?? null;
        }

        if ($this->canPersistEventType($eventType)) {
            $eventPayload['event_type'] = $eventType;
        }

        $event = StudyCalendarEvent::create($eventPayload);

        if ($shouldSyncSubject) {
            $this->syncSubjectSchedule($subjectId, $user->id, $startAt, $endAt, $allDay);
        }

        return response()->json(new StudyCalendarEventResource($event->load('subject')), 201);
    }

    /**
     * ✅ สำคัญ: ชื่อพารามิเตอร์ต้องตรง route {calendar_event}
     */
    public function update(Request $request, StudyCalendarEvent $calendar_event): JsonResponse
    {
        if (! $this->hasCalendarTable()) {
            return response()->json(['message' => 'Calendar table is missing'], 200);
        }

        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        // 🔒 ต้องเป็นของ user เท่านั้น
        $this->authorizeEvent($calendar_event, $user->id);

        if ($calendar_event->study_log_id) {
            return response()->json(['message' => 'ไม่สามารถแก้ไขตารางที่มาจากบันทึกการเรียนได้'], 422);
        }

        $validated = $this->validateEvent($request, false);
        $subjectId = $validated['subject_id'] ?? $calendar_event->subject_id;

        if ($subjectId && ! $this->subjectBelongsToUser($subjectId, $user->id)) {
            return response()->json(['message' => 'ไม่พบรายวิชาที่เลือก'], 422);
        }

        $startTime = array_key_exists('start_time', $validated)
            ? Carbon::parse($validated['start_time'], self::CALENDAR_TIMEZONE)
            : $calendar_event->start_time->copy()->shiftTimezone(self::CALENDAR_TIMEZONE);

        $endTime = $calendar_event->end_time?->copy()->shiftTimezone(self::CALENDAR_TIMEZONE);
        if (array_key_exists('end_time', $validated)) {
            $endTime = $validated['end_time']
                ? Carbon::parse($validated['end_time'], self::CALENDAR_TIMEZONE)
                : null;
        }

        if ($endTime && $endTime->lessThanOrEqualTo($startTime)) {
            return response()->json(['message' => 'เวลาเลิกต้องมากกว่าเวลาเริ่ม'], 422);
        }

        $metadata = is_array($calendar_event->metadata) ? $calendar_event->metadata : [];
        $eventType = $this->resolveEventType($validated, $calendar_event);
        $allDay = array_key_exists('all_day', $validated)
            ? (bool) $validated['all_day']
            : (bool) ($metadata['all_day'] ?? false);

        $requestedSource = is_string($request->input('source')) ? Str::lower(trim((string) $request->input('source'))) : null;
        $currentSource = is_string($metadata['source'] ?? null) ? Str::lower((string) $metadata['source']) : 'manual';
        $source = $requestedSource === 'subject' ? 'subject' : ($requestedSource === 'manual' ? 'manual' : $currentSource);
        $shouldSyncSubject = $subjectId && $eventType === 'class' && $source === 'subject';

        $conflict = $this->findClassTimeConflict($user->id, $startTime, $endTime, $allDay, $eventType, $calendar_event->id);
        if ($conflict) {
            return response()->json(['message' => $this->classTimeConflictMessage($conflict)], 422);
        }

        $subjectConflict = $this->findSubjectTimeConflict(
            $user->id,
            $startTime,
            $endTime,
            $allDay,
            $eventType,
            // A linked class can be a manual override of the subject schedule.
            // Its original subject timing is the same class, not a conflict.
            $subjectId ? (int) $subjectId : null
        );
        if ($subjectConflict) {
            return response()->json(['message' => $this->subjectTimeConflictMessage($subjectConflict)], 422);
        }

        if (array_key_exists('type', $validated) || array_key_exists('event_type', $validated)) {
            $metadata['type'] = $eventType;
        }
        if (array_key_exists('all_day', $validated)) {
            $metadata['all_day'] = (bool) $validated['all_day'];
        }
        if (array_key_exists('room', $validated)) {
            $metadata['room'] = $validated['room'];
        }
        if ($eventType === 'exam') {
            if (array_key_exists('exam_topic', $validated)) {
                $metadata['exam_topic'] = $validated['exam_topic'];
            }
            if (array_key_exists('exam_scope', $validated)) {
                $metadata['exam_scope'] = $validated['exam_scope'];
            }
            if (array_key_exists('exam_hours', $validated)) {
                $metadata['exam_hours'] = $validated['exam_hours'];
            }
        } else {
            unset($metadata['exam_topic'], $metadata['exam_scope'], $metadata['exam_hours']);
        }
        $metadata['source'] = $shouldSyncSubject ? 'subject' : 'manual';

        $eventPayload = [
            'subject_id' => $subjectId,
            'title' => $validated['title'] ?? $calendar_event->title,
            'description' => array_key_exists('description', $validated) ? $validated['description'] : $calendar_event->description,
            'start_time' => $startTime,
            'end_time' => $endTime,
            'status' => $validated['status'] ?? $calendar_event->status,
            'metadata' => $metadata,
        ];
        if (Schema::hasColumn((new StudyCalendarEvent())->getTable(), 'room') && array_key_exists('room', $validated)) {
            $eventPayload['room'] = $validated['room'];
        }

        if ($this->canPersistEventType($eventType)) {
            $eventPayload['event_type'] = $eventType;
        }

        $calendar_event->update($eventPayload);

        if ($shouldSyncSubject) {
            $this->syncSubjectSchedule($subjectId, $user->id, $startTime, $endTime, $allDay);
        }

        return response()->json(new StudyCalendarEventResource($calendar_event->fresh()->load('subject')));
    }

    /**
     * ✅ สำคัญ: ชื่อพารามิเตอร์ต้องตรง route {calendar_event}
     */
    public function destroy(Request $request, StudyCalendarEvent $calendar_event): JsonResponse
    {
        if (! $this->hasCalendarTable()) {
            return response()->json(status: 204);
        }

        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        // 🔒 ต้องเป็นของ user เท่านั้น
        $this->authorizeEvent($calendar_event, $user->id);

        if ($calendar_event->study_log_id) {
            return response()->json(['message' => 'ไม่สามารถลบตารางที่มาจากบันทึกการเรียนได้'], 422);
        }

        $metadata = is_array($calendar_event->metadata) ? $calendar_event->metadata : [];
        if (($metadata['source'] ?? null) === 'subject' && $calendar_event->subject_id) {
            $this->clearSubjectSchedule($calendar_event->subject_id, $user->id);
        }

        $calendar_event->delete();

        return response()->json(status: 204);
    }

    public function destroyById(Request $request): JsonResponse
    {
        if (! $this->hasCalendarTable()) {
            return response()->json(status: 204);
        }

        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        $validated = $request->validate([
            'id' => ['required', 'integer'],
        ]);

        // ✅ ชัดเจน: ต้องเป็น event ของ user เท่านั้น
        $calendar_event = StudyCalendarEvent::where('id', $validated['id'])
            ->where('user_id', $user->id)
            ->first();

        if (! $calendar_event) {
            return response()->json(['message' => 'Not found'], 404);
        }

        if ($calendar_event->study_log_id) {
            return response()->json(['message' => 'ไม่สามารถลบตารางที่มาจากบันทึกการเรียนได้'], 422);
        }

        $metadata = is_array($calendar_event->metadata) ? $calendar_event->metadata : [];
        if (($metadata['source'] ?? null) === 'subject' && $calendar_event->subject_id) {
            $this->clearSubjectSchedule($calendar_event->subject_id, $user->id);
        }

        $calendar_event->delete();

        return response()->json(status: 204);
    }

    public function clearAll(Request $request): JsonResponse
    {
        if (! $this->hasCalendarTable()) {
            return response()->json(status: 204);
        }

        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        if (Schema::hasTable((new Subject())->getTable())) {
            $updates = [];

            if (Schema::hasColumn('subjects', 'start_date')) {
                $updates['start_date'] = null;
            }
            if (Schema::hasColumn('subjects', 'start_time')) {
                $updates['start_time'] = null;
            }
            if (Schema::hasColumn('subjects', 'end_time')) {
                $updates['end_time'] = null;
            }

            if ($updates) {
                Subject::where('user_id', $user->id)->update($updates);
            }
        }

        StudyCalendarEvent::where('user_id', $user->id)
            ->whereNull('study_log_id')
            ->delete();

        return response()->json(['message' => 'cleared'], 200);
    }

    private function authorizeEvent(StudyCalendarEvent $calendarEvent, int $userId): void
    {
        abort_unless((int) $calendarEvent->user_id === (int) $userId, 403, 'Unauthorized');
    }

    private function validateEvent(Request $request, bool $isCreate): array
    {
        $request->merge($this->normalizeEventDateTimeInput($request->all()));

        $rules = [
            'title' => [$isCreate ? 'required' : 'sometimes', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string'],
            'room' => ['sometimes', 'nullable', 'string', 'max:255'],
            'start_time' => [$isCreate ? 'required' : 'sometimes', 'date'],
            'end_time' => ['sometimes', 'nullable', 'date'],
            'subject_id' => ['sometimes', 'nullable', 'integer', 'exists:subjects,id'],
            'source' => ['sometimes', 'nullable', 'in:manual,subject'],
            'type' => ['sometimes', 'nullable', 'in:class,exam,other'],
            'event_type' => ['sometimes', 'nullable', 'in:class,exam,other'],
            'all_day' => ['sometimes', 'boolean'],
            'status' => ['sometimes', 'nullable', 'string', 'max:30'],
            'exam_topic' => ['sometimes', 'nullable', 'string', 'max:255'],
            'exam_scope' => ['sometimes', 'nullable', 'string'],
            'exam_hours' => ['sometimes', 'nullable', 'numeric', 'min:0.5', 'max:12'],
        ];

        return $request->validate($rules);
    }

    private function normalizeEventDateTimeInput(array $payload): array
    {
        foreach (['start_time', 'end_time'] as $field) {
            if (! array_key_exists($field, $payload)) {
                continue;
            }

            $payload[$field] = $this->normalizeDateTimeValue($payload[$field]);
        }

        return $payload;
    }

    private function normalizeDateTimeValue(mixed $value): mixed
    {
        if ($value === null) {
            return null;
        }

        if (! is_string($value)) {
            return $value;
        }

        $raw = trim($value);
        if ($raw === '') {
            return null;
        }

        $raw = preg_replace('/\s+/', ' ', $raw) ?? $raw;
        $raw = str_replace('T', ' ', $raw);

        if (preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.*))?$/', $raw, $matches)) {
            $first = (int) $matches[1];
            $second = (int) $matches[2];
            $year = (int) $matches[3];

            // รองรับทั้ง dd/mm/yyyy และ mm/dd/yyyy (กรณีกำกวมจะใช้ mm/dd/yyyy)
            $month = $first > 12 ? $second : $first;
            $day = $first > 12 ? $first : $second;

            if (checkdate($month, $day, $year)) {
                $timePart = isset($matches[4]) ? trim((string) $matches[4]) : '';
                if ($timePart === '') {
                    return sprintf('%04d-%02d-%02d', $year, $month, $day);
                }

                $normalizedTime = $this->normalizeTimeValue($timePart);
                if ($normalizedTime) {
                    return sprintf('%04d-%02d-%02d %s', $year, $month, $day, $normalizedTime);
                }
            }
        }

        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:\s+(.*))?$/', $raw, $matches)) {
            $year = (int) $matches[1];
            $month = (int) $matches[2];
            $day = (int) $matches[3];

            if (checkdate($month, $day, $year)) {
                $timePart = isset($matches[4]) ? trim((string) $matches[4]) : '';
                if ($timePart === '') {
                    return sprintf('%04d-%02d-%02d', $year, $month, $day);
                }

                $normalizedTime = $this->normalizeTimeValue($timePart);
                if ($normalizedTime) {
                    return sprintf('%04d-%02d-%02d %s', $year, $month, $day, $normalizedTime);
                }
            }
        }

        $dotNormalized = preg_replace('/(?<=\d)\.(?=\d)/', ':', $raw) ?? $raw;
        try {
            return Carbon::parse($dotNormalized)->toDateTimeString();
        } catch (\Throwable $e) {
            return $value;
        }
    }

    private function normalizeTimeValue(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $time = trim($value);
        if ($time === '') {
            return null;
        }

        $time = preg_replace('/(?<=\d)\.(?=\d)/', ':', $time) ?? $time;

        if (preg_match('/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/', $time, $matches)) {
            $hour = (int) $matches[1];
            $minute = (int) $matches[2];
            $second = isset($matches[3]) ? (int) $matches[3] : 0;

            if ($hour >= 0 && $hour <= 23 && $minute >= 0 && $minute <= 59 && $second >= 0 && $second <= 59) {
                return sprintf('%02d:%02d:%02d', $hour, $minute, $second);
            }
        }

        try {
            return Carbon::parse($time)->format('H:i:s');
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function subjectBelongsToUser(int $subjectId, int $userId): bool
    {
        return Subject::where('id', $subjectId)->where('user_id', $userId)->exists();
    }

    private function hasCalendarTable(): bool
    {
        return Schema::hasTable((new StudyCalendarEvent())->getTable());
    }

    private function hasEventTypeColumn(): bool
    {
        return Schema::hasColumn((new StudyCalendarEvent())->getTable(), 'event_type');
    }

    private function subjectColumnDataType(string $column): ?string
    {
        static $cache = [];

        try {
            $database = DB::getDatabaseName();
            if (! $database) {
                return null;
            }

            $table = (new Subject())->getTable();
            $cacheKey = $database . '.' . $table . '.' . $column;
            if (array_key_exists($cacheKey, $cache)) {
                return $cache[$cacheKey];
            }

            $row = DB::table('information_schema.columns')
                ->select('data_type')
                ->where('table_schema', $database)
                ->where('table_name', $table)
                ->where('column_name', $column)
                ->first();

            $type = is_object($row) && isset($row->data_type)
                ? Str::lower((string) $row->data_type)
                : null;

            $cache[$cacheKey] = $type ?: null;

            return $cache[$cacheKey];
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function formatSubjectColumnDateTime(string $column, Carbon $value): string
    {
        $type = $this->subjectColumnDataType($column);

        if (in_array($type, ['datetime', 'timestamp'], true)) {
            return $value->toDateTimeString();
        }

        if ($type === 'date') {
            return $value->toDateString();
        }

        if ($type === 'time') {
            return $value->format('H:i:s');
        }

        // fallback ตามพฤติกรรมเดิม ถ้าอ่านชนิดคอลัมน์ไม่ได้
        return $column === 'start_date'
            ? $value->toDateString()
            : $value->format('H:i:s');
    }

    private function resolveEventType(array $validated, ?StudyCalendarEvent $existing = null): string
    {
        $candidate = $validated['event_type'] ?? $validated['type'] ?? null;

        if ($candidate === null && $existing) {
            $existingMetadata = is_array($existing->metadata) ? $existing->metadata : [];
            $candidate = $existingMetadata['type'] ?? $existing->event_type ?? null;
        }

        $normalized = Str::lower((string) $candidate);
        if (in_array($normalized, self::EVENT_TYPES, true)) {
            return $normalized;
        }

        return 'class';
    }

    private function canPersistEventType(string $eventType): bool
    {
        if (! $this->hasEventTypeColumn()) {
            return false;
        }

        $allowed = $this->eventTypeColumnAllowedValues();
        return $allowed === null || in_array($eventType, $allowed, true);
    }

    private function findClassTimeConflict(
        int $userId,
        Carbon $startTime,
        ?Carbon $endTime,
        bool $allDay,
        string $eventType,
        ?int $ignoreEventId = null
    ): ?StudyCalendarEvent {
        if ($eventType !== 'class' || $allDay || ! $endTime) {
            return null;
        }

        $query = StudyCalendarEvent::with('subject')
            ->where('user_id', $userId)
            ->whereNotNull('end_time')
            ->where('start_time', '<', $endTime)
            ->where('end_time', '>', $startTime);

        if ($ignoreEventId) {
            $query->where('id', '<>', $ignoreEventId);
        }

        foreach ($query->get() as $event) {
            $metadata = is_array($event->metadata) ? $event->metadata : [];
            if ((bool) ($metadata['all_day'] ?? false)) {
                continue;
            }

            if ($this->resolveEventType([], $event) !== 'class') {
                continue;
            }

            return $event;
        }

        return null;
    }

    private function classTimeConflictMessage(StudyCalendarEvent $conflict): string
    {
        $title = trim((string) ($conflict->subject?->name ?: $conflict->title));
        $timeRange = trim(
            ($conflict->start_time ? $conflict->start_time->format('H:i') : '')
            . '-'
            . ($conflict->end_time ? $conflict->end_time->format('H:i') : ''),
            '-'
        );
        $detail = $timeRange !== '' ? " เวลา {$timeRange}" : '';

        return "เวลานี้ซ้อนกับวิชา {$title}{$detail} กรุณาเลือกเวลาอื่น";
    }

    private function findSubjectTimeConflict(
        int $userId,
        Carbon $startTime,
        ?Carbon $endTime,
        bool $allDay,
        string $eventType,
        ?int $ignoreSubjectId = null
    ): ?Subject {
        if ($eventType !== 'class' || $allDay || ! $endTime) {
            return null;
        }

        if (! Schema::hasTable((new Subject())->getTable())) {
            return null;
        }

        foreach (['start_date', 'start_time', 'end_time'] as $column) {
            if (! Schema::hasColumn('subjects', $column)) {
                return null;
            }
        }

        $query = Subject::withoutGlobalScopes()
            ->where('user_id', $userId)
            ->whereNotNull('start_date')
            ->whereNotNull('start_time')
            ->whereNotNull('end_time');

        if ($ignoreSubjectId) {
            $query->where('id', '<>', $ignoreSubjectId);
        }

        // Subject columns store Thai timetable wall-clock values. Converting
        // requests to app.timezone (often UTC) shifts them seven hours earlier.
        $timezone = self::CALENDAR_TIMEZONE;
        $newDate = $startTime->copy()->timezone($timezone)->startOfDay();
        $newStart = $startTime->copy()->timezone($timezone)->format('H:i:s');
        $newEnd = $endTime->copy()->timezone($timezone)->format('H:i:s');

        foreach ($query->get() as $subject) {
            try {
                $existingDate = Carbon::parse((string) $subject->start_date, $timezone)->startOfDay();
            } catch (\Throwable $e) {
                continue;
            }

            if (! $existingDate->isSameDay($newDate)) {
                continue;
            }

            $existingStart = $this->normalizeSubjectTime($subject->start_time);
            $existingEnd = $this->normalizeSubjectTime($subject->end_time);
            if (! $existingStart || ! $existingEnd) {
                continue;
            }

            if ($newStart < $existingEnd && $existingStart < $newEnd) {
                return $subject;
            }
        }

        return null;
    }

    private function subjectTimeConflictMessage(Subject $conflict): string
    {
        $timeRange = trim(($this->formatSubjectTime($conflict->start_time) ?? '') . '-' . ($this->formatSubjectTime($conflict->end_time) ?? ''), '-');
        $detail = $timeRange !== '' ? " เวลา {$timeRange}" : '';

        return "เวลานี้ซ้อนกับวิชา {$conflict->name}{$detail} กรุณาเลือกเวลาอื่น";
    }

    private function normalizeSubjectTime(mixed $value): ?string
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

    private function formatSubjectTime(mixed $value): ?string
    {
        $time = $this->normalizeSubjectTime($value);
        if (! $time) {
            return null;
        }

        return substr($time, 0, 5);
    }

    private function eventTypeColumnAllowedValues(): ?array
    {
        try {
            $database = DB::getDatabaseName();
            if (! $database) {
                return null;
            }

            $table = (new StudyCalendarEvent())->getTable();
            $row = DB::table('information_schema.columns')
                ->select('data_type', 'column_type')
                ->where('table_schema', $database)
                ->where('table_name', $table)
                ->where('column_name', 'event_type')
                ->first();

            if (! $row) {
                return null;
            }

            $dataType = Str::lower((string) ($row->data_type ?? ''));
            if ($dataType !== 'enum') {
                return null;
            }

            $columnType = (string) ($row->column_type ?? '');
            if ($columnType === '') {
                return null;
            }

            preg_match_all("/'([^']+)'/", $columnType, $matches);
            $values = array_map(
                static fn (string $value): string => Str::lower($value),
                $matches[1] ?? []
            );

            return $values ?: null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function syncSubjectSchedule(
        int $subjectId,
        int $userId,
        Carbon $startTime,
        ?Carbon $endTime,
        bool $allDay
    ): void {
        if (! Schema::hasTable((new Subject())->getTable())) {
            return;
        }

        $updates = [];

        if (Schema::hasColumn('subjects', 'start_date')) {
            $updates['start_date'] = $this->formatSubjectColumnDateTime('start_date', $startTime->copy()->startOfDay());
        }
        if (Schema::hasColumn('subjects', 'start_time')) {
            $updates['start_time'] = $allDay ? null : $this->formatSubjectColumnDateTime('start_time', $startTime);
        }
        if (Schema::hasColumn('subjects', 'end_time')) {
            $updates['end_time'] = $allDay
                ? null
                : ($endTime ? $this->formatSubjectColumnDateTime('end_time', $endTime) : null);
        }

        if ($updates) {
            Subject::where('id', $subjectId)
                ->where('user_id', $userId)
                ->update($updates);
        }
    }

    private function clearSubjectSchedule(int $subjectId, int $userId): void
    {
        if (! Schema::hasTable((new Subject())->getTable())) {
            return;
        }

        $updates = [];

        if (Schema::hasColumn('subjects', 'start_date')) {
            $updates['start_date'] = null;
        }
        if (Schema::hasColumn('subjects', 'start_time')) {
            $updates['start_time'] = null;
        }
        if (Schema::hasColumn('subjects', 'end_time')) {
            $updates['end_time'] = null;
        }

        if ($updates) {
            Subject::where('id', $subjectId)
                ->where('user_id', $userId)
                ->update($updates);
        }
    }

    private function syncStudyLogEvents(User $user, ?Carbon $start, ?Carbon $end): void
    {
        if (! $this->hasCalendarTable()) {
            return;
        }

        if (! Schema::hasTable((new StudyLog())->getTable())) {
            return;
        }

        // ล้าง event ที่ผูกกับ log แต่ log ถูกลบไปแล้ว
        StudyCalendarEvent::where('user_id', $user->id)
            ->whereNotNull('study_log_id')
            ->whereDoesntHave('studyLog')
            ->delete();

        $logs = StudyLog::query()
            ->whereHas('subject', fn ($query) => $query->where('user_id', $user->id))
            ->when($start, fn ($query) => $query->whereDate('log_date', '>=', $start->toDateString()))
            ->when($end, fn ($query) => $query->whereDate('log_date', '<=', $end->toDateString()))
            ->get();

        foreach ($logs as $log) {
            if ($this->isSummaryLog($log)) {
                StudyCalendarEvent::where('study_log_id', $log->id)
                    ->where('user_id', $user->id)
                    ->delete();
                continue;
            }

            $existing = StudyCalendarEvent::where('study_log_id', $log->id)
                ->where('user_id', $user->id)
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
                'user_id' => $user->id,
                'subject_id' => $log->subject_id,
                'study_log_id' => $log->id,
                'title' => $log->title,
                'description' => $log->note,
                'start_time' => $startTime,
                'end_time' => null,
                'status' => 'planned',
                'metadata' => $metadata,
            ];

            if ($this->hasEventTypeColumn()) {
                $eventPayload['event_type'] = 'class';
            }

            StudyCalendarEvent::updateOrCreate(
                ['study_log_id' => $log->id, 'user_id' => $user->id],
                $eventPayload
            );
        }
    }

    private function isSummaryLog(?StudyLog $log): bool
    {
        if (! $log) return false;
        if ($log->isSummary()) return true;
        return $this->isSummaryText($log->title) || $this->isSummaryText($log->note);
    }

    private function isSummaryText(?string $text): bool
    {
        $value = trim((string) $text);
        if ($value === '') return false;

        $lower = Str::lower($value);
        if (Str::startsWith($lower, ['สรุป', 'summary'])) return true;

        return Str::contains($lower, [
            'เริ่มบันทึก',
            'สรุปเอกสาร',
            'สรุปเสียง',
            'อัปโหลดไฟล์เพื่อสรุป',
            'อัปโหลดเสียงเพื่อสรุป',
            'summary',
        ]);
    }
}
