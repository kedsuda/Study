<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;

class QuizAnswer extends Model
{
    use HasFactory;

    protected static function booted(): void
    {
        static::addGlobalScope('user', function (Builder $query) {
            if (Auth::check()) {
                $query->where('user_id', Auth::id());
            }
        });

        static::creating(function (self $answer) {
            if (Auth::check() && empty($answer->user_id)) {
                $answer->user_id = Auth::id();
            }
        });
    }

    protected $fillable = [
        'question_id',
        'user_id',
        'selected_answer',
        'is_correct',
        'score',
        'metadata',
        'answered_at',
    ];

    protected $casts = [
        'is_correct' => 'boolean',
        'metadata' => 'array',
        'answered_at' => 'datetime',
    ];

    public function question()
    {
        return $this->belongsTo(QuizQuestion::class, 'question_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
