<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UniteEnseignement extends Model
{
    protected $table = 'unites_enseignement';

    protected $fillable = [
        'classe_id', 'intervenant_id', 'code', 'intitule', 'coefficient', 'credits_ects', 'ordre',
    ];

    protected $casts = [
        'coefficient'  => 'decimal:2',
        'credits_ects' => 'integer',
        'ordre'        => 'integer',
    ];

    public function classe(): BelongsTo { return $this->belongsTo(Classe::class); }
    public function intervenant(): BelongsTo { return $this->belongsTo(Intervenant::class); }
    public function notes(): HasMany { return $this->hasMany(Note::class, 'ue_id'); }
}
