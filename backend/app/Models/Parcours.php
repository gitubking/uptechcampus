<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Parcours extends Model
{
    protected $fillable = ['nom', 'code', 'type_formation_id', 'niveau_entree', 'diplome_vise', 'actif'];
    protected $casts = ['actif' => 'boolean'];

    public function typeFormation(): BelongsTo { return $this->belongsTo(TypeFormation::class); }
    public function classes(): BelongsToMany { return $this->belongsToMany(Classe::class, 'classes_parcours'); }
    public function inscriptions(): HasMany { return $this->hasMany(Inscription::class); }
}
