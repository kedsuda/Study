<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('quiz_questions')) {
            return;
        }

        try {
            DB::statement('ALTER TABLE `quiz_questions` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        } catch (Throwable) {
            return;
        }
    }

    public function down(): void
    {
        // Keep utf8mb4 so Thai quiz content is not corrupted on rollback.
    }
};
