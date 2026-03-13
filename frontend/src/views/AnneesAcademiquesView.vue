<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '@/services/api'

interface AnneeAcademique {
  id: number
  libelle: string
  date_debut: string
  date_fin: string
  actif: boolean
}

const annees = ref<AnneeAcademique[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)
const editTarget = ref<AnneeAcademique | null>(null)

const form = ref({
  libelle: '',
  date_debut: '',
  date_fin: '',
  actif: false,
})

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function openCreate() {
  editTarget.value = null
  form.value = { libelle: '', date_debut: '', date_fin: '', actif: false }
  error.value = ''
  showForm.value = true
}

function openEdit(a: AnneeAcademique) {
  editTarget.value = a
  form.value = { libelle: a.libelle, date_debut: a.date_debut, date_fin: a.date_fin, actif: a.actif }
  error.value = ''
  showForm.value = true
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/annees-academiques')
    annees.value = data
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (editTarget.value) {
      const { data } = await api.put(`/annees-academiques/${editTarget.value.id}`, form.value)
      const idx = annees.value.findIndex(a => a.id === data.id)
      if (idx !== -1) annees.value[idx] = data
      // Si actif mis à true, les autres doivent être false (géré côté serveur)
      if (data.actif) annees.value.forEach(a => { if (a.id !== data.id) a.actif = false })
    } else {
      const { data } = await api.post('/annees-academiques', form.value)
      if (data.actif) annees.value.forEach(a => { a.actif = false })
      annees.value.unshift(data)
    }
    showForm.value = false
  } catch (e: any) {
    const errs = e.response?.data?.errors as Record<string, string[]> | undefined
    error.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? e.response?.data?.message ?? 'Erreur'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="p-6 max-w-3xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-gray-900">Années académiques</h1>
        <p class="text-sm text-gray-500 mt-0.5">Gestion des périodes scolaires</p>
      </div>
      <button @click="openCreate"
        class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Nouvelle année
      </button>
    </div>

    <div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-5 text-sm text-yellow-700">
      <strong>Règle :</strong> Une seule année peut être active à la fois. Activer une année désactive automatiquement la précédente.
    </div>

    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div v-if="loading" class="p-12 text-center text-gray-400 text-sm">Chargement…</div>
      <div v-else-if="annees.length === 0" class="p-12 text-center">
        <p class="text-gray-500 text-sm">Aucune année académique configurée</p>
      </div>
      <table v-else class="w-full">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Libellé</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Début</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fin</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Statut</th>
            <th class="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="a in annees" :key="a.id" class="hover:bg-gray-50 transition">
            <td class="px-5 py-3.5">
              <span class="text-sm font-semibold text-gray-900">{{ a.libelle }}</span>
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-600">{{ formatDate(a.date_debut) }}</td>
            <td class="px-5 py-3.5 text-sm text-gray-600">{{ formatDate(a.date_fin) }}</td>
            <td class="px-5 py-3.5">
              <span v-if="a.actif"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                Active
              </span>
              <span v-else class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                Archivée
              </span>
            </td>
            <td class="px-5 py-3.5 text-right">
              <button @click="openEdit(a)" title="Modifier"
                class="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40" @click="showForm = false" />
        <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
          <h2 class="text-base font-semibold text-gray-900 mb-4">
            {{ editTarget ? 'Modifier l\'année' : 'Nouvelle année académique' }}
          </h2>
          <div v-if="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{{ error }}</div>
          <form @submit.prevent="save" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Libellé <span class="text-red-500">*</span></label>
              <input v-model="form.libelle" required placeholder="ex: 2025-2026"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Date de début <span class="text-red-500">*</span></label>
                <input v-model="form.date_debut" type="date" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Date de fin <span class="text-red-500">*</span></label>
                <input v-model="form.date_fin" type="date" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <label class="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" v-model="form.actif"
                class="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
              <span class="text-sm text-gray-700">Définir comme année active</span>
            </label>
            <div class="flex gap-3 pt-2">
              <button type="button" @click="showForm = false"
                class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition">Annuler</button>
              <button type="submit" :disabled="saving"
                class="flex-1 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
                {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
