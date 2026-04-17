<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('subject', 998);
            $table->string('preview_text', 255)->nullable();
            $table->string('from_name');
            $table->string('from_email');
            $table->string('reply_to')->nullable();

            // ── Conteúdo MJML ─────────────────────────────────────────────
            // mjml_source: código editável (fonte de verdade durante draft)
            // compiled_html: snapshot do HTML compilado — congelado ao enviar
            //                para que alterações posteriores ao template não
            //                afetem campanhas já enviadas
            $table->longText('mjml_source')->nullable();
            $table->longText('compiled_html')->nullable();
            $table->text('content_text')->nullable();
            $table->timestamp('compiled_at')->nullable();
            $table->text('compile_error')->nullable();
            $table->foreignId('template_id')->nullable()->constrained('templates')->nullOnDelete();
            $table->enum('status', ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'failed'])->default('draft');
            $table->timestamp('scheduled_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->unsignedInteger('estimated_recipients')->nullable();
            $table->unsignedInteger('actual_recipients')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('brand_id');
            $table->index(['brand_id', 'status'], 'idx_campaigns_brand_status');
            $table->index(['brand_id', 'status', 'scheduled_at'], 'idx_campaigns_brand_scheduled');
            $table->index('created_by');
        });

        Schema::create('campaign_lists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('list_id')->nullable()->constrained('contact_lists')->nullOnDelete();
            $table->foreignId('segment_id')->nullable()->constrained('segments')->nullOnDelete();
            $table->boolean('is_exclusion')->default(false);

            $table->index('campaign_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campaign_lists');
        Schema::dropIfExists('campaigns');
    }
};
