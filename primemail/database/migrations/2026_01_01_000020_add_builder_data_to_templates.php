<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('templates', function (Blueprint $table) {
            // Estrutura JSON do drag-and-drop builder visual.
            // Quando presente, o editor abre directamente no modo visual;
            // se for null, abre no modo MJML (compatível com templates antigos).
            $table->json('builder_data')->nullable()->after('content_text');
        });
    }

    public function down(): void
    {
        Schema::table('templates', function (Blueprint $table) {
            $table->dropColumn('builder_data');
        });
    }
};
