<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const canWrite = ['dg', 'secretariat'].includes(auth.user?.role ?? '')

interface Filiere { id: number; nom: string }
interface IntervenantFiliere { filiere_id: number; matiere: string; filiere?: Filiere }
interface Intervenant {
  id: number
  nom: string
  prenom: string
  email: string
  telephone: string | null
  statut: string
  numero_contrat: string
  cv_path: string | null
  annee_academique?: { id: number; libelle: string }
  filieres?: IntervenantFiliere[]
}

const intervenant = ref<Intervenant | null>(null)
const loading = ref(true)
const uploadingCv = ref(false)
const updatingStatut = ref(false)

const statutColors: Record<string, string> = {
  actif: 'bg-green-100 text-green-700',
  en_attente: 'bg-yellow-100 text-yellow-700',
  inactif: 'bg-gray-100 text-gray-500',
  suspendu: 'bg-red-100 text-red-700',
}
const statutLabels: Record<string, string> = {
  actif: 'Actif',
  en_attente: 'En attente',
  inactif: 'Inactif',
  suspendu: 'Suspendu',
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get(`/intervenants/${route.params.id}`)
    intervenant.value = data
  } finally {
    loading.value = false
  }
}

async function uploadCv(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !intervenant.value) return
  uploadingCv.value = true
  try {
    const fd = new FormData()
    fd.append('cv', file)
    const { data } = await api.post(`/intervenants/${intervenant.value.id}/cv`, fd)
    intervenant.value.cv_path = data.cv_path
  } finally {
    uploadingCv.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function updateStatut(statut: string) {
  if (!intervenant.value) return
  updatingStatut.value = true
  try {
    const { data } = await api.put(`/intervenants/${intervenant.value.id}`, { statut })
    intervenant.value.statut = data.statut
  } finally {
    updatingStatut.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">

    <!-- Back -->
    <button @click="router.back()" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-5 transition">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Retour aux intervenants
    </button>

    <div v-if="loading" class="p-12 text-center text-gray-400 text-sm">Chargement…</div>

    <template v-else-if="intervenant">

      <!-- Header card -->
      <div class="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <div class="flex items-start gap-5">
          <div class="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
            <span class="text-xl font-bold text-orange-700 uppercase">
              {{ intervenant.prenom[0] }}{{ intervenant.nom[0] }}
            </span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h1 class="text-lg font-bold text-gray-900">{{ intervenant.prenom }} {{ intervenant.nom }}</h1>
                <p class="text-sm text-gray-500 mt-0.5">{{ intervenant.email }}</p>
                <p v-if="intervenant.telephone" class="text-sm text-gray-500">{{ intervenant.telephone }}</p>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                  :class="statutColors[intervenant.statut]">
                  {{ statutLabels[intervenant.statut] ?? intervenant.statut }}
                </span>
                <select v-if="canWrite" :value="intervenant.statut" @change="updateStatut(($event.target as HTMLSelectElement).value)"
                  :disabled="updatingStatut"
                  class="px-2 py-1 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50">
                  <option value="en_attente">En attente</option>
                  <option value="actif">Actif</option>
                  <option value="inactif">Inactif</option>
                  <option value="suspendu">Suspendu</option>
                </select>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-500">
              <span><span class="font-medium text-gray-700">Contrat :</span> {{ intervenant.numero_contrat }}</span>
              <span v-if="intervenant.annee_academique">
                <span class="font-medium text-gray-700">Année :</span> {{ intervenant.annee_academique.libelle }}
              </span>
              <a
                :href="`http://localhost:8000/api/intervenants/${intervenant.id}/contrat-pdf`"
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
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

        <!-- Filières assignées -->
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <h2 class="text-sm font-semibold text-gray-700 mb-3">Filières enseignées</h2>
          <div v-if="!intervenant.filieres?.length" class="text-sm text-gray-400 italic">Aucune filière assignée</div>
          <div v-else class="space-y-2">
            <div v-for="f in intervenant.filieres" :key="f.filiere_id"
              class="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
              <span class="text-sm font-medium text-gray-800">{{ f.filiere?.nom }}</span>
              <span class="text-xs text-gray-500 italic">{{ f.matiere }}</span>
            </div>
          </div>
        </div>

        <!-- CV -->
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <h2 class="text-sm font-semibold text-gray-700 mb-3">CV / Documents</h2>
          <div v-if="intervenant.cv_path" class="flex items-center gap-3 p-3 bg-green-50 rounded-lg mb-3">
            <svg class="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 truncate">CV uploadé</p>
              <p class="text-xs text-gray-500 truncate">{{ intervenant.cv_path }}</p>
            </div>
          </div>
          <div v-else class="text-sm text-gray-400 italic mb-3">Aucun CV uploadé</div>

          <label v-if="canWrite"
            class="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 cursor-pointer hover:bg-gray-50 transition">
            <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {{ uploadingCv ? 'Upload…' : (intervenant.cv_path ? 'Remplacer le CV' : 'Uploader le CV') }}
            <input type="file" accept=".pdf,.doc,.docx" class="hidden" :disabled="uploadingCv" @change="uploadCv" />
          </label>
          <p class="text-xs text-gray-400 mt-2">PDF, DOC, DOCX — max 10 Mo</p>
        </div>

      </div>
    </template>

  </div>
</template>
