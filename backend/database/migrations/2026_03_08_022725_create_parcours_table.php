<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('parcours', function (Blueprint $table) {
            $table->id();
            $table->string('nom'); // BTS, DTS, Licence, Master, DAP...
            $table->string('code')->unique();
            $table->foreignId('type_formation_id')->constrained('types_formation');
            $table->string('niveau_entree')->nullable(); // BAC, BAC+2, CFEE...
            $table->string('diplome_vise')->nullable();
            $table->boolean('actif')->default(true);
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('parcours'); }
};
