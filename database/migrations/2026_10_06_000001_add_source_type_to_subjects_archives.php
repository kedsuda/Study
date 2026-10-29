<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('subjects_archives') || Schema::hasColumn('subjects_archives', 'source_type')) {
            return;
        }

        Schema::table('subjects_archives', function (Blueprint $table) {
            $table->string('source_type', 32)->nullable();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('subjects_archives') || ! Schema::hasColumn('subjects_archives', 'source_type')) {
            return;
        }

        Schema::table('subjects_archives', function (Blueprint $table) {
            $table->dropColumn('source_type');
        });
    }
};
