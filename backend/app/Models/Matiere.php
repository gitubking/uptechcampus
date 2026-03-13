<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Matiere extends Model
{
    protected $fillable = ['nom', 'code', 'description', 'actif'];

    protected $casts = ['actif' => 'boolean'];

    public function filieres(): BelongsToMany
    {
        return $this->belongsToMany(Filiere::class, 'filiere_matiere')
                    ->withPivot('coefficient', 'credits', 'ordre')
                    ->withTimestamps();
    }

    public function unitesEnseignement(): HasMany
    {
        return $this->hasMany(UniteEnseignement::class);
    }
}
