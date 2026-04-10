<?php

namespace App\Enums;

enum CampaignStatus: string
{
    case Draft     = 'draft';
    case Scheduled = 'scheduled';
    case Sending   = 'sending';
    case Sent      = 'sent';
    case Paused    = 'paused';
    case Cancelled = 'cancelled';
    case Failed    = 'failed';

    public function canBeSent(): bool
    {
        return in_array($this, [self::Draft, self::Scheduled]);
    }

    public function isFinal(): bool
    {
        return in_array($this, [self::Sent, self::Cancelled, self::Failed]);
    }

    public function label(): string
    {
        return match($this) {
            self::Draft     => 'Rascunho',
            self::Scheduled => 'Agendada',
            self::Sending   => 'A enviar',
            self::Sent      => 'Enviada',
            self::Paused    => 'Pausada',
            self::Cancelled => 'Cancelada',
            self::Failed    => 'Falhada',
        };
    }
}
