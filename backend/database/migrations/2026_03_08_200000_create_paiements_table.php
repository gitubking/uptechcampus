<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('paiements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('inscription_id')->constrained()->cascadeOnDelete();
            $table->string('numero_recu')->unique();
            $table->enum('type_paiement', ['frais_inscription', 'mensualite', 'rattrapage']);
            $table->date('mois_concerne')->nullable();
            $table->decimal('montant', 10, 2);
            $table->enum('mode_paiement', ['wave', 'orange_money', 'especes', 'virement', 'cheque']);
            $table->enum('statut', ['confirme', 'en_attente', 'rejete'])->default('en_attente');
            $table->string('reference')->nullable();
            $table->text('observation')->nullable();
            $table->foreignId('created_by')->constrained('users');
            $table->foreignId('confirmed_by')->nullable()->constrained('users');
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('paiements');
    }
};
