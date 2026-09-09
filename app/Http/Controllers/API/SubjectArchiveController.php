<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Resources\SubjectArchiveResource;
use App\Models\Subject;
use App\Models\SubjectArchive;
use App\Models\LearningNotification;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

class SubjectArchiveController extends Controller
{
    public function index(Subject $subject): AnonymousResourceCollection
    {
        $this->authorizeSubject($subject);

        $archives = SubjectArchive::query()
            ->where('user_id', request()->user()->id)
            ->where('original_subject_id', $subject->id)
            ->orderByDesc('archived_at')
            ->get();

        return SubjectArchiveResource::collection($archives);
    }

    public function store(Request $request, Subject $subject): JsonResponse
    {
        $this->authorizeSubject($subject);
        $this->ensureArchiveDescriptionColumnSupportsLongText();

        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'color' => ['nullable', 'string', 'max:20'],
            'target_hours' => ['nullable', 'integer', 'min:0'],
            'start_date' => ['nullable', 'date'],
            'start_time' => ['nullable', 'string', 'max:32'],
            'end_time' => ['nullable', 'string', 'max:32'],
            'archived_at' => ['nullable', 'date'],
        ]);

        $startDate = $data['start_date'] ?? $subject->start_date;
        $startTime = $this->normalizeArchiveTimeValue($data['start_time'] ?? $subject->start_time, 'start_time', $startDate);
        $endTime = $this->normalizeArchiveTimeValue($data['end_time'] ?? $subject->end_time, 'end_time', $startDate);
        $description = isset($data['description'])
            ? (string) $data['description']
            : (string) ($subject->description ?? '');

        $archive = SubjectArchive::create([
            'user_id' => $request->user()->id,
            'original_subject_id' => $subject->id,
            'name' => $data['name'] ?? $subject->name,
            'description' => $description,
            'color' => $data['color'] ?? $subject->color,
            'target_hours' => $data['target_hours'] ?? $subject->target_hours,
            'start_date' => $startDate,
            'start_time' => $startTime,
            'end_time' => $endTime,
            'archived_at' => $data['archived_at'] ?? now(),
        ]);

        if (Schema::hasTable((new LearningNotification())->getTable())) {
            LearningNotification::create([
                'user_id' => $request->user()->id,
                'subject_id' => $subject->id,
                'title' => 'เก็บถาวรวิชาแล้ว',
                'body' => 'วิชา: '.$archive->name,
                'notify_at' => Carbon::now(),
                'channel' => 'in_app',
                'status' => 'sent',
                'metadata' => [
                    'type' => 'subject_archive',
                    'is_read' => false,
                ],
            ]);
        }

        return response()->json(new SubjectArchiveResource($archive), 201);
    }

    public function destroy(Subject $subject, SubjectArchive $archive): JsonResponse
    {
        $this->authorizeSubject($subject);

        if ($archive->user_id !== request()->user()->id || $archive->original_subject_id !== $subject->id) {
            abort(404, 'Archive not found');
        }

        $archive->delete();

        return response()->json(status: 204);
    }

    public function update(Request $request, Subject $subject, SubjectArchive $archive): JsonResponse
    {
        $this->authorizeSubject($subject);

        if ($archive->user_id !== $request->user()->id || $archive->original_subject_id !== $subject->id) {
            abort(404, 'Archive not found');
        }

        $this->ensureArchiveDescriptionColumnSupportsLongText();

        $data = $request->validate([
            'name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string'],
            'color' => ['sometimes', 'nullable', 'string', 'max:20'],
            'target_hours' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'start_date' => ['sometimes', 'nullable', 'date'],
            'start_time' => ['sometimes', 'nullable', 'string', 'max:32'],
            'end_time' => ['sometimes', 'nullable', 'string', 'max:32'],
            'archived_at' => ['sometimes', 'nullable', 'date'],
        ]);

        $startDate = array_key_exists('start_date', $data) ? $data['start_date'] : $archive->start_date;

        if (array_key_exists('start_time', $data)) {
            $data['start_time'] = $this->normalizeArchiveTimeValue($data['start_time'], 'start_time', $startDate);
        }

        if (array_key_exists('end_time', $data)) {
            $data['end_time'] = $this->normalizeArchiveTimeValue($data['end_time'], 'end_time', $startDate);
        }

        $archive->fill($data);
        $archive->save();

        return response()->json(new SubjectArchiveResource($archive));
    }

    public function count(Request $request): JsonResponse
    {
        $count = SubjectArchive::query()
            ->where('user_id', $request->user()->id)
            ->count();

        return response()->json(['count' => $count]);
    }

    private function authorizeSubject(Subject $subject): void
    {
        abort_unless($subject->user_id === request()->user()->id, 403, 'Unauthorized');
    }

    private function normalizeArchiveTimeValue(mixed $value, string $column, mixed $startDate): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $raw = trim((string) $value);
        if ($raw === '') {
            return null;
        }

        $columnType = Schema::getColumnType((new SubjectArchive())->getTable(), $column);
        $isTimeColumn = $columnType === 'time';

        if (preg_match('/^\d{2}:\d{2}(?::\d{2})?$/', $raw) === 1) {
            $normalizedTime = strlen($raw) === 5 ? "{$raw}:00" : $raw;
            if ($isTimeColumn) {
                return $normalizedTime;
            }

            $baseDate = $this->resolveBaseDate($startDate);
            return "{$baseDate} {$normalizedTime}";
        }

        try {
            $parsed = Carbon::parse($raw);
        } catch (\Throwable $e) {
            throw ValidationException::withMessages([
                $column => 'รูปแบบเวลาไม่ถูกต้อง',
            ]);
        }

        return $isTimeColumn
            ? $parsed->format('H:i:s')
            : $parsed->format('Y-m-d H:i:s');
    }

    private function resolveBaseDate(mixed $startDate): string
    {
        if ($startDate === null || $startDate === '') {
            return now()->toDateString();
        }

        try {
            return Carbon::parse((string) $startDate)->toDateString();
        } catch (\Throwable $e) {
            return now()->toDateString();
        }
    }

    private function ensureArchiveDescriptionColumnSupportsLongText(): void
    {
        $table = (new SubjectArchive())->getTable();

        if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'description')) {
            return;
        }

        try {
            $driver = DB::getDriverName();

            if ($driver !== 'mysql') {
                return;
            }

            $column = DB::table('information_schema.columns')
                ->selectRaw('DATA_TYPE as data_type, CHARACTER_MAXIMUM_LENGTH as max_length')
                ->where('TABLE_SCHEMA', DB::getDatabaseName())
                ->where('TABLE_NAME', $table)
                ->where('COLUMN_NAME', 'description')
                ->first();

            if (!$column) {
                return;
            }

            $dataType = strtolower((string) ($column->data_type ?? ''));
            $maxLength = $column->max_length !== null ? (int) $column->max_length : null;

            if ($dataType === 'longtext') {
                return;
            }

            if ($dataType === 'text' && $maxLength === null) {
                return;
            }

            DB::statement("ALTER TABLE `{$table}` MODIFY `description` LONGTEXT NULL");
        } catch (\Throwable $e) {
            // Keep the request flow alive; validation/create will surface any remaining DB issue.
        }
    }

}
