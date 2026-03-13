<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('types_formation', function (Blueprint $table) {
            $table->id();
            $table->string('nom'); // Académique, Certifiée, Accélérée
            $table->string('code')->unique();
            $table->string('diplome_vise')->nullable();
            $table->string('duree_description')->nullable();
            $table->string('public_cible')->nullable();
            $table->boolean('actif')->default(true);
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('types_formation'); }
};
