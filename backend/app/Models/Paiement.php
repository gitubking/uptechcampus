<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Paiement extends Model
{
    protected $fillable = [
        'inscription_id', 'numero_recu', 'type_paiement', 'mois_concerne',
        'montant', 'mode_paiement', 'statut', 'reference', 'observation',
        'created_by', 'confirmed_by', 'confirmed_at',
    ];

    protected $casts = [
        'montant'      => 'decimal:2',
        'mois_concerne' => 'date',
        'confirmed_at' => 'datetime',
    ];

    protected static function boot(): void
    {
        parent::boot();

        static::creating(function (Paiement $paiement) {
            if (empty($paiement->numero_recu)) {
                $year = now()->year;
                $last = static::whereYear('created_at', $year)->max('id') ?? 0;
                $seq  = str_pad($last + 1, 5, '0', STR_PAD_LEFT);
                $paiement->numero_recu = "RECU-{$year}-{$seq}";
            }
        });
    }

    public function inscription(): BelongsTo
    {
        return $this->belongsTo(Inscription::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function confirmedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'confirmed_by');
    }
}
