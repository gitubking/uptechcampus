<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('classes', function (Blueprint $table) {
            $table->id();
            $table->string('nom');
            $table->foreignId('filiere_id')->constrained('filieres');
            $table->foreignId('annee_academique_id')->constrained('annees_academiques');
            $table->boolean('est_tronc_commun')->default(false);
            $table->foreignId('tarif_applique_id')->nullable()->constrained('tarifs_intervenants')->nullOnDelete();
            $table->foreignId('created_by')->constrained('users');
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('classes'); }
};
