<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('filiere_matiere', function (Blueprint $table) {
            $table->id();
            $table->foreignId('filiere_id')->constrained('filieres')->cascadeOnDelete();
            $table->foreignId('matiere_id')->constrained('matieres')->cascadeOnDelete();
            $table->decimal('coefficient', 5, 2)->default(1);
            $table->integer('credits')->default(0);
            $table->integer('ordre')->default(0);
            $table->unique(['filiere_id', 'matiere_id']);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('filiere_matiere');
    }
};
