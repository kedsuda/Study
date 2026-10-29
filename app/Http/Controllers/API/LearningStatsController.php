<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class LearningStatsController extends Controller
{
    public function summary(): JsonResponse
    {
        request()->validate([
            'subject_id' => ['nullable', 'integer', 'min:1'],
            'academic_year' => ['nullable', 'integer', 'min:1'],
            'semester' => ['nullable', 'integer', 'min:1'],
        ]);
        $user = request()->user();
        $timezone = config('app.timezone', 'Asia/Bangkok');
        $now = Carbon::now($timezone);
        $rangeDays = max(7, min(120, (int) request()->query('days', 30)));
        $rangeStart = $now->copy()->subDays($rangeDays - 1)->startOfDay();

        $studyLogs = $this->studyLogs($user, $rangeStart, $now);
        $quizAttempts = $this->quizAttempts($user, $rangeStart, $now);
        $allActivityDates = $this->allActivityDates($user);

        return response()->json([
            'range' => [
                'days' => $rangeDays,
                'start' => $rangeStart->toDateString(),
                'end' => $now->toDateString(),
            ],
            'totals' => $this->totals($studyLogs, $quizAttempts),
            'today' => $this->periodTotals(
                $studyLogs,
                $quizAttempts,
                $now->copy()->startOfDay(),
                $now->copy()->endOfDay()
            ),
            'week' => $this->periodTotals(
                $studyLogs,
                $quizAttempts,
                $now->copy()->startOfWeek(Carbon::MONDAY),
                $now->copy()->endOfWeek(Carbon::SUNDAY)
            ),
            'month' => $this->periodTotals(
                $studyLogs,
                $quizAttempts,
                $now->copy()->startOfMonth(),
                $now->copy()->endOfMonth()
            ),
            'streaks' => [
                'current' => $this->currentStreak($allActivityDates, $now),
                'longest' => $this->longestStreak($allActivityDates),
            ],
            'daily_activity' => $this->dailyActivity($studyLogs, $quizAttempts, $rangeStart, $now),
            'subject_breakdown' => $this->subjectBreakdown($studyLogs, $quizAttempts),
            'quiz_performance' => $this->quizPerformance($quizAttempts),
            'missions' => $this->missionProgress($user, $now),
            'achievements' => $this->achievements($user, $allActivityDates),
        ]);
    }

    private function studyLogs(User $user, Carbon $start, Carbon $end): Collection
    {
        if (! Schema::hasTable('study_logs') || ! Schema::hasTable('subjects')) {
            return collect();
        }

        $query = DB::table('study_logs')
            ->join('subjects', 'study_logs.subject_id', '=', 'subjects.id')
            ->where('subjects.user_id', $user->id)
            ->whereBetween('study_logs.log_date', [$start->toDateString(), $end->toDateString()]);

        if (Schema::hasColumn('study_logs', 'note')) {
            $query->where(function ($builder) {
                $builder->whereNull('study_logs.note')
                    ->orWhere('study_logs.note', '<>', 'อัปโหลดไฟล์เพื่อสร้างแบบฝึกหัด');
            });
        }

        $this->applyAcademicFilter($query);

        return $query
            ->select(
                'study_logs.id',
                'study_logs.log_date',
                DB::raw('COALESCE(study_logs.duration_minutes, 0) as duration_minutes'),
                'subjects.id as subject_id',
                'subjects.name as subject_name'
            )
            ->orderBy('study_logs.log_date')
            ->get();
    }

    private function quizAttempts(User $user, Carbon $start, Carbon $end): Collection
    {
        if (! Schema::hasTable('quiz_attempts') || ! Schema::hasTable('quizzes') || ! Schema::hasTable('subjects')) {
            return collect();
        }

        $query = DB::table('quiz_attempts')
            ->join('quizzes', 'quiz_attempts.quiz_id', '=', 'quizzes.id')
            ->join('subjects', 'quizzes.subject_id', '=', 'subjects.id')
            ->leftJoin('quiz_questions', 'quiz_questions.quiz_id', '=', 'quizzes.id')
            ->where('quiz_attempts.user_id', $user->id)
            ->where('subjects.user_id', $user->id)
            ->whereBetween('quiz_attempts.created_at', [$start->toDateTimeString(), $end->toDateTimeString()])
            ->select(
                'quiz_attempts.id',
                'quiz_attempts.score',
                'quiz_attempts.passed',
                'quiz_attempts.created_at',
                'subjects.id as subject_id',
                'subjects.name as subject_name',
                DB::raw('COUNT(quiz_questions.id) as total_questions')
            )
            ->groupBy(
                'quiz_attempts.id',
                'quiz_attempts.score',
                'quiz_attempts.passed',
                'quiz_attempts.created_at',
                'subjects.id',
                'subjects.name'
            )
            ->orderBy('quiz_attempts.created_at');

        $this->applyAcademicFilter($query);

        return $query->get()->map(function ($attempt) {
            $totalQuestions = max(0, (int) ($attempt->total_questions ?? 0));
            $score = (int) ($attempt->score ?? 0);
            $attempt->percentage = $totalQuestions > 0 ? round(($score / $totalQuestions) * 100, 1) : null;
            return $attempt;
        });
    }

    private function applyAcademicFilter(Builder $query): void
    {
        if (request()->filled('subject_id')) {
            $query->where('subjects.id', (int) request()->query('subject_id'));
        }
        if (! request()->filled('academic_year') && ! request()->filled('semester')) {
            return;
        }

        $query->whereExists(function (Builder $semester) {
            $semester->selectRaw('1')->from('semester')
                ->whereColumn('semester.semester_id', 'subjects.semester_id');
            foreach (['academic_year', 'semester'] as $field) {
                if (request()->filled($field)) {
                    $semester->where('semester.'.$field, (int) request()->query($field));
                }
            }
        });
    }

    private function totals(Collection $studyLogs, Collection $quizAttempts): array
    {
        $studyMinutes = (int) $studyLogs->sum(fn ($log) => (int) $log->duration_minutes);
        $quizSets = $quizAttempts->count();
        $questionCount = (int) $quizAttempts->sum(fn ($attempt) => (int) $attempt->total_questions);
        $passed = $quizAttempts->filter(fn ($attempt) => (bool) $attempt->passed)->count();

        return [
            'study_sessions' => $studyLogs->count(),
            'study_minutes' => $studyMinutes,
            'study_hours' => round($studyMinutes / 60, 1),
            'quiz_sets' => $quizSets,
            'quiz_questions' => $questionCount,
            'quiz_passed' => $passed,
            'quiz_pass_rate' => $quizSets > 0 ? round(($passed / $quizSets) * 100, 1) : 0,
        ];
    }

    private function periodTotals(Collection $studyLogs, Collection $quizAttempts, Carbon $start, Carbon $end): array
    {
        return $this->totals(
            $studyLogs->filter(fn ($log) => Carbon::parse($log->log_date)->betweenIncluded($start, $end)),
            $quizAttempts->filter(fn ($attempt) => Carbon::parse($attempt->created_at)->betweenIncluded($start, $end))
        );
    }

    private function dailyActivity(Collection $studyLogs, Collection $quizAttempts, Carbon $start, Carbon $end): array
    {
        $studyByDate = $studyLogs->groupBy(fn ($log) => Carbon::parse($log->log_date)->toDateString());
        $quizByDate = $quizAttempts->groupBy(fn ($attempt) => Carbon::parse($attempt->created_at)->toDateString());

        return collect(CarbonPeriod::create($start->copy()->startOfDay(), $end->copy()->startOfDay()))
            ->map(function (Carbon $date) use ($studyByDate, $quizByDate) {
                $key = $date->toDateString();
                $dayStudy = $studyByDate->get($key, collect());
                $dayQuizzes = $quizByDate->get($key, collect());

                return [
                    'date' => $key,
                    'label' => $date->format('d/m'),
                    'study_minutes' => (int) $dayStudy->sum(fn ($log) => (int) $log->duration_minutes),
                    'study_sessions' => $dayStudy->count(),
                    'quiz_sets' => $dayQuizzes->count(),
                ];
            })
            ->values()
            ->all();
    }

    private function subjectBreakdown(Collection $studyLogs, Collection $quizAttempts): array
    {
        $subjectIds = $studyLogs->pluck('subject_id')->merge($quizAttempts->pluck('subject_id'))->unique()->values();

        return $subjectIds
            ->map(function ($subjectId) use ($studyLogs, $quizAttempts) {
                $subjectStudy = $studyLogs->where('subject_id', $subjectId);
                $subjectQuizzes = $quizAttempts->where('subject_id', $subjectId);
                $name = $subjectStudy->first()->subject_name ?? $subjectQuizzes->first()->subject_name ?? 'ไม่ระบุวิชา';

                return [
                    'subject_id' => (int) $subjectId,
                    'subject_name' => $name,
                    'study_minutes' => (int) $subjectStudy->sum(fn ($log) => (int) $log->duration_minutes),
                    'study_sessions' => $subjectStudy->count(),
                    'quiz_sets' => $subjectQuizzes->count(),
                    'average_score' => $this->averagePercentage($subjectQuizzes),
                ];
            })
            ->sortByDesc(fn ($item) => $item['study_minutes'] + ($item['quiz_sets'] * 15))
            ->values()
            ->take(8)
            ->all();
    }

    private function quizPerformance(Collection $quizAttempts): array
    {
        return [
            'average_score' => $this->averagePercentage($quizAttempts),
            'best_score' => (float) ($quizAttempts->pluck('percentage')->filter(fn ($score) => $score !== null)->max() ?? 0),
            'latest_score' => (float) ($quizAttempts->pluck('percentage')->filter(fn ($score) => $score !== null)->last() ?? 0),
        ];
    }

    private function averagePercentage(Collection $attempts): float
    {
        $scores = $attempts->pluck('percentage')->filter(fn ($score) => $score !== null);
        return $scores->isNotEmpty() ? round((float) $scores->avg(), 1) : 0.0;
    }

    private function allActivityDates(User $user): array
    {
        $dates = collect();

        if (Schema::hasTable('study_logs') && Schema::hasTable('subjects')) {
            $dates = $dates->merge(
                DB::table('study_logs')
                    ->join('subjects', 'study_logs.subject_id', '=', 'subjects.id')
                    ->where('subjects.user_id', $user->id)
                    ->tap(fn (Builder $query) => $this->applyAcademicFilter($query))
                    ->pluck('study_logs.log_date')
            );
        }

        if (Schema::hasTable('quiz_attempts') && Schema::hasTable('quizzes') && Schema::hasTable('subjects')) {
            $dates = $dates->merge(
                DB::table('quiz_attempts')
                    ->join('quizzes', 'quiz_attempts.quiz_id', '=', 'quizzes.id')
                    ->join('subjects', 'quizzes.subject_id', '=', 'subjects.id')
                    ->where('quiz_attempts.user_id', $user->id)
                    ->where('subjects.user_id', $user->id)
                    ->tap(fn (Builder $query) => $this->applyAcademicFilter($query))
                    ->selectRaw('DATE(quiz_attempts.created_at) as activity_date')
                    ->pluck('activity_date')
            );
        }

        return $dates
            ->map(fn ($date) => Carbon::parse($date)->toDateString())
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    private function currentStreak(array $activityDates, Carbon $now): int
    {
        $dateSet = array_flip($activityDates);
        $cursor = $now->copy()->startOfDay();
        $streak = 0;

        if (! isset($dateSet[$cursor->toDateString()])) {
            $cursor->subDay();
        }

        while (isset($dateSet[$cursor->toDateString()])) {
            $streak++;
            $cursor->subDay();
        }

        return $streak;
    }

    private function longestStreak(array $activityDates): int
    {
        $longest = 0;
        $current = 0;
        $previous = null;

        foreach ($activityDates as $date) {
            $carbon = Carbon::parse($date)->startOfDay();
            $current = $previous && (int) $carbon->diffInDays($previous) === 1 ? $current + 1 : 1;
            $longest = max($longest, $current);
            $previous = $carbon;
        }

        return $longest;
    }

    private function missionProgress(User $user, Carbon $now): array
    {
        if (! Schema::hasTable('learning_goal_targets')) {
            return [];
        }

        $columns = Schema::getColumnListing('learning_goal_targets');
        $hasColumn = fn (string $column): bool => in_array($column, $columns, true);
        $targetExpression = collect(['target_value', 'target_quiz_sets', 'target_sessions'])
            ->filter(fn (string $column) => $hasColumn($column))
            ->map(fn (string $column) => "NULLIF(`{$column}`, 0)")
            ->implode(', ');

        $selects = [
            'id',
            'period_type',
            DB::raw(($targetExpression !== '' ? "COALESCE({$targetExpression}, 0)" : '0').' as mission_target_value'),
            DB::raw(($hasColumn('current_value') ? 'COALESCE(`current_value`, 0)' : '0').' as mission_current_value'),
            DB::raw(($hasColumn('mission_count') ? 'COALESCE(`mission_count`, 0)' : ($hasColumn('current_value') ? 'COALESCE(`current_value`, 0)' : '0')).' as mission_count'),
            DB::raw(($hasColumn('title') ? 'NULLIF(`title`, \'\')' : 'NULL').' as mission_title'),
            DB::raw(($hasColumn('reward_points') ? 'COALESCE(`reward_points`, 0)' : '0').' as mission_reward_points'),
            DB::raw(($hasColumn('status') ? 'NULLIF(`status`, \'\')' : 'NULL').' as mission_status'),
        ];

        return DB::table('learning_goal_targets')
            ->select($selects)
            ->where('user_id', $user->id)
            ->whereDate('period_start', '<=', $now->toDateString())
            ->whereDate('period_end', '>=', $now->toDateString())
            ->orderByRaw("FIELD(period_type, 'daily', 'weekly', 'monthly')")
            ->get()
            ->map(function ($goal) {
                $target = (int) $goal->mission_target_value;
                $current = (int) $goal->mission_current_value;
                $title = $this->readObjectString($goal, ['mission_title']) ?: 'ภารกิจการเรียน';

                return [
                    'id' => (int) $goal->id,
                    'period_type' => $goal->period_type,
                    'title' => $title,
                    'target_value' => $target,
                    'current_value' => $current,
                    'mission_count' => (int) $goal->mission_count,
                    'progress_percent' => $target > 0 ? min(100, (int) round(($current / $target) * 100)) : 0,
                    'reward_points' => (int) $goal->mission_reward_points,
                    'status' => $this->readObjectString($goal, ['mission_status']) ?: 'pending',
                ];
            })
            ->values()
            ->all();
    }

    private function readObjectInt(object $row, array $properties, int $fallback): int
    {
        foreach ($properties as $property) {
            if (property_exists($row, $property) && $row->{$property} !== null && $row->{$property} !== '') {
                return (int) $row->{$property};
            }
        }

        return $fallback;
    }

    private function readObjectString(object $row, array $properties): ?string
    {
        foreach ($properties as $property) {
            if (property_exists($row, $property) && is_string($row->{$property}) && trim($row->{$property}) !== '') {
                return trim($row->{$property});
            }
        }

        return null;
    }

    private function achievements(User $user, array $activityDates): array
    {
        $totalMinutes = 0;
        $studySessionCount = 0;
        $quizAttemptCount = 0;

        if (Schema::hasTable('study_logs') && Schema::hasTable('subjects')) {
            $study = DB::table('study_logs')
                ->join('subjects', 'study_logs.subject_id', '=', 'subjects.id')
                ->where('subjects.user_id', $user->id)
                ->selectRaw('COUNT(*) as sessions, COALESCE(SUM(study_logs.duration_minutes), 0) as minutes')
                ->first();

            $totalMinutes = (int) ($study->minutes ?? 0);
            $studySessionCount = (int) ($study->sessions ?? 0);
        }

        if (Schema::hasTable('quiz_attempts')) {
            $quizAttemptCount = DB::table('quiz_attempts')->where('user_id', $user->id)->count();
        }

        $longestStreak = $this->longestStreak($activityDates);

        return [
            [
                'key' => 'first_study_log',
                'title' => 'เริ่มต้นเส้นทาง',
                'description' => 'บันทึกการเรียนครั้งแรก',
                'unlocked' => $studySessionCount >= 1,
                'progress' => min(100, $studySessionCount >= 1 ? 100 : 0),
            ],
            [
                'key' => 'study_20_hours',
                'title' => 'สะสม 20 ชั่วโมง',
                'description' => 'เรียนครบ 1,200 นาที',
                'unlocked' => $totalMinutes >= 1200,
                'progress' => min(100, (int) round(($totalMinutes / 1200) * 100)),
            ],
            [
                'key' => 'quiz_10_sets',
                'title' => 'นักลุยแบบทดสอบ',
                'description' => 'ทำแบบทดสอบครบ 10 ชุด',
                'unlocked' => $quizAttemptCount >= 10,
                'progress' => min(100, (int) round(($quizAttemptCount / 10) * 100)),
            ],
            [
                'key' => 'streak_7_days',
                'title' => 'ต่อเนื่อง 7 วัน',
                'description' => 'มีประวัติเรียนหรือทำแบบทดสอบติดกัน 7 วัน',
                'unlocked' => $longestStreak >= 7,
                'progress' => min(100, (int) round(($longestStreak / 7) * 100)),
            ],
        ];
    }
}
