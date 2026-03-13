<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const canWrite = computed(() => ['dg', 'secretariat'].includes(auth.user?.role ?? ''))

// --- Données ---
const etudiant = ref<any>(null)
const loading = ref(true)
const activeTab = ref<'infos' | 'inscriptions' | 'documents'>('infos')

async function fetchEtudiant() {
  loading.value = true
  try {
    const { data } = await api.get(`/etudiants/${route.params.id}`)
    etudiant.value = data
  } finally {
    loading.value = false
  }
}

onMounted(fetchEtudiant)

// --- Statuts ---
const statutLabel: Record<string, string> = {
  inscrit_actif: 'Actif', pre_inscrit: 'Pré-inscrit', en_examen: 'En examen',
  diplome: 'Diplômé', abandonne: 'Abandonné',
}
const statutClass: Record<string, string> = {
  inscrit_actif: 'bg-green-100 text-green-700',
  pre_inscrit: 'bg-amber-100 text-amber-700',
  en_examen: 'bg-blue-100 text-blue-700',
  diplome: 'bg-purple-100 text-purple-700',
  abandonne: 'bg-red-100 text-red-700',
}

// --- Upload photo ---
const photoInput = ref<HTMLInputElement | null>(null)
const photoLoading = ref(false)

async function uploadPhoto(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  photoLoading.value = true
  try {
    const fd = new FormData()
    fd.append('photo', file)
    const { data } = await api.post(`/etudiants/${etudiant.value.id}/photo`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    etudiant.value.photo_path = data.photo_path
  } finally {
    photoLoading.value = false
  }
}

// --- Upload document ---
const docInput = ref<HTMLInputElement | null>(null)
const docType = ref('cni')
const docLoading = ref(false)
const docTypes = [
  { value: 'cni', label: 'CNI' },
  { value: 'passeport', label: 'Passeport' },
  { value: 'photo', label: 'Photo' },
  { value: 'diplome', label: 'Diplôme' },
  { value: 'bulletin_naissance', label: 'Bulletin de naissance' },
  { value: 'contrat_signe', label: 'Contrat signé' },
  { value: 'autre', label: 'Autre' },
]

async function uploadDocument(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  docLoading.value = true
  try {
    const fd = new FormData()
    fd.append('etudiant_id', String(etudiant.value.id))
    fd.append('type_document', docType.value)
    fd.append('fichier', file)
    const { data } = await api.post('/documents', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    etudiant.value.documents.push(data)
  } finally {
    docLoading.value = false
    if (docInput.value) docInput.value.value = ''
  }
}

async function deleteDocument(docId: number) {
  if (!confirm('Supprimer ce document ?')) return
  await api.delete(`/documents/${docId}`)
  etudiant.value.documents = etudiant.value.documents.filter((d: any) => d.id !== docId)
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR')
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
</script>

<template>
  <div class="p-6 lg:p-8 max-w-5xl">

    <!-- Retour -->
    <button @click="router.push('/etudiants')"
      class="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-5 transition">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Retour à la liste
    </button>

    <!-- Chargement -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <svg class="animate-spin w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>

    <template v-else-if="etudiant">

      <!-- Profil header -->
      <div class="bg-white rounded-xl border border-gray-200 p-6 mb-5 flex items-start gap-6">
        <!-- Avatar / Photo -->
        <div class="relative flex-shrink-0">
          <div class="w-20 h-20 rounded-xl overflow-hidden bg-indigo-100 flex items-center justify-center">
            <img v-if="etudiant.photo_path"
              :src="`http://localhost:8000/storage/${etudiant.photo_path}`"
              class="w-full h-full object-cover" />
            <span v-else class="text-2xl font-bold text-indigo-700 uppercase">
              {{ etudiant.prenom[0] }}{{ etudiant.nom[0] }}
            </span>
          </div>
          <button v-if="canWrite" @click="photoInput?.click()"
            :disabled="photoLoading"
            class="absolute -bottom-1.5 -right-1.5 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 transition">
            <svg class="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <input ref="photoInput" type="file" accept="image/*" class="hidden" @change="uploadPhoto" />
        </div>

        <!-- Infos principales -->
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h1 class="text-xl font-bold text-gray-900">{{ etudiant.prenom }} {{ etudiant.nom }}</h1>
              <p class="text-sm text-gray-500 font-mono mt-0.5">{{ etudiant.numero_etudiant }}</p>
            </div>
            <span
              v-if="etudiant.inscriptions?.[0]"
              class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0"
              :class="statutClass[etudiant.inscriptions[0].statut] ?? 'bg-gray-100 text-gray-600'"
            >
              {{ statutLabel[etudiant.inscriptions[0].statut] ?? etudiant.inscriptions[0].statut }}
            </span>
          </div>
          <div class="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {{ etudiant.email }}
            </span>
            <span v-if="etudiant.telephone" class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {{ etudiant.telephone }}
            </span>
            <span v-if="etudiant.inscriptions?.[0]?.classe?.filiere" class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
              {{ etudiant.inscriptions[0].classe.filiere.nom }}
            </span>
          </div>
        </div>
      </div>

      <!-- Onglets -->
      <div class="flex border-b border-gray-200 mb-5">
        <button v-for="tab in [
          { key: 'infos', label: 'Informations' },
          { key: 'inscriptions', label: `Inscriptions (${etudiant.inscriptions?.length ?? 0})` },
          { key: 'documents', label: `Documents (${etudiant.documents?.length ?? 0})` },
        ]" :key="tab.key"
          @click="activeTab = tab.key as any"
          class="px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition"
          :class="activeTab === tab.key
            ? 'border-indigo-600 text-indigo-600'
            : 'border-transparent text-gray-500 hover:text-gray-700'"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Onglet : Informations -->
      <div v-if="activeTab === 'infos'" class="bg-white rounded-xl border border-gray-200 p-6">
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div v-for="field in [
            { label: 'Nom complet', value: `${etudiant.prenom} ${etudiant.nom}` },
            { label: 'N° étudiant', value: etudiant.numero_etudiant },
            { label: 'Email', value: etudiant.email },
            { label: 'Téléphone', value: etudiant.telephone },
            { label: 'Date de naissance', value: formatDate(etudiant.date_naissance) },
            { label: 'Lieu de naissance', value: etudiant.lieu_naissance },
            { label: 'Adresse', value: etudiant.adresse },
            { label: 'N° CNI', value: etudiant.cni_numero },
          ]" :key="field.label">
            <div>
              <dt class="text-xs font-medium text-gray-500 mb-1">{{ field.label }}</dt>
              <dd class="text-sm text-gray-900">{{ field.value || '—' }}</dd>
            </div>
          </div>
        </dl>
      </div>

      <!-- Onglet : Inscriptions -->
      <div v-else-if="activeTab === 'inscriptions'">
        <div v-if="!etudiant.inscriptions?.length" class="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          Aucune inscription enregistrée
        </div>
        <div v-else class="space-y-3">
          <div v-for="insc in etudiant.inscriptions" :key="insc.id"
            class="bg-white rounded-xl border border-gray-200 p-5">
            <div class="flex items-start justify-between">
              <div>
                <p class="font-medium text-gray-900">{{ insc.classe?.filiere?.nom ?? '—' }}</p>
                <p class="text-sm text-gray-500 mt-0.5">
                  {{ insc.classe?.nom }} — {{ insc.annee_academique?.libelle }}
                </p>
                <p v-if="insc.parcours" class="text-sm text-gray-500">
                  Parcours : {{ insc.parcours.nom }}
                </p>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                  :class="statutClass[insc.statut] ?? 'bg-gray-100 text-gray-600'">
                  {{ statutLabel[insc.statut] ?? insc.statut }}
                </span>
                <a
                  v-if="['en_examen', 'inscrit_actif', 'diplome'].includes(insc.statut)"
                  :href="`http://localhost:8000/api/inscriptions/${insc.id}/contrat-pdf`"
                  target="_blank"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Contrat PDF
                </a>
              </div>
            </div>
            <div class="mt-3 flex gap-4 text-xs text-gray-500">
              <span>Date : {{ formatDate(insc.created_at) }}</span>
              <span v-if="insc.mensualite">Mensualité : {{ Number(insc.mensualite).toLocaleString('fr-FR') }} FCFA</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Onglet : Documents -->
      <div v-else-if="activeTab === 'documents'">
        <!-- Upload -->
        <div v-if="canWrite" class="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 class="text-sm font-medium text-gray-700 mb-3">Ajouter un document</h3>
          <div class="flex items-center gap-3">
            <select v-model="docType"
              class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option v-for="dt in docTypes" :key="dt.value" :value="dt.value">{{ dt.label }}</option>
            </select>
            <button @click="docInput?.click()" :disabled="docLoading"
              class="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50">
              <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {{ docLoading ? 'Envoi…' : 'Choisir un fichier' }}
            </button>
            <input ref="docInput" type="file" class="hidden" @change="uploadDocument" />
          </div>
        </div>

        <!-- Liste documents -->
        <div v-if="!etudiant.documents?.length" class="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          Aucun document enregistré
        </div>
        <div v-else class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50">
                <th class="text-left px-5 py-3 font-medium text-gray-500">Document</th>
                <th class="text-left px-5 py-3 font-medium text-gray-500">Type</th>
                <th class="text-left px-5 py-3 font-medium text-gray-500">Taille</th>
                <th class="text-left px-5 py-3 font-medium text-gray-500">Date</th>
                <th class="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="doc in etudiant.documents" :key="doc.id"
                class="border-b border-gray-100 last:border-0">
                <td class="px-5 py-3">
                  <a :href="`http://localhost:8000/storage/${doc.fichier_path}`" target="_blank"
                    class="text-indigo-600 hover:underline flex items-center gap-2"
                    @click.stop>
                    <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    {{ doc.nom_fichier }}
                  </a>
                </td>
                <td class="px-5 py-3 text-gray-600 capitalize">{{ doc.type_document.replace('_', ' ') }}</td>
                <td class="px-5 py-3 text-gray-500">{{ formatFileSize(doc.taille_fichier) }}</td>
                <td class="px-5 py-3 text-gray-500">{{ formatDate(doc.created_at) }}</td>
                <td class="px-5 py-3">
                  <button v-if="canWrite" @click="deleteDocument(doc.id)"
                    class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>
  </div>
</template>
