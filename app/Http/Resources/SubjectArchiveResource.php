<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SubjectArchiveResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'original_subject_id' => $this->original_subject_id,
            'name' => $this->name,
            'description' => $this->description,
            'source_type' => $this->source_type,
            'color' => $this->color,
            'target_hours' => $this->target_hours,
            'start_date' => $this->start_date,
            'start_time' => $this->start_time,
            'end_time' => $this->end_time,
            'archived_at' => optional($this->archived_at)->toIso8601String(),
        ];
    }
}
