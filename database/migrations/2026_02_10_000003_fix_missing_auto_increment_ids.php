<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        $tables = [
            'ai_messages',
            'ai_threads',
            'audio_summaries',
            'audio_summaries_v2',
            'audio_transcription_jobs',
            'audio_transcription_segments',
            'email_digests',
            'email_digest_items',
            'email_provider_accounts',
            'failed_jobs',
            'files',
            'learning_goal_targets',
            'learning_moods',
            'lessons',
            'lesson_summaries',
            'mood_logs',
            'quiz_answers',
            'quiz_attempts',
            'quiz_questions',
            'schedules',
            'study_environments',
            'study_logs',
            'summaries',
            'topic_materials',
        ];

        foreach ($tables as $table) {
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'id')) {
                continue;
            }

            $column = DB::selectOne(
                'SELECT column_type, extra FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
                [$table, 'id']
            );
            if (!$column) continue;

            $type = $column->column_type ?? null; // e.g. "bigint(20) unsigned"
            if (!is_string($type) || trim($type) === '') {
                continue;
            }

            $extra = strtolower((string) ($column->extra ?? ''));
            $isAutoIncrement = str_contains($extra, 'auto_increment');

            // If table already has a PRIMARY KEY but it's not on `id`, don't try to override.
            $primaryAny = DB::selectOne(
                'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
                [$table, 'PRIMARY']
            );
            $primaryOnId = DB::selectOne(
                'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? AND column_name = ? LIMIT 1',
                [$table, 'PRIMARY', 'id']
            );

            if ($primaryAny && !$primaryOnId) {
                continue;
            }

            if (!$primaryOnId) {
                try {
                    DB::statement("ALTER TABLE `{$table}` ADD PRIMARY KEY (`id`)");
                } catch (\Throwable $e) {
                    // ignore (might already exist or fail due to duplicate ids)
                }
            }

            if (!$isAutoIncrement) {
                try {
                    DB::statement("ALTER TABLE `{$table}` MODIFY `id` {$type} NOT NULL AUTO_INCREMENT");
                } catch (\Throwable $e) {
                    // ignore
                }
            }

            // Best-effort: set next AUTO_INCREMENT to max(id)+1 when possible.
            try {
                $maxId = DB::table($table)->max('id');
                if (is_numeric($maxId)) {
                    $next = (int) $maxId + 1;
                    if ($next > 0) {
                        DB::statement("ALTER TABLE `{$table}` AUTO_INCREMENT = {$next}");
                    }
                }
            } catch (\Throwable $e) {
                // ignore
            }
        }
    }

    public function down(): void
    {
        // No down migration: reverting AUTO_INCREMENT/PK safely is not guaranteed.
    }
};
