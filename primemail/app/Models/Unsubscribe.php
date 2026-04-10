<?php

namespace App\Models;

use App\Scopes\BrandScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Unsubscribe extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'brand_id', 'contact_id', 'email', 'campaign_id',
        'source', 'ip_address', 'unsubscribed_at',
    ];

    protected function casts(): array
    {
        return ['unsubscribed_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());
    }

    public function brand(): BelongsTo    { return $this->belongsTo(Brand::class); }
    public function contact(): BelongsTo  { return $this->belongsTo(Contact::class); }
    public function campaign(): BelongsTo { return $this->belongsTo(Campaign::class); }
}
