<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Note extends Model
{
    protected $fillable = [
        'inscription_id', 'ue_id', 'semestre',
        'note_controle', 'note_examen', 'note_rattrapage', 'moyenne',
        'created_by',
    ];

    protected $casts = [
        'note_controle'   => 'decimal:2',
        'note_examen'     => 'decimal:2',
        'note_rattrapage' => 'decimal:2',
        'moyenne'         => 'decimal:2',
        'semestre'        => 'integer',
    ];

    public function ue(): BelongsTo { return $this->belongsTo(UniteEnseignement::class, 'ue_id'); }
    public function inscription(): BelongsTo { return $this->belongsTo(Inscription::class); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    /**
     * Calcule et retourne la moyenne finale (avec rattrapage si meilleur).
     */
    public function calculerMoyenne(): float
    {
        $controle = $this->note_controle ?? $this->note_examen;
        $examen   = $this->note_examen   ?? $this->note_controle;

        if ($controle === null && $examen === null) {
            return 0;
        }

        $moyenne = ($controle + $examen) / 2;

        if ($this->note_rattrapage !== null && $this->note_rattrapage > $moyenne) {
            return round((float) $this->note_rattrapage, 2);
        }

        return round((float) $moyenne, 2);
    }

    /**
     * Recalcule et sauvegarde la moyenne.
     */
    public function recalculerEtSauvegarder(): void
    {
        $this->update(['moyenne' => $this->calculerMoyenne()]);
    }
}
