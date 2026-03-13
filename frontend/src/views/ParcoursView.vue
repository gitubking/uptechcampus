<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const canWrite = auth.user?.role === 'dg'

interface TypeFormation { id: number; nom: string; code: string }
interface Parcours {
  id: number
  nom: string
  code: string
  niveau_entree: string | null
  diplome_vise: string | null
  actif: boolean
  type_formation?: TypeFormation
}

const parcours = ref<Parcours[]>([])
const typesFormation = ref<TypeFormation[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)
const editTarget = ref<Parcours | null>(null)

const form = ref({
  nom: '',
  code: '',
  type_formation_id: null as number | null,
  niveau_entree: '',
  diplome_vise: '',
  actif: true,
})

function openCreate() {
  editTarget.value = null
  form.value = {
    nom: '',
    code: '',
    type_formation_id: typesFormation.value[0]?.id ?? null,
    niveau_entree: '',
    diplome_vise: '',
    actif: true,
  }
  error.value = ''
  showForm.value = true
}

function openEdit(p: Parcours) {
  editTarget.value = p
  form.value = {
    nom: p.nom,
    code: p.code,
    type_formation_id: p.type_formation?.id ?? null,
    niveau_entree: p.niveau_entree ?? '',
    diplome_vise: p.diplome_vise ?? '',
    actif: p.actif,
  }
  error.value = ''
  showForm.value = true
}

async function load() {
  loading.value = true
  try {
    const [p, tf] = await Promise.all([
      api.get('/parcours'),
      api.get('/types-formation'),
    ])
    parcours.value = p.data
    typesFormation.value = tf.data
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (editTarget.value) {
      const { data } = await api.put(`/parcours/${editTarget.value.id}`, form.value)
      const idx = parcours.value.findIndex(p => p.id === data.id)
      if (idx !== -1) parcours.value[idx] = data
    } else {
      const { data } = await api.post('/parcours', form.value)
      parcours.value.push(data)
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
  <div class="p-6 max-w-5xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-gray-900">Parcours</h1>
        <p class="text-sm text-gray-500 mt-0.5">Formations proposées par type (FC, FI, FA…)</p>
      </div>
      <button v-if="canWrite" @click="openCreate"
        class="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Nouveau parcours
      </button>
    </div>

    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div v-if="loading" class="p-12 text-center text-gray-400 text-sm">Chargement…</div>
      <div v-else-if="parcours.length === 0" class="p-12 text-center">
        <p class="text-gray-500 text-sm">Aucun parcours défini</p>
      </div>
      <table v-else class="w-full">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Parcours</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Code</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type de formation</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Niveau d'entrée</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Diplôme visé</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Statut</th>
            <th v-if="canWrite" class="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="p in parcours" :key="p.id" class="hover:bg-gray-50 transition">
            <td class="px-5 py-3.5">
              <span class="text-sm font-semibold text-gray-900">{{ p.nom }}</span>
            </td>
            <td class="px-5 py-3.5">
              <span class="text-xs font-mono font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{{ p.code }}</span>
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-600">{{ p.type_formation?.nom ?? '—' }}</td>
            <td class="px-5 py-3.5 text-sm text-gray-600">{{ p.niveau_entree ?? '—' }}</td>
            <td class="px-5 py-3.5 text-sm text-gray-600">{{ p.diplome_vise ?? '—' }}</td>
            <td class="px-5 py-3.5">
              <span :class="p.actif ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
                class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium">
                {{ p.actif ? 'Actif' : 'Inactif' }}
              </span>
            </td>
            <td v-if="canWrite" class="px-5 py-3.5 text-right">
              <button @click="openEdit(p)" title="Modifier"
                class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
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
        <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
          <h2 class="text-base font-semibold text-gray-900 mb-4">
            {{ editTarget ? 'Modifier le parcours' : 'Nouveau parcours' }}
          </h2>
          <div v-if="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{{ error }}</div>
          <form @submit.prevent="save" class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div class="col-span-2">
                <label class="block text-xs font-medium text-gray-700 mb-1">Nom du parcours <span class="text-red-500">*</span></label>
                <input v-model="form.nom" required placeholder="ex: BTS Systèmes Informatiques et Numériques"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Code <span class="text-red-500">*</span></label>
                <input v-model="form.code" required placeholder="ex: BTS-SIN"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Type de formation <span class="text-red-500">*</span></label>
                <select v-model="form.type_formation_id" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option v-for="tf in typesFormation" :key="tf.id" :value="tf.id">{{ tf.nom }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Niveau d'entrée</label>
                <input v-model="form.niveau_entree" placeholder="ex: Bac, BEP, Licence…"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Diplôme visé</label>
                <input v-model="form.diplome_vise" placeholder="ex: BTS, Licence Pro…"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
            </div>
            <label v-if="editTarget" class="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" v-model="form.actif"
                class="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500" />
              <span class="text-sm text-gray-700">Parcours actif</span>
            </label>
            <div class="flex gap-3 pt-2">
              <button type="button" @click="showForm = false"
                class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition">Annuler</button>
              <button type="submit" :disabled="saving"
                class="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition">
                {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
