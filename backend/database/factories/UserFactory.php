<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

class UserFactory extends Factory
{
    protected static ?string $password;

    public function definition(): array
    {
        return [
            'nom'             => fake()->lastName(),
            'prenom'          => fake()->firstName(),
            'email'           => fake()->unique()->safeEmail(),
            'password'        => static::$password ??= Hash::make('Uptech@2026'),
            'telephone'       => fake()->optional()->phoneNumber(),
            'role'            => 'secretariat',
            'statut'          => 'actif',
            'premier_connexion' => false,
            'cgu_acceptees'   => true,
            'tentatives_echec' => 0,
        ];
    }

    public function dg(): static
    {
        return $this->state(['role' => 'dg']);
    }
}
