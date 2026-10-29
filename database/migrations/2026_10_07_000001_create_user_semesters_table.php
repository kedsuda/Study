<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('user_semesters')) {
            Schema::create('user_semesters', function (Blueprint $table) {
                $table->unsignedBigInteger('user_id');
                $table->unsignedInteger('semester_id');
                $table->primary(['user_id', 'semester_id']);
                $table->index('semester_id');
            });
        }

        // Existing subjects establish membership without assigning unused global terms.
        if (Schema::hasTable('subjects') && Schema::hasColumn('subjects', 'semester_id')) {
            $memberships = DB::table('subjects')
                ->whereNotNull('user_id')->whereNotNull('semester_id')
                ->select('user_id', 'semester_id')->distinct()->get();
            foreach ($memberships->chunk(500) as $chunk) {
                DB::table('user_semesters')->insertOrIgnore($chunk->map(fn ($row) => (array) $row)->all());
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_semesters');
    }
};
