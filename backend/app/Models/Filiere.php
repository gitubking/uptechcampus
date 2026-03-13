<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Filiere extends Model
{
    protected $fillable = [
        'nom', 'code', 'description', 'actif', 'type_formation_id',
        'frais_inscription', 'mensualite', 'duree_mois',
    ];

    protected $casts = [
        'actif'             => 'boolean',
        'frais_inscription' => 'decimal:2',
        'mensualite'        => 'decimal:2',
        'duree_mois'        => 'integer',
    ];

    public function typeFormation(): BelongsTo { return $this->belongsTo(TypeFormation::class); }
    public function classes(): HasMany { return $this->hasMany(Classe::class); }
    public function intervenantFilieres(): HasMany { return $this->hasMany(IntervenantFiliere::class); }
    public function inscriptions(): HasMany { return $this->hasMany(Inscription::class); }

    public function matieres(): BelongsToMany
    {
        return $this->belongsToMany(Matiere::class, 'filiere_matiere')
                    ->withPivot('coefficient', 'credits', 'ordre')
                    ->withTimestamps()
                    ->orderBy('filiere_matiere.ordre');
    }
}
