<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaign_recipients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->foreignId('contact_id')->constrained()->cascadeOnDelete();
            $table->string('email', 320);
            $table->enum('status', ['pending', 'sent', 'bounced', 'failed'])->default('pending');
            $table->string('message_id', 255)->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index('campaign_id');
            $table->index(['brand_id', 'campaign_id'], 'idx_cr_brand_campaign');
            $table->index('contact_id');
            $table->index(['campaign_id', 'status'], 'idx_cr_status');
            $table->index('message_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campaign_recipients');
    }
};
