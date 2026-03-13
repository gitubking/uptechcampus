<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('intervenants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users');
            $table->string('numero_contrat')->unique(); // CONT-AAAA-XXXXX
            $table->string('nom');
            $table->string('prenom');
            $table->string('email')->unique();
            $table->string('telephone', 20)->nullable();
            $table->string('photo_path')->nullable();
            $table->string('cv_path')->nullable();
            $table->enum('statut', ['actif','inactif','en_attente','suspendu'])->default('en_attente');
            $table->foreignId('annee_academique_id')->constrained('annees_academiques');
            $table->foreignId('created_by')->constrained('users');
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('intervenants'); }
};
