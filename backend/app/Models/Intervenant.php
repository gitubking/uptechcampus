<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Intervenant extends Model
{
    protected $fillable = [
        'user_id', 'numero_contrat', 'nom', 'prenom', 'email',
        'telephone', 'photo_path', 'cv_path',
        'statut', 'annee_academique_id', 'created_by'
    ];

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function anneeAcademique(): BelongsTo { return $this->belongsTo(AnneeAcademique::class); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function filieres(): HasMany { return $this->hasMany(IntervenantFiliere::class); }

    public function getFullNameAttribute(): string
    {
        return "{$this->prenom} {$this->nom}";
    }
}
