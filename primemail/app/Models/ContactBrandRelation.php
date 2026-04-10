<?php

namespace App\Models;

use App\Scopes\BrandScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ContactBrandRelation extends Model
{
    protected $table = 'contact_brand_relations';

    protected $fillable = [
        'contact_id', 'brand_id', 'consent_status', 'consent_source',
        'consent_date', 'opt_out_date', 'opt_out_source', 'global_unsubscribe',
    ];

    protected function casts(): array
    {
        return [
            'consent_date'      => 'datetime',
            'opt_out_date'      => 'datetime',
            'global_unsubscribe' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());
    }

    public function contact(): BelongsTo { return $this->belongsTo(Contact::class); }
    public function brand(): BelongsTo   { return $this->belongsTo(Brand::class); }

    public function hasConsent(): bool
    {
        return $this->consent_status === 'opted_in' && !$this->global_unsubscribe;
    }
}
