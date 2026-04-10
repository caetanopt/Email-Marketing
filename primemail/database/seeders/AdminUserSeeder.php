<?php

namespace Database\Seeders;

use App\Models\Brand;
use App\Models\Role;
use App\Models\User;
use App\Models\UserBrandRole;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        // Cria o super admin
        $admin = User::firstOrCreate(
            ['email' => 'admin@caetano.pt'],
            [
                'name'              => 'Administrador',
                'password'          => Hash::make('PrimeMail@2026!'),
                'email_verified_at' => now(),
                'status'            => 'active',
            ]
        );

        // Atribui papel super_admin a todas as marcas
        $superAdminRole = Role::where('name', 'super_admin')->first();
        $brands         = Brand::all();

        foreach ($brands as $brand) {
            UserBrandRole::firstOrCreate(
                ['user_id' => $admin->id, 'brand_id' => $brand->id, 'role_id' => $superAdminRole->id],
                ['granted_at' => now()]
            );
        }

        // Define a primeira marca como ativa
        $admin->update(['active_brand_id' => $brands->first()?->id]);

        $this->command->info('✅ Super admin criado: admin@caetano.pt');
        $this->command->warn('⚠️  Altere a password após o primeiro login!');
    }
}
