<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('documents_etudiant', function (Blueprint $table) {
            $table->id();
            $table->foreignId('etudiant_id')->constrained('etudiants')->cascadeOnDelete();
            $table->foreignId('inscription_id')->nullable()->constrained('inscriptions')->nullOnDelete();
            $table->enum('type_document', ['cni','passeport','photo','diplome','bulletin_naissance','contrat_signe','autre']);
            $table->string('fichier_path');
            $table->string('nom_fichier');
            $table->unsignedBigInteger('taille_fichier')->nullable();
            $table->enum('statut', ['present','manquant','expire'])->default('present');
            $table->foreignId('uploaded_by')->constrained('users');
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('documents_etudiant'); }
};
