<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('intervenant_filieres', function (Blueprint $table) {
            $table->id();
            $table->foreignId('intervenant_id')->constrained('intervenants')->cascadeOnDelete();
            $table->foreignId('filiere_id')->constrained('filieres')->cascadeOnDelete();
            $table->string('matiere');
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('intervenant_filieres'); }
};
