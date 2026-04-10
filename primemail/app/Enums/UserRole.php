<?php

namespace App\Enums;

enum UserRole: string
{
    case SuperAdmin          = 'super_admin';
    case GroupAdmin          = 'group_admin';
    case BrandAdmin          = 'brand_admin';
    case MarketingManager    = 'marketing_manager';
    case MarketingCoordinator = 'marketing_coordinator';
    case Analyst             = 'analyst';

    public function label(): string
    {
        return match($this) {
            self::SuperAdmin           => 'Super Administrador',
            self::GroupAdmin           => 'Administrador de Grupo',
            self::BrandAdmin           => 'Administrador de Marca',
            self::MarketingManager     => 'Gestor de Marketing',
            self::MarketingCoordinator => 'Coordenador de Marketing',
            self::Analyst              => 'Analista',
        };
    }

    public function canManageBrands(): bool
    {
        return in_array($this, [self::SuperAdmin, self::GroupAdmin]);
    }

    public function canSendCampaigns(): bool
    {
        return in_array($this, [self::SuperAdmin, self::GroupAdmin, self::BrandAdmin, self::MarketingManager]);
    }
}
