<?php

namespace App\Models;

use App\Scopes\BrandScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CampaignRecipient extends Model
{
    public $timestamps = true;

    protected $fillable = [
        'campaign_id', 'brand_id', 'contact_id',
        'email', 'status', 'message_id',
        'sent_at', 'failed_at', 'suppressed_at',
    ];

    protected function casts(): array
    {
        return [
            'sent_at'       => 'datetime',
            'failed_at'     => 'datetime',
            'suppressed_at' => 'datetime',
            'created_at'    => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());
    }

    public function campaign(): BelongsTo { return $this->belongsTo(Campaign::class); }
    public function contact(): BelongsTo  { return $this->belongsTo(Contact::class); }
    public function brand(): BelongsTo    { return $this->belongsTo(Brand::class); }
}
