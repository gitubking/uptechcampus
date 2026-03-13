<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class NiveauBourse extends Model
{
    protected $table = 'niveaux_bourse';

    protected $fillable = ['nom', 'pourcentage', 'applique_inscription', 'actif'];

    protected $casts = [
        'pourcentage'          => 'decimal:2',
        'applique_inscription' => 'boolean',
        'actif'                => 'boolean',
    ];

    public function inscriptions(): HasMany
    {
        return $this->hasMany(Inscription::class);
    }
}
