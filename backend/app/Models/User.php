<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\HasMany;

class User extends Authenticatable
{
    use HasApiTokens, Notifiable;

    protected $fillable = [
        'nom', 'prenom', 'email', 'password', 'telephone', 'photo_path',
        'role', 'statut', 'tentatives_echec', 'bloque_jusqu_a',
        'premier_connexion', 'cgu_acceptees', 'created_by', 'last_login_at',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected $casts = [
        'bloque_jusqu_a' => 'datetime',
        'last_login_at' => 'datetime',
        'premier_connexion' => 'boolean',
        'cgu_acceptees' => 'boolean',
    ];

    public function getFullNameAttribute(): string
    {
        return "{$this->prenom} {$this->nom}";
    }

    public function isBlocked(): bool
    {
        return $this->statut === 'bloque' ||
               ($this->bloque_jusqu_a && $this->bloque_jusqu_a->isFuture());
    }

    public function hasRole(string|array $roles): bool
    {
        if (is_array($roles)) {
            return in_array($this->role, $roles);
        }
        return $this->role === $roles;
    }

    public function intervenant(): HasOne
    {
        return $this->hasOne(Intervenant::class);
    }

    public function etudiant(): HasOne
    {
        return $this->hasOne(Etudiant::class);
    }
}
