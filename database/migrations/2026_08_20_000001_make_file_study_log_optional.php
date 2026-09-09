<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('files') && Schema::hasColumn('files', 'study_log_id')) {
            // MySQL requires the foreign key to be removed before a referenced
            // column can be changed. Some existing databases use a custom
            // constraint name, so look it up instead of assuming Laravel's name.
            $foreignKeys = DB::select(
                "select constraint_name from information_schema.key_column_usage
                 where table_schema = database()
                   and table_name = 'files'
                   and column_name = 'study_log_id'
                   and referenced_table_name is not null"
            );

            $column = DB::selectOne(
                "select is_nullable from information_schema.columns
                 where table_schema = database()
                   and table_name = 'files'
                   and column_name = 'study_log_id'"
            );

            // New installations already have a nullable column and a valid
            // foreign key from the original table migration.
            if ($column?->is_nullable === 'YES' && $foreignKeys !== []) {
                return;
            }

            foreach ($foreignKeys as $foreignKey) {
                DB::statement('alter table `files` drop foreign key `'.$foreignKey->constraint_name.'`');
            }

            $referencedColumn = DB::selectOne(
                "select column_type from information_schema.columns
                 where table_schema = database()
                   and table_name = 'study_logs'
                   and column_name = 'id'"
            );

            if ($referencedColumn) {
                // Older databases use INT primary keys while newer Laravel
                // migrations use BIGINT UNSIGNED. Match the real parent key.
                DB::statement('alter table `files` modify `study_log_id` '.$referencedColumn->column_type.' null');
            } else {
                Schema::table('files', function (Blueprint $table) {
                    $table->foreignId('study_log_id')->nullable()->change();
                });
            }

            Schema::table('files', function (Blueprint $table) {
                $table->foreign('study_log_id')
                    ->references('id')
                    ->on('study_logs')
                    ->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        // Existing quiz document records may not have a study log, so this
        // column cannot safely be made required again.
    }
};
