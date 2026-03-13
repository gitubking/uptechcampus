<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ParametreSysteme;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class ParametreController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(ParametreSysteme::orderBy('cle')->get());
    }

    public function update(Request $request, string $cle): JsonResponse
    {
        $request->validate(['valeur' => 'required|string']);
        $param = ParametreSysteme::firstOrCreate(['cle' => $cle], ['description' => '']);
        $avant = $param->toArray();
        $param->update(['valeur' => $request->valeur, 'updated_by' => $request->user()->id]);
        AuditService::log('parametre_updated', 'App\\Models\\ParametreSysteme', $param->id, $avant, $param->fresh()->toArray(), $request);
        return response()->json($param->fresh());
    }
}
