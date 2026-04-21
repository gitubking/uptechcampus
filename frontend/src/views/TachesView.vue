<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

interface Assignee {
  id: number
  nom: string
  prenom: string
  role: string
}

interface Tache {
  id: number
  titre: string
  description: string | null
  assignee_id: number | null  // legacy = premier assigné
  assignees: Assignee[]        // source de vérité multi-agent
  created_by: number | null
  priorite: 'basse' | 'normale' | 'haute' | 'urgente'
  statut: 'a_faire' | 'en_cours' | 'en_revue' | 'termine'
  date_debut: string | null
  deadline: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  createur_nom?: string | null
  createur_prenom?: string | null
}

interface User {
  id: number
  nom: string
  prenom: string
  role: string
  statut: string
}

interface ProductivityStat {
  id: number
  nom: string
  prenom: string
  role: string
  a_faire: number
  en_cours: number
  en_revue: number
  termine: number
  en_retard: number
  total: number
  termines_30j: number
}

const auth = useAuthStore()
// Seul le DG peut créer / assigner / éditer les tâches.
const MANAGER_ROLES = ['dg']
const isManager = computed(() => MANAGER_ROLES.includes(auth.user?.role ?? ''))

const taches = ref<Tache[]>([])
const users = ref<User[]>([])
const stats = ref<ProductivityStat[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')

const tab = ref<'kanban' | 'liste' | 'productivite'>('kanban')
const filterAssignee = ref<string>('')
const filterPriorite = ref<string>('')
const searchQ = ref('')

const showForm = ref(false)
const editTarget = ref<Tache | null>(null)
const form = ref({
  titre: '',
  description: '',
  assignee_ids: [] as number[],
  priorite: 'normale',
  statut: 'a_faire',
  date_debut: '',
  deadline: '',
})

const ROLE_LABEL: Record<string, string> = {
  dg: 'DG', dir_peda: 'Dir. études', resp_fin: 'Resp. Fin.',
  coordinateur: 'Dir. adj. études', secretariat: 'Secrétariat', enseignant: 'Enseignant',
}

const PRIORITE_CONF = {
  urgente: { label: 'Urgente', color: 'bg-red-100 text-red-700 border-red-200' },
  haute: { label: 'Haute', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  normale: { label: 'Normale', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  basse: { label: 'Basse', color: 'bg-gray-100 text-gray-600 border-gray-200' },
} as const

const STATUT_CONF = {
  a_faire: { label: 'À faire', color: 'bg-gray-100 text-gray-700' },
  en_cours: { label: 'En cours', color: 'bg-blue-100 text-blue-700' },
  en_revue: { label: 'En revue', color: 'bg-purple-100 text-purple-700' },
  termine: { label: 'Terminé', color: 'bg-green-100 text-green-700' },
} as const

const kanbanColumns: { key: Tache['statut']; label: string }[] = [
  { key: 'a_faire', label: 'À faire' },
  { key: 'en_cours', label: 'En cours' },
  { key: 'en_revue', label: 'En revue' },
  { key: 'termine', label: 'Terminé' },
]

const filteredTaches = computed(() => {
  return taches.value.filter(t => {
    if (filterAssignee.value) {
      const targetId = Number(filterAssignee.value)
      const match = (t.assignees ?? []).some(a => a.id === targetId)
      if (!match) return false
    }
    if (filterPriorite.value && t.priorite !== filterPriorite.value) return false
    if (searchQ.value) {
      const q = searchQ.value.toLowerCase()
      const hay = `${t.titre} ${t.description ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

function tachesByStatut(statut: Tache['statut']) {
  return filteredTaches.value.filter(t => t.statut === statut)
}

function isOverdue(t: Tache) {
  if (!t.deadline || t.statut === 'termine') return false
  return new Date(t.deadline) < new Date(new Date().toDateString())
}

function formatDate(d: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function initials(prenom?: string | null, nom?: string | null) {
  return `${(prenom ?? '')[0] ?? '?'}${(nom ?? '')[0] ?? ''}`.toUpperCase()
}

async function loadAll() {
  loading.value = true
  try {
    const [tachesRes, usersRes] = await Promise.all([
      api.get('/taches'),
      isManager.value ? api.get('/users').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ])
    taches.value = tachesRes.data
    // Accepte tous les rôles administratifs/pédagogiques et exclut seulement les
    // statuts explicitement désactivés — un statut null/undefined reste éligible.
    const ASSIGNABLE_ROLES = ['dg','dir_peda','resp_fin','coordinateur','secretariat']
    const BLOCKED_STATUS = ['inactif','suspendu','supprime','bloque']
    users.value = (usersRes.data as User[]).filter(u => {
      if (!ASSIGNABLE_ROLES.includes(u.role)) return false
      if (u.statut && BLOCKED_STATUS.includes(String(u.statut).toLowerCase())) return false
      return true
    })
    if (isManager.value && users.value.length === 0 && Array.isArray(usersRes.data)) {
      // Diagnostic : liste vide alors que le fetch a réussi → rôles/statuts anormaux en base
      // eslint-disable-next-line no-console
      console.warn('[Taches] Aucun utilisateur assignable. Data brute:', usersRes.data)
    }
    if (isManager.value) {
      const statsRes = await api.get('/taches/stats').catch(() => ({ data: [] }))
      stats.value = statsRes.data
    }
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editTarget.value = null
  form.value = { titre: '', description: '', assignee_ids: [], priorite: 'normale', statut: 'a_faire', date_debut: '', deadline: '' }
  error.value = ''
  showForm.value = true
}

function openEdit(t: Tache) {
  editTarget.value = t
  form.value = {
    titre: t.titre,
    description: t.description ?? '',
    assignee_ids: (t.assignees ?? []).map(a => a.id),
    priorite: t.priorite,
    statut: t.statut,
    date_debut: t.date_debut ? t.date_debut.slice(0, 10) : '',
    deadline: t.deadline ? t.deadline.slice(0, 10) : '',
  }
  error.value = ''
  showForm.value = true
}

function toggleAssignee(uid: number) {
  const idx = form.value.assignee_ids.indexOf(uid)
  if (idx === -1) form.value.assignee_ids.push(uid)
  else form.value.assignee_ids.splice(idx, 1)
}

async function save() {
  saving.value = true
  error.value = ''
  if (form.value.date_debut && form.value.deadline && form.value.deadline < form.value.date_debut) {
    error.value = 'La date de fin doit être postérieure ou égale à la date de début.'
    saving.value = false
    return
  }
  try {
    const payload = {
      titre: form.value.titre,
      description: form.value.description,
      priorite: form.value.priorite,
      statut: form.value.statut,
      assignee_ids: form.value.assignee_ids,
      date_debut: form.value.date_debut || null,
      deadline: form.value.deadline || null,
    }
    if (editTarget.value) {
      await api.put(`/taches/${editTarget.value.id}`, payload)
    } else {
      await api.post('/taches', payload)
    }
    showForm.value = false
    await loadAll()
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur'
  } finally {
    saving.value = false
  }
}

function canChangeStatut(_t: Tache, _statut: Tache['statut']): boolean {
  // Tout rôle administratif qui accède à la page peut changer le statut de
  // n'importe quelle tâche. L'accès à la page est déjà verrouillé côté back
  // (TACHES_ROLES), donc inutile de re-filtrer ici.
  return true
}

async function changeStatut(t: Tache, statut: Tache['statut']) {
  if (t.statut === statut) return
  if (!canChangeStatut(t, statut)) return
  const prev = t.statut
  t.statut = statut
  try {
    await api.put(`/taches/${t.id}/statut`, { statut })
    if (statut === 'termine') t.completed_at = new Date().toISOString()
    else t.completed_at = null
    if (isManager.value) {
      const statsRes = await api.get('/taches/stats').catch(() => ({ data: [] }))
      stats.value = statsRes.data
    }
  } catch {
    t.statut = prev
  }
}

async function markDone(t: Tache) {
  await changeStatut(t, 'termine')
}

async function removeTache(t: Tache) {
  if (!confirm(`Supprimer la tâche "${t.titre}" ?`)) return
  try {
    await api.delete(`/taches/${t.id}`)
    taches.value = taches.value.filter(x => x.id !== t.id)
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  }
}

// Drag & drop Kanban — seul le DG peut déplacer librement ; un assigné ne peut
// que "drop" dans la colonne Terminé.
const dragId = ref<number | null>(null)
function onDragStart(t: Tache) {
  dragId.value = t.id
}
function onDrop(statut: Tache['statut']) {
  if (dragId.value == null) return
  const t = taches.value.find(x => x.id === dragId.value)
  if (t && canChangeStatut(t, statut)) changeStatut(t, statut)
  dragId.value = null
}

onMounted(loadAll)
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 py-8">
    <!-- Header ───────────────────────────────────────────────────── -->
    <header class="mb-6 flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-600">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
          Productivité équipe
        </div>
        <h1 class="mt-1 text-2xl font-bold tracking-tight text-gray-900">Tâches &amp; productivité</h1>
        <p class="mt-1 text-sm text-gray-500">Suivi du travail de l'équipe administrative</p>
      </div>
      <button v-if="isManager" @click="openCreate"
        class="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 hover:shadow">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        Nouvelle tâche
      </button>
    </header>

    <!-- Tabs ────────────────────────────────────────────────────── -->
    <div class="mb-5 inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
      <button @click="tab = 'kanban'"
        :class="['inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
          tab === 'kanban' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50']">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        Kanban
      </button>
      <button @click="tab = 'liste'"
        :class="['inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
          tab === 'liste' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50']">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
        Liste
      </button>
      <button v-if="isManager" @click="tab = 'productivite'"
        :class="['inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
          tab === 'productivite' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50']">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        Productivité
      </button>
    </div>

    <!-- Filtres ─────────────────────────────────────────────────── -->
    <div v-if="tab !== 'productivite'" class="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
      <div class="relative flex-1 min-w-[220px]">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/></svg>
        <input v-model="searchQ" placeholder="Rechercher une tâche…"
          class="w-full rounded-lg border-0 bg-transparent px-3 py-2 pl-9 text-sm outline-none focus:ring-2 focus:ring-red-500" />
      </div>
      <select v-if="isManager" v-model="filterAssignee"
        class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
        <option value="">Tous les agents</option>
        <option v-for="u in users" :key="u.id" :value="String(u.id)">
          {{ u.prenom }} {{ u.nom }} ({{ ROLE_LABEL[u.role] || u.role }})
        </option>
      </select>
      <select v-model="filterPriorite"
        class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
        <option value="">Toutes priorités</option>
        <option value="urgente">Urgente</option>
        <option value="haute">Haute</option>
        <option value="normale">Normale</option>
        <option value="basse">Basse</option>
      </select>
      <span class="ml-auto px-2 text-xs text-gray-500">
        {{ filteredTaches.length }} tâche{{ filteredTaches.length > 1 ? 's' : '' }}
      </span>
    </div>

    <div v-if="loading" class="rounded-2xl border border-gray-200 bg-white p-16 text-center">
      <div class="inline-block h-8 w-8 animate-spin rounded-full border-2 border-red-200 border-t-red-600"></div>
      <p class="mt-3 text-sm text-gray-500">Chargement des tâches…</p>
    </div>

    <!-- Vue KANBAN ──────────────────────────────────────────────── -->
    <div v-else-if="tab === 'kanban'" class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div v-for="col in kanbanColumns" :key="col.key"
        class="flex flex-col rounded-2xl border border-gray-200 bg-gray-50/70 p-3 min-h-[500px]"
        @dragover.prevent
        @drop.prevent="onDrop(col.key)">
        <!-- En-tête colonne -->
        <div class="mb-3 flex items-center justify-between px-1">
          <div class="flex items-center gap-2">
            <span :class="['h-2.5 w-2.5 rounded-full',
              col.key === 'a_faire' ? 'bg-gray-400' :
              col.key === 'en_cours' ? 'bg-blue-500' :
              col.key === 'en_revue' ? 'bg-violet-500' : 'bg-emerald-500']"></span>
            <h3 class="text-sm font-semibold text-gray-800">{{ col.label }}</h3>
          </div>
          <span class="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-600 shadow-sm">
            {{ tachesByStatut(col.key).length }}
          </span>
        </div>
        <!-- Cartes -->
        <div class="space-y-2 flex-1">
          <div v-for="t in tachesByStatut(col.key)" :key="t.id"
            draggable="true"
            @dragstart="onDragStart(t)"
            class="group relative cursor-grab overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md active:cursor-grabbing">
            <!-- Liseret priorité -->
            <div :class="['absolute left-0 top-0 h-full w-1',
              t.priorite === 'urgente' ? 'bg-red-500' :
              t.priorite === 'haute' ? 'bg-orange-400' :
              t.priorite === 'normale' ? 'bg-blue-400' : 'bg-gray-300']"></div>

            <div class="pl-3 pr-3 py-3">
              <!-- Ligne priorité + actions -->
              <div class="mb-1.5 flex items-start justify-between gap-2">
                <span :class="['inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', PRIORITE_CONF[t.priorite].color]">
                  {{ PRIORITE_CONF[t.priorite].label }}
                </span>
                <div class="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button v-if="isManager" @click="openEdit(t)"
                    class="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-red-600"
                    title="Modifier">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  </button>
                  <button
                    v-if="!isManager && (t.assignees ?? []).some(a => a.id === auth.user?.id) && t.statut !== 'termine'"
                    @click="markDone(t)"
                    class="rounded p-1 text-emerald-500 transition hover:bg-emerald-50 hover:text-emerald-700"
                    title="Marquer terminé">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                  </button>
                </div>
              </div>
              <!-- Titre -->
              <h4 class="mb-1 text-sm font-semibold leading-snug text-gray-900">{{ t.titre }}</h4>
              <!-- Description -->
              <p v-if="t.description" class="mb-2 line-clamp-2 text-xs text-gray-500">{{ t.description }}</p>
              <!-- Échéancier -->
              <div v-if="t.date_debut || t.deadline"
                :class="['mb-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
                  isOverdue(t) ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600']">
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                <template v-if="t.date_debut && t.deadline">
                  {{ formatDate(t.date_debut) }} → {{ formatDate(t.deadline) }}
                </template>
                <template v-else-if="t.date_debut">Début : {{ formatDate(t.date_debut) }}</template>
                <template v-else-if="t.deadline">Échéance : {{ formatDate(t.deadline) }}</template>
                <span v-if="isOverdue(t)" class="ml-0.5">⚠</span>
              </div>
              <!-- Assignés -->
              <div class="flex items-center justify-between">
                <div v-if="(t.assignees ?? []).length" class="flex items-center">
                  <div v-for="(a, idx) in (t.assignees ?? []).slice(0, 3)" :key="a.id"
                    :style="{ marginLeft: idx === 0 ? '0' : '-8px', zIndex: 3 - idx }"
                    :title="`${a.prenom} ${a.nom}`"
                    class="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-red-500 to-red-700 text-[9px] font-bold text-white shadow-sm">
                    {{ initials(a.prenom, a.nom) }}
                  </div>
                  <span v-if="(t.assignees ?? []).length > 3"
                    class="ml-1 text-[10px] font-semibold text-gray-500">
                    +{{ (t.assignees ?? []).length - 3 }}
                  </span>
                  <span v-else-if="(t.assignees ?? []).length === 1" class="ml-1.5 max-w-[100px] truncate text-[11px] text-gray-600">
                    {{ t.assignees?.[0]?.prenom }} {{ t.assignees?.[0]?.nom }}
                  </span>
                </div>
                <span v-else class="text-[11px] italic text-gray-400">Non assignée</span>
              </div>
            </div>
          </div>
          <div v-if="tachesByStatut(col.key).length === 0"
            class="rounded-lg border border-dashed border-gray-300 bg-white/60 py-6 text-center text-[11px] italic text-gray-400">
            Aucune tâche
          </div>
        </div>
      </div>
    </div>

    <!-- Vue LISTE — groupée par statut (4 sections À faire / En cours / En revue / Terminé) -->
    <div v-else-if="tab === 'liste'" class="space-y-4">
      <div v-if="filteredTaches.length === 0"
        class="rounded-2xl border border-dashed border-gray-300 bg-white p-16 text-center">
        <svg class="mx-auto h-10 w-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
        <p class="mt-3 text-sm font-medium text-gray-700">Aucune tâche ne correspond aux filtres.</p>
      </div>
      <div v-for="col in kanbanColumns" :key="col.key"
        class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div :class="['flex items-center justify-between px-4 py-3 border-b', STATUT_CONF[col.key].color]">
          <div class="flex items-center gap-2">
            <span :class="['h-2.5 w-2.5 rounded-full',
              col.key === 'a_faire' ? 'bg-gray-500' :
              col.key === 'en_cours' ? 'bg-blue-600' :
              col.key === 'en_revue' ? 'bg-violet-600' : 'bg-emerald-600']"></span>
            <h3 class="text-sm font-bold">{{ col.label }}</h3>
          </div>
          <span class="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold shadow-sm">
            {{ tachesByStatut(col.key).length }}
          </span>
        </div>
        <div v-if="tachesByStatut(col.key).length === 0" class="px-4 py-6 text-center text-xs text-gray-400 italic">
          Aucune tâche dans cette catégorie
        </div>
        <table v-else class="w-full">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Titre</th>
              <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Assigné à</th>
              <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Priorité</th>
              <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
              <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Début</th>
              <th class="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Fin</th>
              <th class="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in tachesByStatut(col.key)" :key="t.id" class="hover:bg-gray-50 transition">
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-gray-900">{{ t.titre }}</div>
                <div v-if="t.description" class="text-xs text-gray-500 line-clamp-1">{{ t.description }}</div>
              </td>
              <td class="px-4 py-3 text-sm text-gray-700">
                <template v-if="(t.assignees ?? []).length">
                  <span v-for="(a, idx) in (t.assignees ?? [])" :key="a.id">
                    {{ a.prenom }} {{ a.nom }}<span v-if="idx < (t.assignees ?? []).length - 1">, </span>
                  </span>
                </template>
                <span v-else class="text-gray-400 italic">—</span>
              </td>
              <td class="px-4 py-3">
                <span :class="['text-xs font-medium px-2 py-0.5 rounded border', PRIORITE_CONF[t.priorite].color]">
                  {{ PRIORITE_CONF[t.priorite].label }}
                </span>
              </td>
              <td class="px-4 py-3">
                <select :value="t.statut" @change="changeStatut(t, ($event.target as HTMLSelectElement).value as Tache['statut'])"
                  :class="['text-xs font-medium px-2 py-1 rounded border-0 cursor-pointer', STATUT_CONF[t.statut].color]">
                  <option value="a_faire">À faire</option>
                  <option value="en_cours">En cours</option>
                  <option value="en_revue">En revue</option>
                  <option value="termine">Terminé</option>
                </select>
              </td>
              <td class="px-4 py-3 text-sm">
                <span v-if="t.date_debut" class="text-gray-600">{{ formatDate(t.date_debut) }}</span>
                <span v-else class="text-gray-400">—</span>
              </td>
              <td class="px-4 py-3 text-sm">
                <span v-if="t.deadline" :class="isOverdue(t) ? 'text-red-600 font-medium' : 'text-gray-600'">
                  {{ formatDate(t.deadline) }}
                  <span v-if="isOverdue(t)" class="ml-1 text-xs">(en retard)</span>
                </span>
                <span v-else class="text-gray-400">—</span>
              </td>
              <td class="px-4 py-3 text-right">
                <button v-if="isManager" @click="openEdit(t)" class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition" title="Modifier">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button v-if="isManager || t.created_by === auth.user?.id" @click="removeTache(t)"
                  class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition" title="Supprimer">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Vue PRODUCTIVITE ────────────────────────────────────────── -->
    <div v-else-if="tab === 'productivite'" class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div v-if="stats.length === 0" class="p-16 text-center text-gray-500">
        <svg class="mx-auto h-10 w-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        <p class="mt-3 text-sm font-medium text-gray-700">Aucune donnée de productivité pour l'instant.</p>
        <p class="mt-1 text-xs text-gray-500">Elle apparaîtra dès qu'une tâche sera assignée.</p>
      </div>
      <table v-else class="w-full">
        <thead class="border-b border-gray-200 bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Agent</th>
            <th class="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Rôle</th>
            <th class="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500" style="min-width:200px;">Répartition</th>
            <th class="px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-red-600">Retard</th>
            <th class="px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Faites 30j</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="s in stats" :key="s.id" class="transition hover:bg-gray-50">
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 text-[11px] font-bold text-white shadow-sm">
                  {{ initials(s.prenom, s.nom) }}
                </div>
                <div>
                  <div class="text-sm font-semibold text-gray-900">{{ s.prenom }} {{ s.nom }}</div>
                  <div class="text-[11px] text-gray-500">{{ s.total }} tâche{{ s.total > 1 ? 's' : '' }}</div>
                </div>
              </div>
            </td>
            <td class="px-4 py-3 text-sm text-gray-600">{{ ROLE_LABEL[s.role] || s.role }}</td>
            <td class="px-4 py-3">
              <!-- Barre empilée + légende chiffrée -->
              <div class="flex h-2 overflow-hidden rounded-full bg-gray-100">
                <div v-if="s.a_faire" class="bg-gray-400" :style="{ width: (s.a_faire / Math.max(1, s.total)) * 100 + '%' }" :title="`${s.a_faire} à faire`"></div>
                <div v-if="s.en_cours" class="bg-blue-500" :style="{ width: (s.en_cours / Math.max(1, s.total)) * 100 + '%' }" :title="`${s.en_cours} en cours`"></div>
                <div v-if="s.en_revue" class="bg-violet-500" :style="{ width: (s.en_revue / Math.max(1, s.total)) * 100 + '%' }" :title="`${s.en_revue} en revue`"></div>
                <div v-if="s.termine" class="bg-emerald-500" :style="{ width: (s.termine / Math.max(1, s.total)) * 100 + '%' }" :title="`${s.termine} terminées`"></div>
              </div>
              <div class="mt-1 flex gap-2 text-[10px] text-gray-500">
                <span><span class="inline-block h-1.5 w-1.5 rounded-full bg-gray-400"></span> {{ s.a_faire }}</span>
                <span><span class="inline-block h-1.5 w-1.5 rounded-full bg-blue-500"></span> {{ s.en_cours }}</span>
                <span><span class="inline-block h-1.5 w-1.5 rounded-full bg-violet-500"></span> {{ s.en_revue }}</span>
                <span><span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span> {{ s.termine }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-center">
              <span :class="s.en_retard > 0 ? 'inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700 ring-1 ring-inset ring-red-100' : 'text-sm text-gray-300'">
                {{ s.en_retard }}
              </span>
            </td>
            <td class="px-4 py-3 text-center">
              <span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-100">
                {{ s.termines_30j }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal création / édition -->
    <Teleport to="body">
      <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40" @click="showForm = false" />
        <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
          <h2 class="text-base font-semibold text-gray-900 mb-4">
            {{ editTarget ? 'Modifier la tâche' : 'Nouvelle tâche' }}
          </h2>
          <div v-if="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{{ error }}</div>
          <form @submit.prevent="save" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Titre <span class="text-red-500">*</span></label>
              <input v-model="form.titre" required
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Description</label>
              <textarea v-model="form.description" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">
                Assigner à
                <span class="text-[11px] font-normal text-gray-500">(cochez un ou plusieurs agents)</span>
              </label>
              <div class="max-h-44 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-1">
                <div v-if="users.length === 0" class="text-xs text-gray-400 italic text-center py-2">
                  Aucun agent assignable.
                </div>
                <label v-for="u in users" :key="u.id"
                  class="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <input type="checkbox"
                    :checked="form.assignee_ids.includes(u.id)"
                    @change="toggleAssignee(u.id)"
                    class="accent-red-600" />
                  <span class="text-gray-900 flex-1 truncate">{{ u.prenom }} {{ u.nom }}</span>
                  <span class="text-xs text-gray-500">{{ ROLE_LABEL[u.role] || u.role }}</span>
                </label>
              </div>
              <p v-if="form.assignee_ids.length" class="text-[11px] text-gray-500 mt-1">
                {{ form.assignee_ids.length }} agent(s) sélectionné(s).
              </p>
              <p v-else class="text-[11px] text-gray-500 mt-1">
                Aucun sélectionné → la tâche sera non assignée.
              </p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Priorité</label>
                <select v-model="form.priorite"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="basse">Basse</option>
                  <option value="normale">Normale</option>
                  <option value="haute">Haute</option>
                  <option value="urgente">Urgente</option>
                </select>
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Échéancier</label>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] text-gray-500 mb-1">Date de début</label>
                  <input v-model="form.date_debut" type="date"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
                <div>
                  <label class="block text-[11px] text-gray-500 mb-1">Date de fin</label>
                  <input v-model="form.deadline" type="date" :min="form.date_debut || undefined"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
              </div>
              <p class="mt-1 text-[11px] text-gray-500 leading-snug">
                À 08:00 de la date de début, la tâche passe automatiquement en « En cours ». Après la date de fin, elle bascule en « En revue » tant qu'elle n'est pas terminée.
              </p>
            </div>
            <div v-if="editTarget">
              <label class="block text-xs font-medium text-gray-700 mb-1">Statut</label>
              <select v-model="form.statut"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                <option value="a_faire">À faire</option>
                <option value="en_cours">En cours</option>
                <option value="en_revue">En revue</option>
                <option value="termine">Terminé</option>
              </select>
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
