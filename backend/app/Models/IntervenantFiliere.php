<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IntervenantFiliere extends Model
{
    protected $table = 'intervenant_filieres';
    protected $fillable = ['intervenant_id', 'filiere_id', 'matiere'];

    public function intervenant(): BelongsTo { return $this->belongsTo(Intervenant::class); }
    public function filiere(): BelongsTo { return $this->belongsTo(Filiere::class); }
}
