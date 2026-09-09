<?php

namespace App\Http\Controllers\API\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class AdminController extends Controller
{
    public function overview(): JsonResponse
    {
        $recentCutoff = Carbon::now()->subDays(7)->toDateTimeString();

        return response()->json([
            'counts' => [
                'users' => $this->countTable('users'),
                'subjects' => $this->countTable('subjects'),
                'schedules' => $this->countTable('schedules'),
                'study_logs' => $this->countStudyLogs(),
                'summaries' => $this->countTable('summaries'),
                'quizzes' => $this->countTable('quizzes'),
                'quiz_attempts' => $this->countTable('quiz_attempts'),
                'goals' => $this->countTable('learning_goal_targets'),
                'files' => $this->countTable('files'),
            ],
            'recent_activity' => [
                'new_users' => $this->countSince('users', 'created_at', $recentCutoff),
                'study_logs' => $this->countStudyLogsSince($recentCutoff),
                'quiz_attempts' => $this->countSince('quiz_attempts', 'created_at', $recentCutoff),
            ],
            'latest_users' => $this->latestUsers(),
        ]);
    }

    public function users(Request $request): JsonResponse
    {
        $search = trim((string) $request->query('search', ''));
        $perPage = max(5, min(50, (int) $request->query('per_page', 15)));

        $query = DB::table('users')
            ->select(
                'users.id',
                'users.name',
                'users.email',
                'users.role',
                'users.provider',
                'users.education_level',
                'users.created_at',
                DB::raw($this->subCountSql('subjects', 'subjects.user_id', 'users.id') . ' as subjects_count'),
                DB::raw($this->studyLogSubCountSql('users.id') . ' as study_logs_count'),
                DB::raw($this->subCountSql('quiz_attempts', 'quiz_attempts.user_id', 'users.id') . ' as quiz_attempts_count'),
                DB::raw($this->subCountSql('learning_goal_targets', 'learning_goal_targets.user_id', 'users.id') . ' as goals_count')
            )
            ->orderByDesc('users.created_at')
            ->orderByDesc('users.id');

        if ($search !== '') {
            $query->where(function ($inner) use ($search) {
                $inner->where('users.name', 'like', "%{$search}%")
                    ->orWhere('users.email', 'like', "%{$search}%");
            });
        }

        return response()->json($query->paginate($perPage));
    }

    public function user(User $user): JsonResponse
    {
        return response()->json([
            'user' => $user->only([
                'id',
                'name',
                'email',
                'role',
                'provider',
                'profile_pic',
                'education_level',
                'created_at',
                'updated_at',
            ]),
            'subjects' => $this->rowsForUser('subjects', $user->id, [
                'id',
                'name',
                'description',
                'start_date',
                'start_time',
                'end_time',
                'room',
                'created_at',
            ]),
            'schedules' => $this->rowsForUser('schedules', $user->id, [
                'id',
                'subject_id',
                'day_of_week',
                'start_time',
                'end_time',
                'room',
                'schedule_type',
            ]),
            'calendar_events' => $this->rowsForUser('study_calendar_events', $user->id, [
                'id',
                'subject_id',
                'study_log_id',
                'title',
                'description',
                'start_time',
                'end_time',
                'status',
                'event_type',
                'created_at',
            ]),
            'study_logs' => $this->studyLogsForUser($user->id, [
                'id',
                'subject_id',
                'title',
                'log_date',
                'duration_minutes',
                'mood',
                'log_type',
                'created_at',
            ]),
            'summaries' => $this->summariesForUser($user->id),
            'quizzes' => $this->quizzesForUser($user->id),
            'goals' => $this->rowsForUser('learning_goal_targets', $user->id, [
                'id',
                'subject_id',
                'period_type',
                'quest_type',
                'title',
                'target_value',
                'current_value',
                'mission_count',
                'reward_points',
                'status',
                'period_start',
                'period_end',
            ]),
            'profile' => $this->profileForUser($user->id),
        ]);
    }

    public function settings(): JsonResponse
    {
        return response()->json([
            'settings' => $this->storedSettings(),
            'readonly' => [
                'timezone' => config('app.timezone'),
                'app_name' => config('app.name'),
                'mailer' => config('mail.default'),
            ],
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'app_display_name' => ['nullable', 'string', 'max:120'],
            'maintenance_notice' => ['nullable', 'string', 'max:500'],
            'default_timezone' => ['nullable', 'string', 'max:64'],
            'notifications_enabled' => ['required', Rule::in(['0', '1', 0, 1, true, false])],
        ]);

        $settings = [
            'app_display_name' => trim((string) ($data['app_display_name'] ?? '')),
            'maintenance_notice' => trim((string) ($data['maintenance_notice'] ?? '')),
            'default_timezone' => trim((string) ($data['default_timezone'] ?? config('app.timezone', 'Asia/Bangkok'))),
            'notifications_enabled' => filter_var($data['notifications_enabled'], FILTER_VALIDATE_BOOL) ? '1' : '0',
        ];

        if (Schema::hasTable('system_settings')) {
            foreach ($settings as $key => $value) {
                DB::table('system_settings')->updateOrInsert(
                    ['key' => $key],
                    [
                        'value' => $value,
                        'updated_by' => $request->user()?->id,
                        'updated_at' => now(),
                        'created_at' => now(),
                    ]
                );
            }
        }

        return response()->json([
            'message' => 'บันทึกการตั้งค่าระบบเรียบร้อยแล้ว',
            'settings' => $this->storedSettings($settings),
        ]);
    }

    private function countTable(string $table): int
    {
        return Schema::hasTable($table) ? (int) DB::table($table)->count() : 0;
    }

    private function countStudyLogs(): int
    {
        if (! Schema::hasTable('study_logs')) {
            return 0;
        }

        return (int) $this->excludeQuizSourceLogs(DB::table('study_logs'))->count();
    }

    private function countStudyLogsSince(string $cutoff): int
    {
        if (! Schema::hasTable('study_logs') || ! Schema::hasColumn('study_logs', 'created_at')) {
            return 0;
        }

        return (int) $this->excludeQuizSourceLogs(DB::table('study_logs'))
            ->where('created_at', '>=', $cutoff)
            ->count();
    }

    private function studyLogSubCountSql(string $localColumn): string
    {
        if (! Schema::hasTable('study_logs')) {
            return '0';
        }

        $filter = Schema::hasColumn('study_logs', 'note')
            ? " and coalesce(study_logs.note, '') <> 'อัปโหลดไฟล์เพื่อสร้างแบบฝึกหัด'"
            : '';

        return "(select count(*) from study_logs where study_logs.user_id = {$localColumn}{$filter})";
    }

    private function countSince(string $table, string $column, string $cutoff): int
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
            return 0;
        }

        return (int) DB::table($table)->where($column, '>=', $cutoff)->count();
    }

    private function subCountSql(string $table, string $foreignColumn, string $localColumn): string
    {
        if (! Schema::hasTable($table)) {
            return '0';
        }

        return "(select count(*) from {$table} where {$foreignColumn} = {$localColumn})";
    }

    private function latestUsers(): array
    {
        if (! Schema::hasTable('users')) {
            return [];
        }

        return DB::table('users')
            ->select('id', 'name', 'email', 'role', 'created_at')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(6)
            ->get()
            ->all();
    }

    private function rowsForUser(string $table, int $userId, array $columns): array
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'user_id')) {
            return [];
        }

        $available = collect($columns)->filter(fn ($column) => Schema::hasColumn($table, $column))->values()->all();
        if ($available === []) {
            return [];
        }

        return DB::table($table)
            ->select($available)
            ->where('user_id', $userId)
            ->orderByDesc(Schema::hasColumn($table, 'created_at') ? 'created_at' : $available[0])
            ->limit(20)
            ->get()
            ->all();
    }

    private function studyLogsForUser(int $userId, array $columns): array
    {
        if (! Schema::hasTable('study_logs') || ! Schema::hasColumn('study_logs', 'user_id')) {
            return [];
        }

        $available = collect($columns)->filter(fn ($column) => Schema::hasColumn('study_logs', $column))->values()->all();
        if ($available === []) {
            return [];
        }

        return $this->excludeQuizSourceLogs(DB::table('study_logs'))
            ->select($available)
            ->where('user_id', $userId)
            ->orderByDesc(Schema::hasColumn('study_logs', 'created_at') ? 'created_at' : $available[0])
            ->limit(20)
            ->get()
            ->all();
    }

    private function excludeQuizSourceLogs($query)
    {
        if (Schema::hasColumn('study_logs', 'note')) {
            $query->where(function ($builder) {
                $builder->whereNull('note')
                    ->orWhere('note', '<>', 'อัปโหลดไฟล์เพื่อสร้างแบบฝึกหัด');
            });
        }

        return $query;
    }

    private function summariesForUser(int $userId): array
    {
        if (! Schema::hasTable('summaries') || ! Schema::hasTable('study_logs')) {
            return [];
        }

        return DB::table('summaries')
            ->join('study_logs', 'summaries.study_log_id', '=', 'study_logs.id')
            ->leftJoin('subjects', 'study_logs.subject_id', '=', 'subjects.id')
            ->where('study_logs.user_id', $userId)
            ->select(
                'summaries.id',
                'summaries.study_log_id',
                'study_logs.title as study_log_title',
                'subjects.name as subject_name',
                DB::raw('left(summaries.content, 240) as content_preview'),
                'summaries.ai_model',
                'summaries.created_at'
            )
            ->orderByDesc('summaries.created_at')
            ->limit(20)
            ->get()
            ->all();
    }

    private function quizzesForUser(int $userId): array
    {
        if (! Schema::hasTable('quizzes') || ! Schema::hasTable('subjects')) {
            return [];
        }

        return DB::table('quizzes')
            ->join('subjects', 'quizzes.subject_id', '=', 'subjects.id')
            ->where('subjects.user_id', $userId)
            ->select(
                'quizzes.id',
                'quizzes.subject_id',
                'subjects.name as subject_name',
                'quizzes.title',
                'quizzes.description',
                'quizzes.ai_model',
                'quizzes.created_at'
            )
            ->orderByDesc('quizzes.created_at')
            ->limit(20)
            ->get()
            ->all();
    }

    private function profileForUser(int $userId): ?object
    {
        if (! Schema::hasTable('portfolios')) {
            return null;
        }

        return DB::table('portfolios')
            ->where('user_id', $userId)
            ->select('id', 'title', 'full_name', 'nickname', 'phone', 'address', 'is_public', 'created_at')
            ->orderByDesc('updated_at')
            ->first();
    }

    private function storedSettings(array $fallback = []): array
    {
        $defaults = array_merge([
            'app_display_name' => config('app.name', 'Smart Learning Tracker'),
            'maintenance_notice' => '',
            'default_timezone' => config('app.timezone', 'Asia/Bangkok'),
            'notifications_enabled' => '1',
        ], $fallback);

        if (! Schema::hasTable('system_settings')) {
            return $defaults;
        }

        $stored = DB::table('system_settings')
            ->whereIn('key', array_keys($defaults))
            ->pluck('value', 'key')
            ->all();

        return array_merge($defaults, $stored);
    }
}
