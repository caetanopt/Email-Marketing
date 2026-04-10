<?php

namespace App\Models;

use App\Scopes\BrandScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmailEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'campaign_id', 'brand_id', 'contact_id', 'email',
        'event_type', 'event_data', 'ip_address', 'user_agent', 'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'event_data'  => 'array',
            'occurred_at' => 'datetime',
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
