<?php

namespace App\Actions\Contacts;

use App\DataTransferObjects\ContactData;
use App\Models\AuditLog;
use App\Models\Contact;
use App\Models\ContactBrandRelation;

class UpdateContactAction
{
    public function execute(Contact $contact, ContactData $data, int $brandId): Contact
    {
        $old = $contact->only('email', 'first_name', 'last_name', 'phone', 'company');

        $contact->update(array_filter([
            'first_name' => $data->firstName,
            'last_name'  => $data->lastName,
            'phone'      => $data->phone,
            'company'    => $data->company,
        ], fn ($v) => $v !== null));

        // Actualiza consentimento se enviado explicitamente
        ContactBrandRelation::where('contact_id', $contact->id)
            ->where('brand_id', $brandId)
            ->update([
                'consent_given' => $data->consent,
                'consent_at'    => $data->consent ? now() : null,
            ]);

        AuditLog::record(
            action:     'contact.updated',
            brandId:    $brandId,
            entityType: 'contact',
            entityId:   $contact->id,
            oldValues:  $old,
            newValues:  $contact->fresh()->only('email', 'first_name', 'last_name', 'phone', 'company'),
        );

        return $contact;
    }
}
