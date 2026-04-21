<?php

namespace App\Actions\Contacts;

use App\DataTransferObjects\ContactData;
use App\Models\AuditLog;
use App\Models\Contact;
use App\Models\ContactBrandRelation;
use App\Models\SuppressionList;
use Illuminate\Validation\ValidationException;

class CreateContactAction
{
    public function execute(ContactData $data, int $brandId): Contact
    {
        $email = strtolower(trim($data->email));
        $emailHash = hash('sha256', $email);

        // Verificar supressão antes de qualquer operação
        if (SuppressionList::isSuppressed($email, $brandId)) {
            throw ValidationException::withMessages([
                'email' => 'Este email está na lista de supressão desta marca.',
            ]);
        }

        // Upsert: se o contacto já existe (mesmo email), reutiliza-o
        $contact = Contact::firstOrCreate(
            ['email' => $email],
            [
                'email_hash' => $emailHash,
                'first_name' => $data->firstName,
                'last_name'  => $data->lastName,
                'phone'      => $data->phone,
                'company'    => $data->company,
            ]
        );

        // Se já existia, atualiza dados que vieram preenchidos
        if (!$contact->wasRecentlyCreated) {
            $contact->fill(array_filter([
                'first_name' => $data->firstName,
                'last_name'  => $data->lastName,
                'phone'      => $data->phone,
                'company'    => $data->company,
            ]))->save();
        }

        // Relação com a marca (consentimento)
        ContactBrandRelation::firstOrCreate(
            ['contact_id' => $contact->id, 'brand_id' => $brandId],
            [
                'consent_given' => $data->consent,
                'consent_at'    => $data->consent ? now() : null,
                'status'        => 'active',
            ]
        );

        AuditLog::record(
            action:     'contact.created',
            brandId:    $brandId,
            entityType: 'contact',
            entityId:   $contact->id,
            newValues:  ['email' => $email],
        );

        return $contact;
    }
}
