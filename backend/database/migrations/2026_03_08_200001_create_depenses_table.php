<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('depenses', function (Blueprint $table) {
            $table->id();
            $table->string('libelle');
            $table->string('categorie'); // loyer_charges, salaires, materiel, fournitures, internet_tel, entretien, communication, autre
            $table->decimal('montant', 10, 2);
            $table->string('mode_paiement'); // virement, wave, orange_money, especes, cheque, prelevement
            $table->enum('statut', ['validee', 'en_attente', 'rejetee'])->default('en_attente');
            $table->string('beneficiaire')->nullable();
            $table->string('reference_facture')->nullable();
            $table->text('notes')->nullable();
            $table->string('justificatif_path')->nullable();
            $table->foreignId('annee_academique_id')->nullable()->constrained('annees_academiques')->nullOnDelete();
            $table->date('date_depense');
            $table->foreignId('created_by')->constrained('users');
            $table->foreignId('validated_by')->nullable()->constrained('users');
            $table->timestamp('validated_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('depenses');
    }
};
