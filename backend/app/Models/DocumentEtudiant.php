<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocumentEtudiant extends Model
{
    protected $table = 'documents_etudiant';
    protected $fillable = [
        'etudiant_id', 'inscription_id', 'type_document',
        'fichier_path', 'nom_fichier', 'taille_fichier', 'statut', 'uploaded_by'
    ];

    public function etudiant(): BelongsTo { return $this->belongsTo(Etudiant::class); }
    public function inscription(): BelongsTo { return $this->belongsTo(Inscription::class); }
    public function uploadedBy(): BelongsTo { return $this->belongsTo(User::class, 'uploaded_by'); }
}
