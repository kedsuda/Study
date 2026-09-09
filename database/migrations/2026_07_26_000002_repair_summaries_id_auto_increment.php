<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (DB::getDriverName() !== 'mysql' || ! Schema::hasTable('summaries') || ! Schema::hasColumn('summaries', 'id')) {
            return;
        }

        $column = DB::selectOne(
            'SELECT column_type, extra FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
            ['summaries', 'id']
        );

        if (! $column || ! is_string($column->column_type ?? null) || trim((string) $column->column_type) === '') {
            return;
        }

        $primaryAny = DB::selectOne(
            'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
            ['summaries', 'PRIMARY']
        );
        $primaryOnId = DB::selectOne(
            'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? AND column_name = ? LIMIT 1',
            ['summaries', 'PRIMARY', 'id']
        );

        if ($primaryAny && ! $primaryOnId) {
            throw new RuntimeException('The summaries table has a primary key, but it is not on the id column.');
        }

        if (! $primaryOnId) {
            DB::statement('ALTER TABLE `summaries` ADD PRIMARY KEY (`id`)');
        }

        $extra = strtolower((string) ($column->extra ?? ''));
        if (! str_contains($extra, 'auto_increment')) {
            DB::statement("ALTER TABLE `summaries` MODIFY `id` {$column->column_type} NOT NULL AUTO_INCREMENT");
        }

        $maxId = DB::table('summaries')->max('id');
        if (is_numeric($maxId)) {
            $next = (int) $maxId + 1;
            if ($next > 0) {
                DB::statement("ALTER TABLE `summaries` AUTO_INCREMENT = {$next}");
            }
        }
    }

    public function down(): void
    {
        // Reverting AUTO_INCREMENT/primary-key repairs safely is not guaranteed.
    }
};
