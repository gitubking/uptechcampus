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
  absent_type: string | null
  absent_jusquau: string | null
}

const membres = ref<Membre[]>([])
const mois = ref('')
const loading = ref(true)
const filterRole = ref('')
const filterStatut = ref('actif')
const searchQ = ref('')

const ROLE_LABEL: Record<string, string> = {
  dg: 'Directeur Général', dir_peda: 'Directeur des études', resp_fin: 'Resp. Financier',
  coordinateur: 'Directeur adjoint des études', secretariat: 'Secrétariat',
}

const ROLE_COLOR: Record<string, string> = {
  dg: 'bg-purple-100 text-purple-700',
  dir_peda: 'bg-indigo-100 text-indigo-700',
  resp_fin: 'bg-emerald-100 text-emerald-700',
  coordinateur: 'bg-blue-100 text-blue-700',
  secretariat: 'bg-cyan-100 text-cyan-700',
}

const ABSENCE_TYPE_SHORT: Record<string, string> = {
  conge_annuel: 'Congé',
  maladie: 'Maladie',
  exceptionnel: 'Exceptionnel',
  formation: 'Formation',
  mission: 'Mission',
  sans_solde: 'Sans solde',
  autre: 'Absent',
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
    absents_aujourd_hui: items.filter(m => !!m.absent_type).length,
    taches_en_cours: items.reduce((s, m) => s + m.taches_en_cours + m.taches_a_faire, 0),
    taches_en_retard: items.reduce((s, m) => s + m.taches_en_retard, 0),
    taches_termines_30j: items.reduce((s, m) => s + m.taches_termines_30j, 0),
    activite_7j: items.reduce((s, m) => s + m.activite_7j, 0),
  }
})

function initials(m: Membre) {
  return `${(m.prenom?.[0] ?? '')}${(m.nom?.[0] ?? '')}`.toUpperCase()
}

function formatDateFr(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
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
  <div class="mx-auto max-w-7xl px-6 py-8">
    <!-- Header ───────────────────────────────────────────────────── -->
    <header class="mb-8 flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-600">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
          Direction générale
        </div>
        <h1 class="mt-1 text-2xl font-bold tracking-tight text-gray-900">Mon équipe</h1>
        <p class="mt-1 text-sm text-gray-500">
          Vue consolidée de la productivité de l'équipe administrative — <span class="font-medium text-gray-700">{{ mois }}</span>
        </p>
      </div>
    </header>

    <!-- KPIs globaux ────────────────────────────────────────────── -->
    <div class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span> Agents actifs
        </div>
        <div class="mt-2 text-3xl font-bold text-gray-900">{{ totaux.agents }}</div>
      </div>
      <div :class="['rounded-2xl border p-4 shadow-sm',
        totaux.absents_aujourd_hui ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-white']">
        <div class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide"
          :class="totaux.absents_aujourd_hui ? 'text-orange-700' : 'text-gray-500'">
          <span :class="['h-1.5 w-1.5 rounded-full', totaux.absents_aujourd_hui ? 'bg-orange-500 animate-pulse' : 'bg-gray-400']"></span>
          Absents aujourd'hui
        </div>
        <div :class="['mt-2 text-3xl font-bold', totaux.absents_aujourd_hui ? 'text-orange-700' : 'text-gray-900']">
          {{ totaux.absents_aujourd_hui }}
        </div>
      </div>
      <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
          <span class="h-1.5 w-1.5 rounded-full bg-blue-500"></span> En cours
        </div>
        <div class="mt-2 text-3xl font-bold text-blue-700">{{ totaux.taches_en_cours }}</div>
      </div>
      <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-red-700">
          <span class="h-1.5 w-1.5 rounded-full bg-red-500"></span> En retard
        </div>
        <div class="mt-2 text-3xl font-bold text-red-700">{{ totaux.taches_en_retard }}</div>
      </div>
      <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> Faites 30j
        </div>
        <div class="mt-2 text-3xl font-bold text-emerald-700">{{ totaux.taches_termines_30j }}</div>
      </div>
      <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span> Actions 7j
        </div>
        <div class="mt-2 text-3xl font-bold text-gray-900">{{ totaux.activite_7j }}</div>
      </div>
    </div>

    <!-- Filtres ─────────────────────────────────────────────────── -->
    <div class="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
      <div class="relative flex-1 min-w-[220px]">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/></svg>
        <input v-model="searchQ" placeholder="Rechercher un agent…"
          class="w-full rounded-lg border-0 bg-transparent px-3 py-2 pl-9 text-sm outline-none focus:ring-2 focus:ring-red-500" />
      </div>
      <select v-model="filterRole" class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
        <option value="">Tous les rôles</option>
        <option v-for="(label, key) in ROLE_LABEL" :key="key" :value="key">{{ label }}</option>
      </select>
      <select v-model="filterStatut" class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
        <option value="">Tous les statuts</option>
        <option value="actif">Actif</option>
        <option value="inactif">Inactif</option>
        <option value="suspendu">Suspendu</option>
        <option value="bloque">Bloqué</option>
      </select>
      <span class="ml-auto px-2 text-xs text-gray-500">
        {{ filtered.length }} agent{{ filtered.length > 1 ? 's' : '' }}
      </span>
    </div>

    <!-- Loading ─────────────────────────────────────────────────── -->
    <div v-if="loading" class="rounded-2xl border border-gray-200 bg-white p-16 text-center">
      <div class="inline-block h-8 w-8 animate-spin rounded-full border-2 border-red-200 border-t-red-600"></div>
      <p class="mt-3 text-sm text-gray-500">Chargement de votre équipe…</p>
    </div>

    <!-- Empty ───────────────────────────────────────────────────── -->
    <div v-else-if="filtered.length === 0" class="rounded-2xl border border-dashed border-gray-300 bg-white p-16 text-center">
      <svg class="mx-auto h-10 w-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.5v15m7.5-7.5h-15"/></svg>
      <p class="mt-3 text-sm font-medium text-gray-700">Aucun agent ne correspond aux filtres.</p>
      <p class="mt-1 text-xs text-gray-500">Essayez de réinitialiser la recherche ou le filtre de rôle.</p>
    </div>

    <!-- Grille agents ───────────────────────────────────────────── -->
    <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <article v-for="m in filtered" :key="m.id"
        :class="['group relative overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:shadow-md',
          m.absent_type ? 'border-orange-200 ring-1 ring-orange-100' : 'border-gray-200']">

        <!-- Liseret de couleur selon statut -->
        <div :class="['absolute inset-x-0 top-0 h-1',
          m.absent_type ? 'bg-orange-400' :
          m.statut !== 'actif' ? 'bg-gray-300' :
          activityLevel(m) === 'haute' ? 'bg-emerald-400' :
          activityLevel(m) === 'moyenne' ? 'bg-blue-400' :
          activityLevel(m) === 'basse' ? 'bg-amber-400' : 'bg-gray-300']"></div>

        <!-- Bandeau absent aujourd'hui -->
        <div v-if="m.absent_type"
          class="flex items-center gap-2 border-b border-orange-200 bg-orange-50 px-4 py-2">
          <svg class="h-4 w-4 flex-shrink-0 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span class="text-xs font-semibold text-orange-800">
            Absent(e) — {{ ABSENCE_TYPE_SHORT[m.absent_type] ?? 'Absence' }}
          </span>
          <span v-if="m.absent_jusquau" class="ml-auto text-[10px] font-medium text-orange-700">
            jusqu'au {{ formatDateFr(m.absent_jusquau) }}
          </span>
        </div>

        <div class="p-5">
          <!-- Header carte -->
          <div class="mb-4 flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <div class="relative flex-shrink-0">
                <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 text-sm font-bold text-white shadow-sm">
                  {{ initials(m) }}
                </div>
                <!-- Pastille présence -->
                <span v-if="m.statut === 'actif' && !m.absent_type"
                  class="absolute -right-0.5 -top-0.5 block h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
                  title="Actif"></span>
                <span v-else-if="m.absent_type"
                  class="absolute -right-0.5 -top-0.5 block h-3 w-3 rounded-full border-2 border-white bg-orange-500"
                  title="Absent"></span>
                <span v-else
                  class="absolute -right-0.5 -top-0.5 block h-3 w-3 rounded-full border-2 border-white bg-gray-400"
                  :title="m.statut"></span>
              </div>
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-gray-900">{{ m.prenom }} {{ m.nom }}</div>
                <span :class="['mt-0.5 inline-block rounded px-2 py-0.5 text-[11px] font-medium',
                  ROLE_COLOR[m.role] || 'bg-gray-100 text-gray-700']">
                  {{ ROLE_LABEL[m.role] || m.role }}
                </span>
              </div>
            </div>
            <span v-if="m.statut !== 'actif'"
              class="flex-shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-700">
              {{ m.statut }}
            </span>
          </div>

          <!-- Tâches : barre de progression + chiffres -->
          <div class="mb-4">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Tâches</span>
              <span class="text-[11px] text-gray-400">
                {{ m.taches_a_faire + m.taches_en_cours + m.taches_en_revue + m.taches_termine }} au total
              </span>
            </div>
            <!-- Barre empilée -->
            <div class="mb-3 flex h-2 overflow-hidden rounded-full bg-gray-100">
              <div v-if="m.taches_a_faire" class="bg-gray-400" :style="{ width: ((m.taches_a_faire / Math.max(1, m.taches_a_faire + m.taches_en_cours + m.taches_en_revue + m.taches_termine)) * 100) + '%' }" :title="`${m.taches_a_faire} à faire`"></div>
              <div v-if="m.taches_en_cours" class="bg-blue-500" :style="{ width: ((m.taches_en_cours / Math.max(1, m.taches_a_faire + m.taches_en_cours + m.taches_en_revue + m.taches_termine)) * 100) + '%' }" :title="`${m.taches_en_cours} en cours`"></div>
              <div v-if="m.taches_en_revue" class="bg-violet-500" :style="{ width: ((m.taches_en_revue / Math.max(1, m.taches_a_faire + m.taches_en_cours + m.taches_en_revue + m.taches_termine)) * 100) + '%' }" :title="`${m.taches_en_revue} en revue`"></div>
              <div v-if="m.taches_termine" class="bg-emerald-500" :style="{ width: ((m.taches_termine / Math.max(1, m.taches_a_faire + m.taches_en_cours + m.taches_en_revue + m.taches_termine)) * 100) + '%' }" :title="`${m.taches_termine} terminées`"></div>
            </div>
            <div class="grid grid-cols-4 gap-1.5 text-center">
              <div class="rounded-lg bg-gray-50 py-1.5 ring-1 ring-inset ring-gray-100">
                <div class="text-sm font-bold text-gray-800">{{ m.taches_a_faire }}</div>
                <div class="text-[9px] uppercase text-gray-500">À faire</div>
              </div>
              <div class="rounded-lg bg-blue-50 py-1.5 ring-1 ring-inset ring-blue-100">
                <div class="text-sm font-bold text-blue-700">{{ m.taches_en_cours }}</div>
                <div class="text-[9px] uppercase text-blue-700">En cours</div>
              </div>
              <div class="rounded-lg bg-red-50 py-1.5 ring-1 ring-inset ring-red-100">
                <div class="text-sm font-bold text-red-700">{{ m.taches_en_retard }}</div>
                <div class="text-[9px] uppercase text-red-700">Retard</div>
              </div>
              <div class="rounded-lg bg-emerald-50 py-1.5 ring-1 ring-inset ring-emerald-100">
                <div class="text-sm font-bold text-emerald-700">{{ m.taches_termines_30j }}</div>
                <div class="text-[9px] uppercase text-emerald-700">30 j</div>
              </div>
            </div>
          </div>

          <!-- Footer activité -->
          <div class="flex items-center justify-between border-t border-gray-100 pt-3">
            <div class="flex items-center gap-1.5">
              <span :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', ACTIVITY_LEVEL_CONF[activityLevel(m)].color]">
                <span class="h-1.5 w-1.5 rounded-full"
                  :class="activityLevel(m) === 'haute' ? 'bg-green-600' :
                          activityLevel(m) === 'moyenne' ? 'bg-blue-600' :
                          activityLevel(m) === 'basse' ? 'bg-yellow-600' : 'bg-gray-400'"></span>
                {{ ACTIVITY_LEVEL_CONF[activityLevel(m)].label }}
              </span>
              <span class="text-[11px] text-gray-400">• {{ m.activite_7j }} act. / 7j</span>
            </div>
            <div class="text-right">
              <div class="text-[9px] uppercase tracking-wide text-gray-400">Dern. connex.</div>
              <div class="text-[11px] font-medium text-gray-600">{{ relativeTime(m.last_login_at) }}</div>
            </div>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
