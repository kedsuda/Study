<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use App\Models\FileAttachment;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class QuizResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'subject_id' => $this->subject_id,
            'title' => $this->title,
            'description' => $this->description,
            'ai_model' => $this->ai_model,
            'metadata' => $this->sourceMetadata(),
            'questions' => QuizQuestionResource::collection($this->whenLoaded('questions')),
            'created_at' => $this->created_at,
            'latest_attempt' => $this->when($request->user(), function () use ($request) {
                if (Schema::hasTable('quiz_attempts')) {
                    $attempt = DB::table('quiz_attempts')->where('quiz_id', $this->id)
                        ->where('user_id', $request->user()->id)->orderByDesc('id')->first();
                    if ($attempt) {
                        $total = count(json_decode((string) $attempt->answers, true) ?: []);
                        return ['score' => (int) $attempt->score, 'total' => $total,
                            'percentage' => $total ? round($attempt->score / $total * 100) : 0,
                            'answered_at' => $attempt->created_at];
                    }
                }
                $answers = $this->relationLoaded('answers')
                    ? $this->getRelation('answers')->where('user_id', $request->user()->id)->sortByDesc('answered_at')
                    : $this->answers()
                        ->where('user_id', $request->user()->id)
                        ->whereNotNull('answered_at')
                        ->orderByDesc('answered_at')
                        ->get();

                if ($answers->isEmpty()) {
                    return null;
                }

                $grouped = $answers->groupBy(function ($answer) {
                    return optional($answer->answered_at)->format('Y-m-d H:i:s');
                })->map(function ($collection) {
                    $total = $collection->count();
                    $score = $collection->sum('score');
                    return [
                        'score' => $score,
                        'total' => $total,
                        'percentage' => $total > 0 ? round(($score / $total) * 100) : 0,
                        'answered_at' => $collection->first()->answered_at,
                    ];
                })->sortKeysDesc();

                return $grouped->first();
            }),
        ];
    }

    private function sourceMetadata(): array
    {
        $metadata = is_array($this->metadata) ? $this->metadata : [];
        $ids = array_filter(array_merge($metadata['file_ids'] ?? [], [$metadata['file_id'] ?? null]));
        if ($ids) {
            $names = FileAttachment::whereIn('id', $ids)->pluck('original_name')->all();
            $metadata['file_names'] = $names;
            if ($names) $metadata['file_name'] = implode(', ', $names);
        }
        return $metadata;
    }
}
