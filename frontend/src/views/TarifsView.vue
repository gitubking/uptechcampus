<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '@/services/api'

interface TypeFormation { id: number; nom: string; code: string }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }
interface Tarif {
  id: number
  montant_horaire: number
  date_effet: string
  type_formation?: TypeFormation
  annee_academique?: AnneeAcademique
}

const tarifs = ref<Tarif[]>([])
const typesFormation = ref<TypeFormation[]>([])
const annees = ref<AnneeAcademique[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)

const form = ref({
  type_formation_id: null as number | null,
  annee_academique_id: null as number | null,
  montant_horaire: 0,
  date_effet: new Date().toISOString().split('T')[0],
})

function formatAmount(n: number) {
  return new Intl.NumberFormat('fr-FR').format(n) + ' FCFA/h'
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function openCreate() {
  const anneeActive = annees.value.find(a => a.actif)
  form.value = {
    type_formation_id: typesFormation.value[0]?.id ?? null,
    annee_academique_id: anneeActive?.id ?? annees.value[0]?.id ?? null,
    montant_horaire: 0,
    date_effet: new Date().toISOString().split('T')[0],
  }
  error.value = ''
  showForm.value = true
}

async function load() {
  loading.value = true
  try {
    const [t, tf, a] = await Promise.all([
      api.get('/tarifs'),
      api.get('/types-formation'),
      api.get('/annees-academiques'),
    ])
    tarifs.value = t.data
    typesFormation.value = tf.data
    annees.value = a.data
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const { data } = await api.post('/tarifs', form.value)
    const idx = tarifs.value.findIndex(t =>
      t.type_formation?.id === data.type_formation?.id &&
      t.annee_academique?.id === data.annee_academique?.id
    )
    if (idx !== -1) tarifs.value[idx] = data
    else tarifs.value.push(data)
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
  <div class="p-6 max-w-4xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-gray-900">Tarifs intervenants</h1>
        <p class="text-sm text-gray-500 mt-0.5">Taux horaires par type de formation et année académique</p>
      </div>
      <button @click="openCreate"
        class="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Définir un tarif
      </button>
    </div>

    <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-sm text-blue-700">
      <strong>Règle tronc commun :</strong> Lorsqu'une séance regroupe plusieurs types de formation (tronc commun), le taux horaire le plus élevé parmi les formations présentes est appliqué à l'intervenant.
    </div>

    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div v-if="loading" class="p-12 text-center text-gray-400 text-sm">Chargement…</div>
      <div v-else-if="tarifs.length === 0" class="p-12 text-center">
        <svg class="w-10 h-10 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-gray-500 text-sm">Aucun tarif défini</p>
      </div>
      <table v-else class="w-full">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type de formation</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Année académique</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Taux horaire</th>
            <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date d'effet</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="t in tarifs" :key="t.id" class="hover:bg-gray-50">
            <td class="px-5 py-3.5">
              <span class="text-sm font-medium text-gray-900">{{ t.type_formation?.nom ?? '—' }}</span>
              <span class="ml-2 text-xs font-mono text-gray-400">{{ t.type_formation?.code }}</span>
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-600">{{ t.annee_academique?.libelle ?? '—' }}</td>
            <td class="px-5 py-3.5">
              <span class="text-sm font-semibold text-gray-900">{{ formatAmount(t.montant_horaire) }}</span>
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-500">{{ formatDate(t.date_effet) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40" @click="showForm = false" />
        <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
          <h2 class="text-base font-semibold text-gray-900 mb-4">Définir un tarif</h2>
          <div v-if="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{{ error }}</div>
          <form @submit.prevent="save" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Type de formation <span class="text-red-500">*</span></label>
              <select v-model="form.type_formation_id" required
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
                <option v-for="tf in typesFormation" :key="tf.id" :value="tf.id">{{ tf.nom }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Année académique <span class="text-red-500">*</span></label>
              <select v-model="form.annee_academique_id" required
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
                <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Taux horaire (FCFA/h) <span class="text-red-500">*</span></label>
              <input v-model.number="form.montant_horaire" type="number" min="0" required
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Date d'effet <span class="text-red-500">*</span></label>
              <input v-model="form.date_effet" type="date" required
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
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
