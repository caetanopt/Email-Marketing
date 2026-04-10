<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('segments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->foreignId('list_id')->nullable()->constrained('contact_lists')->nullOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->json('conditions');
            $table->unsignedInteger('estimated_count')->nullable();
            $table->timestamp('estimated_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index('brand_id');
            $table->index(['brand_id', 'list_id'], 'idx_segments_brand_list');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('segments');
    }
};
