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
            'calendar_notes',
            'career_paths',
            'career_recommendations',
            'chat_history',
            'learning_notifications',
            'notification_email_settings',
            'semester',
            'study_calendar_events',
            'study_notifications',
            'subjects',
            'subjects_archives',
            'users',
        ];

        foreach ($tables as $table) {
            $this->repairAutoIncrementId($table);
        }
    }

    public function down(): void
    {
        // Reverting AUTO_INCREMENT/primary-key repairs safely is not guaranteed.
    }

    private function repairAutoIncrementId(string $table): void
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'id')) {
            return;
        }

        $column = DB::selectOne(
            'SELECT column_type, extra FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
            [$table, 'id']
        );

        if (! $column) {
            return;
        }

        $type = $column->column_type ?? null;
        if (! is_string($type) || trim($type) === '') {
            return;
        }

        $primaryAny = DB::selectOne(
            'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
            [$table, 'PRIMARY']
        );
        $primaryOnId = DB::selectOne(
            'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? AND column_name = ? LIMIT 1',
            [$table, 'PRIMARY', 'id']
        );

        if ($primaryAny && ! $primaryOnId) {
            return;
        }

        if (! $primaryOnId) {
            try {
                DB::statement("ALTER TABLE `{$table}` ADD PRIMARY KEY (`id`)");
            } catch (\Throwable) {
                return;
            }
        }

        $extra = strtolower((string) ($column->extra ?? ''));
        if (! str_contains($extra, 'auto_increment')) {
            try {
                DB::statement("ALTER TABLE `{$table}` MODIFY `id` {$type} NOT NULL AUTO_INCREMENT");
            } catch (\Throwable) {
                return;
            }
        }

        try {
            $maxId = DB::table($table)->max('id');
            if (is_numeric($maxId)) {
                $next = (int) $maxId + 1;
                if ($next > 0) {
                    DB::statement("ALTER TABLE `{$table}` AUTO_INCREMENT = {$next}");
                }
            }
        } catch (\Throwable) {
            // Best-effort only.
        }
    }
};
