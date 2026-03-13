<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class NiveauEntree extends Model
{
    protected $table = 'niveaux_entree';

    protected $fillable = ['nom', 'code', 'est_superieur_bac', 'ordre', 'actif'];

    protected $casts = [
        'est_superieur_bac' => 'boolean',
        'actif'             => 'boolean',
        'ordre'             => 'integer',
    ];

    public function inscriptions(): HasMany
    {
        return $this->hasMany(Inscription::class);
    }
}
