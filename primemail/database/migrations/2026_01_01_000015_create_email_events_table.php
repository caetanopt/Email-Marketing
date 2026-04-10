<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->foreignId('contact_id')->nullable()->constrained()->nullOnDelete();
            $table->string('email', 320);
            $table->enum('event_type', ['open', 'click', 'bounce', 'unsubscribe', 'spam_complaint', 'delivered']);
            $table->json('event_data')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 500)->nullable();
            $table->timestamp('occurred_at')->useCurrent();

            $table->index('campaign_id');
            $table->index(['brand_id', 'campaign_id'], 'idx_ee_brand_campaign');
            $table->index(['contact_id', 'event_type'], 'idx_ee_contact_type');
            $table->index(['event_type', 'occurred_at'], 'idx_ee_type_occurred');
            $table->index(['brand_id', 'event_type'], 'idx_ee_brand_type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_events');
    }
};
