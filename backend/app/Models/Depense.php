<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Depense extends Model
{
    protected $fillable = [
        'libelle', 'categorie', 'montant', 'mode_paiement', 'statut',
        'beneficiaire', 'reference_facture', 'notes', 'justificatif_path',
        'annee_academique_id', 'date_depense',
        'created_by', 'validated_by', 'validated_at',
    ];

    protected $casts = [
        'montant'      => 'decimal:2',
        'date_depense' => 'date',
        'validated_at' => 'datetime',
    ];

    public function anneeAcademique(): BelongsTo
    {
        return $this->belongsTo(AnneeAcademique::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function validatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'validated_by');
    }
}
