<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Annonce extends Model
{
    protected $fillable = [
        'titre', 'type', 'contenu', 'destinataires', 'canaux',
        'statut', 'epingle', 'publie_at', 'created_by',
    ];

    protected $casts = [
        'destinataires' => 'array',
        'canaux'        => 'array',
        'epingle'       => 'boolean',
        'publie_at'     => 'datetime',
    ];

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
