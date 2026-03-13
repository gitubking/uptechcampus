<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Classe extends Model
{
    protected $fillable = [
        'nom', 'filiere_id', 'annee_academique_id',
        'est_tronc_commun', 'tarif_applique_id', 'created_by'
    ];
    protected $casts = ['est_tronc_commun' => 'boolean'];

    public function filiere(): BelongsTo { return $this->belongsTo(Filiere::class); }
    public function anneeAcademique(): BelongsTo { return $this->belongsTo(AnneeAcademique::class); }
    public function tarifApplique(): BelongsTo { return $this->belongsTo(TarifIntervenant::class, 'tarif_applique_id'); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function parcours(): BelongsToMany { return $this->belongsToMany(Parcours::class, 'classes_parcours'); }
    public function inscriptions(): HasMany { return $this->hasMany(Inscription::class); }
    public function seances(): HasMany { return $this->hasMany(Seance::class); }
    public function unitesEnseignement(): HasMany { return $this->hasMany(UniteEnseignement::class); }

    public function updateTroncCommun(): void
    {
        $parcoursList = $this->parcours()->with('typeFormation.tarifs')->get();
        $anneeId = $this->annee_academique_id;
        $tarifs = $parcoursList->map(function ($p) use ($anneeId) {
            return $p->typeFormation->tarifs->where('annee_academique_id', $anneeId)->first();
        })->filter()->unique('id');

        if ($tarifs->count() > 1) {
            $maxTarif = $tarifs->sortByDesc('montant_horaire')->first();
            $this->update(['est_tronc_commun' => true, 'tarif_applique_id' => $maxTarif->id]);
        } else {
            $this->update(['est_tronc_commun' => false, 'tarif_applique_id' => $tarifs->first()?->id]);
        }
    }
}
