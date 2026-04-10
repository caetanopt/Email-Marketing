<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contact_brand_relations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('contact_id')->constrained()->cascadeOnDelete();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            $table->enum('consent_status', ['opted_in', 'opted_out', 'unknown'])->default('unknown');
            $table->string('consent_source', 100)->nullable();
            $table->timestamp('consent_date')->nullable();
            $table->timestamp('opt_out_date')->nullable();
            $table->string('opt_out_source', 100)->nullable();
            $table->boolean('global_unsubscribe')->default(false);
            $table->timestamps();

            $table->unique(['contact_id', 'brand_id'], 'unique_contact_brand');
            $table->index(['brand_id', 'consent_status'], 'idx_cbr_brand_consent');
            $table->index('contact_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contact_brand_relations');
    }
};
