<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('unsubscribes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->foreignId('contact_id')->nullable()->constrained()->nullOnDelete();
            $table->string('email', 320);
            $table->foreignId('campaign_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('source', ['link', 'manual', 'import', 'api', 'bounce', 'spam_complaint']);
            $table->string('ip_address', 45)->nullable();
            $table->timestamp('unsubscribed_at')->useCurrent();

            $table->unique(['brand_id', 'email'], 'unique_brand_email_unsub');
            $table->index('brand_id');
            $table->index('contact_id');
            $table->index(['brand_id', 'unsubscribed_at'], 'idx_unsub_date');
        });

        Schema::create('suppression_list', function (Blueprint $table) {
            $table->id();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->string('email', 320);
            $table->char('email_hash', 64);
            $table->enum('reason', ['unsubscribe', 'hard_bounce', 'spam_complaint', 'manual', 'import']);
            $table->timestamp('added_at')->useCurrent();
            $table->foreignId('added_by')->nullable()->constrained('users')->nullOnDelete();

            $table->unique(['brand_id', 'email_hash'], 'unique_brand_suppression');
            $table->index('brand_id');
            $table->index('email_hash');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('suppression_list');
        Schema::dropIfExists('unsubscribes');
    }
};
