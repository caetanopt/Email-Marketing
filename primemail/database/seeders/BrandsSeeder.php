<?php

namespace Database\Seeders;

use App\Models\Brand;
use Illuminate\Database\Seeder;

class BrandsSeeder extends Seeder
{
    public function run(): void
    {
        $brands = [
            ['name' => 'Caetano',       'slug' => 'caetano',       'primary_color' => '#1A1A2E', 'from_name' => 'Caetano',       'from_email' => 'marketing@caetano.pt'],
            ['name' => 'BMW',           'slug' => 'bmw',           'primary_color' => '#1C69D4', 'from_name' => 'BMW Caetano',   'from_email' => 'bmw@caetano.pt'],
            ['name' => 'Hyundai',       'slug' => 'hyundai',       'primary_color' => '#002C5F', 'from_name' => 'Hyundai Caetano', 'from_email' => 'hyundai@caetano.pt'],
            ['name' => 'BYD',           'slug' => 'byd',           'primary_color' => '#1DB954', 'from_name' => 'BYD Caetano',   'from_email' => 'byd@caetano.pt'],
            ['name' => 'Audi',          'slug' => 'audi',          'primary_color' => '#BB0A21', 'from_name' => 'Audi Caetano',  'from_email' => 'audi@caetano.pt'],
            ['name' => 'Alpine',        'slug' => 'alpine',        'primary_color' => '#0055A4', 'from_name' => 'Alpine Caetano', 'from_email' => 'alpine@caetano.pt'],
            ['name' => 'Dacia',         'slug' => 'dacia',         'primary_color' => '#FFBE00', 'from_name' => 'Dacia Caetano', 'from_email' => 'dacia@caetano.pt'],
            ['name' => 'Caetano Parts', 'slug' => 'caetano-parts', 'primary_color' => '#E63946', 'from_name' => 'Caetano Parts', 'from_email' => 'parts@caetano.pt'],
        ];

        foreach ($brands as $brand) {
            Brand::firstOrCreate(['slug' => $brand['slug']], array_merge($brand, [
                'status'           => 'active',
                'physical_address' => 'Rua do Progresso, 100, 4100-000 Porto, Portugal',
            ]));
        }

        $this->command->info('✅ ' . count($brands) . ' marcas criadas.');
    }
}
