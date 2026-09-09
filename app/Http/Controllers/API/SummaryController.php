<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Resources\SummaryResource;
use App\Models\FileAttachment;
use App\Models\Summary;
use App\Models\StudyLog;
use App\Services\AI\AIService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class SummaryController extends Controller
{
    public function __construct(private readonly AIService $aiService)
    {
    }

    public function index(StudyLog $studyLog): AnonymousResourceCollection
    {
        $this->authorizeStudyLog($studyLog);
        return SummaryResource::collection($studyLog->summaries);
    }

    public function generate(StudyLog $studyLog, Request $request): JsonResponse
    {
        $this->authorizeStudyLog($studyLog);

        if ($request->filled('file_id')) {
            $data = $request->validate([
                'file_id' => ['required', 'integer'],
            ]);

            $file = $studyLog->files()->whereKey((int) $data['file_id'])->first();
            if (! $file) {
                return response()->json([
                    'message' => 'ไม่พบไฟล์แนบสำหรับบันทึกนี้',
                ], 404);
            }

            if (! $this->isSummarizableDocument($file)) {
                return response()->json([
                    'message' => 'รองรับเฉพาะไฟล์ PDF, DOC, DOCX หรือ TXT สำหรับสรุปด้วย Groq',
                ], 422);
            }

            if (Str::startsWith((string) $file->file_path, 'supabase:')) {
                return response()->json([
                    'message' => 'ไฟล์นี้อยู่บน Supabase กรุณาให้หน้าเว็บส่งไฟล์เข้ามาสรุปโดยตรง',
                ], 422);
            }

            $disk = Storage::disk('public');
            if (! $disk->exists($file->file_path)) {
                return response()->json([
                    'message' => 'ไม่พบไฟล์ต้นฉบับใน storage',
                ], 404);
            }

            try {
                $uploadedFile = new UploadedFile(
                    $disk->path($file->file_path),
                    $file->original_name,
                    $file->mime_type,
                    null,
                    true
                );
                $result = $this->aiService->summarizeDocument($uploadedFile);
            } catch (\Throwable $e) {
                return response()->json([
                    'message' => $e->getMessage() ?: 'ไม่สามารถสรุปไฟล์แนบได้',
                ], 422);
            }

            $summary = $studyLog->summaries()->create([
                'content' => (string) ($result['summary'] ?? ''),
                'ai_model' => $result['model'] ?? null,
                'metadata' => [
                    'source' => 'document',
                    'file_id' => $file->id,
                    'file_name' => $file->original_name,
                    'text_length' => isset($result['text']) ? mb_strlen((string) $result['text'], 'UTF-8') : null,
                ],
            ]);

            return response()->json(new SummaryResource($summary), 201);
        }

        if ($request->filled('content')) {
            $data = $request->validate([
                'content' => ['required', 'string'],
                'ai_model' => ['nullable', 'string', 'max:255'],
                'metadata' => ['nullable', 'array'],
            ]);

            $summary = $studyLog->summaries()->create([
                'content' => $data['content'],
                'ai_model' => $data['ai_model'] ?? null,
                'metadata' => $data['metadata'] ?? null,
            ]);

            return response()->json(new SummaryResource($summary), 201);
        }

        $summary = $this->aiService->generateSummary($studyLog);

        return response()->json(new SummaryResource($summary), 201);
    }

    public function destroy(Summary $summary): JsonResponse
    {
        $summary->loadMissing('studyLog.subject');
        abort_unless($summary->studyLog?->subject?->user_id === request()->user()->id, 403, 'Unauthorized');

        $summary->delete();

        return response()->json([
            'message' => 'Summary deleted successfully.',
        ]);
    }

    private function authorizeStudyLog(StudyLog $studyLog): void
    {
        abort_unless($studyLog->subject->user_id === request()->user()->id, 403, 'Unauthorized');
    }

    private function isSummarizableDocument(FileAttachment $file): bool
    {
        $extension = strtolower(pathinfo((string) $file->original_name, PATHINFO_EXTENSION));
        if (in_array($extension, ['pdf', 'doc', 'docx', 'txt'], true)) {
            return true;
        }

        return in_array($file->file_type, ['pdf', 'word'], true);
    }
}
