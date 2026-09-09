<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FileAttachment extends Model
{
    use HasFactory;

    protected $table = 'files';

    protected $fillable = [
        'study_log_id',
        'original_name',
        'file_path',
        'file_type',
        'mime_type',
        'file_size',
        'status',
        'archived_at',
    ];

    protected $casts = [
        'archived_at' => 'datetime',
    ];

    public function studyLog()
    {
        return $this->belongsTo(StudyLog::class);
    }
}
