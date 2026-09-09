<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('files')) {
            return;
        }

        Schema::table('files', function (Blueprint $table) {
            if (! Schema::hasColumn('files', 'status')) {
                $table->string('status', 32)->default('active')->after('file_size');
            }

            if (! Schema::hasColumn('files', 'archived_at')) {
                $table->timestamp('archived_at')->nullable()->after('status');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('files')) {
            return;
        }

        Schema::table('files', function (Blueprint $table) {
            if (Schema::hasColumn('files', 'archived_at')) {
                $table->dropColumn('archived_at');
            }

            if (Schema::hasColumn('files', 'status')) {
                $table->dropColumn('status');
            }
        });
    }
};
