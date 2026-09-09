<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Throwable;

class StudyLog extends Model
{
    use HasFactory;

    public const TYPE_STUDY = 'study';
    public const TYPE_DOCUMENT_SUMMARY = 'document_summary';
    public const TYPE_AUDIO_SUMMARY = 'audio_summary';

    protected $fillable = [
        'id',
        'user_id', // ✅ เพิ่ม
        'subject_id',
        'title',
        'note',
        'log_date',
        'duration_minutes',
        'mood',
        'log_type',
    ];

    protected $casts = [
        'log_date' => 'date',
    ];

    /* =======================
     | Global Scope + Auto user
     ======================= */
protected static function booted(): void
{
    $table = (new self)->getTable();
    if (!self::hasTableSafe($table) || !self::hasColumnSafe($table, 'user_id')) {
        return;
    }

    static::addGlobalScope('user', function (Builder $query) {
        if (Auth::check()) {
            $query->where((new self)->getTable().'.user_id', Auth::id());
        }
    });

    // Legacy quiz uploads created a placeholder study log solely to attach a
    // file. It is a quiz asset, not a learning-summary entry.
    if (self::hasColumnSafe($table, 'note')) {
        static::addGlobalScope('quiz_source', function (Builder $query) use ($table) {
            $query->where(function (Builder $query) use ($table) {
                $query->whereNull($table.'.note')
                    ->orWhere($table.'.note', '<>', 'อัปโหลดไฟล์เพื่อสร้างแบบฝึกหัด');
            });
        });
    }

    static::creating(function (self $log) {
        if (Auth::check() && empty($log->user_id)) {
            $log->user_id = Auth::id();
        }
    });
}


    /* =======================
     | Relations
     ======================= */
    public function subject()
    {
        return $this->belongsTo(Subject::class);
    }

    public function files()
    {
        return $this->hasMany(FileAttachment::class);
    }

    public function summaries()
    {
        return $this->hasMany(Summary::class);
    }

    public function audioSummaries()
    {
        return $this->hasMany(AudioSummary::class)
            ->where('status', 'completed')
            ->whereNotNull('summary')
            ->where('summary', '!=', '')
            ->orderByDesc('created_at');
    }

    public function isSummary(): bool
    {
        return in_array($this->log_type, [
            self::TYPE_DOCUMENT_SUMMARY,
            self::TYPE_AUDIO_SUMMARY,
        ], true);
    }

    private static function hasTableSafe(string $table): bool
    {
        static $cache = [];
        if (array_key_exists($table, $cache)) {
            return $cache[$table];
        }

        try {
            $exists = DB::selectOne(
                'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
                [$table]
            ) !== null;
        } catch (Throwable $error) {
            $exists = false;
        }

        $cache[$table] = $exists;
        return $exists;
    }

    private static function hasColumnSafe(string $table, string $column): bool
    {
        $key = $table . '.' . $column;
        static $cache = [];
        if (array_key_exists($key, $cache)) {
            return $cache[$key];
        }

        try {
            $exists = DB::selectOne(
                'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
                [$table, $column]
            ) !== null;
        } catch (Throwable $error) {
            $exists = false;
        }

        $cache[$key] = $exists;
        return $exists;
    }
}
