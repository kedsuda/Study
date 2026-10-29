<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Requests\FileUploadRequest;
use App\Http\Resources\FileResource;
use App\Models\FileAttachment;
use App\Models\StudyLog;
use App\Models\Subject;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class FileController extends Controller
{
    public function index(Subject $subject): JsonResponse
    {
        abort_unless((int) $subject->user_id === (int) request()->user()->id, 403);
        $files = FileAttachment::where(function ($query) use ($subject) {
            $query->whereHas('studyLog', fn ($logs) => $logs->where('subject_id', $subject->id))
                ->orWhere(function ($orphanedFiles) use ($subject) {
                    $orphanedFiles->whereDoesntHave('studyLog')
                        ->where('file_path', 'like', 'study-files/'.$subject->id.'/%');
                });
        })->with('studyLog')->latest()->get();
        return response()->json(FileResource::collection($files));
    }

    private function authorizeFile(FileAttachment $file): void
    {
        $subject = $file->studyLog?->subject;
        if (! $subject && preg_match('~^study-files/([0-9]+)/[^/\\\\]+$~', (string) $file->file_path, $match)) {
            $subject = Subject::find((int) $match[1]);
        }
        abort_unless($subject && (int) $subject->user_id === (int) request()->user()->id, 403, 'Unauthorized');
    }

    public function store(FileUploadRequest $request, StudyLog $studyLog): JsonResponse
    {
        $subject = $studyLog->subject;
        abort_unless($subject->user_id === $request->user()->id, 403, 'Unauthorized');
        if ($request->hasFile('file')) {
            $file = $request->file('file');
            $storedPath = $file->store('study-files/'.$subject->id, 'public');

            $record = $studyLog->files()->create([
                'original_name' => $file->getClientOriginalName(),
                'file_path' => $storedPath,
                'file_type' => $this->resolveType(
                    $file->getClientOriginalExtension(),
                    $request->input('file_type'),
                    $file->getMimeType()
                ),
                'mime_type' => $file->getMimeType(),
                'file_size' => $file->getSize(),
            ]);
        } else {
            $record = $studyLog->files()->create([
                'original_name' => (string) ($request->input('original_name') ?: basename((string) $request->input('storage_path'))),
                'file_path' => (string) $request->input('storage_path'),
                'file_type' => $this->resolveType(null, $request->input('file_type'), $request->input('mime_type')),
                'mime_type' => $request->input('mime_type'),
                'file_size' => $request->input('file_size'),
            ]);
        }

        return response()->json(new FileResource($record), 201);
    }

    public function destroy(FileAttachment $file): JsonResponse
    {
        $this->authorizeFile($file);
        Storage::disk('public')->delete($file->file_path);
        $file->delete();
        return response()->json(status: 204);
    }

    /**
     * Return the original attachment without depending on Laravel's public
     * storage symlink.  Some shared hosts expose a stale `public/storage`
     * directory, which otherwise makes a newly uploaded document resolve to
     * the application's HTML page instead of the document bytes.
     */
    public function download(Request $request, FileAttachment $file): BinaryFileResponse|JsonResponse
    {
        $this->authorizeFile($file);

        $disk = Storage::disk('public');
        if (! $disk->exists($file->file_path)) {
            return response()->json([
                'message' => 'ไม่พบไฟล์ต้นฉบับในระบบจัดเก็บ กรุณาอัปโหลดไฟล์อีกครั้ง',
            ], 404);
        }

        return response()->file($disk->path($file->file_path), [
            'Content-Type' => $file->mime_type ?: 'application/octet-stream',
            'Content-Disposition' => 'inline; filename="'.addslashes($file->original_name).'"',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function updateStatus(Request $request, FileAttachment $file): JsonResponse
    {
        $this->authorizeFile($file);

        $data = $request->validate([
            'status' => ['required', 'string', 'in:active,archived'],
        ]);

        if (Schema::hasColumn($file->getTable(), 'status')) {
            $file->status = $data['status'];
        }

        if (Schema::hasColumn($file->getTable(), 'archived_at')) {
            $file->archived_at = $data['status'] === 'archived' ? now() : null;
        }

        $file->save();

        return response()->json(new FileResource($file->fresh()));
    }

    private function resolveType(?string $extension, ?string $providedType = null, ?string $mimeType = null): string
    {
        $providedType = strtolower((string) $providedType);
        if (in_array($providedType, ['pdf', 'word', 'audio', 'image', 'other'], true)) {
            return $providedType;
        }

        $extension = strtolower((string) $extension);
        $mimeType = strtolower((string) $mimeType);

        if ($mimeType !== '' && str_starts_with($mimeType, 'image/')) {
            return 'image';
        }

        return match ($extension) {
            'pdf' => 'pdf',
            'doc', 'docx' => 'word',
            'mp3', 'wav', 'm4a' => 'audio',
            'jpg', 'jpeg', 'png', 'gif', 'webp' => 'image',
            default => 'other',
        };
    }
}
