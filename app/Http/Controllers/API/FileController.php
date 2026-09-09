<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Requests\FileUploadRequest;
use App\Http\Resources\FileResource;
use App\Models\FileAttachment;
use App\Models\StudyLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

class FileController extends Controller
{
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
        abort_unless($file->studyLog->subject->user_id === request()->user()->id, 403, 'Unauthorized');
        Storage::disk('public')->delete($file->file_path);
        $file->delete();
        return response()->json(status: 204);
    }

    public function updateStatus(Request $request, FileAttachment $file): JsonResponse
    {
        abort_unless($file->studyLog->subject->user_id === $request->user()->id, 403, 'Unauthorized');

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
