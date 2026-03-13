<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AuditLog extends Model
{
    public $timestamps = false;
    protected $table = 'audit_logs';
    protected $fillable = [
        'user_id', 'action', 'modele', 'modele_id',
        'donnees_avant', 'donnees_apres', 'ip_address', 'user_agent'
    ];
    protected $casts = [
        'donnees_avant' => 'array',
        'donnees_apres' => 'array',
        'created_at' => 'datetime',
    ];

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
}
