<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Etudiant extends Model
{
    protected $fillable = [
        'numero_etudiant', 'user_id', 'nom', 'prenom', 'email',
        'telephone', 'photo_path', 'date_naissance', 'lieu_naissance',
        'adresse', 'cni_numero', 'nom_parent', 'telephone_parent'
    ];
    protected $casts = ['date_naissance' => 'date'];

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function inscriptions(): HasMany { return $this->hasMany(Inscription::class); }
    public function documents(): HasMany { return $this->hasMany(DocumentEtudiant::class); }
    public function inscriptionActive(): HasOne
    {
        return $this->hasOne(Inscription::class)->whereIn('statut', ['inscrit_actif', 'pre_inscrit', 'en_examen'])->latest();
    }

    public function getFullNameAttribute(): string
    {
        return "{$this->prenom} {$this->nom}";
    }
}
