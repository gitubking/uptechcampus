<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TarifIntervenant extends Model
{
    protected $table = 'tarifs_intervenants';
    protected $fillable = ['type_formation_id', 'annee_academique_id', 'montant_horaire', 'date_effet', 'created_by'];
    protected $casts = ['date_effet' => 'date', 'montant_horaire' => 'decimal:2'];

    public function typeFormation(): BelongsTo { return $this->belongsTo(TypeFormation::class); }
    public function anneeAcademique(): BelongsTo { return $this->belongsTo(AnneeAcademique::class); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
