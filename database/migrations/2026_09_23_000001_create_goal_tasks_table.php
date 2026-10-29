<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('goal_tasks')) {
            return;
        }

        Schema::create('goal_tasks', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->string('title', 255);
            $table->text('description')->nullable();
            $table->date('task_date');
            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();
            $table->boolean('completed')->default(false);
            $table->timestamps();
            $table->index(['user_id', 'task_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('goal_tasks');
    }
};
