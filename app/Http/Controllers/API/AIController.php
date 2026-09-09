<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\AudioSummary;
use App\Models\AudioSummaryV2;
use App\Models\AudioTranscriptionJob;
use App\Models\AudioTranscriptionSegment;
use App\Models\FileAttachment;
use App\Models\StudyLog;
use App\Models\Subject;
use App\Services\AI\AIService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class AIController extends Controller
{
    private const LONG_RUNNING_REQUEST_SECONDS = 360;
    private const AUDIO_SEGMENT_TEXT_LIMIT = 255;

    public function __construct(private readonly AIService $aiService)
    {
    }

    public function transcribeAudio(): JsonResponse
    {
        $this->extendLongRunningRequestLimit();

        request()->validate([
            'file' => ['required', 'file', 'max:51200'],
        ]);

        $file = request()->file('file');
        if (! $this->isAllowedAudio($file?->getClientOriginalExtension(), $file?->getMimeType())) {
            return response()->json([
                'message' => 'รองรับเฉพาะไฟล์เสียง เช่น MP3, WAV, M4A, WEBM, OGG, MP4, AAC, 3GP',
            ], 422);
        }

        try {
            $transcript = $this->aiService->transcribeAudio($file);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => $e->getMessage() ?: 'ไม่สามารถถอดเสียงได้',
            ], 422);
        }

        return response()->json($transcript);
    }

    public function summarizeAudio(): JsonResponse
    {
        $this->extendLongRunningRequestLimit();

        request()->validate([
            'file' => ['required', 'file', 'max:51200'],
            'subject_id' => ['nullable', 'integer'],
            'source_mode' => ['nullable', 'in:upload,record'],
            'summary_period' => ['nullable', 'in:daily,weekly,monthly'],
            'mood' => ['nullable', 'in:สนุก,เฉย ๆ,เครียด'],
        ]);

        $file = request()->file('file');
        if (! $this->isAllowedAudio($file?->getClientOriginalExtension(), $file?->getMimeType())) {
            return response()->json([
                'message' => 'รองรับเฉพาะไฟล์เสียง เช่น MP3, WAV, M4A, WEBM, OGG, MP4, AAC, 3GP',
            ], 422);
        }

        $user = request()->user();
        $subjectId = request()->input('subject_id');
        $sourceMode = request()->input('source_mode');
        $summaryPeriod = request()->input('summary_period', 'daily');
        $subject = $this->resolveAudioSubject($user->id, $subjectId);
        if (! $subject) {
            return response()->json([
                'message' => 'กรุณาเลือกวิชาเพื่อบันทึกเสียงลงฐานข้อมูล',
            ], 422);
        }

        $log = $this->createAudioStudyLog($subject, $file, $sourceMode, request()->input('mood'));
        $fileRecord = $this->storeAudioFile($subject, $log, $file);
        $job = $this->createAudioJob($user->id, $fileRecord->id, $log->id);

        try {
            $result = $this->aiService->summarizeAudio($file, $summaryPeriod);
            $this->finalizeAudioJob($job, $result['transcript'] ?? $result['text'] ?? '', null);
            $this->storeAudioResults($job, $fileRecord, $log, $result, $sourceMode, $summaryPeriod);
        } catch (\Throwable $e) {
            $this->finalizeAudioJob($job, '', $e->getMessage());
            $this->storeAudioFailure($job, $fileRecord, $log, $e->getMessage(), $sourceMode, $summaryPeriod);
            return response()->json([
                'message' => $e->getMessage() ?: 'ไม่สามารถสรุปเสียงได้',
            ], 422);
        }

        return response()->json($result);
    }

    public function audioSummaries(Request $request): JsonResponse
    {
        $user = $request->user();
        $subjectId = $request->input('subject_id');
        $subjectId = $subjectId !== null ? (int) $subjectId : null;

        $summaries = AudioSummary::query()
            ->where('status', 'completed')
            ->whereNotNull('summary')
            ->where('summary', '!=', '')
            ->whereHas('studyLog.subject', function ($query) use ($user, $subjectId) {
                $query->where('user_id', $user->id);
                if ($subjectId) {
                    $query->where('id', $subjectId);
                }
            })
            ->with(['studyLog.subject', 'file'])
            ->orderByDesc('created_at')
            ->limit(30)
            ->get();

        $payload = $summaries->map(function (AudioSummary $summary) {
            return [
                'id' => $summary->id,
                'study_log_id' => $summary->study_log_id,
                'summary' => $summary->summary,
                'transcript' => $summary->transcript,
                'created_at' => $summary->created_at,
                'title' => $summary->studyLog?->title,
                'subject' => $summary->studyLog?->subject?->name,
                'source_mode' => $summary->metadata['source_mode']
                    ?? ($summary->file?->original_name === 'recording.webm' ? 'record' : 'upload'),
            ];
        })->values();

        return response()->json($payload);
    }

    public function storeAudioSummary(Request $request): JsonResponse
    {
        $data = $request->validate([
            'subject_id' => ['required', 'integer'],
            'source_mode' => ['nullable', 'in:upload,record'],
            'title' => ['nullable', 'string', 'max:255'],
            'transcript' => ['nullable', 'string'],
            'summary' => ['nullable', 'string'],
            'ai_model' => ['nullable', 'string', 'max:100'],
            'summary_period' => ['nullable', 'in:daily,weekly,monthly'],
            'mood' => ['nullable', 'in:สนุก,เฉย ๆ,เครียด'],
        ]);

        $transcript = trim((string) ($data['transcript'] ?? ''));
        $summary = trim((string) ($data['summary'] ?? ''));

        if ($transcript === '' && $summary === '') {
            return response()->json([
                'message' => 'ยังไม่มีข้อความถอดเสียงหรือสรุปสำหรับบันทึก',
            ], 422);
        }

        $user = $request->user();
        $subject = $this->resolveAudioSubject($user->id, (int) $data['subject_id']);
        if (! $subject) {
            return response()->json([
                'message' => 'กรุณาเลือกวิชาเพื่อบันทึกเสียงลงฐานข้อมูล',
            ], 422);
        }

        $sourceMode = $data['source_mode'] ?? 'upload';
        $summaryPeriod = $data['summary_period'] ?? 'daily';

        [$log, $audioSummary] = DB::transaction(function () use ($subject, $data, $sourceMode, $summaryPeriod, $transcript, $summary) {
            $log = $this->createAudioStudyLogFromTitle($subject, $data['title'] ?? null, $sourceMode, $data['mood'] ?? null);
            $fileRecord = $this->createBrowserAudioFileRecord($subject, $log, $data['title'] ?? null, $sourceMode, $transcript);
            $job = $this->createAudioJob((int) $subject->user_id, $fileRecord->id, $log->id);
            $this->finalizeAudioJob($job, $transcript, null);

            $result = [
                'transcript' => $transcript,
                'summary' => $summary,
                'model' => $data['ai_model'] ?? null,
            ];
            $this->storeAudioResults($job, $fileRecord, $log, $result, $sourceMode, $summaryPeriod);

            return [$log, AudioSummary::where('study_log_id', $log->id)->latest()->first()];
        });

        return response()->json([
            'id' => $audioSummary->id,
            'study_log_id' => $log->id,
            'summary' => $audioSummary->summary,
            'transcript' => $audioSummary->transcript,
            'created_at' => $audioSummary->created_at,
            'title' => $log->title,
            'subject' => $subject->name,
            'source_mode' => $sourceMode,
        ], 201);
    }

    public function destroyAudioSummary(AudioSummary $audioSummary): JsonResponse
    {
        $audioSummary->loadMissing('studyLog.subject', 'file');

        $ownerId = $audioSummary->studyLog?->subject?->user_id
            ?? $audioSummary->file?->studyLog?->subject?->user_id;

        abort_unless($ownerId === request()->user()->id, 403, 'Unauthorized');

        DB::transaction(function () use ($audioSummary) {
            $studyLogId = $audioSummary->study_log_id;
            $fileId = $audioSummary->file_id;
            $filePath = $audioSummary->file?->file_path;

            $jobIds = AudioTranscriptionJob::query()
                ->where(function ($query) use ($studyLogId, $fileId) {
                    if ($studyLogId) {
                        $query->where('study_log_id', $studyLogId);
                    }
                    if ($fileId) {
                        $method = $studyLogId ? 'orWhere' : 'where';
                        $query->{$method}('file_id', $fileId);
                    }
                })
                ->pluck('id');

            if ($jobIds->isNotEmpty()) {
                AudioTranscriptionSegment::query()->whereIn('job_id', $jobIds)->delete();
                AudioSummaryV2::query()->whereIn('job_id', $jobIds)->delete();
                AudioTranscriptionJob::query()->whereIn('id', $jobIds)->delete();
            }

            $audioSummary->delete();

            if ($fileId) {
                FileAttachment::query()->where('id', $fileId)->delete();
            }

            if ($studyLogId) {
                StudyLog::query()->where('id', $studyLogId)->delete();
            }

            if ($filePath) {
                Storage::disk('public')->delete($filePath);
            }
        });

        return response()->json(status: 204);
    }

    public function extractDocument(): JsonResponse
    {
        request()->validate([
            'file' => ['nullable', 'file', 'max:51200'],
            'images' => ['nullable', 'array', 'max:3'],
            'images.*' => ['file', 'mimetypes:image/jpeg,image/png,image/webp', 'max:6144'],
        ]);

        $images = array_values(array_filter((array) request()->file('images')));
        if ($images !== []) {
            try {
                return response()->json($this->aiService->extractDocumentImageText($images));
            } catch (\Throwable $e) {
                return response()->json([
                    'message' => $e->getMessage() ?: 'ไม่สามารถอ่านข้อความจากภาพในเอกสารได้',
                ], 422);
            }
        }

        $file = request()->file('file');
        if (! $file) {
            return response()->json([
                'message' => 'กรุณาเลือกไฟล์เอกสาร',
            ], 422);
        }

        if (! $this->isAllowedDocument($file?->getClientOriginalExtension())) {
            return response()->json([
                'message' => 'รองรับเฉพาะไฟล์ PDF, DOC, DOCX หรือ TXT เท่านั้น',
            ], 422);
        }

        try {
            $result = $this->aiService->extractDocumentText($file);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => $e->getMessage() ?: 'ไม่สามารถประมวลผลเอกสารได้',
            ], 422);
        }

        return response()->json($result);
    }

    public function summarizeDocument(): JsonResponse
    {
        $validated = request()->validate([
            'file' => ['nullable', 'file', 'max:51200'],
            'text' => ['nullable', 'string', 'min:20'],
        ]);

        $text = trim((string) ($validated['text'] ?? ''));
        if ($text !== '') {
            try {
                $result = $this->aiService->summarizeDocumentText($text);
            } catch (\Throwable $e) {
                return response()->json([
                    'message' => $e->getMessage() ?: 'ไม่สามารถสรุปเอกสารได้',
                ], 422);
            }

            return response()->json($result);
        }

        $file = request()->file('file');
        if (! $file) {
            return response()->json([
                'message' => 'กรุณาเลือกไฟล์หรือส่งข้อความจากเอกสาร',
            ], 422);
        }

        if (! $this->isAllowedDocument($file?->getClientOriginalExtension())) {
            return response()->json([
                'message' => 'รองรับเฉพาะไฟล์ PDF, DOC, DOCX หรือ TXT เท่านั้น',
            ], 422);
        }

        try {
            $result = $this->aiService->summarizeDocument($file);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => $e->getMessage() ?: 'ไม่สามารถสรุปเอกสารได้',
            ], 422);
        }

        return response()->json($result);
    }

    public function mindMap(Request $request): JsonResponse
    {
        $data = $request->validate([
            'text' => ['required', 'string', 'min:10'],
        ]);

        try {
            $result = $this->aiService->generateMindMapFromText((string) $data['text']);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => $e->getMessage() ?: 'ไม่สามารถสร้างมายแมพได้',
            ], 422);
        }

        return response()->json($result);
    }

    private function isAllowedDocument(?string $extension): bool
    {
        if (! $extension) {
            return false;
        }

        return in_array(strtolower($extension), ['pdf', 'doc', 'docx', 'txt'], true);
    }

    private function isAllowedAudio(?string $extension, ?string $mimeType): bool
    {
        $extension = strtolower((string) $extension);
        $mimeType = strtolower((string) $mimeType);
        $allowedExtensions = ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'mp4', 'aac', '3gp', '3gpp'];

        if ($extension !== '' && in_array($extension, $allowedExtensions, true)) {
            return true;
        }

        if ($mimeType !== '' && (str_starts_with($mimeType, 'audio/') || $mimeType === 'video/mp4')) {
            return true;
        }

        return false;
    }

    private function resolveAudioSubject(int $userId, ?int $subjectId): ?Subject
    {
        if ($subjectId) {
            return Subject::where('id', $subjectId)->where('user_id', $userId)->first();
        }

        return Subject::where('user_id', $userId)->orderBy('id')->first();
    }

    private function createAudioStudyLog(Subject $subject, UploadedFile $file, ?string $sourceMode = null, ?string $mood = null): StudyLog
    {
        $title = trim(pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME));
        if ($sourceMode === 'record') {
            $title = 'สรุปเสียงจากการอัดสด';
        } else {
            $title = $title !== '' ? "สรุปเสียง: {$title}" : 'สรุปเสียงจากไฟล์';
        }

        return StudyLog::create([
            'subject_id' => $subject->id,
            'title' => $title,
            'note' => $sourceMode === 'record' ? 'อัดเสียงสดเพื่อสรุป' : 'อัปโหลดเสียงเพื่อสรุป',
            'mood' => $mood,
            'log_date' => Carbon::now()->toDateString(),
            'log_type' => StudyLog::TYPE_AUDIO_SUMMARY,
        ]);
    }

    private function createAudioStudyLogFromTitle(Subject $subject, ?string $title, ?string $sourceMode = null, ?string $mood = null): StudyLog
    {
        $title = trim((string) $title);
        if ($sourceMode === 'record') {
            $resolvedTitle = $title !== '' ? $title : 'สรุปเสียงจากการอัดสด';
        } else {
            $resolvedTitle = $title !== '' ? "สรุปเสียง: {$title}" : 'สรุปเสียงจากไฟล์';
        }

        return StudyLog::create([
            'subject_id' => $subject->id,
            'title' => $resolvedTitle,
            'note' => $sourceMode === 'record' ? 'อัดเสียงสดเพื่อสรุป' : 'อัปโหลดเสียงเพื่อสรุป',
            'mood' => $mood,
            'log_date' => Carbon::now()->toDateString(),
            'log_type' => StudyLog::TYPE_AUDIO_SUMMARY,
        ]);
    }

    private function storeAudioFile(Subject $subject, StudyLog $log, UploadedFile $file): FileAttachment
    {
        $storedPath = $file->store('study-files/'.$subject->id, 'public');

        return FileAttachment::create([
            'study_log_id' => $log->id,
            'original_name' => $file->getClientOriginalName(),
            'file_path' => $storedPath,
            'file_type' => 'audio',
            'mime_type' => $file->getMimeType(),
            'file_size' => $file->getSize(),
        ]);
    }

    private function createBrowserAudioFileRecord(
        Subject $subject,
        StudyLog $log,
        ?string $title,
        ?string $sourceMode,
        string $transcript
    ): FileAttachment {
        $baseName = trim((string) $title);
        if ($baseName === '') {
            $baseName = $sourceMode === 'record' ? 'recording.webm' : 'browser-audio-summary.wav';
        }

        return FileAttachment::create([
            'study_log_id' => $log->id,
            'original_name' => $baseName,
            'file_path' => 'browser-audio-summaries/'.$subject->id.'/'.Carbon::now()->format('YmdHis').'-'.bin2hex(random_bytes(4)).'.txt',
            'file_type' => 'audio',
            'mime_type' => 'text/plain',
            'file_size' => max(0, strlen($transcript)),
        ]);
    }

    private function createAudioJob(int $userId, int $fileId, int $studyLogId): AudioTranscriptionJob
    {
        return AudioTranscriptionJob::create([
            'user_id' => $userId,
            'file_id' => $fileId,
            'study_log_id' => $studyLogId,
            'status' => 'processing',
            'provider' => config('ai.provider'),
            'model' => config('ai.gemini.model') ?: config('ai.openai.summary_model'),
            'started_at' => Carbon::now(),
        ]);
    }

    private function finalizeAudioJob(AudioTranscriptionJob $job, string $transcript, ?string $error): void
    {
        $payload = [
            'status' => $error ? 'failed' : 'completed',
            'completed_at' => Carbon::now(),
            'error_message' => $this->normalizeErrorMessage($error),
        ];

        if (! $error && $transcript !== '') {
            $payload['language'] = null;
        }

        $job->update($payload);
    }

    private function storeAudioResults(
        AudioTranscriptionJob $job,
        FileAttachment $fileRecord,
        StudyLog $log,
        array $result,
        ?string $sourceMode = null,
        ?string $summaryPeriod = null
    ): void {
        $transcript = (string) ($result['transcript'] ?? $result['text'] ?? '');
        $summary = (string) ($result['summary'] ?? '');

        foreach ($this->splitTranscriptSegments($transcript) as $index => $segmentText) {
            AudioTranscriptionSegment::create([
                'job_id' => $job->id,
                'seq' => $index + 1,
                'text' => $segmentText,
            ]);
        }

        AudioSummary::create([
            'file_id' => $fileRecord->id,
            'study_log_id' => $log->id,
            'status' => 'completed',
            'transcript' => $transcript,
            'summary' => $summary,
            'ai_model' => $result['model'] ?? null,
            'metadata' => [
                'source_mode' => $sourceMode ?: 'upload',
                'summary_period' => $summaryPeriod ?: 'daily',
            ],
        ]);

        AudioSummaryV2::create([
            'job_id' => $job->id,
            'summary_type' => $summaryPeriod ?: 'daily',
            'prompt' => 'สรุปใจความจากเสียงเป็นภาษาไทยแบบเข้าใจง่าย กระชับ ใช้ bullet สั้น ๆ',
            'summary_text' => $summary,
            'provider' => config('ai.provider'),
            'model' => $result['model'] ?? null,
            'status' => 'completed',
        ]);
    }

    private function storeAudioFailure(
        AudioTranscriptionJob $job,
        FileAttachment $fileRecord,
        StudyLog $log,
        ?string $errorMessage,
        ?string $sourceMode = null,
        ?string $summaryPeriod = null
    ): void {
        AudioSummary::create([
            'file_id' => $fileRecord->id,
            'study_log_id' => $log->id,
            'status' => 'failed',
            'error_message' => $this->normalizeErrorMessage($errorMessage),
            'metadata' => [
                'source_mode' => $sourceMode ?: 'upload',
                'summary_period' => $summaryPeriod ?: 'daily',
            ],
        ]);

        AudioSummaryV2::create([
            'job_id' => $job->id,
            'summary_type' => $summaryPeriod ?: 'daily',
            'summary_text' => '',
            'provider' => config('ai.provider'),
            'model' => config('ai.gemini.model') ?: config('ai.openai.summary_model'),
            'status' => 'failed',
            'error_message' => $this->normalizeErrorMessage($errorMessage),
        ]);
    }

    private function normalizeErrorMessage(?string $message, int $maxLength = 250): ?string
    {
        if ($message === null) {
            return null;
        }

        $message = trim($message);
        if ($message === '') {
            return null;
        }

        if (mb_strlen($message, 'UTF-8') <= $maxLength) {
            return $message;
        }

        return rtrim(mb_substr($message, 0, max(0, $maxLength - 3), 'UTF-8')).'...';
    }

    private function extendLongRunningRequestLimit(): void
    {
        $seconds = self::LONG_RUNNING_REQUEST_SECONDS;

        if (function_exists('set_time_limit')) {
            @set_time_limit($seconds);
        }

        @ini_set('max_execution_time', (string) $seconds);
        @ini_set('default_socket_timeout', (string) $seconds);
    }

    /**
     * @return array<int, string>
     */
    private function splitTranscriptSegments(string $transcript): array
    {
        $transcript = trim($transcript);
        if ($transcript === '') {
            return [''];
        }

        $limit = self::AUDIO_SEGMENT_TEXT_LIMIT;
        $segments = [];
        $current = '';

        foreach (preg_split('/\s+/u', $transcript, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $word) {
            $candidate = $current === '' ? $word : "{$current} {$word}";
            if (mb_strlen($candidate, 'UTF-8') <= $limit) {
                $current = $candidate;
                continue;
            }

            if ($current !== '') {
                $segments[] = $current;
                $current = '';
            }

            while (mb_strlen($word, 'UTF-8') > $limit) {
                $segments[] = mb_substr($word, 0, $limit, 'UTF-8');
                $word = mb_substr($word, $limit, null, 'UTF-8');
            }

            $current = $word;
        }

        if ($current !== '') {
            $segments[] = $current;
        }

        return $segments === [] ? [''] : $segments;
    }
}
