<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('learning_goal_targets')) {
            return;
        }

        $afterColumn = Schema::hasColumn('learning_goal_targets', 'current_value')
            ? 'current_value'
            : (Schema::hasColumn('learning_goal_targets', 'target_value') ? 'target_value' : 'period_end');

        Schema::table('learning_goal_targets', function (Blueprint $table) use ($afterColumn) {
            if (! Schema::hasColumn('learning_goal_targets', 'mission_count')) {
                $table->unsignedInteger('mission_count')->default(0)->after($afterColumn);
            }
        });

        if (Schema::hasColumn('learning_goal_targets', 'current_value')) {
            DB::table('learning_goal_targets')->update([
                'mission_count' => DB::raw('COALESCE(`current_value`, 0)'),
            ]);
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('learning_goal_targets')) {
            return;
        }

        Schema::table('learning_goal_targets', function (Blueprint $table) {
            if (Schema::hasColumn('learning_goal_targets', 'mission_count')) {
                $table->dropColumn('mission_count');
            }
        });
    }
};
