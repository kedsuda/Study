<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StudyCalendarEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $timezone = config('app.timezone', 'Asia/Bangkok');
        $metadata = is_array($this->metadata) ? $this->metadata : [];
        $metadataType = is_string($metadata['type'] ?? null) ? strtolower((string) $metadata['type']) : null;
        $columnType = is_string($this->event_type ?? null) ? strtolower((string) $this->event_type) : null;
        $eventType = in_array($metadataType, ['class', 'exam', 'other'], true)
            ? $metadataType
            : (in_array($columnType, ['class', 'exam', 'other'], true) ? $columnType : null);

        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'subject_id' => $this->subject_id,
            'study_log_id' => $this->study_log_id,
            'title' => $this->title,
            'description' => $this->description,
            'room' => $this->room ?? ($metadata['room'] ?? null),
            // Calendar datetimes are stored as local timetable values.  Use
            // shiftTimezone so the wall-clock time remains the same when the
            // API adds the Bangkok offset (e.g. 15:00 stays 15:00, not 22:00).
            'start_time' => $this->start_time?->copy()?->shiftTimezone($timezone)?->toIso8601String(),
            'end_time' => $this->end_time?->copy()?->shiftTimezone($timezone)?->toIso8601String(),
            'status' => $this->status,
            'type' => $eventType,
            'event_type' => $eventType,
            'all_day' => (bool) ($metadata['all_day'] ?? false),
            'source' => $metadata['source'] ?? null,
            'metadata' => $metadata,
            'subject' => $this->whenLoaded('subject', function () {
                return [
                    'id' => $this->subject?->id,
                    'name' => $this->subject?->name,
                ];
            }),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
