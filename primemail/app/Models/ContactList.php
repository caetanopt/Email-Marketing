<?php

namespace App\Models;

use App\Scopes\BrandScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class ContactList extends Model
{
    use HasFactory, SoftDeletes;

    protected $table = 'contact_lists';

    protected $fillable = [
        'brand_id', 'name', 'description',
        'total_contacts', 'active_contacts', 'status', 'created_by',
    ];

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());
    }

    public function brand(): BelongsTo   { return $this->belongsTo(Brand::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    public function members(): HasMany
    {
        return $this->hasMany(ContactListMember::class, 'list_id');
    }

    public function imports(): HasMany
    {
        return $this->hasMany(Import::class, 'list_id');
    }

    public function campaigns(): HasMany
    {
        return $this->hasMany(CampaignList::class, 'list_id');
    }
}
