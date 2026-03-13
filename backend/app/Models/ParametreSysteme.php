<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ParametreSysteme extends Model
{
    protected $table = 'parametres_systeme';
    protected $fillable = ['cle', 'groupe', 'valeur', 'description', 'updated_by'];

    public function updatedBy(): BelongsTo { return $this->belongsTo(User::class, 'updated_by'); }

    public static function get(string $cle, mixed $default = null): mixed
    {
        $param = static::where('cle', $cle)->first();
        return $param ? $param->valeur : $default;
    }
}
