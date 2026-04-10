<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;

class RolesAndPermissionsSeeder extends Seeder
{
    public function run(): void
    {
        // ── Permissões ────────────────────────────────────────────────────
        $permissions = [
            // Campanhas
            ['name' => 'campaigns.view',      'display_name' => 'Ver campanhas',       'module' => 'campaigns'],
            ['name' => 'campaigns.create',    'display_name' => 'Criar campanhas',     'module' => 'campaigns'],
            ['name' => 'campaigns.edit',      'display_name' => 'Editar campanhas',    'module' => 'campaigns'],
            ['name' => 'campaigns.delete',    'display_name' => 'Eliminar campanhas',  'module' => 'campaigns'],
            ['name' => 'campaigns.send',      'display_name' => 'Enviar campanhas',    'module' => 'campaigns'],
            ['name' => 'campaigns.schedule',  'display_name' => 'Agendar campanhas',   'module' => 'campaigns'],

            // Contactos
            ['name' => 'contacts.view',       'display_name' => 'Ver contactos',       'module' => 'contacts'],
            ['name' => 'contacts.create',     'display_name' => 'Criar contactos',     'module' => 'contacts'],
            ['name' => 'contacts.edit',       'display_name' => 'Editar contactos',    'module' => 'contacts'],
            ['name' => 'contacts.delete',     'display_name' => 'Eliminar contactos',  'module' => 'contacts'],
            ['name' => 'contacts.import',     'display_name' => 'Importar contactos',  'module' => 'contacts'],
            ['name' => 'contacts.export',     'display_name' => 'Exportar contactos',  'module' => 'contacts'],

            // Listas
            ['name' => 'lists.view',          'display_name' => 'Ver listas',          'module' => 'lists'],
            ['name' => 'lists.create',        'display_name' => 'Criar listas',        'module' => 'lists'],
            ['name' => 'lists.edit',          'display_name' => 'Editar listas',       'module' => 'lists'],
            ['name' => 'lists.delete',        'display_name' => 'Eliminar listas',     'module' => 'lists'],

            // Templates
            ['name' => 'templates.view',      'display_name' => 'Ver templates',       'module' => 'templates'],
            ['name' => 'templates.create',    'display_name' => 'Criar templates',     'module' => 'templates'],
            ['name' => 'templates.edit',      'display_name' => 'Editar templates',    'module' => 'templates'],
            ['name' => 'templates.delete',    'display_name' => 'Eliminar templates',  'module' => 'templates'],

            // Relatórios
            ['name' => 'reports.view',        'display_name' => 'Ver relatórios',      'module' => 'reports'],
            ['name' => 'reports.export',      'display_name' => 'Exportar relatórios', 'module' => 'reports'],

            // Marca
            ['name' => 'brand.manage',        'display_name' => 'Gerir marca',         'module' => 'brand'],
            ['name' => 'brand.users',         'display_name' => 'Gerir utilizadores',  'module' => 'brand'],

            // Sistema (só super_admin / group_admin)
            ['name' => 'system.brands',       'display_name' => 'Gerir marcas',        'module' => 'system'],
            ['name' => 'system.users',        'display_name' => 'Gerir utilizadores',  'module' => 'system'],
            ['name' => 'system.audit',        'display_name' => 'Ver audit logs',      'module' => 'system'],
        ];

        foreach ($permissions as $perm) {
            Permission::firstOrCreate(['name' => $perm['name']], $perm);
        }

        // ── Papéis e atribuição de permissões ─────────────────────────────
        $roles = [
            'super_admin' => [
                'display_name' => 'Super Administrador',
                'description'  => 'Acesso total ao sistema',
                'permissions'  => Permission::pluck('name')->toArray(), // tudo
            ],
            'group_admin' => [
                'display_name' => 'Administrador de Grupo',
                'description'  => 'Acesso a todas as marcas, gestão de utilizadores',
                'permissions'  => [
                    'campaigns.*', 'contacts.*', 'lists.*', 'templates.*',
                    'reports.*', 'brand.*', 'system.brands', 'system.users', 'system.audit',
                ],
            ],
            'brand_admin' => [
                'display_name' => 'Administrador de Marca',
                'description'  => 'Admin de marca específica, gere utilizadores da marca',
                'permissions'  => [
                    'campaigns.view', 'campaigns.create', 'campaigns.edit', 'campaigns.delete', 'campaigns.send', 'campaigns.schedule',
                    'contacts.view', 'contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.import', 'contacts.export',
                    'lists.view', 'lists.create', 'lists.edit', 'lists.delete',
                    'templates.view', 'templates.create', 'templates.edit', 'templates.delete',
                    'reports.view', 'reports.export',
                    'brand.manage', 'brand.users',
                ],
            ],
            'marketing_manager' => [
                'display_name' => 'Gestor de Marketing',
                'description'  => 'Cria, edita e envia campanhas, gere listas',
                'permissions'  => [
                    'campaigns.view', 'campaigns.create', 'campaigns.edit', 'campaigns.send', 'campaigns.schedule',
                    'contacts.view', 'contacts.create', 'contacts.edit', 'contacts.import', 'contacts.export',
                    'lists.view', 'lists.create', 'lists.edit',
                    'templates.view', 'templates.create', 'templates.edit',
                    'reports.view', 'reports.export',
                ],
            ],
            'marketing_coordinator' => [
                'display_name' => 'Coordenador de Marketing',
                'description'  => 'Cria rascunhos, importa listas, não pode enviar',
                'permissions'  => [
                    'campaigns.view', 'campaigns.create', 'campaigns.edit',
                    'contacts.view', 'contacts.create', 'contacts.edit', 'contacts.import',
                    'lists.view', 'lists.create', 'lists.edit',
                    'templates.view',
                    'reports.view',
                ],
            ],
            'analyst' => [
                'display_name' => 'Analista',
                'description'  => 'Apenas leitura e relatórios',
                'permissions'  => [
                    'campaigns.view', 'contacts.view', 'lists.view',
                    'templates.view', 'reports.view', 'reports.export',
                ],
            ],
        ];

        foreach ($roles as $name => $data) {
            $role = Role::firstOrCreate(
                ['name' => $name],
                ['display_name' => $data['display_name'], 'description' => $data['description']]
            );

            // Resolve permissões com wildcard (ex: 'campaigns.*')
            $permNames = [];
            foreach ($data['permissions'] as $perm) {
                if (str_ends_with($perm, '.*')) {
                    $module = str_replace('.*', '', $perm);
                    $permNames = array_merge(
                        $permNames,
                        Permission::where('module', $module)->pluck('name')->toArray()
                    );
                } else {
                    $permNames[] = $perm;
                }
            }

            $permIds = Permission::whereIn('name', array_unique($permNames))->pluck('id');
            $role->permissions()->syncWithoutDetaching($permIds);
        }

        $this->command->info('✅ Roles e permissões criados.');
    }
}
