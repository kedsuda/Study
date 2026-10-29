<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SubjectArchive extends Model
{
    use HasFactory;

    protected $table = 'subjects_archives';

    public $timestamps = false;

    protected $fillable = [
        'original_subject_id',
        'user_id',
        'name',
        'description',
        'source_type',
        'color',
        'target_hours',
        'start_date',
        'start_time',
        'end_time',
        'archived_at',
    ];

    protected $casts = [
        'archived_at' => 'datetime',
    ];
}
