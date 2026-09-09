<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('career_recommendations')) {
            return;
        }

        Schema::table('career_recommendations', function (Blueprint $table) {
            if (! Schema::hasColumn('career_recommendations', 'career')) {
                $table->string('career', 255)->nullable()->after('subject_id');
            }
        });

        // allow AI-driven records without fixed career_paths mapping
        if (Schema::hasColumn('career_recommendations', 'career_path_id')) {
            foreach ($this->foreignKeysForColumn('career_recommendations', 'career_path_id') as $foreignKey) {
                DB::statement("ALTER TABLE `career_recommendations` DROP FOREIGN KEY `{$foreignKey}`");
            }
            DB::statement('ALTER TABLE `career_recommendations` MODIFY `career_path_id` '.$this->columnType('career_recommendations', 'career_path_id', 'BIGINT UNSIGNED').' NULL');
            $this->addCareerPathForeignKeyIfPossible();
        }

        // Remove old fixed recommendations/paths so the system uses fresh AI-generated data only.
        DB::table('career_recommendations')->delete();
        if (Schema::hasTable('career_paths')) {
            DB::table('career_paths')->delete();
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('career_recommendations')) {
            return;
        }

        if (Schema::hasColumn('career_recommendations', 'career_path_id')) {
            foreach ($this->foreignKeysForColumn('career_recommendations', 'career_path_id') as $foreignKey) {
                DB::statement("ALTER TABLE `career_recommendations` DROP FOREIGN KEY `{$foreignKey}`");
            }
            DB::statement('ALTER TABLE `career_recommendations` MODIFY `career_path_id` '.$this->columnType('career_recommendations', 'career_path_id', 'BIGINT UNSIGNED').' NOT NULL');
            $this->addCareerPathForeignKeyIfPossible();
        }

        if (Schema::hasColumn('career_recommendations', 'career')) {
            Schema::table('career_recommendations', function (Blueprint $table) {
                $table->dropColumn('career');
            });
        }
    }

    private function foreignKeyExists(string $constraintName): bool
    {
        $database = DB::getDatabaseName();

        return DB::table('information_schema.TABLE_CONSTRAINTS')
            ->where('CONSTRAINT_SCHEMA', $database)
            ->where('TABLE_NAME', 'career_recommendations')
            ->where('CONSTRAINT_NAME', $constraintName)
            ->where('CONSTRAINT_TYPE', 'FOREIGN KEY')
            ->exists();
    }

    /**
     * @return array<int, string>
     */
    private function foreignKeysForColumn(string $table, string $column): array
    {
        $database = DB::getDatabaseName();

        return collect(DB::table('information_schema.KEY_COLUMN_USAGE')
            ->where('TABLE_SCHEMA', $database)
            ->where('TABLE_NAME', $table)
            ->where('COLUMN_NAME', $column)
            ->whereNotNull('REFERENCED_TABLE_NAME')
            ->pluck('CONSTRAINT_NAME'))
            ->filter(fn ($name) => is_string($name) && trim($name) !== '')
            ->unique()
            ->values()
            ->all();
    }

    private function columnType(string $table, string $column, string $fallback): string
    {
        $database = DB::getDatabaseName();
        $row = DB::table('information_schema.COLUMNS')
            ->where('TABLE_SCHEMA', $database)
            ->where('TABLE_NAME', $table)
            ->where('COLUMN_NAME', $column)
            ->select('COLUMN_TYPE')
            ->first();

        return is_string($row?->COLUMN_TYPE ?? null) && trim($row->COLUMN_TYPE) !== ''
            ? (string) $row->COLUMN_TYPE
            : $fallback;
    }

    private function addCareerPathForeignKeyIfPossible(): void
    {
        if (! Schema::hasTable('career_paths') || $this->foreignKeyExists('career_recommendations_career_path_id_foreign')) {
            return;
        }

        try {
            DB::statement('ALTER TABLE `career_recommendations` ADD CONSTRAINT `career_recommendations_career_path_id_foreign` FOREIGN KEY (`career_path_id`) REFERENCES `career_paths`(`id`) ON DELETE CASCADE');
        } catch (Throwable) {
            // Legacy databases may have mismatched integer types. The app treats career_path_id as nullable.
        }
    }
};
