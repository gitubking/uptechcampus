<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AnneeAcademique extends Model
{
    protected $table = 'annees_academiques';
    protected $fillable = ['libelle', 'date_debut', 'date_fin', 'actif'];
    protected $casts = ['date_debut' => 'date', 'date_fin' => 'date', 'actif' => 'boolean'];

    public function classes(): HasMany { return $this->hasMany(Classe::class); }
    public function inscriptions(): HasMany { return $this->hasMany(Inscription::class); }
    public function tarifs(): HasMany { return $this->hasMany(TarifIntervenant::class); }
    public function intervenants(): HasMany { return $this->hasMany(Intervenant::class); }

    protected static function booted(): void
    {
        static::saving(function (AnneeAcademique $annee) {
            if ($annee->actif) {
                static::where('id', '!=', $annee->id)->update(['actif' => false]);
            }
        });
    }
}
