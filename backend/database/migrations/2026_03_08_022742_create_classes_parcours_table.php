<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('classes_parcours', function (Blueprint $table) {
            $table->foreignId('classe_id')->constrained('classes')->cascadeOnDelete();
            $table->foreignId('parcours_id')->constrained('parcours')->cascadeOnDelete();
            $table->primary(['classe_id', 'parcours_id']);
        });
    }
    public function down(): void { Schema::dropIfExists('classes_parcours'); }
};
