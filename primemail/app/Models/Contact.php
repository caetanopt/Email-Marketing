<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Contact extends Model
{
    use HasFactory;

    protected $fillable = [
        'email', 'email_hash', 'first_name', 'last_name', 'phone', 'company',
    ];

    protected static function booted(): void
    {
        // Gera email_hash automaticamente antes de criar
        static::creating(function (Contact $contact) {
            $contact->email       = strtolower(trim($contact->email));
            $contact->email_hash  = hash('sha256', $contact->email);
        });

        static::updating(function (Contact $contact) {
            if ($contact->isDirty('email')) {
                $contact->email      = strtolower(trim($contact->email));
                $contact->email_hash = hash('sha256', $contact->email);
            }
        });
    }

    public function listMemberships(): HasMany
    {
        return $this->hasMany(ContactListMember::class);
    }

    public function brandRelations(): HasMany
    {
        return $this->hasMany(ContactBrandRelation::class);
    }

    public function emailEvents(): HasMany
    {
        return $this->hasMany(EmailEvent::class);
    }

    public function unsubscribes(): HasMany
    {
        return $this->hasMany(Unsubscribe::class);
    }

    public function getFullNameAttribute(): string
    {
        return trim("{$this->first_name} {$this->last_name}");
    }
}
