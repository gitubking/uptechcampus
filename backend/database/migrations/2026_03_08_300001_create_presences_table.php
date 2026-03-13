<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('presences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('seance_id')->constrained()->cascadeOnDelete();
            $table->foreignId('inscription_id')->constrained()->cascadeOnDelete();
            $table->enum('statut', ['present', 'retard', 'absent', 'excuse'])->default('absent');
            $table->time('heure_arrivee')->nullable();
            $table->text('note')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['seance_id', 'inscription_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('presences');
    }
};
