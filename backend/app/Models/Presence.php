<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Presence extends Model
{
    protected $fillable = [
        'seance_id', 'inscription_id', 'statut', 'heure_arrivee', 'note', 'created_by',
    ];

    public function seance(): BelongsTo { return $this->belongsTo(Seance::class); }
    public function inscription(): BelongsTo { return $this->belongsTo(Inscription::class); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
