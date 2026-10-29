<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\LearningGoalTarget;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class GoalController extends Controller
{
    private ?array $goalTableColumns = null;

    public function summary(): JsonResponse
    {
        $user = request()->user();
        $timezone = config('app.timezone', 'Asia/Bangkok');
        $now = Carbon::now($timezone);
        $subjectId = request()->integer('subject_id');
        $semesterId = request()->integer('semester_id');
        $context = $this->resolveQuestContext($user, $subjectId, $semesterId);

        $todayStart = $now->copy()->startOfDay();
        $todayEnd = $now->copy()->endOfDay();

        $weekStart = $now->copy()->startOfWeek(Carbon::MONDAY);
        $weekEnd = $now->copy()->endOfWeek(Carbon::SUNDAY);

        $monthStart = $now->copy()->startOfMonth();
        $monthEnd = $now->copy()->endOfMonth();

        return response()->json([
            'today' => $this->buildSummary($user, $todayStart, $todayEnd, 'daily', $context),
            'week' => $this->buildSummary($user, $weekStart, $weekEnd, 'weekly', $context),
            'month' => $this->buildSummary($user, $monthStart, $monthEnd, 'monthly', $context),
        ]);
    }

    public function upsertTarget(): JsonResponse
    {
        // Log incoming request for debugging when clients report failures
        try {
            Log::info('upsertTarget request', request()->all());
        } catch (\Throwable $e) {
            // ignore logging failures
        }

        $user = request()->user();
        $timezone = config('app.timezone', 'Asia/Bangkok');
        $now = Carbon::now($timezone);

        $data = request()->validate([
            'period_type' => ['required', 'in:daily,weekly,monthly'],
            'target_quiz_sets' => ['nullable', 'integer', 'min:1', 'max:999', 'required_without_all:target_sessions,target_minutes'],
            'target_sessions' => ['nullable', 'integer', 'min:1', 'max:999', 'required_without_all:target_quiz_sets,target_minutes'],
            'target_minutes' => ['nullable', 'integer', 'min:1', 'max:99999', 'required_without_all:target_quiz_sets,target_sessions'],
            'subject_id' => ['nullable', 'integer', 'min:1'],
            'semester_id' => ['nullable', 'integer', 'min:1'],
        ]);

        // extra logging to help debug persistence issues
        try {
            Log::info('upsertTarget debug', [
                'user_id' => $user?->id ?? null,
                'period_type' => $data['period_type'] ?? null,
                'target_quiz_sets' => $data['target_quiz_sets'] ?? null,
                'target_sessions' => $data['target_sessions'] ?? null,
                'target_minutes' => $data['target_minutes'] ?? null,
                'subject_id' => $data['subject_id'] ?? null,
            ]);
        } catch (\Throwable $e) {
        }

        [$start, $end] = $this->resolvePeriodBounds($data['period_type'], $now);
        $context = $this->resolveQuestContext(
            $user,
            isset($data['subject_id']) ? (int) $data['subject_id'] : null,
            isset($data['semester_id']) ? (int) $data['semester_id'] : null
        );

        $goal = null;
        if (Schema::hasTable((new LearningGoalTarget())->getTable())) {
            $query = LearningGoalTarget::withoutGlobalScopes()
                ->where('user_id', $user->id)
                ->where('period_type', $data['period_type'])
                ->where('period_start', $start->toDateTimeString());

            if ($this->goalTableHasColumn('subject_id')) {
                if (isset($data['subject_id'])) {
                    $query->where('subject_id', (int) $data['subject_id']);
                } else {
                    $query->whereNull('subject_id');
                }
            }

            if ($this->goalTableHasColumn('schedule_id')) {
                $query->whereNull('schedule_id');
            }

            $goal = $query->first();
        }

        $goalData = $this->extractQuizGoalData($goal, $data['period_type'], $context);
        $targetSessions = (int) ($data['target_sessions'] ?? 0);
        $targetMinutes = (int) ($data['target_minutes'] ?? 0);
        $targetQuizSets = (int) ($data['target_quiz_sets'] ?? 0);

        if ($targetMinutes > 0) {
            $goalData['quest_type'] = 'study_minutes';
            $goalData['target_sessions'] = 0;
            $goalData['target_minutes'] = $targetMinutes;
            $goalData['target_quiz_sets'] = 0;
            $goalData['target_questions'] = 0;
            $goalData['target_value'] = $targetMinutes;
            $goalData['title'] = $this->buildStudyMinutesGoalTitle($data['period_type'], $context);
            $goalData['description'] = $this->buildStudyMinutesDescription($data['period_type'], $targetMinutes, $context);
        } elseif ($targetSessions > 0) {
            $goalData['quest_type'] = 'study_sessions';
            $goalData['target_sessions'] = $targetSessions;
            $goalData['target_minutes'] = 0;
            $goalData['target_quiz_sets'] = 0;
            $goalData['target_questions'] = 0;
            $goalData['target_value'] = $targetSessions;
            $goalData['title'] = $this->buildActivityGoalTitle($data['period_type'], $context);
            $goalData['description'] = $this->buildStudySessionsDescription($data['period_type'], $targetSessions, $context);
        } else {
            $goalData['quest_type'] = 'quiz_mastery';
            $goalData['target_sessions'] = 0;
            $goalData['target_minutes'] = 0;
            $goalData['target_quiz_sets'] = $targetQuizSets;
            $goalData['target_questions'] = 0;
            $goalData['target_value'] = $targetQuizSets;
            $goalData['title'] = $this->buildQuizCountTitle($data['period_type'], $context);
            $goalData['description'] = $this->buildQuizCountDescription($data['period_type'], $targetQuizSets, $context);
        }

        $goalData['filter_subject_id'] = isset($data['subject_id']) ? (int) $data['subject_id'] : null;
        $goalData['filter_semester_id'] = isset($data['semester_id']) ? (int) $data['semester_id'] : null;

        $studyTotals = $this->studyTotals($user, $start, $end, $context);
        $quizTotals = $this->quizTotals($user, $start, $end, $context);
        $currentActivities = (int) $studyTotals['study_sessions'] + (int) $quizTotals['quiz_sets'];
        $goalStatus = $this->resolveGoalStatus(
            $goalData,
            $currentActivities,
            (int) $studyTotals['study_minutes'],
            (int) $quizTotals['question_count'],
            (int) $quizTotals['quiz_sets']
        );
        $questProgress = $this->resolveQuestProgress(
            $goalData['quest_type'],
            $currentActivities,
            (int) $studyTotals['study_minutes'],
            (int) $quizTotals['question_count'],
            (int) $quizTotals['quiz_sets'],
            $goalData['target_value']
        );

        $saved = $this->persistQuestState(
            $user,
            $start,
            $end,
            $data['period_type'],
            $goal,
            $goalData,
            $goalStatus,
            $questProgress
        );

        $summary = $this->buildSummary($user, $start, $end, $data['period_type'], $context);

        return response()->json([
            'message' => 'อัปเดตเป้าหมายเรียบร้อยแล้ว',
            'goal' => $summary['goal'] ?? $saved,
        ]);
    }

    public function resetTarget(): JsonResponse
    {
        $user = request()->user();
        $timezone = config('app.timezone', 'Asia/Bangkok');
        $now = Carbon::now($timezone);

        $data = request()->validate([
            'period_type' => ['required', 'in:daily,weekly,monthly'],
            'subject_id' => ['nullable', 'integer', 'min:1'],
            'semester_id' => ['nullable', 'integer', 'min:1'],
        ]);

        if (!Schema::hasTable((new LearningGoalTarget())->getTable())) {
            return response()->json(['message' => 'รีเซ็ตเป้าหมายเรียบร้อยแล้ว']);
        }

        [$start] = $this->resolvePeriodBounds($data['period_type'], $now);

        LearningGoalTarget::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('period_type', $data['period_type'])
            ->where('period_start', $start->toDateTimeString())
            ->when(
                $this->goalTableHasColumn('subject_id'),
                fn ($query) => isset($data['subject_id'])
                    ? $query->where('subject_id', (int) $data['subject_id'])
                    : $query->whereNull('subject_id')
            )
            ->when(
                $this->goalTableHasColumn('schedule_id'),
                fn ($query) => $query->whereNull('schedule_id')
            )
            ->delete();

        return response()->json([
            'message' => 'รีเซ็ตเป้าหมายเรียบร้อยแล้ว',
        ]);
    }

    private function buildSummary(User $user, Carbon $start, Carbon $end, string $periodType, array $context): array
    {
        $goal = null;
        if (Schema::hasTable((new LearningGoalTarget())->getTable())) {
            $goal = LearningGoalTarget::withoutGlobalScopes()
                ->where('user_id', $user->id)
                ->where('period_type', $periodType)
                ->where('period_start', $start->toDateTimeString())
                ->when(
                    $this->goalTableHasColumn('subject_id'),
                    fn ($query) => !empty($context['filter_subject_id'])
                        ? $query->where('subject_id', (int) $context['filter_subject_id'])
                        : $query->whereNull('subject_id')
                )
                ->when(
                    $this->goalTableHasColumn('schedule_id'),
                    fn ($query) => $query->whereNull('schedule_id')
                )
                ->first();
        }

        $goalData = $this->extractQuizGoalData($goal, $periodType, $context);

        $studyTotals = $this->studyTotals($user, $start, $end, $context);
        $quizTotals = $this->quizTotals($user, $start, $end, $context);
        $subjects = $this->subjectProgress($user, $start, $end, $context);

        $currentSessions = (int) $studyTotals['study_sessions'];
        $currentMinutes = (int) $studyTotals['study_minutes'];
        $currentQuestions = (int) $quizTotals['question_count'];
        $currentQuizSets = (int) $quizTotals['quiz_sets'];
        $currentActivities = $currentSessions + $currentQuizSets;
        $goalStatus = $this->resolveGoalStatus($goalData, $currentActivities, $currentMinutes, $currentQuestions, $currentQuizSets);
        $questProgress = $this->resolveQuestProgress($goalData['quest_type'], $currentActivities, $currentMinutes, $currentQuestions, $currentQuizSets, $goalData['target_value']);

        $goal = $this->persistQuestState(
            $user,
            $start,
            $end,
            $periodType,
            $goal,
            $goalData,
            $goalStatus,
            $questProgress
        );

        return [
            'period_type' => $periodType,
            'period_start' => $start->toIso8601String(),
            'period_end' => $end->toIso8601String(),
            'total_activities' => $currentActivities,
            'total_sessions' => $currentSessions,
            'total_minutes' => $currentMinutes,
            'total_quiz_sets' => $currentQuizSets,
            'total_questions' => $currentQuestions,
            'subjects' => $subjects,
            'goal' => [
                'goal_type' => $goalData['quest_type'],
                'target_value' => $goalData['target_value'],
                'current_value' => $questProgress['current_value'],
                'mission_count' => $questProgress['current_value'],
                'target_sessions' => $goalData['target_sessions'],
                'target_minutes' => $goalData['target_minutes'],
                'target_questions' => $goalData['target_questions'],
                'target_quiz_sets' => $goalData['target_quiz_sets'],
                'current_activities' => $currentActivities,
                'current_sessions' => $currentSessions,
                'current_minutes' => $currentMinutes,
                'current_questions' => $currentQuestions,
                'current_quiz_sets' => $currentQuizSets,
                'progress_percent' => $goalStatus['progress_percent'],
                'status' => $goalStatus['status'],
                'achieved' => $goalStatus['achieved'],
            ],
            'quest' => [
                'id' => $goal?->id,
                'quest_type' => $goalData['quest_type'],
                'title' => $goalData['title'],
                'description' => $goalData['description'],
                'reward_points' => $goalData['reward_points'],
                'status' => $goalStatus['achieved'] ? 'completed' : 'pending',
                'target_value' => $goalData['target_value'],
                'current_value' => $questProgress['current_value'],
                'mission_count' => $questProgress['current_value'],
                'progress_percent' => $questProgress['progress_percent'],
                'focus_subject_id' => $goalData['focus_subject_id'],
                'focus_subject_name' => $goalData['focus_subject_name'],
                'focus_lesson_title' => $goalData['focus_lesson_title'],
                'focus_quiz_title' => $goalData['focus_quiz_title'],
                'celebration_message' => $goalStatus['achieved']
                    ? sprintf('ภารกิจสำเร็จแล้ว +%d แต้ม', $goalData['reward_points'])
                    : 'ลุยต่ออีกนิด ภารกิจนี้ใกล้สำเร็จแล้ว',
                'cta_path' => $goalData['quest_type'] === 'quiz_mastery' ? '/quizzes' : '/subjects',
            ],
        ];
    }

    private function resolveQuizGoalStatus(
        int $currentQuestions,
        int $questionTarget,
        int $currentQuizSets,
        int $quizSetTarget
    ): array {
        if ($questionTarget <= 0 && $quizSetTarget <= 0) {
            return [
                'status' => 'not_set',
                'achieved' => false,
                'current_value' => $currentQuestions,
                'progress_percent' => 0,
            ];
        }

        $questionProgress = $questionTarget > 0 ? (int) round(($currentQuestions / $questionTarget) * 100) : 0;
        $quizSetProgress = $quizSetTarget > 0 ? (int) round(($currentQuizSets / $quizSetTarget) * 100) : 0;
        $achieved = ($questionTarget > 0 && $currentQuestions >= $questionTarget)
            || ($quizSetTarget > 0 && $currentQuizSets >= $quizSetTarget);

        return [
            'status' => $achieved ? 'achieved' : 'not_achieved',
            'achieved' => $achieved,
            'current_value' => $currentQuestions,
            'progress_percent' => max(0, min(100, max($questionProgress, $quizSetProgress))),
        ];
    }

    private function resolveGoalStatus(
        array $goalData,
        int $currentActivities,
        int $currentMinutes,
        int $currentQuestions,
        int $currentQuizSets
    ): array {
        return match ($goalData['quest_type']) {
            'study_sessions' => $this->resolveSingleMetricGoalStatus($currentActivities, (int) $goalData['target_sessions']),
            'study_minutes' => $this->resolveSingleMetricGoalStatus($currentMinutes, (int) $goalData['target_minutes']),
            default => $this->resolveQuizGoalStatus(
                $currentQuestions,
                (int) $goalData['target_questions'],
                $currentQuizSets,
                (int) $goalData['target_quiz_sets']
            ),
        };
    }

    private function resolveSingleMetricGoalStatus(int $currentValue, int $targetValue): array
    {
        if ($targetValue <= 0) {
            return [
                'status' => 'not_set',
                'achieved' => false,
                'current_value' => $currentValue,
                'progress_percent' => 0,
            ];
        }

        $progress = max(0, min(100, (int) round(($currentValue / $targetValue) * 100)));

        return [
            'status' => $currentValue >= $targetValue ? 'achieved' : 'not_achieved',
            'achieved' => $currentValue >= $targetValue,
            'current_value' => $currentValue,
            'progress_percent' => $progress,
        ];
    }

    private function emptySummary(Carbon $start, Carbon $end, string $periodType, array $goalData): array
    {
        return [
            'period_type' => $periodType,
            'period_start' => $start->toIso8601String(),
            'period_end' => $end->toIso8601String(),
            'total_activities' => 0,
            'total_sessions' => 0,
            'total_minutes' => 0,
            'total_quiz_sets' => 0,
            'total_questions' => 0,
            'subjects' => [],
            'goal' => [
                'goal_type' => $goalData['quest_type'],
                'target_value' => $goalData['target_value'],
                'current_value' => 0,
                'mission_count' => 0,
                'target_sessions' => $goalData['target_sessions'],
                'target_minutes' => $goalData['target_minutes'],
                'target_questions' => $goalData['target_questions'],
                'target_quiz_sets' => $goalData['target_quiz_sets'],
                'current_activities' => 0,
                'current_sessions' => 0,
                'current_minutes' => 0,
                'current_questions' => 0,
                'current_quiz_sets' => 0,
                'progress_percent' => 0,
                'status' => 'not_achieved',
                'achieved' => false,
            ],
            'quest' => [
                'id' => null,
                'quest_type' => $goalData['quest_type'],
                'title' => $goalData['title'],
                'description' => $goalData['description'],
                'reward_points' => $goalData['reward_points'],
                'status' => 'pending',
                'target_value' => $goalData['target_value'],
                'current_value' => 0,
                'mission_count' => 0,
                'progress_percent' => 0,
                'focus_subject_id' => $goalData['focus_subject_id'],
                'focus_subject_name' => $goalData['focus_subject_name'],
                'focus_lesson_title' => $goalData['focus_lesson_title'],
                'focus_quiz_title' => $goalData['focus_quiz_title'],
                'celebration_message' => sprintf('ภารกิจสำเร็จแล้ว +%d แต้ม', $goalData['reward_points']),
                'cta_path' => $goalData['quest_type'] === 'quiz_mastery' ? '/quizzes' : '/subjects',
            ],
        ];
    }

    private function resolveQuestContext(User $user, ?int $subjectId = null, ?int $semesterId = null): array
    {
        $fallback = [
            'focus_subject_id' => null,
            'focus_subject_name' => null,
            'focus_quiz_title' => null,
            'focus_lesson_title' => null,
            'filter_subject_id' => $subjectId,
            'filter_semester_id' => $semesterId,
        ];

        if (! Schema::hasTable('subjects')) {
            return $fallback;
        }

        $latestQuiz = null;
        if (Schema::hasTable('quizzes')) {
            $latestQuiz = DB::table('quizzes')
                ->join('subjects', 'quizzes.subject_id', '=', 'subjects.id')
                ->where('subjects.user_id', $user->id)
                ->when($subjectId, fn ($query) => $query->where('subjects.id', $subjectId))
                ->when(!$subjectId && $semesterId, fn ($query) => $query->where('subjects.semester_id', $semesterId))
                ->select(
                    'subjects.id as subject_id',
                    'subjects.name as subject_name',
                    'quizzes.title as quiz_title'
                )
                ->orderByDesc('quizzes.updated_at')
                ->orderByDesc('quizzes.id')
                ->first();
        }

        if ($latestQuiz) {
            $fallback = [
                'focus_subject_id' => (int) $latestQuiz->subject_id,
                'focus_subject_name' => (string) $latestQuiz->subject_name,
                'focus_quiz_title' => (string) $latestQuiz->quiz_title,
                'focus_lesson_title' => null,
                'filter_subject_id' => $subjectId,
                'filter_semester_id' => $semesterId,
            ];
        }

        if (! Schema::hasTable('lessons') || empty($fallback['focus_subject_id'])) {
            return $fallback;
        }

        $latestLesson = DB::table('lessons')
            ->where('subject_id', $fallback['focus_subject_id'])
            ->select('title')
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->first();

        if ($latestLesson && is_string($latestLesson->title) && trim($latestLesson->title) !== '') {
            $fallback['focus_lesson_title'] = trim($latestLesson->title);
        }

        return $fallback;
    }

    private function extractQuizGoalData(?LearningGoalTarget $goal, string $periodType, array $context): array
    {
        $defaults = match ($periodType) {
            'daily' => ['questions' => 0, 'quiz_sets' => 0, 'reward_points' => 15],
            'weekly' => ['questions' => 0, 'quiz_sets' => 0, 'reward_points' => 40],
            'monthly' => ['questions' => 0, 'quiz_sets' => 0, 'reward_points' => 120],
            default => ['questions' => 0, 'quiz_sets' => 0, 'reward_points' => 15],
        };

        $metadata = is_array($goal?->metadata) ? $goal->metadata : [];
        $goalSubjectId = (int) ($goal?->subject_id ?? $metadata['filter_subject_id'] ?? 0);
        $contextSubjectId = (int) ($context['filter_subject_id'] ?? 0);
        $goalSemesterId = (int) ($metadata['filter_semester_id'] ?? 0);
        $contextSemesterId = (int) ($context['filter_semester_id'] ?? 0);
        $sameSubjectFilter = $goalSubjectId === $contextSubjectId;
        $sameSemesterFilter = $contextSubjectId > 0 ? true : $goalSemesterId === $contextSemesterId;
        $sameFilter = $sameSubjectFilter && $sameSemesterFilter;
        $titleAndDescription = $this->buildQuestTitleAndDescription($periodType, $context);

        $questType = $sameFilter ? ($this->readGoalString($goal, ['quest_type']) ?: 'quiz_mastery') : 'quiz_mastery';
        $targetSessions = $sameFilter ? $this->readGoalInt($goal, ['target_sessions'], 0) : 0;
        $targetMinutes = $sameFilter ? $this->readGoalInt($goal, ['target_minutes'], 0) : 0;
        $targetQuestions = $sameFilter ? $this->readGoalInt($goal, ['target_questions'], 0) : 0;
        $targetQuizSets = $sameFilter ? $this->readGoalInt($goal, ['target_quiz_sets'], 0) : 0;
        $targetValue = $sameFilter ? $this->readGoalInt($goal, ['target_value'], 0) : 0;
        $rewardPoints = $sameFilter ? $this->readGoalInt($goal, ['reward_points'], 0) : 0;

        if ($questType === 'quiz_mastery' && $targetQuizSets <= 0) {
            $targetQuizSets = $targetValue > 0 ? $targetValue : $targetSessions;
            $targetSessions = 0;
            $targetMinutes = 0;
        } elseif ($questType === 'study_minutes' && $targetMinutes <= 0) {
            $targetMinutes = $targetValue;
            $targetSessions = 0;
            $targetQuizSets = 0;
        } elseif ($questType === 'study_sessions' && $targetSessions <= 0) {
            $targetSessions = $targetValue;
            $targetMinutes = 0;
            $targetQuizSets = 0;
        }

        if ($targetValue <= 0) {
            $targetValue = match ($questType) {
                'study_sessions' => $targetSessions,
                'study_minutes' => $targetMinutes,
                default => $targetQuizSets,
            };
        }

        if ($rewardPoints <= 0) {
            $rewardPoints = $defaults['reward_points'];
        }

        $title = $this->readGoalString($goal, ['title']) ?: $titleAndDescription['title'];
        if ($questType === 'study_sessions') {
            // The metric is the number of completed learning activities, not study time.
            // Rebuild the title so legacy rows also receive the accurate name on load.
            $title = $this->buildActivityGoalTitle($periodType, $context);
        } elseif ($questType === 'study_minutes') {
            $title = $this->buildStudyMinutesGoalTitle($periodType, $context);
        }

        return [
            'quest_type' => $questType,
            'title' => $title,
            'description' => $titleAndDescription['description'],
            'target_value' => $targetValue,
            'target_sessions' => $targetSessions,
            'target_minutes' => $targetMinutes,
            'target_questions' => $targetQuestions,
            'target_quiz_sets' => $targetQuizSets,
            'reward_points' => $rewardPoints,
            'focus_subject_id' => $context['focus_subject_id'],
            'focus_subject_name' => $context['focus_subject_name'],
            'focus_lesson_title' => $context['focus_lesson_title'],
            'focus_quiz_title' => $context['focus_quiz_title'],
            'filter_subject_id' => $context['filter_subject_id'],
            'filter_semester_id' => $context['filter_semester_id'],
        ];
    }

    private function buildQuestTitleAndDescription(string $periodType, array $context): array
    {
        $subjectName = $context['focus_subject_name'] ?: 'วิชาที่กำลังเรียน';
        $lessonTitle = $context['focus_lesson_title'] ?: null;
        $quizTitle = $context['focus_quiz_title'] ?: null;

        return match ($periodType) {
            'daily' => [
                'title' => $lessonTitle
                    ? "พิชิตบทเรียน {$lessonTitle}"
                    : ($quizTitle ? "ผ่านควิซ {$quizTitle}" : "Daily Quest ของ {$subjectName}"),
                'description' => $lessonTitle
                    ? "ทำแบบทดสอบของ {$subjectName} เรื่อง {$lessonTitle} ให้ผ่านเกณฑ์ภายในวันนี้"
                    : ($quizTitle
                        ? "เก็บแต้มจากแบบทดสอบ {$quizTitle} ของ {$subjectName} ให้สำเร็จวันนี้"
                        : "เคลียร์แบบฝึกหัดของ {$subjectName} อย่างน้อย 1 ชุด หรือทำครบตามจำนวนข้อวันนี้"),
            ],
            'weekly' => [
                'title' => "เป้าหมายแบบทดสอบของ {$subjectName}",
                'description' => "ทำแบบทดสอบของ {$subjectName} ให้ครบตามจำนวนที่ตั้งไว้ภายในสัปดาห์นี้",
            ],
            'monthly' => [
                'title' => "เป้าหมายแบบทดสอบของ {$subjectName}",
                'description' => "ทำแบบทดสอบของ {$subjectName} ให้ครบตามจำนวนที่ตั้งไว้ภายในเดือนนี้",
            ],
            default => [
                'title' => "Quest ของ {$subjectName}",
                'description' => "สะสมความคืบหน้าในการเรียนของ {$subjectName}",
            ],
        };
    }

    private function resolveQuestProgress(
        string $questType,
        int $currentActivities,
        int $currentMinutes,
        int $currentQuestions,
        int $currentQuizSets,
        int $targetValue
    ): array
    {
        $currentValue = match ($questType) {
            'study_sessions' => $currentActivities,
            'study_minutes' => $currentMinutes,
            default => $currentQuizSets,
        };
        $progressPercent = $targetValue > 0
            ? max(0, min(100, (int) round(($currentValue / $targetValue) * 100)))
            : 0;

        return [
            'current_value' => $currentValue,
            'progress_percent' => $progressPercent,
        ];
    }

    private function studyTotals(User $user, Carbon $start, Carbon $end, array $context): array
    {
        if (! Schema::hasTable('study_logs') || ! Schema::hasTable('subjects')) {
            return ['study_sessions' => 0, 'study_minutes' => 0];
        }

        $query = DB::table('study_logs')
            ->join('subjects', 'study_logs.subject_id', '=', 'subjects.id')
            ->where('subjects.user_id', $user->id)
            ->whereBetween('study_logs.log_date', [$start->toDateTimeString(), $end->toDateTimeString()]);

        $this->applySubjectContext($query, $context);

        $row = $query
            ->selectRaw('COUNT(DISTINCT study_logs.id) as study_sessions, COALESCE(SUM(study_logs.duration_minutes), 0) as study_minutes')
            ->first();

        return [
            'study_sessions' => (int) ($row->study_sessions ?? 0),
            'study_minutes' => (int) ($row->study_minutes ?? 0),
        ];
    }

    private function quizTotals(User $user, Carbon $start, Carbon $end, array $context): array
    {
        if (! Schema::hasTable('quiz_attempts') || ! Schema::hasTable('quizzes') || ! Schema::hasTable('subjects')) {
            return ['quiz_sets' => 0, 'question_count' => 0];
        }

        $query = $this->baseQuizQuery($user, $start, $end, $context);
        $questionCountSql = $this->questionCountSql($query);
        $row = $query
            ->selectRaw("COUNT(DISTINCT quiz_attempts.id) as quiz_sets, {$questionCountSql} as question_count")
            ->first();

        return [
            'quiz_sets' => (int) ($row->quiz_sets ?? 0),
            'question_count' => (int) ($row->question_count ?? 0),
        ];
    }

    private function subjectProgress(User $user, Carbon $start, Carbon $end, array $context): array
    {
        if (! Schema::hasTable('subjects')) {
            return [];
        }

        $studyRows = collect();
        if (Schema::hasTable('study_logs')) {
            $studyQuery = DB::table('study_logs')
                ->join('subjects', 'study_logs.subject_id', '=', 'subjects.id')
                ->where('subjects.user_id', $user->id)
                ->whereBetween('study_logs.log_date', [$start->toDateTimeString(), $end->toDateTimeString()]);

            $this->applySubjectContext($studyQuery, $context);

            $studyRows = $studyQuery
                ->selectRaw('subjects.id as subject_id, subjects.name as subject_name, COUNT(DISTINCT study_logs.id) as study_sessions, COALESCE(SUM(study_logs.duration_minutes), 0) as study_minutes')
                ->groupBy('subjects.id', 'subjects.name')
                ->get()
                ->keyBy('subject_id');
        }

        $quizRows = collect();
        if (Schema::hasTable('quiz_attempts') && Schema::hasTable('quizzes')) {
            $quizQuery = $this->baseQuizQuery($user, $start, $end, $context);
            $questionCountSql = $this->questionCountSql($quizQuery);
            $quizRows = $quizQuery
                ->selectRaw("subjects.id as subject_id, subjects.name as subject_name, COUNT(DISTINCT quiz_attempts.id) as quiz_sets, {$questionCountSql} as question_count")
                ->groupBy('subjects.id', 'subjects.name')
                ->get()
                ->keyBy('subject_id');
        }

        $activities = $this->subjectActivities($user, $start, $end, $context);

        return $studyRows
            ->keys()
            ->merge($quizRows->keys())
            ->unique()
            ->map(function ($subjectId) use ($studyRows, $quizRows, $activities) {
                $study = $studyRows->get($subjectId);
                $quiz = $quizRows->get($subjectId);

                return [
                    'subject_id' => (int) $subjectId,
                    'subject_name' => (string) ($study->subject_name ?? $quiz->subject_name ?? 'ไม่ระบุวิชา'),
                    'activity_count' => (int) ($study->study_sessions ?? 0) + (int) ($quiz->quiz_sets ?? 0),
                    'study_sessions' => (int) ($study->study_sessions ?? 0),
                    'study_minutes' => (int) ($study->study_minutes ?? 0),
                    'quiz_sets' => (int) ($quiz->quiz_sets ?? 0),
                    'question_count' => (int) ($quiz->question_count ?? 0),
                    'activities' => $activities->get($subjectId, collect())->values()->all(),
                ];
            })
            ->sortByDesc(fn ($item) => $item['activity_count'])
            ->values()
            ->all();
    }

    private function subjectActivities(User $user, Carbon $start, Carbon $end, array $context)
    {
        $activities = collect();
        if (Schema::hasTable('study_logs')) {
            $query = DB::table('study_logs')
                ->join('subjects', 'study_logs.subject_id', '=', 'subjects.id')
                ->where('subjects.user_id', $user->id)
                ->whereBetween('study_logs.log_date', [$start->toDateTimeString(), $end->toDateTimeString()]);
            $this->applySubjectContext($query, $context);

            $activities = $query->select('study_logs.*')->get()->map(fn ($log) => [
                'id' => 'study-'.$log->id,
                'subject_id' => (int) $log->subject_id,
                'type' => $log->log_type ?? 'study',
                'title' => $log->title ?: 'บันทึกการเรียน',
                'date' => $log->log_date,
                'duration_minutes' => $log->duration_minutes === null ? null : (int) $log->duration_minutes,
            ]);
        }

        if (Schema::hasTable('quiz_attempts') && Schema::hasTable('quizzes')) {
            $quizzes = $this->baseQuizQuery($user, $start, $end, $context)
                ->select('quiz_attempts.id', 'quiz_attempts.created_at', 'quiz_attempts.score', 'quiz_attempts.passed', 'quizzes.subject_id', 'quizzes.title')
                ->get()->map(fn ($attempt) => [
                    'id' => 'quiz-'.$attempt->id,
                    'subject_id' => (int) $attempt->subject_id,
                    'type' => 'quiz',
                    'title' => $attempt->title ?: 'แบบทดสอบ',
                    'date' => $attempt->created_at,
                    'score' => (int) $attempt->score,
                    'passed' => (bool) $attempt->passed,
                ]);
            $activities = $activities->concat($quizzes);
        }

        return $activities->sortByDesc('date')->groupBy('subject_id');
    }

    private function baseQuizQuery(User $user, Carbon $start, Carbon $end, array $context)
    {
        $query = DB::table('quiz_attempts')
            ->join('quizzes', 'quiz_attempts.quiz_id', '=', 'quizzes.id')
            ->join('subjects', 'quizzes.subject_id', '=', 'subjects.id')
            ->where('quiz_attempts.user_id', $user->id)
            ->where('subjects.user_id', $user->id)
            ->whereBetween('quiz_attempts.created_at', [$start->toDateTimeString(), $end->toDateTimeString()]);

        $this->applySubjectContext($query, $context);

        return $query;
    }

    private function questionCountSql($query): string
    {
        if (Schema::hasTable('quiz_questions')) {
            $query->leftJoin('quiz_questions', 'quiz_questions.quiz_id', '=', 'quizzes.id');

            return 'COUNT(quiz_questions.id)';
        }

        return 'COALESCE(SUM(JSON_LENGTH(quiz_attempts.answers)), 0)';
    }

    private function applySubjectContext($query, array $context): void
    {
        if (!empty($context['filter_subject_id'])) {
            $query->where('subjects.id', (int) $context['filter_subject_id']);
        } elseif (!empty($context['filter_semester_id'])) {
            $query->where('subjects.semester_id', (int) $context['filter_semester_id']);
        }
    }

    private function persistQuestState(
        User $user,
        Carbon $start,
        Carbon $end,
        string $periodType,
        ?LearningGoalTarget $goal,
        array $goalData,
        array $goalStatus,
        array $questProgress
    ): ?LearningGoalTarget {
        if (! Schema::hasTable((new LearningGoalTarget())->getTable())) {
            return $goal;
        }

        if (
            ! $goal
            && $goalData['target_value'] <= 0
            && $goalData['target_sessions'] <= 0
            && $goalData['target_minutes'] <= 0
            && $goalData['target_quiz_sets'] <= 0
            && $goalData['target_questions'] <= 0
        ) {
            return null;
        }

        $attributes = [
            'user_id' => $user->id,
            'period_type' => $periodType,
            'period_start' => $start->toDateTimeString(),
        ];

        if ($this->goalTableHasColumn('period_end')) {
            $attributes['period_end'] = $end->toDateTimeString();
        }

        if ($this->goalTableHasColumn('subject_id')) {
            $subjectId = $goalData['filter_subject_id'] ?? null;
            // Guard against invalid subject IDs that would violate the FK constraint.
            if ($subjectId !== null && Schema::hasTable('subjects')) {
                $subjectExists = DB::table('subjects')
                    ->where('id', (int) $subjectId)
                    ->where('user_id', $user->id)
                    ->exists();

                $attributes['subject_id'] = $subjectExists ? (int) $subjectId : null;
            } else {
                $attributes['subject_id'] = null;
            }
        }

        if ($this->goalTableHasColumn('schedule_id')) {
            $attributes['schedule_id'] = null;
        }

        $payload = [];

        if ($this->goalTableHasColumn('quest_type')) {
            $payload['quest_type'] = $goalData['quest_type'];
        }

        if ($this->goalTableHasColumn('title')) {
            $payload['title'] = $goalData['title'];
        }

        if ($this->goalTableHasColumn('target_value')) {
            $payload['target_value'] = $goalData['target_value'];
        }

        if ($this->goalTableHasColumn('current_value')) {
            $payload['current_value'] = $questProgress['current_value'];
        }

        if ($this->goalTableHasColumn('mission_count')) {
            $payload['mission_count'] = $questProgress['current_value'];
        }

        if ($this->goalTableHasColumn('reward_points')) {
            $payload['reward_points'] = $goalData['reward_points'];
        }

        if ($this->goalTableHasColumn('status')) {
            $payload['status'] = $goalStatus['achieved'] ? 'completed' : 'pending';
        }

        if ($this->goalTableHasColumn('target_sessions')) {
            $payload['target_sessions'] = $goalData['target_sessions'];
        }

        if ($this->goalTableHasColumn('target_minutes')) {
            $payload['target_minutes'] = $goalData['target_minutes'];
        }

        if ($this->goalTableHasColumn('target_questions')) {
            $payload['target_questions'] = $goalData['target_questions'];
        }

        if ($this->goalTableHasColumn('target_quiz_sets')) {
            $payload['target_quiz_sets'] = $goalData['target_quiz_sets'];
        }

        if ($this->goalTableHasColumn('metadata')) {
            $payload['metadata'] = [
                'description' => $goalData['description'],
                'focus_subject_id' => $goalData['focus_subject_id'],
                'focus_subject_name' => $goalData['focus_subject_name'],
                'focus_lesson_title' => $goalData['focus_lesson_title'],
                'focus_quiz_title' => $goalData['focus_quiz_title'],
                'filter_subject_id' => $goalData['filter_subject_id'] ?? null,
                'filter_semester_id' => $goalData['filter_semester_id'] ?? null,
                'target_questions' => $goalData['target_questions'],
                'target_quiz_sets' => $goalData['target_quiz_sets'],
                'progress_percent' => $questProgress['progress_percent'],
            ];
        }

        return LearningGoalTarget::withoutGlobalScopes()->updateOrCreate(
            [
                'user_id' => $attributes['user_id'],
                'period_type' => $attributes['period_type'],
                'period_start' => $attributes['period_start'],
                'subject_id' => $attributes['subject_id'] ?? null,
                'schedule_id' => $attributes['schedule_id'] ?? null,
            ],
            array_merge($attributes, $payload)
        );
    }

    private function goalTableHasColumn(string $column): bool
    {
        if ($this->goalTableColumns === null) {
            $this->goalTableColumns = Schema::hasTable('learning_goal_targets')
                ? Schema::getColumnListing('learning_goal_targets')
                : [];
        }

        return in_array($column, $this->goalTableColumns, true);
    }

    private function readGoalInt(?LearningGoalTarget $goal, array $columns, int $fallback): int
    {
        if (! $goal) {
            return $fallback;
        }

        foreach ($columns as $column) {
            if (! $this->goalTableHasColumn($column)) {
                continue;
            }

            $value = $goal->getAttribute($column);
            if ($value !== null && $value !== '') {
                return (int) $value;
            }
        }

        return $fallback;
    }

    private function readGoalString(?LearningGoalTarget $goal, array $columns): ?string
    {
        if (! $goal) {
            return null;
        }

        foreach ($columns as $column) {
            if (! $this->goalTableHasColumn($column)) {
                continue;
            }

            $value = $goal->getAttribute($column);
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }

        return null;
    }

    private function resolvePeriodBounds(string $periodType, Carbon $now): array
    {
        return match ($periodType) {
            'daily' => [$now->copy()->startOfDay(), $now->copy()->endOfDay()],
            'weekly' => [$now->copy()->startOfWeek(Carbon::MONDAY), $now->copy()->endOfWeek(Carbon::SUNDAY)],
            'monthly' => [$now->copy()->startOfMonth(), $now->copy()->endOfMonth()],
            default => [$now->copy()->startOfDay(), $now->copy()->endOfDay()],
        };
    }

    private function buildQuizCountTitle(string $periodType, array $context): string
    {
        $subjectName = $context['focus_subject_name'] ?: 'วิชาที่กำลังเรียน';

        return match ($periodType) {
            'daily' => "ทำแบบทดสอบของ {$subjectName}",
            'weekly' => "สะสมแบบทดสอบของ {$subjectName}",
            'monthly' => "เป้าหมายแบบทดสอบของ {$subjectName}",
            default => "แบบทดสอบของ {$subjectName}",
        };
    }

    private function buildQuizCountDescription(string $periodType, int $targetQuizSets, array $context): string
    {
        $subjectName = $context['focus_subject_name'] ?: 'วิชาที่กำลังเรียน';

        return match ($periodType) {
            'daily' => "ทำแบบทดสอบของ {$subjectName} ให้ครบ {$targetQuizSets} ชุดภายในวันนี้",
            'weekly' => "ทำแบบทดสอบของ {$subjectName} ให้ครบ {$targetQuizSets} ชุดภายในสัปดาห์นี้",
            'monthly' => "ทำแบบทดสอบของ {$subjectName} ให้ครบ {$targetQuizSets} ชุดภายในเดือนนี้",
            default => "ทำแบบทดสอบของ {$subjectName} ให้ครบ {$targetQuizSets} ชุด",
        };
    }

    private function buildActivityGoalTitle(string $periodType, array $context): string
    {
        $subjectName = $context['focus_subject_name'] ?: 'วิชาที่กำลังเรียน';

        return match ($periodType) {
            'daily' => "เป้าหมายกิจกรรมการเรียนวันนี้ของ {$subjectName}",
            'weekly' => "เป้าหมายกิจกรรมการเรียนสัปดาห์นี้ของ {$subjectName}",
            'monthly' => "เป้าหมายกิจกรรมการเรียนเดือนนี้ของ {$subjectName}",
            default => "เป้าหมายกิจกรรมการเรียนของ {$subjectName}",
        };
    }

    private function buildStudyMinutesGoalTitle(string $periodType, array $context): string
    {
        $subjectName = $context['focus_subject_name'] ?: 'วิชาที่กำลังเรียน';

        return match ($periodType) {
            'daily' => "เป้าหมายเวลาเรียนวันนี้ของ {$subjectName}",
            'weekly' => "เป้าหมายเวลาเรียนสัปดาห์นี้ของ {$subjectName}",
            'monthly' => "เป้าหมายเวลาเรียนเดือนนี้ของ {$subjectName}",
            default => "เป้าหมายเวลาเรียนของ {$subjectName}",
        };
    }

    private function buildStudySessionsDescription(string $periodType, int $targetSessions, array $context): string
    {
        $subjectName = $context['focus_subject_name'] ?: 'วิชาที่กำลังเรียน';

        return match ($periodType) {
            'daily' => "ทำกิจกรรมการเรียนของ {$subjectName} ให้ครบ {$targetSessions} กิจกรรมภายในวันนี้",
            'weekly' => "ทำกิจกรรมการเรียนของ {$subjectName} ให้ครบ {$targetSessions} กิจกรรมภายในสัปดาห์นี้",
            'monthly' => "ทำกิจกรรมการเรียนของ {$subjectName} ให้ครบ {$targetSessions} กิจกรรมภายในเดือนนี้",
            default => "ทำกิจกรรมการเรียนของ {$subjectName} ให้ครบ {$targetSessions} กิจกรรม",
        };
    }

    private function buildStudyMinutesDescription(string $periodType, int $targetMinutes, array $context): string
    {
        $subjectName = $context['focus_subject_name'] ?: 'วิชาที่กำลังเรียน';
        $hours = round($targetMinutes / 60, 1);

        return match ($periodType) {
            'daily' => "เรียน {$subjectName} ให้ครบ {$hours} ชั่วโมงภายในวันนี้",
            'weekly' => "เรียน {$subjectName} ให้ครบ {$hours} ชั่วโมงภายในสัปดาห์นี้",
            'monthly' => "เรียน {$subjectName} ให้ครบ {$hours} ชั่วโมงภายในเดือนนี้",
            default => "เรียน {$subjectName} ให้ครบ {$hours} ชั่วโมง",
        };
    }
}
