<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use JsonException;

class QuizQuestion extends Model
{
    use HasFactory;

    protected $fillable = [
        'quiz_id',
        'question_text',
        'question_type',
        'options',
        'correct_answer',
        'points',
        'explanation',
    ];

    protected $casts = [
        'points' => 'integer',
    ];

    public function getOptionsAttribute($value): ?array
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            $decoded = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return null;
        }

        return is_array($decoded) ? $decoded : null;
    }

    public function setOptionsAttribute($value): void
    {
        if ($value === null || $value === '') {
            $this->attributes['options'] = null;
            return;
        }

        if (is_array($value)) {
            $items = array_values(array_filter(array_map(
                static fn ($item) => self::stringifyOption($item),
                $value
            ), static fn (string $item) => $item !== ''));

            $encoded = $items !== []
                ? json_encode($items, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)
                : null;

            $this->attributes['options'] = $items !== []
                ? (is_string($encoded) ? $encoded : null)
                : null;
            return;
        }

        $this->attributes['options'] = $value;
    }

    private static function stringifyOption(mixed $value): string
    {
        if (is_array($value)) {
            $value = implode(' ', array_filter(array_map(
                static fn ($item) => self::stringifyOption($item),
                $value
            ), static fn (string $item) => $item !== ''));
        } elseif (is_object($value)) {
            $value = method_exists($value, '__toString') ? (string) $value : '';
        } elseif (is_bool($value)) {
            $value = $value ? 'true' : 'false';
        } elseif ($value === null) {
            $value = '';
        } else {
            $value = (string) $value;
        }

        if (! mb_check_encoding($value, 'UTF-8')) {
            $value = function_exists('mb_scrub') ? mb_scrub($value, 'UTF-8') : $value;
        }

        return trim($value);
    }

    public function quiz()
    {
        return $this->belongsTo(Quiz::class);
    }

    public function answers()
    {
        return $this->hasMany(QuizAnswer::class, 'question_id');
    }
}
