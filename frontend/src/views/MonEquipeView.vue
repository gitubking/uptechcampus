<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'

interface Membre {
  id: number
  nom: string
  prenom: string
  role: string
  email: string
  statut: string
  last_login_at: string | null
  taches_a_faire: number
  taches_en_cours: number
  taches_en_revue: number
  taches_termine: number
  taches_en_retard: number
  taches_termines_30j: number
  vac_heures_mois: number
  vac_montant_mois: number
  seances_emargees_mois: number
  seances_total_mois: number
  activite_7j: number
  activite_30j: number
  derniere_action_at: string | null
}

const membres = ref<Membre[]>([])
const mois = ref('')
const loading = ref(true)
const filterRole = ref('')
const filterStatut = ref('actif')
const searchQ = ref('')

const ROLE_LABEL: Record<string, string> = {
  dg: 'Directeur Général', dir_peda: 'Dir. Pédagogique', resp_fin: 'Resp. Financier',
  coordinateur: 'Coordinateur', secretariat: 'Secrétariat', enseignant: 'Enseignant',
}

const ROLE_COLOR: Record<string, string> = {
  dg: 'bg-purple-100 text-purple-700',
  dir_peda: 'bg-indigo-100 text-indigo-700',
  resp_fin: 'bg-emerald-100 text-emerald-700',
  coordinateur: 'bg-blue-100 text-blue-700',
  secretariat: 'bg-cyan-100 text-cyan-700',
  enseignant: 'bg-amber-100 text-amber-700',
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/mon-equipe')
    membres.value = data.membres
    mois.value = data.mois
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => {
  return membres.value.filter(m => {
    if (filterRole.value && m.role !== filterRole.value) return false
    if (filterStatut.value && m.statut !== filterStatut.value) return false
    if (searchQ.value) {
      const q = searchQ.value.toLowerCase()
      if (!`${m.prenom} ${m.nom} ${m.email}`.toLowerCase().includes(q)) return false
    }
    return true
  })
})

const totaux = computed(() => {
  const items = filtered.value
  return {
    agents: items.length,
    taches_en_cours: items.reduce((s, m) => s + m.taches_en_cours + m.taches_a_faire, 0),
    taches_en_retard: items.reduce((s, m) => s + m.taches_en_retard, 0),
    taches_termines_30j: items.reduce((s, m) => s + m.taches_termines_30j, 0),
    heures_mois: items.reduce((s, m) => s + Number(m.vac_heures_mois || 0), 0),
    activite_7j: items.reduce((s, m) => s + m.activite_7j, 0),
  }
})

function initials(m: Membre) {
  return `${(m.prenom?.[0] ?? '')}${(m.nom?.[0] ?? '')}`.toUpperCase()
}

function formatNumber(n: number, decimals = 0) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function formatMontant(n: number) {
  return formatNumber(Math.round(n)) + ' FCFA'
}

function relativeTime(d: string | null): string {
  if (!d) return 'Jamais'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'À l\'instant'
  if (mins < 60) return `Il y a ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `Il y a ${h} h`
  const days = Math.floor(h / 24)
  if (days < 30) return `Il y a ${days} j`
  const months = Math.floor(days / 30)
  return `Il y a ${months} mois`
}

function emargementRate(m: Membre): number | null {
  if (m.seances_total_mois === 0) return null
  return Math.round((m.seances_emargees_mois / m.seances_total_mois) * 100)
}

function activityLevel(m: Membre): 'haute' | 'moyenne' | 'basse' | 'nulle' {
  if (m.activite_7j === 0) return 'nulle'
  if (m.activite_7j >= 20) return 'haute'
  if (m.activite_7j >= 5) return 'moyenne'
  return 'basse'
}

const ACTIVITY_LEVEL_CONF = {
  haute:   { label: 'Élevée',  color: 'bg-green-100 text-green-700' },
  moyenne: { label: 'Moyenne', color: 'bg-blue-100 text-blue-700' },
  basse:   { label: 'Faible',  color: 'bg-yellow-100 text-yellow-700' },
  nulle:   { label: 'Aucune',  color: 'bg-gray-100 text-gray-500' },
}

onMounted(load)
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-xl font-bold text-gray-900">Mon équipe</h1>
      <p class="text-sm text-gray-500 mt-0.5">
        Vue consolidée de la productivité par agent — mois en cours ({{ mois }})
      </p>
    </div>

    <!-- KPIs globaux -->
    <div class="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Agents actifs</div>
        <div class="text-2xl font-bold text-gray-900">{{ totaux.agents }}</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Tâches en cours</div>
        <div class="text-2xl font-bold text-blue-600">{{ totaux.taches_en_cours }}</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">En retard</div>
        <div class="text-2xl font-bold text-red-600">{{ totaux.taches_en_retard }}</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Terminées 30j</div>
        <div class="text-2xl font-bold text-green-600">{{ totaux.taches_termines_30j }}</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Heures vacations (mois)</div>
        <div class="text-2xl font-bold text-gray-900">{{ formatNumber(totaux.heures_mois, 1) }}h</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Actions 7j</div>
        <div class="text-2xl font-bold text-gray-900">{{ totaux.activite_7j }}</div>
      </div>
    </div>

    <!-- Filtres -->
    <div class="flex flex-wrap gap-2 mb-4">
      <input v-model="searchQ" placeholder="Rechercher un agent..."
        class="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64" />
      <select v-model="filterRole" class="px-3 py-2 border border-gray-300 rounded-lg text-sm">
        <option value="">Tous les rôles</option>
        <option v-for="(label, key) in ROLE_LABEL" :key="key" :value="key">{{ label }}</option>
      </select>
      <select v-model="filterStatut" class="px-3 py-2 border border-gray-300 rounded-lg text-sm">
        <option value="">Tous les statuts</option>
        <option value="actif">Actif</option>
        <option value="inactif">Inactif</option>
        <option value="suspendu">Suspendu</option>
        <option value="bloque">Bloqué</option>
      </select>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
      Chargement…
    </div>

    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <p class="text-gray-500 text-sm">Aucun agent ne correspond aux filtres.</p>
    </div>

    <!-- Grille agents -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div v-for="m in filtered" :key="m.id"
        class="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition">

        <!-- Header carte -->
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-11 h-11 rounded-full bg-red-100 text-red-700 text-sm font-semibold flex items-center justify-center flex-shrink-0">
              {{ initials(m) }}
            </div>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-gray-900 truncate">{{ m.prenom }} {{ m.nom }}</div>
              <span :class="['inline-block text-xs font-medium px-2 py-0.5 rounded mt-0.5', ROLE_COLOR[m.role] || 'bg-gray-100 text-gray-700']">
                {{ ROLE_LABEL[m.role] || m.role }}
              </span>
            </div>
          </div>
          <span v-if="m.statut !== 'actif'"
            class="text-xs font-medium px-2 py-0.5 rounded bg-red-50 text-red-700 flex-shrink-0">
            {{ m.statut }}
          </span>
        </div>

        <!-- Tâches -->
        <div class="mb-4">
          <div class="text-xs font-medium text-gray-500 uppercase mb-1.5">Tâches</div>
          <div class="grid grid-cols-4 gap-2 text-center">
            <div class="bg-gray-50 rounded-lg py-1.5">
              <div class="text-base font-bold text-gray-700">{{ m.taches_a_faire }}</div>
              <div class="text-[10px] text-gray-500">À faire</div>
            </div>
            <div class="bg-blue-50 rounded-lg py-1.5">
              <div class="text-base font-bold text-blue-700">{{ m.taches_en_cours }}</div>
              <div class="text-[10px] text-blue-600">En cours</div>
            </div>
            <div class="bg-red-50 rounded-lg py-1.5">
              <div class="text-base font-bold text-red-700">{{ m.taches_en_retard }}</div>
              <div class="text-[10px] text-red-600">En retard</div>
            </div>
            <div class="bg-green-50 rounded-lg py-1.5">
              <div class="text-base font-bold text-green-700">{{ m.taches_termines_30j }}</div>
              <div class="text-[10px] text-green-600">Fait 30j</div>
            </div>
          </div>
        </div>

        <!-- Enseignants : heures + émargement -->
        <div v-if="m.role === 'enseignant'" class="mb-4">
          <div class="text-xs font-medium text-gray-500 uppercase mb-1.5">Activité pédagogique</div>
          <div class="grid grid-cols-2 gap-2">
            <div class="bg-amber-50 rounded-lg p-2">
              <div class="text-xs text-amber-700 font-medium">Heures (mois)</div>
              <div class="text-sm font-bold text-amber-900">{{ formatNumber(m.vac_heures_mois, 1) }}h</div>
              <div class="text-[10px] text-amber-600">{{ formatMontant(m.vac_montant_mois) }}</div>
            </div>
            <div class="bg-indigo-50 rounded-lg p-2">
              <div class="text-xs text-indigo-700 font-medium">Émargement</div>
              <div v-if="emargementRate(m) !== null" class="text-sm font-bold text-indigo-900">
                {{ emargementRate(m) }}%
              </div>
              <div v-else class="text-sm font-bold text-gray-400">—</div>
              <div class="text-[10px] text-indigo-600">
                {{ m.seances_emargees_mois }}/{{ m.seances_total_mois }} séances
              </div>
            </div>
          </div>
        </div>

        <!-- Activité app -->
        <div class="flex items-center justify-between pt-3 border-t border-gray-100">
          <div class="flex items-center gap-2">
            <span :class="['text-xs font-medium px-2 py-0.5 rounded', ACTIVITY_LEVEL_CONF[activityLevel(m)].color]">
              Activité : {{ ACTIVITY_LEVEL_CONF[activityLevel(m)].label }}
            </span>
            <span class="text-xs text-gray-400">
              {{ m.activite_7j }} actions (7j)
            </span>
          </div>
          <div class="text-right">
            <div class="text-[10px] text-gray-400">Dernière connexion</div>
            <div class="text-xs text-gray-600">{{ relativeTime(m.last_login_at) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
