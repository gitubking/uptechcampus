<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('etudiants', function (Blueprint $table) {
            $table->id();
            $table->string('numero_etudiant')->unique(); // UPTECH-AAAA-XXX
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('nom');
            $table->string('prenom');
            $table->string('email')->unique();
            $table->string('telephone', 20)->nullable();
            $table->string('photo_path')->nullable();
            $table->date('date_naissance')->nullable();
            $table->string('lieu_naissance')->nullable();
            $table->string('adresse')->nullable();
            $table->string('cni_numero')->nullable();
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('etudiants'); }
};
