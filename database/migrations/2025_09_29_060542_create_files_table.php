<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('files')) {
            return;
        }

        Schema::create('files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('study_log_id')->nullable()->constrained()->nullOnDelete();
            $table->string('original_name');
            $table->string('file_path');
            $table->enum('file_type', ['pdf', 'word', 'audio', 'other']);
            $table->string('mime_type')->nullable();
            $table->unsignedBigInteger('file_size')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('files');
    }
};
