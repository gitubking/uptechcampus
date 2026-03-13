<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Seance extends Model
{
    protected $fillable = [
        'classe_id', 'intervenant_id', 'matiere', 'date_debut', 'date_fin',
        'mode', 'salle', 'lien_visio', 'statut', 'notes',
        'annee_academique_id', 'created_by',
    ];

    protected $casts = [
        'date_debut' => 'datetime',
        'date_fin'   => 'datetime',
    ];

    public function classe(): BelongsTo { return $this->belongsTo(Classe::class); }
    public function intervenant(): BelongsTo { return $this->belongsTo(Intervenant::class); }
    public function anneeAcademique(): BelongsTo { return $this->belongsTo(AnneeAcademique::class); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function presences(): HasMany { return $this->hasMany(Presence::class); }
}
