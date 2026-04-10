<?php

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

class BrandScope implements Scope
{
    /**
     * Aplica o scope a uma query Eloquent.
     * Filtra automaticamente por brand_id da sessão ativa.
     * Para queries cross-brand (admins), usar withoutGlobalScope(BrandScope::class).
     */
    public function apply(Builder $builder, Model $model): void
    {
        if ($brandId = session('active_brand_id')) {
            $builder->where($model->getTable() . '.brand_id', $brandId);
        }
    }
}
