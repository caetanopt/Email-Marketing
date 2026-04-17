<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('campaign_recipients', function (Blueprint $table) {
            $table->char('tracking_token', 32)->nullable()->unique()->after('message_id');
            $table->timestamp('failed_at')->nullable()->after('sent_at');
            $table->timestamp('suppressed_at')->nullable()->after('failed_at');

            // Extend status enum to include suppressed
            $table->enum('status', ['pending', 'sent', 'bounced', 'failed', 'suppressed'])
                  ->default('pending')
                  ->change();
        });

        Schema::table('campaign_recipients', function (Blueprint $table) {
            $table->index('tracking_token');
        });
    }

    public function down(): void
    {
        Schema::table('campaign_recipients', function (Blueprint $table) {
            $table->dropIndex(['tracking_token']);
            $table->dropColumn(['tracking_token', 'failed_at', 'suppressed_at']);
            $table->enum('status', ['pending', 'sent', 'bounced', 'failed'])
                  ->default('pending')
                  ->change();
        });
    }
};
