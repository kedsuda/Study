<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

class LearningGoalTarget extends Model
{
    protected static function booted(): void
    {
        static::addGlobalScope('user', function (Builder $query) {
            if (Auth::check()) {
                $query->where('user_id', Auth::id());
            }
        });

        static::creating(function (self $target) {
            if (Auth::check() && empty($target->user_id)) {
                $target->user_id = Auth::id();
            }

            // รองรับฐานข้อมูลเก่าที่ id ไม่ได้ตั้ง AUTO_INCREMENT
            if (empty($target->id)) {
                $nextId = (int) DB::table($target->getTable())->max('id') + 1;
                $target->id = max(1, $nextId);
            }
        });
    }

    protected $table = 'learning_goal_targets';

    protected $fillable = [
        'user_id',
        'subject_id',
        'schedule_id',
        'period_type',
        'period_start',
        'period_end',
        'quest_type',
        'title',
        'target_value',
        'current_value',
        'mission_count',
        'reward_points',
        'status',
        'target_sessions',
        'target_minutes',
        'target_questions',
        'target_quiz_sets',
        'metadata',
    ];

    protected $casts = [
        'period_start' => 'datetime',
        'period_end' => 'datetime',
        'subject_id' => 'integer',
        'schedule_id' => 'integer',
        'target_value' => 'integer',
        'current_value' => 'integer',
        'mission_count' => 'integer',
        'reward_points' => 'integer',
        'target_sessions' => 'integer',
        'target_minutes' => 'integer',
        'target_questions' => 'integer',
        'target_quiz_sets' => 'integer',
        'metadata' => 'array',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
