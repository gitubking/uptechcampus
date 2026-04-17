<?php

namespace Tests\Feature;

use App\Models\Parcours;
use App\Models\TypeFormation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ParcoursUpdateTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private TypeFormation $typeFormation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::factory()->dg()->create();
        $this->typeFormation = TypeFormation::firstOrCreate(
            ['code' => 'FI'],
            ['nom' => 'Formation Initiale', 'code' => 'FI']
        );
    }

    private function createParcours(array $attrs = []): Parcours
    {
        return Parcours::create(array_merge([
            'nom'               => 'BTS SIO',
            'code'              => 'BTS-SIO-' . uniqid(),
            'type_formation_id' => $this->typeFormation->id,
            'niveau_entree'     => 'Bac',
            'diplome_vise'      => 'BTS',
            'actif'             => true,
        ], $attrs));
    }

    public function test_actif_checkbox_persists_after_save(): void
    {
        $parcours = $this->createParcours(['actif' => true]);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/parcours/{$parcours->id}", [
                'nom'               => $parcours->nom,
                'code'              => $parcours->code,
                'type_formation_id' => $parcours->type_formation_id,
                'actif'             => false,
            ])
            ->assertOk()
            ->assertJsonPath('actif', false);

        $parcours->refresh();
        $this->assertFalse((bool) $parcours->actif);
    }

    public function test_actif_true_persists_after_save(): void
    {
        $parcours = $this->createParcours(['actif' => false]);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/parcours/{$parcours->id}", [
                'nom'               => $parcours->nom,
                'code'              => $parcours->code,
                'type_formation_id' => $parcours->type_formation_id,
                'actif'             => true,
            ])
            ->assertOk()
            ->assertJsonPath('actif', true);

        $parcours->refresh();
        $this->assertTrue((bool) $parcours->actif);
    }

    public function test_niveau_entree_persists_after_save(): void
    {
        $parcours = $this->createParcours(['niveau_entree' => 'Bac']);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/parcours/{$parcours->id}", [
                'nom'               => $parcours->nom,
                'code'              => $parcours->code,
                'type_formation_id' => $parcours->type_formation_id,
                'niveau_entree'     => 'Bac+2',
                'actif'             => true,
            ])
            ->assertOk();

        $parcours->refresh();
        $this->assertEquals('Bac+2', $parcours->niveau_entree);
    }

    public function test_diplome_vise_persists_after_save(): void
    {
        $parcours = $this->createParcours(['diplome_vise' => 'BTS']);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/parcours/{$parcours->id}", [
                'nom'               => $parcours->nom,
                'code'              => $parcours->code,
                'type_formation_id' => $parcours->type_formation_id,
                'diplome_vise'      => 'Licence Pro',
                'actif'             => true,
            ])
            ->assertOk();

        $parcours->refresh();
        $this->assertEquals('Licence Pro', $parcours->diplome_vise);
    }

    public function test_all_fields_update_together(): void
    {
        $parcours = $this->createParcours([
            'niveau_entree' => 'Bac',
            'diplome_vise'  => 'BTS',
            'actif'         => true,
        ]);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/parcours/{$parcours->id}", [
                'nom'               => 'BTS Modifié',
                'code'              => $parcours->code,
                'type_formation_id' => $parcours->type_formation_id,
                'niveau_entree'     => 'Bac+2',
                'diplome_vise'      => 'Licence Pro',
                'actif'             => false,
            ])
            ->assertOk();

        $parcours->refresh();
        $this->assertEquals('BTS Modifié', $parcours->nom);
        $this->assertEquals('Bac+2', $parcours->niveau_entree);
        $this->assertEquals('Licence Pro', $parcours->diplome_vise);
        $this->assertFalse((bool) $parcours->actif);
    }
}
