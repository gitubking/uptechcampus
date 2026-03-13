<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('annees_academiques', function (Blueprint $table) {
            $table->id();
            $table->string('libelle'); // ex: "2025-2026"
            $table->date('date_debut');
            $table->date('date_fin');
            $table->boolean('actif')->default(false);
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('annees_academiques'); }
};
