<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('classe_id')->constrained()->cascadeOnDelete();
            $table->foreignId('intervenant_id')->nullable()->constrained()->nullOnDelete();
            $table->string('matiere');
            $table->dateTime('date_debut');
            $table->dateTime('date_fin');
            $table->enum('mode', ['presentiel', 'en_ligne', 'hybride', 'exam'])->default('presentiel');
            $table->string('salle')->nullable();
            $table->string('lien_visio')->nullable();
            $table->enum('statut', ['planifie', 'confirme', 'annule', 'reporte'])->default('planifie');
            $table->text('notes')->nullable();
            $table->foreignId('annee_academique_id')->nullable()->constrained('annees_academiques')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seances');
    }
};
