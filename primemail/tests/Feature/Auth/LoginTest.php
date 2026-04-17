<?php

namespace Tests\Feature\Auth;

use App\Models\Brand;
use App\Models\Role;
use App\Models\User;
use App\Models\UserBrandRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class LoginTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_screen_can_be_rendered(): void
    {
        $response = $this->get('/login');
        $response->assertStatus(200);
    }

    public function test_user_can_authenticate_with_valid_credentials(): void
    {
        $this->seedMinimalRoles();
        $user = User::factory()->create(['password' => Hash::make('senha123')]);
        $this->assignRoleOnBrand($user);

        $response = $this->post('/login', [
            'email'    => $user->email,
            'password' => 'senha123',
        ]);

        $this->assertAuthenticatedAs($user);
        $response->assertRedirect();
    }

    public function test_invalid_credentials_fail(): void
    {
        $this->seedMinimalRoles();
        $user = User::factory()->create(['password' => Hash::make('correta')]);

        $response = $this->post('/login', [
            'email'    => $user->email,
            'password' => 'errada',
        ]);

        $response->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_rate_limit_after_5_failed_attempts(): void
    {
        $this->seedMinimalRoles();
        $user = User::factory()->create();
        RateLimiter::clear($user->email . '|127.0.0.1');

        for ($i = 0; $i < 5; $i++) {
            $this->post('/login', ['email' => $user->email, 'password' => 'errada']);
        }

        $response = $this->post('/login', ['email' => $user->email, 'password' => 'errada']);

        $response->assertSessionHasErrors('email');
        $errors = session('errors')->get('email');
        $this->assertStringContainsString('seconds', strtolower(json_encode($errors)));
    }

    public function test_user_with_single_brand_is_redirected_to_dashboard(): void
    {
        $this->seedMinimalRoles();
        $user = User::factory()->create(['password' => Hash::make('ok')]);
        $this->assignRoleOnBrand($user);

        $response = $this->post('/login', ['email' => $user->email, 'password' => 'ok']);

        $response->assertRedirect(route('dashboard', absolute: false));
        $this->assertNotNull(session('active_brand_id'));
    }

    public function test_user_with_multiple_brands_goes_to_selector(): void
    {
        $this->seedMinimalRoles();
        $user = User::factory()->create(['password' => Hash::make('ok')]);
        $this->assignRoleOnBrand($user);
        $this->assignRoleOnBrand($user, brandName: 'BMW Teste', slug: 'bmw-test');

        $response = $this->post('/login', ['email' => $user->email, 'password' => 'ok']);

        $response->assertRedirect(route('brands.select'));
        $this->assertNull(session('active_brand_id'));
    }

    private function seedMinimalRoles(): void
    {
        Role::firstOrCreate(['name' => 'super_admin'], ['display_name' => 'Super Admin']);
    }

    private function assignRoleOnBrand(User $user, string $brandName = 'Caetano Teste', string $slug = 'caetano-test'): void
    {
        $brand = Brand::firstOrCreate(
            ['slug' => $slug],
            ['name' => $brandName, 'primary_color' => '#1A1A2E']
        );
        $role = Role::where('name', 'super_admin')->first();

        UserBrandRole::firstOrCreate([
            'user_id'  => $user->id,
            'brand_id' => $brand->id,
            'role_id'  => $role->id,
        ]);
    }
}
