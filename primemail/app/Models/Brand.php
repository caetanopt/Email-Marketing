<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Brand extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'name', 'slug', 'logo_path', 'primary_color',
        'from_name', 'from_email', 'reply_to_email',
        'email_footer_html', 'physical_address', 'unsubscribe_url',
        'smtp_config', 'status', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'smtp_config' => 'encrypted:json',
        ];
    }

    // ── Relações ──────────────────────────────────────────────────────────

    public function userRoles(): HasMany
    {
        return $this->hasMany(UserBrandRole::class);
    }

    public function contactLists(): HasMany
    {
        return $this->hasMany(ContactList::class);
    }

    public function campaigns(): HasMany
    {
        return $this->hasMany(Campaign::class);
    }

    public function templates(): HasMany
    {
        return $this->hasMany(Template::class);
    }

    public function suppressionList(): HasMany
    {
        return $this->hasMany(SuppressionList::class);
    }

    public function imports(): HasMany
    {
        return $this->hasMany(Import::class);
    }
}
