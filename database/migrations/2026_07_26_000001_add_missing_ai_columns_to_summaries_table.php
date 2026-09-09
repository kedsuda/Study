<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('summaries')) {
            return;
        }

        Schema::table('summaries', function (Blueprint $table) {
            if (! Schema::hasColumn('summaries', 'ai_model')) {
                $table->string('ai_model')->nullable()->after('content');
            }

            if (! Schema::hasColumn('summaries', 'metadata')) {
                $table->json('metadata')->nullable()->after('ai_model');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('summaries')) {
            return;
        }

        Schema::table('summaries', function (Blueprint $table) {
            if (Schema::hasColumn('summaries', 'metadata')) {
                $table->dropColumn('metadata');
            }

            if (Schema::hasColumn('summaries', 'ai_model')) {
                $table->dropColumn('ai_model');
            }
        });
    }
};
