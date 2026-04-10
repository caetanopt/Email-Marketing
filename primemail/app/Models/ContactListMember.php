<?php

namespace App\Models;

use App\Scopes\BrandScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ContactListMember extends Model
{
    protected $table = 'contact_list_members';

    protected $fillable = [
        'contact_id', 'list_id', 'brand_id', 'status',
        'custom_fields', 'subscribed_at', 'unsubscribed_at',
        'bounce_type', 'import_id',
    ];

    protected function casts(): array
    {
        return [
            'custom_fields'   => 'array',
            'subscribed_at'   => 'datetime',
            'unsubscribed_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());
    }

    public function contact(): BelongsTo { return $this->belongsTo(Contact::class); }
    public function list(): BelongsTo    { return $this->belongsTo(ContactList::class, 'list_id'); }
    public function brand(): BelongsTo   { return $this->belongsTo(Brand::class); }
    public function import(): BelongsTo  { return $this->belongsTo(Import::class); }

    public function scopeActive($query)     { return $query->where('status', 'active'); }
    public function scopeSubscribed($query) { return $query->where('status', 'active'); }
}
