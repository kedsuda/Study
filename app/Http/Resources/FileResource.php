<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Schema;

class FileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $hasStatus = Schema::hasColumn($this->resource->getTable(), 'status');
        $hasArchivedAt = Schema::hasColumn($this->resource->getTable(), 'archived_at');

        return [
            'id' => $this->id,
            'original_name' => $this->original_name,
            'file_path' => $this->file_path,
            'file_url' => null,
            'file_type' => $this->file_type,
            'mime_type' => $this->mime_type,
            'file_size' => $this->file_size,
            'status' => $hasStatus ? ($this->status ?: 'active') : 'active',
            'archived_at' => $hasArchivedAt ? optional($this->archived_at)->toIso8601String() : null,
            'created_at' => $this->created_at,
        ];
    }
}
