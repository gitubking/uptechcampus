<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'

interface LogRow {
  id: number
  user_id: number | null
  user_role: string | null
  user_nom: string | null
  user_prenom: string | null
  action: string
  entity: string
  entity_id: string | null
  path: string
  status_code: number
  ip: string | null
  user_agent: string | null
  created_at: string
}

interface User { id: number; nom: string; prenom: string; role: string; statut: string }
interface EntityCount { entity: string; cnt: number }

const logs = ref<LogRow[]>([])
const total = ref(0)
const users = ref<User[]>([])
const entities = ref<EntityCount[]>([])
const loading = ref(true)

const filterUser = ref('')
const filterEntity = ref('')
const filterAction = ref('')
const filterFrom = ref('')
const filterTo = ref('')
const page = ref(0)
const pageSize = 50

const ROLE_LABEL: Record<string, string> = {
  dg: 'DG', dir_peda: 'Dir. Péda', resp_fin: 'Resp. Fin.',
  coordinateur: 'Coord.', secretariat: 'Secrétariat', enseignant: 'Enseignant', etudiant: 'Étudiant',
}

const ACTION_COLOR: Record<string, string> = {
  POST: 'bg-green-100 text-green-700',
  PUT: 'bg-blue-100 text-blue-700',
  PATCH: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
}

const totalPages = computed(() => Math.ceil(total.value / pageSize))

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('limit', String(pageSize))
    params.set('offset', String(page.value * pageSize))
    if (filterUser.value) params.set('user_id', filterUser.value)
    if (filterEntity.value) params.set('entity', filterEntity.value)
    if (filterAction.value) params.set('action', filterAction.value)
    if (filterFrom.value) params.set('from', filterFrom.value)
    if (filterTo.value) params.set('to', filterTo.value)
    const { data } = await api.get(`/activity-logs?${params.toString()}`)
    logs.value = data.logs
    total.value = data.total
  } finally {
    loading.value = false
  }
}

async function loadMeta() {
  const [uRes, eRes] = await Promise.all([
    api.get('/users').catch(() => ({ data: [] })),
    api.get('/activity-logs/entities').catch(() => ({ data: [] })),
  ])
  users.value = (uRes.data as User[]).filter(u => u.role !== 'etudiant')
  entities.value = eRes.data
}

function applyFilters() {
  page.value = 0
  load()
}

function resetFilters() {
  filterUser.value = ''
  filterEntity.value = ''
  filterAction.value = ''
  filterFrom.value = ''
  filterTo.value = ''
  page.value = 0
  load()
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function actionLabel(a: string) {
  switch (a) {
    case 'POST': return 'Création'
    case 'PUT': case 'PATCH': return 'Modification'
    case 'DELETE': return 'Suppression'
    default: return a
  }
}

function shortPath(p: string) {
  return p.length > 60 ? p.slice(0, 57) + '…' : p
}

onMounted(async () => {
  await loadMeta()
  await load()
})
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <div class="mb-6">
      <h1 class="text-xl font-bold text-gray-900">Journal d'activité</h1>
      <p class="text-sm text-gray-500 mt-0.5">Traçabilité des actions effectuées sur l'application</p>
    </div>

    <!-- Filtres -->
    <div class="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <div class="grid grid-cols-1 md:grid-cols-6 gap-3">
        <div class="md:col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Utilisateur</label>
          <select v-model="filterUser" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Tous</option>
            <option v-for="u in users" :key="u.id" :value="String(u.id)">
              {{ u.prenom }} {{ u.nom }} ({{ ROLE_LABEL[u.role] || u.role }})
            </option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Entité</label>
          <select v-model="filterEntity" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Toutes</option>
            <option v-for="e in entities" :key="e.entity" :value="e.entity">
              {{ e.entity }} ({{ e.cnt }})
            </option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Action</label>
          <select v-model="filterAction" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Toutes</option>
            <option value="POST">Création</option>
            <option value="PUT">Modification</option>
            <option value="DELETE">Suppression</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Du</label>
          <input v-model="filterFrom" type="date" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Au</label>
          <input v-model="filterTo" type="date" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div class="flex gap-2 mt-3">
        <button @click="applyFilters"
          class="px-4 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition">
          Filtrer
        </button>
        <button @click="resetFilters"
          class="px-4 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition">
          Réinitialiser
        </button>
      </div>
    </div>

    <!-- Table -->
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div v-if="loading" class="p-12 text-center text-gray-400 text-sm">Chargement…</div>
      <div v-else-if="logs.length === 0" class="p-12 text-center text-gray-500 text-sm">
        Aucune activité enregistrée pour ces filtres.
      </div>
      <table v-else class="w-full">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date / heure</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Utilisateur</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Action</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Entité</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Chemin</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">IP</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="l in logs" :key="l.id" class="hover:bg-gray-50 transition">
            <td class="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap font-mono">
              {{ formatDateTime(l.created_at) }}
            </td>
            <td class="px-4 py-2.5 text-sm">
              <div v-if="l.user_id" class="flex flex-col">
                <span class="text-gray-900 font-medium">{{ l.user_prenom }} {{ l.user_nom }}</span>
                <span class="text-xs text-gray-500">{{ l.user_role ? ROLE_LABEL[l.user_role] || l.user_role : '' }}</span>
              </div>
              <span v-else class="text-gray-400 italic">Supprimé</span>
            </td>
            <td class="px-4 py-2.5">
              <span :class="['text-xs font-medium px-2 py-0.5 rounded', ACTION_COLOR[l.action] || 'bg-gray-100 text-gray-700']">
                {{ actionLabel(l.action) }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-sm text-gray-700">
              {{ l.entity }}
              <span v-if="l.entity_id" class="text-gray-400 font-mono text-xs">#{{ l.entity_id }}</span>
            </td>
            <td class="px-4 py-2.5 text-xs text-gray-500 font-mono">{{ shortPath(l.path) }}</td>
            <td class="px-4 py-2.5">
              <span :class="['text-xs font-medium px-2 py-0.5 rounded',
                l.status_code < 300 ? 'bg-green-100 text-green-700' :
                l.status_code < 400 ? 'bg-blue-100 text-blue-700' :
                'bg-red-100 text-red-700']">
                {{ l.status_code }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-xs text-gray-500 font-mono">{{ l.ip || '—' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="!loading && logs.length > 0" class="flex items-center justify-between px-4 py-3 border-t border-gray-200">
        <span class="text-xs text-gray-500">
          {{ page * pageSize + 1 }}–{{ Math.min((page + 1) * pageSize, total) }} sur {{ total }}
        </span>
        <div class="flex gap-1">
          <button @click="() => { if (page > 0) { page--; load() } }" :disabled="page === 0"
            class="px-3 py-1 border border-gray-300 text-gray-700 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            Précédent
          </button>
          <span class="px-3 py-1 text-xs text-gray-500">
            Page {{ page + 1 }} / {{ Math.max(totalPages, 1) }}
          </span>
          <button @click="() => { if (page + 1 < totalPages) { page++; load() } }" :disabled="page + 1 >= totalPages"
            class="px-3 py-1 border border-gray-300 text-gray-700 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            Suivant
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
