<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Inscription extends Model
{
    protected $fillable = [
        'etudiant_id', 'filiere_id', 'niveau_entree_id', 'niveau_bourse_id',
        'classe_id', 'parcours_id', 'annee_academique_id',
        'statut', 'acces_bloque',
        'frais_inscription', 'mensualite', 'frais_tenue',
        'reduction_type', 'reduction_valeur',
        'contrat_path', 'date_contrat_signe', 'date_validation',
        'validated_by', 'inscription_precedente_id', 'created_by'
    ];

    protected $casts = [
        'date_contrat_signe' => 'date',
        'date_validation'    => 'date',
        'frais_inscription'  => 'decimal:2',
        'mensualite'         => 'decimal:2',
        'frais_tenue'        => 'decimal:2',
        'reduction_valeur'   => 'decimal:2',
        'acces_bloque'       => 'boolean',
    ];

    public function etudiant(): BelongsTo { return $this->belongsTo(Etudiant::class); }
    public function filiere(): BelongsTo { return $this->belongsTo(Filiere::class); }
    public function niveauEntree(): BelongsTo { return $this->belongsTo(NiveauEntree::class); }
    public function niveauBourse(): BelongsTo { return $this->belongsTo(NiveauBourse::class); }
    public function classe(): BelongsTo { return $this->belongsTo(Classe::class); }
    public function parcours(): BelongsTo { return $this->belongsTo(Parcours::class); }
    public function anneeAcademique(): BelongsTo { return $this->belongsTo(AnneeAcademique::class); }
    public function validatedBy(): BelongsTo { return $this->belongsTo(User::class, 'validated_by'); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function inscriptionPrecedente(): BelongsTo { return $this->belongsTo(Inscription::class, 'inscription_precedente_id'); }
    public function documents(): HasMany { return $this->hasMany(DocumentEtudiant::class); }
    public function paiements(): HasMany { return $this->hasMany(Paiement::class); }
    public function presences(): HasMany { return $this->hasMany(Presence::class); }
    public function notes(): HasMany { return $this->hasMany(Note::class); }

    public function getMensualiteEffectiveAttribute(): float
    {
        if (!$this->reduction_type) return (float) $this->mensualite;
        if ($this->reduction_type === 'pourcentage') {
            return $this->mensualite * (1 - $this->reduction_valeur / 100);
        }
        return max(0, $this->mensualite - $this->reduction_valeur);
    }
}
