<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tags', function (Blueprint $table) {
            $table->id();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->string('color', 7)->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['brand_id', 'name'], 'unique_brand_tag');
        });

        Schema::create('contact_tag_relations', function (Blueprint $table) {
            $table->foreignId('contact_id')->constrained()->cascadeOnDelete();
            $table->foreignId('tag_id')->constrained('tags')->cascadeOnDelete();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->primary(['contact_id', 'tag_id']);
            $table->index(['brand_id', 'tag_id'], 'idx_ctr_brand_tag');
            $table->index('contact_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contact_tag_relations');
        Schema::dropIfExists('tags');
    }
};
