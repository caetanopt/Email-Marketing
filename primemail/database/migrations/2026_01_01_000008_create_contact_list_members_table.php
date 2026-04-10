<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contact_list_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('contact_id')->constrained()->cascadeOnDelete();
            $table->foreignId('list_id')->constrained('contact_lists')->cascadeOnDelete();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->enum('status', ['active', 'unsubscribed', 'bounced', 'cleaned'])->default('active');
            $table->json('custom_fields')->nullable();
            $table->timestamp('subscribed_at')->nullable();
            $table->timestamp('unsubscribed_at')->nullable();
            $table->enum('bounce_type', ['hard', 'soft'])->nullable();
            $table->foreignId('import_id')->nullable()->constrained('imports')->nullOnDelete();
            $table->timestamps();

            $table->unique(['contact_id', 'list_id'], 'unique_contact_list');
            $table->index('list_id');
            $table->index(['brand_id', 'status'], 'idx_clm_brand_status');
            $table->index('contact_id');
            $table->index(['list_id', 'status'], 'idx_clm_list_status');
            $table->index('import_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contact_list_members');
    }
};
