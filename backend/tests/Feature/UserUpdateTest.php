<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserUpdateTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::factory()->dg()->create();
    }

    public function test_admin_can_update_user_role(): void
    {
        $user = User::factory()->create(['role' => 'secretariat']);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/users/{$user->id}", [
                'nom'    => $user->nom,
                'prenom' => $user->prenom,
                'email'  => $user->email,
                'role'   => 'coordinateur',
                'statut' => 'actif',
            ]);

        $response->assertOk();
        $this->assertDatabaseHas('users', [
            'id'   => $user->id,
            'role' => 'coordinateur',
        ]);
        $response->assertJsonPath('role', 'coordinateur');
    }

    public function test_role_is_not_silently_ignored_on_update(): void
    {
        $user = User::factory()->create(['role' => 'secretariat']);
        $originalRole = $user->role;

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/users/{$user->id}", [
                'nom'    => $user->nom,
                'prenom' => $user->prenom,
                'email'  => $user->email,
                'role'   => 'dir_peda',
                'statut' => 'actif',
            ])
            ->assertOk();

        $user->refresh();
        $this->assertNotEquals($originalRole, $user->role);
        $this->assertEquals('dir_peda', $user->role);
    }

    public function test_invalid_role_is_rejected(): void
    {
        $user = User::factory()->create(['role' => 'secretariat']);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/users/{$user->id}", [
                'nom'    => $user->nom,
                'prenom' => $user->prenom,
                'email'  => $user->email,
                'role'   => 'super_admin',
            ])
            ->assertUnprocessable();

        $user->refresh();
        $this->assertEquals('secretariat', $user->role);
    }

    public function test_update_preserves_other_fields_when_only_role_changes(): void
    {
        $user = User::factory()->create([
            'role'   => 'secretariat',
            'statut' => 'actif',
        ]);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/users/{$user->id}", [
                'nom'    => $user->nom,
                'prenom' => $user->prenom,
                'email'  => $user->email,
                'role'   => 'coordinateur',
                'statut' => 'actif',
            ])
            ->assertOk();

        $user->refresh();
        $this->assertEquals('coordinateur', $user->role);
        $this->assertEquals('actif', $user->statut);
        $this->assertEquals($user->nom, $user->nom);
    }

    public function test_update_statut_works(): void
    {
        $user = User::factory()->create(['statut' => 'actif']);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/users/{$user->id}", [
                'nom'    => $user->nom,
                'prenom' => $user->prenom,
                'email'  => $user->email,
                'role'   => $user->role,
                'statut' => 'suspendu',
            ])
            ->assertOk()
            ->assertJsonPath('statut', 'suspendu');

        $this->assertDatabaseHas('users', ['id' => $user->id, 'statut' => 'suspendu']);
    }

    public function test_non_dg_cannot_update_users(): void
    {
        $coordinator = User::factory()->create(['role' => 'coordinateur']);
        $target = User::factory()->create(['role' => 'secretariat']);

        $this->actingAs($coordinator, 'sanctum')
            ->putJson("/api/users/{$target->id}", [
                'nom'  => $target->nom,
                'role' => 'dg',
            ])
            ->assertForbidden();

        $target->refresh();
        $this->assertEquals('secretariat', $target->role);
    }
}
