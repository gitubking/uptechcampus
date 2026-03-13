<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('tarifs_intervenants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('type_formation_id')->constrained('types_formation');
            $table->foreignId('annee_academique_id')->constrained('annees_academiques');
            $table->decimal('montant_horaire', 10, 2);
            $table->date('date_effet');
            $table->foreignId('created_by')->constrained('users');
            $table->timestamps();
            $table->unique(['type_formation_id', 'annee_academique_id']);
        });
    }
    public function down(): void { Schema::dropIfExists('tarifs_intervenants'); }
};
