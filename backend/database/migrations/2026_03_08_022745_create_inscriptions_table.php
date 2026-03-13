<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('inscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('etudiant_id')->constrained('etudiants');
            $table->foreignId('classe_id')->constrained('classes');
            $table->foreignId('parcours_id')->constrained('parcours');
            $table->foreignId('annee_academique_id')->constrained('annees_academiques');
            $table->enum('statut', ['pre_inscrit','en_examen','inscrit_actif','suspendu','abandonne','diplome'])->default('pre_inscrit');
            $table->decimal('frais_inscription', 10, 2)->default(0);
            $table->decimal('mensualite', 10, 2)->default(0);
            $table->enum('reduction_type', ['pourcentage','montant'])->nullable();
            $table->decimal('reduction_valeur', 10, 2)->nullable();
            $table->string('contrat_path')->nullable();
            $table->date('date_contrat_signe')->nullable();
            $table->date('date_validation')->nullable();
            $table->foreignId('validated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('inscription_precedente_id')->nullable()->constrained('inscriptions')->nullOnDelete();
            $table->foreignId('created_by')->constrained('users');
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('inscriptions'); }
};
