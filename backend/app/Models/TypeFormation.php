<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TypeFormation extends Model
{
    protected $table = 'types_formation';
    protected $fillable = ['nom', 'code', 'diplome_vise', 'duree_description', 'public_cible', 'actif'];
    protected $casts = ['actif' => 'boolean'];

    public function parcours(): HasMany { return $this->hasMany(Parcours::class); }
    public function tarifs(): HasMany { return $this->hasMany(TarifIntervenant::class); }
    public function filieres(): HasMany { return $this->hasMany(Filiere::class); }
}
