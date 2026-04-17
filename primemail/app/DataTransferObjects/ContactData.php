<?php

namespace App\DataTransferObjects;

readonly class ContactData
{
    public function __construct(
        public string  $email,
        public ?string $firstName = null,
        public ?string $lastName  = null,
        public ?string $phone     = null,
        public ?string $company   = null,
        public bool    $consent   = false,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            email:     $data['email'],
            firstName: $data['first_name'] ?? null,
            lastName:  $data['last_name']  ?? null,
            phone:     $data['phone']      ?? null,
            company:   $data['company']    ?? null,
            consent:   (bool) ($data['consent'] ?? false),
        );
    }
}
