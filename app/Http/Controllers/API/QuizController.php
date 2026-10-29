<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Requests\QuizAttemptRequest;
use App\Http\Requests\QuizGenerationRequest;
use App\Http\Resources\QuizAnswerResource;
use App\Http\Resources\QuizResource;
use App\Models\FileAttachment;
use App\Models\Quiz;
use App\Models\StudyLog;
use App\Models\Subject;
use App\Services\AI\AIService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class QuizController extends Controller
{
    public function __construct(private readonly AIService $aiService)
    {
    }

    public function index(int $subject): AnonymousResourceCollection
    {
        $subject = $this->resolveSubject($subject);
        $this->authorizeSubject($subject);
        $userId = request()->user()->id;
        $quizzes = $subject->quizzes()
            ->with(['answers' => fn ($query) => $query->where('user_id', $userId)])
            ->latest()
            ->get();
        return QuizResource::collection($quizzes);
    }

    public function store(QuizGenerationRequest $request, int $subject): JsonResponse
    {
        $subject = $this->resolveSubject($subject);
        $this->authorizeSubject($subject);
        $this->ensureQuizQuestionColumnsSupportLongText();

        try {
            $quizDto = $this->aiService->generateQuiz($subject, $request->validated());
        } catch (\Throwable $e) {
            return response()->json([
                'message' => $e->getMessage() ?: 'ไม่สามารถสร้างข้อสอบได้',
            ], 422);
        }

        $quiz = DB::transaction(function () use ($subject, $quizDto) {
            $quiz = $subject->quizzes()->create([
                'title' => $this->limitText($quizDto['title'] ?? $subject->name, 240),
                'description' => $this->limitNullableText($quizDto['description'] ?? null, 240),
                'ai_model' => $quizDto['model'] ?? null,
                'metadata' => $this->normalizeQuizMetadata($quizDto['metadata'] ?? null),
            ]);

            foreach ($quizDto['questions'] as $question) {
                $quiz->questions()->create($this->formatQuestionPayload($question));
            }

            return $quiz;
        });

        return response()->json(new QuizResource($quiz->load('questions')), 201);
    }

    public function storeFromFile(int $subject): JsonResponse
    {
        $subject = $this->resolveSubject($subject);
        $this->authorizeSubject($subject);
        $this->ensureQuizQuestionColumnsSupportLongText();
        $usedFallbackQuiz = false;

        $data = request()->validate([
            'file' => ['required_without:file_id', 'file', 'max:51200'],
            'file_id' => ['nullable', 'integer', 'exists:files,id'],
            'title' => ['nullable', 'string', 'max:255'],
            'difficulty' => ['nullable', 'in:easy,medium,hard'],
            'question_types' => ['nullable', 'array'],
            'question_types.*' => ['in:multiple_choice,true_false,short_answer'],
            'question_count' => ['nullable', 'integer', 'min:3', 'max:50'],
            'extracted_text' => ['nullable', 'string'],
        ]);

        /** @var UploadedFile $file */
        $file = request()->file('file');
        $existingFile = null;
        if (! empty($data['file_id'])) {
            $existingFile = FileAttachment::findOrFail($data['file_id']);
            $this->authorizeSourceFile($existingFile);
            abort_unless(Storage::disk('public')->exists($existingFile->file_path), 422, 'ไม่พบไฟล์ต้นฉบับที่บันทึกไว้');
            $file = new UploadedFile(Storage::disk('public')->path($existingFile->file_path),
                $existingFile->original_name, $existingFile->mime_type, null, true);
        }
        if (! $this->isAllowedDocument($file?->getClientOriginalExtension())) {
            return response()->json([
                'message' => 'รองรับเฉพาะไฟล์ PDF, DOC, DOCX หรือ TXT เท่านั้น',
            ], 422);
        }
        if (! $existingFile) {
            $digest = hash_file('sha256', $file->getRealPath());
            $candidates = FileAttachment::where('file_path', 'like', 'study-files/'.$subject->id.'/%')
                ->where('original_name', $file->getClientOriginalName())->where('file_size', $file->getSize())->get();
            foreach ($candidates as $candidate) {
                if (Storage::disk('public')->exists($candidate->file_path)
                    && hash_file('sha256', Storage::disk('public')->path($candidate->file_path)) === $digest) {
                    $existingFile = $candidate;
                    break;
                }
            }
        }

        // Always try to read the uploaded file first.  The browser-supplied
        // extraction is only a fallback for PDFs that the server cannot read
        // (for example image-only PDFs).  Previously it was used first, so a
        // stale client extraction could create questions from another file.
        $browserExtractedText = trim((string) ($data['extracted_text'] ?? ''));
        $text = '';
        $textSource = 'uploaded_file';
        try {
            try {
                $extract = $this->aiService->extractDocumentText($file);
                $text = trim((string) ($extract['text'] ?? ''));
            } catch (\Throwable $extractionError) {
                if ($browserExtractedText === '') {
                    throw $extractionError;
                }

                $text = $browserExtractedText;
                $textSource = 'browser_pdf_fallback';
            }

            if ($text === '') {
                throw new \RuntimeException('ไม่สามารถดึงข้อความจากไฟล์ได้');
            }

            $quizDto = $this->aiService->generateQuizFromText($subject, $text, $data);
        } catch (\Throwable $e) {
            // Browser/OCR extraction may succeed for PDFs the local parser cannot read.
            // Keep that source when question generation fails after extraction.
            $bestEffortText = $text !== '' ? $text : $this->aiService->extractDocumentTextBestEffort($file);
            // Never generate questions from only the subject or file name: every
            // generated question must be grounded in text extracted from the
            // document the learner selected.
            if (! is_string($bestEffortText) || trim($bestEffortText) === '') {
                return response()->json([
                    'message' => 'ระบบอ่านเนื้อหาจาก PDF ที่เลือกไม่ได้ จึงยังไม่สร้างแบบฝึกหัดเพื่อป้องกันคำถามที่ไม่ตรงกับไฟล์ กรุณาอัปโหลด PDF ต้นฉบับที่เปิดอ่านได้ หรือแปลงเป็น DOCX/TXT',
                ], 422);
            }
            try {
            $quizDto = $this->aiService->generateFallbackQuizFromDocument(
                $subject,
                $file,
                $data,
                $e->getMessage(),
                $bestEffortText
            );
            } catch (\Throwable $fallbackError) {
                return response()->json(['message' => $fallbackError->getMessage()], 422);
            }
            $usedFallbackQuiz = true;
        }

        $storedPath = $existingFile?->file_path ?? $file->store('study-files/'.$subject->id, 'public');

        try {
            $quiz = DB::transaction(function () use ($subject, $file, $storedPath, $quizDto, $textSource, $existingFile) {
                $fileRecord = $existingFile ?? FileAttachment::create([
                    // The uploaded document is a quiz asset; it must not create
                    // a study log or appear in the study-summary menu.
                    'study_log_id' => null,
                    'original_name' => $file->getClientOriginalName(),
                    'file_path' => $storedPath,
                    'file_type' => $this->resolveFileType($file->getClientOriginalExtension()),
                    'mime_type' => $file->getMimeType(),
                    'file_size' => $file->getSize(),
                ]);

                $metadata = array_merge($quizDto['metadata'] ?? [], [
                    'source' => 'document',
                    'file_id' => $fileRecord->id,
                    'file_name' => $file->getClientOriginalName(),
                    'source_text_origin' => $textSource,
                ]);

                $quiz = $subject->quizzes()->create([
                    'title' => $this->limitText($quizDto['title'] ?? $subject->name, 240),
                    'description' => $this->limitNullableText($quizDto['description'] ?? null, 240),
                    'ai_model' => $quizDto['model'] ?? null,
                    'metadata' => $this->normalizeQuizMetadata($metadata),
                ]);

                foreach ($quizDto['questions'] as $question) {
                    $quiz->questions()->create($this->formatQuestionPayload($question));
                }

                return $quiz;
            });
        } catch (\Throwable $e) {
            if (! $existingFile) Storage::disk('public')->delete($storedPath);
            return response()->json([
                'message' => $e->getMessage() ?: 'บันทึกข้อสอบจากไฟล์ไม่สำเร็จ',
            ], 422);
        }

        $resource = new QuizResource($quiz->load('questions'));

        return response()->json([
            ...$resource->resolve(request()),
            'message' => $usedFallbackQuiz
                ? (($quizDto['metadata']['fallback_mode'] ?? null) === 'document-best-effort'
                    ? 'สร้างแบบฝึกหัดจากข้อความที่อ่านได้ในเอกสารเรียบร้อยแล้ว'
                    : 'สร้างแบบฝึกหัดเบื้องต้นเรียบร้อยแล้ว เนื่องจากระบบยังอ่านเนื้อหาในเอกสารไม่สำเร็จ')
                : 'สร้างแบบฝึกหัดจากเอกสารเรียบร้อยแล้ว',
        ], 201);
    }

    public function show(Quiz $quiz): QuizResource
    {
        $this->authorizeQuiz($quiz);
        $quiz->load('questions');

        if ($quiz->questions->isEmpty()) {
            $this->repairEmptyQuizQuestions($quiz);
            $quiz->refresh()->load('questions');
        }

        return new QuizResource($quiz);
    }

    public function destroy(Quiz $quiz): JsonResponse
    {
        $this->authorizeQuiz($quiz);

        DB::transaction(function () use ($quiz) {
            DB::table('quiz_attempts')->where('quiz_id', $quiz->id)->delete();
            $quiz->answers()->delete();
            $quiz->questions()->delete();
            $quiz->delete();
        });

        return response()->json(status: 204);
    }

    public function summary(): JsonResponse
    {
        $user = request()->user();

        if (! $user || ! Schema::hasTable('quiz_attempts') || ! Schema::hasTable('quizzes') || ! Schema::hasTable('subjects')) {
            return response()->json([
                'attempt_count' => 0,
                'attempted_quiz_count' => 0,
                'average_score' => null,
                'latest_score' => null,
                'best_score' => null,
                'passed_count' => 0,
                'pass_rate' => null,
            ]);
        }

        $attempts = DB::table('quiz_attempts')
            ->join('quizzes', 'quizzes.id', '=', 'quiz_attempts.quiz_id')
            ->join('subjects', 'subjects.id', '=', 'quizzes.subject_id')
            ->where('quiz_attempts.user_id', $user->id)
            ->where('subjects.user_id', $user->id)
            ->orderBy('quiz_attempts.created_at')
            ->orderBy('quiz_attempts.id')
            ->get([
                'quiz_attempts.id',
                'quiz_attempts.quiz_id',
                'quiz_attempts.score',
                'quiz_attempts.answers',
                'quiz_attempts.passed',
                'quiz_attempts.created_at',
            ]);

        $scores = $attempts
            ->map(function ($attempt) {
                $answers = json_decode((string) ($attempt->answers ?? '[]'), true);
                $total = is_array($answers) ? count($answers) : 0;
                $score = (int) ($attempt->score ?? 0);

                return [
                    'quiz_id' => (int) ($attempt->quiz_id ?? 0),
                    'score' => $score,
                    'total' => $total,
                    'percentage' => $total > 0 ? round(($score / $total) * 100, 1) : null,
                    'passed' => (bool) ($attempt->passed ?? false),
                    'created_at' => $attempt->created_at,
                ];
            })
            ->filter(fn (array $attempt) => $attempt['percentage'] !== null)
            ->values();

        $attemptCount = $scores->count();
        $latest = $scores->last();

        return response()->json([
            'attempt_count' => $attemptCount,
            'attempted_quiz_count' => $scores->pluck('quiz_id')->filter()->unique()->count(),
            'average_score' => $attemptCount > 0 ? round((float) $scores->avg('percentage'), 1) : null,
            'latest_score' => $latest ? (float) $latest['percentage'] : null,
            'best_score' => $attemptCount > 0 ? (float) $scores->max('percentage') : null,
            'passed_count' => $scores->filter(fn (array $attempt) => $attempt['passed'])->count(),
            'pass_rate' => $attemptCount > 0
                ? round(($scores->filter(fn (array $attempt) => $attempt['passed'])->count() / $attemptCount) * 100, 1)
                : null,
        ]);
    }

    public function submitAttempt(QuizAttemptRequest $request, Quiz $quiz): JsonResponse
    {
        $this->authorizeQuiz($quiz);
        $data = $request->validated();
        $user = $request->user();

        return DB::transaction(function () use ($quiz, $data, $user) {
        $questionIds = $quiz->questions()->pluck('id')->map(fn ($id) => (int) $id)->all();
        $submittedIds = array_map(fn ($answer) => (int) $answer['question_id'], $data['answers']);
        abort_if(count($submittedIds) !== count(array_unique($submittedIds)) || array_diff($submittedIds, $questionIds), 422, 'คำตอบมีข้อซ้ำหรือไม่ได้อยู่ในแบบฝึกหัดนี้');
        $result = $this->aiService->gradeQuiz($quiz, $user, $data['answers']);
        $percentage = $result['total'] > 0 ? ($result['score'] / $result['total']) * 100 : 0;

        if (Schema::hasTable('quiz_attempts')) {
            $attemptPayload = [
                'user_id' => $user->id,
                'quiz_id' => $quiz->id,
                'answers' => $this->encodeAttemptAnswers($this->formatAttemptAnswers($result['answers'] ?? [])),
                'score' => (int) $result['score'],
                'passed' => $percentage >= 60,
                'created_at' => now(),
                'updated_at' => now(),
            ];

            DB::table('quiz_attempts')->insert($attemptPayload);
        }

        return response()->json([
            'score' => $result['score'],
            'total' => $result['total'],
            'answers' => QuizAnswerResource::collection($result['answers']),
        ]);
        });
    }

    public function attempts(Quiz $quiz): JsonResponse
    {
        $this->authorizeQuiz($quiz);
        if (! Schema::hasTable('quiz_attempts')) {
            return response()->json([]);
        }
        return response()->json(DB::table('quiz_attempts')
            ->where('quiz_id', $quiz->id)->where('user_id', request()->user()->id)
            ->orderByDesc('id')->get()->map(function ($attempt) {
                $answers = json_decode((string) $attempt->answers, true) ?: [];
                return [
                    'id' => $attempt->id, 'score' => (int) $attempt->score,
                    'total' => count($answers), 'answers' => $answers,
                    'answered_at' => Carbon::parse($attempt->created_at, config('app.timezone', 'UTC'))->toIso8601String(),
                ];
            }));
    }

    private function authorizeSourceFile(FileAttachment $file): void
    {
        // The library includes all of the learner's subjects. The document's
        // owner must be checked independently of the destination quiz subject.
        $sourceSubjectId = $file->study_log_id
            ? StudyLog::withoutGlobalScopes()->whereKey($file->study_log_id)->value('subject_id')
            : null;
        if (! $sourceSubjectId && preg_match('~^study-files/([0-9]+)/[^/\\\\]+$~', (string) $file->file_path, $match)) {
            $sourceSubjectId = (int) $match[1];
        }

        $sourceSubject = $sourceSubjectId
            ? Subject::withoutGlobalScope('user')->find($sourceSubjectId)
            : null;
        abort_unless($sourceSubject, 403, 'ไม่สามารถตรวจสอบเจ้าของไฟล์เอกสารได้');
        $this->authorizeSubject($sourceSubject);
    }

    private function authorizeSubject(Subject $subject): void
    {
        $user = request()->user();

        abort_unless($user && ((int) $subject->user_id === (int) $user->id || $user->role === 'admin'), 403, 'Unauthorized');
    }

    private function authorizeQuiz(Quiz $quiz): void
    {
        $subject = Subject::withoutGlobalScope('user')->find($quiz->subject_id);
        abort_unless($subject, 404, 'Subject not found');

        $this->authorizeSubject($subject);
        $quiz->setRelation('subject', $subject);
    }

    private function resolveSubject(int $subjectId): Subject
    {
        return Subject::withoutGlobalScope('user')->findOrFail($subjectId);
    }

    private function isAllowedDocument(?string $extension): bool
    {
        if (! $extension) {
            return false;
        }

        return in_array(strtolower($extension), ['pdf', 'doc', 'docx', 'txt'], true);
    }

    private function resolveFileType(?string $extension): string
    {
        return match (strtolower((string) $extension)) {
            'pdf' => 'pdf',
            'doc', 'docx' => 'word',
            'txt' => 'other',
            default => 'other',
        };
    }

    private function repairEmptyQuizQuestions(Quiz $quiz): void
    {
        if ($quiz->questions()->exists()) {
            return;
        }

        $metadata = is_array($quiz->metadata) ? $quiz->metadata : [];
        $sourceText = $this->quizRepairSourceText($quiz, $metadata);
        $questionTypes = $metadata['requested_types'] ?? ['multiple_choice', 'short_answer'];
        $questionTypes = is_array($questionTypes) ? $questionTypes : ['multiple_choice', 'short_answer'];

        $quizDto = $this->aiService->generateLocalQuizFromText($quiz->subject, $sourceText, [
            'title' => $quiz->title ?: null,
            'difficulty' => $metadata['difficulty'] ?? 'medium',
            'question_count' => 5,
            'question_types' => $questionTypes,
        ], [
            'source' => $metadata['source'] ?? 'repair',
            'fallback_mode' => 'repaired-empty-quiz',
        ]);

        DB::transaction(function () use ($quiz, $quizDto) {
            if ($quiz->questions()->exists()) {
                return;
            }

            foreach ($quizDto['questions'] as $question) {
                $quiz->questions()->create($this->formatQuestionPayload($question));
            }
        });
    }

    /**
     * @param  array<string,mixed>  $metadata
     */
    private function quizRepairSourceText(Quiz $quiz, array $metadata): string
    {
        $pieces = [];
        $fileId = isset($metadata['file_id']) ? (int) $metadata['file_id'] : null;
        if ($fileId) {
            $file = FileAttachment::find($fileId);
            if ($file && $file->file_path && Storage::disk('public')->exists($file->file_path)) {
                try {
                    $path = Storage::disk('public')->path($file->file_path);
                    $uploaded = new UploadedFile(
                        $path,
                        $file->original_name ?: basename($path),
                        $file->mime_type,
                        null,
                        true
                    );
                    $text = $this->aiService->extractDocumentTextBestEffort($uploaded);
                    if (is_string($text) && trim($text) !== '') {
                        $pieces[] = $text;
                    }
                } catch (\Throwable) {
                    // Continue with study-log and subject context.
                }
            }
        }

        $studyLogId = isset($metadata['study_log_id']) ? (int) $metadata['study_log_id'] : null;
        if ($studyLogId) {
            $log = StudyLog::find($studyLogId);
            if ($log) {
                $pieces[] = trim(implode("\n", array_filter([
                    $log->title ? 'หัวข้อ: '.$log->title : null,
                    $log->note ? 'บันทึก: '.$log->note : null,
                ])));
            }
        }

        $pieces[] = trim(implode("\n", array_filter([
            $quiz->title ? 'ชื่อแบบฝึกหัด: '.$quiz->title : null,
            $quiz->subject?->name ? 'วิชา: '.$quiz->subject->name : null,
            $quiz->subject?->description ? 'รายละเอียดวิชา: '.$quiz->subject->description : null,
        ])));

        return trim(implode("\n\n", array_filter($pieces)));
    }

    /**
     * @param  array<string, mixed>  $question
     * @return array<string, mixed>
     */
    private function formatQuestionPayload(array $question): array
    {
        $questionText = $this->cleanUtf8Text($question['question_text'] ?? 'Question');
        $correctAnswer = $this->cleanUtf8Text($question['correct_answer'] ?? '');
        $explanation = $this->cleanUtf8Text($question['explanation'] ?? '');

        return [
            'question_text' => $questionText !== '' ? $questionText : 'Question',
            'question_type' => (string) ($question['question_type'] ?? 'multiple_choice'),
            'options' => $this->normalizeOptions($question['options'] ?? null),
            'correct_answer' => $correctAnswer !== '' ? $correctAnswer : null,
            'explanation' => $explanation !== '' ? $explanation : null,
        ];
    }

    private function cleanUtf8Text(mixed $value): string
    {
        if (is_array($value)) {
            $value = implode(' ', array_filter(array_map(
                fn ($item) => $this->cleanUtf8Text($item),
                $value
            ), fn (string $item) => $item !== ''));
        } elseif (is_object($value)) {
            $value = method_exists($value, '__toString') ? (string) $value : '';
        } elseif (is_bool($value)) {
            $value = $value ? 'true' : 'false';
        } elseif ($value === null) {
            $value = '';
        } else {
            $value = (string) $value;
        }

        $value = trim($value);

        if ($value === '') {
            return '';
        }

        if (! mb_check_encoding($value, 'UTF-8')) {
            if (function_exists('mb_scrub')) {
                $value = mb_scrub($value, 'UTF-8');
            } else {
                $converted = @iconv('UTF-8', 'UTF-8//IGNORE', $value);
                $value = is_string($converted) ? $converted : '';
            }
        }

        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', ' ', $value) ?? $value;
        $value = preg_replace('/[ \t]+/u', ' ', $value) ?? $value;

        return trim($value);
    }

    /**
     * @param  mixed  $value
     * @return array<int, string>|null
     */
    private function normalizeOptions(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }

        $options = array_values(array_filter(array_map(
            fn ($option) => $this->cleanUtf8Text($option),
            $value
        ), static fn (string $option) => $option !== ''));

        return $options !== [] ? $options : null;
    }

    private function encodedLength(array $options): int
    {
        $encoded = json_encode($options, JSON_UNESCAPED_UNICODE);
        return strlen($encoded ?: '[]');
    }

    private function limitText(mixed $value, int $limit): string
    {
        $trimmed = $this->cleanUtf8Text($value);
        if ($trimmed === '') {
            return '';
        }

        if (mb_strlen($trimmed, 'UTF-8') <= $limit) {
            return $trimmed;
        }

        return rtrim(mb_substr($trimmed, 0, $limit, 'UTF-8'));
    }

    private function limitNullableText(mixed $value, int $limit): ?string
    {
        $trimmed = $this->cleanUtf8Text($value);
        if ($trimmed === '') {
            return null;
        }

        if (mb_strlen($trimmed, 'UTF-8') <= $limit) {
            return $trimmed;
        }

        return rtrim(mb_substr($trimmed, 0, $limit, 'UTF-8'));
    }

    private function trimText(string $value, int $limit): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }

        if (mb_strlen($trimmed, 'UTF-8') <= $limit) {
            return $trimmed;
        }

        return rtrim(mb_substr($trimmed, 0, $limit, 'UTF-8'));
    }

    private function trimNullableText(mixed $value, int $limit): ?string
    {
        $trimmed = trim((string) ($value ?? ''));
        if ($trimmed === '') {
            return null;
        }

        if (mb_strlen($trimmed, 'UTF-8') <= $limit) {
            return $trimmed;
        }

        return rtrim(mb_substr($trimmed, 0, $limit, 'UTF-8'));
    }

    /**
     * @param mixed $metadata
     * @return array<string,mixed>|null
     */
    private function normalizeQuizMetadata(mixed $metadata): ?array
    {
        if (! is_array($metadata)) {
            return null;
        }

        $normalized = [
            'source' => isset($metadata['source']) ? $this->cleanUtf8Text($metadata['source']) : null,
            'difficulty' => isset($metadata['difficulty']) ? $this->cleanUtf8Text($metadata['difficulty']) : null,
            'question_count' => isset($metadata['question_count']) ? (int) $metadata['question_count'] : null,
            'file_id' => isset($metadata['file_id']) ? (int) $metadata['file_id'] : null,
            'study_log_id' => isset($metadata['study_log_id']) ? (int) $metadata['study_log_id'] : null,
            'source_text_origin' => isset($metadata['source_text_origin'])
                ? $this->cleanUtf8Text($metadata['source_text_origin'])
                : null,
        ];

        if (! empty($metadata['requested_types']) && is_array($metadata['requested_types'])) {
            $normalized['requested_types'] = array_values(array_slice(array_map(
                fn ($type) => $this->cleanUtf8Text($type),
                $metadata['requested_types']
            ), 0, 3));
        }

        if (! empty($metadata['summary_ids']) && is_array($metadata['summary_ids'])) {
            $normalized['summary_ids'] = array_values(array_slice(array_map('intval', $metadata['summary_ids']), 0, 5));
        }

        if (! empty($metadata['study_log_ids']) && is_array($metadata['study_log_ids'])) {
            $normalized['study_log_ids'] = array_values(array_slice(array_map('intval', $metadata['study_log_ids']), 0, 6));
        }

        if (! empty($metadata['file_ids']) && is_array($metadata['file_ids'])) {
            $normalized['file_ids'] = array_values(array_slice(array_map('intval', $metadata['file_ids']), 0, 6));
        }

        if (! empty($metadata['file_name'])) {
            $normalized['file_name'] = $this->limitText($metadata['file_name'], 60);
        }

        $normalized = array_filter($normalized, static fn ($value) => $value !== null && $value !== [] && $value !== '');

        if ($normalized === []) {
            return null;
        }

        $encoded = json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        $maxLength = $this->resolveQuizMetadataColumnLength();
        if ($encoded !== false && strlen($encoded) <= $maxLength) {
            return $normalized;
        }

        unset($normalized['file_name']);
        $encoded = json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($encoded !== false && strlen($encoded) <= $maxLength) {
            return $normalized;
        }

        unset($normalized['requested_types'], $normalized['summary_ids'], $normalized['study_log_ids'], $normalized['file_ids']);
        $encoded = json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($encoded !== false && strlen($encoded) <= $maxLength) {
            return $normalized;
        }

        return array_filter([
            'source' => $normalized['source'] ?? null,
            'file_id' => $normalized['file_id'] ?? null,
            'study_log_id' => $normalized['study_log_id'] ?? null,
        ], static fn ($value) => $value !== null && $value !== '');
    }

    private function resolveQuizMetadataColumnLength(): int
    {
        try {
            if (! Schema::hasTable('quizzes') || ! Schema::hasColumn('quizzes', 'metadata')) {
                return 240;
            }

            $column = DB::selectOne(
                'SELECT CHARACTER_MAXIMUM_LENGTH AS max_length
                 FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
                 LIMIT 1',
                ['quizzes', 'metadata']
            );

            $maxLength = (int) ($column->max_length ?? 0);
            return $maxLength > 0 ? max(32, $maxLength - 8) : 240;
        } catch (\Throwable) {
            return 240;
        }
    }

    private function encodeAttemptAnswers(array $answers): string
    {
        $encoded = json_encode($answers, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);

        return is_string($encoded) && $encoded !== '' ? $encoded : '[]';
    }

    /**
     * @param  array<int, mixed>  $answers
     * @return array<int, array<string, mixed>>
     */
    private function formatAttemptAnswers(array $answers): array
    {
        return array_values(array_map(function ($answer) {
            $question = $answer->question ?? null;

            return [
                'question_id' => (int) ($answer->question_id ?? 0),
                'selected_answer' => $this->cleanUtf8Text($answer->selected_answer ?? ''),
                'is_correct' => (bool) ($answer->is_correct ?? false),
                'score' => (int) ($answer->score ?? 0),
                'correct_answer' => $this->cleanUtf8Text($question?->correct_answer ?? ''),
                'explanation' => $this->cleanUtf8Text($question?->explanation ?? ''),
                'question_text' => $this->cleanUtf8Text($question?->question_text ?? ''),
                'question_type' => $this->cleanUtf8Text($question?->question_type ?? ''),
                'options' => $question?->options,
            ];
        }, $answers));
    }

    private function ensureQuizQuestionColumnsSupportLongText(): void
    {
        if (! Schema::hasTable('quiz_questions')) {
            return;
        }

        try {
            if (DB::getDriverName() !== 'mysql') {
                return;
            }

            $columns = DB::table('information_schema.columns')
                ->selectRaw('COLUMN_NAME as column_name, DATA_TYPE as data_type, CHARACTER_MAXIMUM_LENGTH as max_length')
                ->where('TABLE_SCHEMA', DB::getDatabaseName())
                ->where('TABLE_NAME', 'quiz_questions')
                ->whereIn('COLUMN_NAME', ['question_text', 'options', 'correct_answer', 'explanation'])
                ->get()
                ->keyBy('column_name');

            $definitions = [
                'question_text' => 'TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL',
                'options' => 'LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
                'correct_answer' => 'TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
                'explanation' => 'TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
            ];

            foreach ($definitions as $column => $definition) {
                $meta = $columns->get($column);
                if (! $meta) {
                    continue;
                }

                $dataType = strtolower((string) ($meta->data_type ?? ''));
                $maxLength = $meta->max_length !== null ? (int) $meta->max_length : null;

                $alreadyExpanded = match ($column) {
                    'options' => $dataType === 'longtext',
                    default => in_array($dataType, ['text', 'mediumtext', 'longtext'], true) && $maxLength === null,
                };

                if ($alreadyExpanded) {
                    continue;
                }

                DB::statement("ALTER TABLE `quiz_questions` MODIFY `{$column}` {$definition}");
            }

            DB::statement('ALTER TABLE `quiz_questions` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        } catch (\Throwable) {
            // Keep request flow alive; if schema update cannot run, the original DB error will surface.
        }
    }
}
