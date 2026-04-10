<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contacts', function (Blueprint $table) {
            $table->id();
            $table->string('email', 320)->unique();
            $table->char('email_hash', 64)->unique();
            $table->string('first_name')->nullable();
            $table->string('last_name')->nullable();
            $table->string('phone', 50)->nullable();
            $table->string('company')->nullable();
            $table->timestamps();

            $table->index('email_hash');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contacts');
    }
};
