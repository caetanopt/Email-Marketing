<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('brand_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->text('description')->nullable();

            // ── MJML ──────────────────────────────────────────────────────
            // Os autores escrevem em MJML; o sistema compila para HTML
            // cross-client responsivo. Guardamos ambos para performance:
            // - compilação pesada (~200ms) feita uma vez por save
            // - envio usa o compiled_html em cache
            $table->longText('mjml_source');                    // código MJML (fonte de verdade)
            $table->longText('compiled_html')->nullable();      // HTML gerado pelo MJML CLI
            $table->text('content_text')->nullable();           // alternativa plain-text (fallback)
            $table->timestamp('compiled_at')->nullable();       // última compilação OK
            $table->text('compile_error')->nullable();          // último erro (se falhar)

            $table->string('thumbnail_path', 500)->nullable();
            $table->boolean('is_shared')->default(false);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('brand_id');
            $table->index('is_shared');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('templates');
    }
};
