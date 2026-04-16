<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import api from '@/services/api'

interface User {
  id: number
  nom: string
  prenom: string
  email: string
  telephone: string | null
  role: string
  statut: string
  last_login_at: string | null
}

const users = ref<User[]>([])
const loading = ref(true)
const saving = ref(false)
const resetting = ref<number | null>(null)
const bulkCreating = ref(false)
const error = ref('')
const showForm = ref(false)
const editTarget = ref<User | null>(null)
const filterRole = ref('')
const filterStatut = ref('')

const form = ref({ nom: '', prenom: '', email: '', telephone: '', role: '', statut: 'actif' })

const roleLabels: Record<string, string> = {
  dg: 'Directeur Général',
  dir_peda: 'Directeur Pédagogique',
  resp_fin: 'Resp. Financier',
  coordinateur: 'Coordinateur',
  secretariat: 'Secrétariat',
  enseignant: 'Enseignant',
  etudiant: 'Étudiant',
  parent: 'Parent / Tuteur',
}

const roleColors: Record<string, string> = {
  dg: 'bg-purple-100 text-purple-700',
  dir_peda: 'bg-blue-100 text-blue-700',
  resp_fin: 'bg-emerald-100 text-emerald-700',
  coordinateur: 'bg-red-100 text-red-700',
  secretariat: 'bg-yellow-100 text-yellow-700',
  enseignant: 'bg-teal-100 text-teal-700',
  etudiant: 'bg-indigo-100 text-indigo-700',
  parent: 'bg-pink-100 text-pink-700',
}

const statutColors: Record<string, string> = {
  actif: 'bg-green-100 text-green-700',
  inactif: 'bg-gray-100 text-gray-500',
  suspendu: 'bg-yellow-100 text-yellow-700',
  bloque: 'bg-red-100 text-red-700',
}

const searchQuery = ref('')

const filtered = computed(() =>
  users.value.filter(u => {
    if (filterRole.value && u.role !== filterRole.value) return false
    if (filterStatut.value && u.statut !== filterStatut.value) return false
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      return `${u.prenom} ${u.nom} ${u.email}`.toLowerCase().includes(q)
    }
    return true
  })
)

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function openCreate() {
  editTarget.value = null
  form.value = { nom: '', prenom: '', email: '', telephone: '', role: 'secretariat', statut: 'actif' }
  error.value = ''
  showForm.value = true
}

function openEdit(u: User) {
  editTarget.value = u
  form.value = { nom: u.nom, prenom: u.prenom, email: u.email, telephone: u.telephone ?? '', role: u.role, statut: u.statut }
  error.value = ''
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  error.value = ''
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/users')
    users.value = data
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (editTarget.value) {
      const { data } = await api.put(`/users/${editTarget.value.id}`, form.value)
      const idx = users.value.findIndex(u => u.id === data.id)
      if (idx !== -1) users.value[idx] = data
    } else {
      const { data } = await api.post('/users', form.value)
      users.value.push(data)
    }
    closeForm()
  } catch (e: any) {
    const errs = e.response?.data?.errors as Record<string, string[]> | undefined
    error.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? e.response?.data?.message ?? 'Erreur'
  } finally {
    saving.value = false
  }
}

async function bulkCreateEtudiants() {
  if (!confirm('Créer automatiquement les comptes pour tous les étudiants sans compte ?\nMot de passe par défaut : Uptech@2026')) return
  bulkCreating.value = true
  try {
    const { data } = await api.post('/users/bulk-etudiants', {})
    alert(data.message)
    await load()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur lors de la création des comptes.')
  } finally {
    bulkCreating.value = false
  }
}

async function toggleStatut(u: User) {
  const newStatut = u.statut === 'actif' ? 'bloque' : 'actif'
  const action = newStatut === 'actif' ? 'Débloquer' : 'Bloquer'
  if (!confirm(`${action} le compte de ${u.prenom} ${u.nom} ?`)) return
  try {
    const { data } = await api.put(`/users/${u.id}`, { ...u, statut: newStatut })
    const idx = users.value.findIndex(x => x.id === data.id)
    if (idx !== -1) users.value[idx] = data
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  }
}

async function resetPassword(u: User) {
  if (!confirm(`Réinitialiser le mot de passe de ${u.prenom} ${u.nom} ?`)) return
  resetting.value = u.id
  try {
    await api.post(`/users/${u.id}/reset-password`)
    alert(`Mot de passe réinitialisé : Uptech@2026`)
  } finally {
    resetting.value = null
  }
}

onMounted(load)

// ── Permissions matrix ──────────────────────────────────────────────
const activeTab = ref<'users' | 'permissions'>('users')
const permSaving = ref(false)
const permSaved = ref(false)
const permLoading = ref(false)

const PERM_ROLES = ['dg','dir_peda','resp_fin','coordinateur','secretariat','enseignant']
const PERM_ROLE_LABELS: Record<string,string> = {
  dg: 'DG', dir_peda: 'Dir. Péda', resp_fin: 'Resp. Fin.',
  coordinateur: 'Coord.', secretariat: 'Secrét.', enseignant: 'Enseignant',
}
const PERM_ROLE_COLORS: Record<string,string> = {
  dg: '#7c3aed', dir_peda: '#2563eb', resp_fin: '#059669',
  coordinateur: '#dc2626', secretariat: '#d97706', enseignant: '#0891b2',
}

const PAGE_SECTIONS = [
  {
    label: '📊 Principal',
    pages: [
      { path: '/dashboard',  label: 'Tableau de bord' },
      { path: '/rapports',   label: 'Rapports' },
    ],
  },
  {
    label: '🎓 Pédagogie',
    pages: [
      { path: '/etudiants',                label: 'Étudiants' },
      { path: '/dossiers-etudiants',       label: 'Dossiers étudiants' },
      { path: '/classes',                  label: 'Classes' },
      { path: '/emplois-du-temps',         label: 'Emplois du temps' },
      { path: '/emargement',               label: 'Émargement' },
      { path: '/suivi-emargements',        label: 'Suivi émargements' },
      { path: '/cahier-de-textes',         label: 'Cahier de textes' },
      { path: '/absences',                 label: 'Absences' },
      { path: '/notes-bulletins',          label: 'Notes & Bulletins' },
      { path: '/enseignants',              label: 'Enseignants' },
    ],
  },
  {
    label: '💰 Finances',
    pages: [
      { path: '/finance',                  label: 'Tableau financier' },
      { path: '/paiements',                label: 'Paiements' },
      { path: '/suivi-paiements',          label: 'Suivi paiements' },
      { path: '/caisse',                   label: 'Caisse' },
      { path: '/depenses',                 label: 'Dépenses' },
      { path: '/vacations',                label: 'Vacations' },
      { path: '/formations-individuelles', label: 'Formations individuelles' },
    ],
  },
  {
    label: '📢 Communication',
    pages: [
      { path: '/communication', label: 'Communication' },
    ],
  },
  {
    label: '⚙️ Administration',
    pages: [
      { path: '/users',       label: 'Utilisateurs' },
      { path: '/filieres',    label: 'Filières & Maquettes' },
      { path: '/parametres',  label: 'Paramètres' },
    ],
  },
]

// ── Valeurs par défaut codées en dur (rôles autorisés pour chaque page) ──
// Ces défauts sont appliqués immédiatement à l'ouverture de l'onglet.
// La DB peut ensuite les écraser si l'admin a sauvegardé des personnalisations.
const DEFAULT_PERMS: Record<string, string[]> = {
  // Principal
  '/dashboard':               ['dg','dir_peda','resp_fin','coordinateur','secretariat','enseignant'],
  '/rapports':                ['dg','dir_peda','resp_fin'],
  // Pédagogie
  '/etudiants':               ['dg','dir_peda','resp_fin','coordinateur','secretariat'],
  '/dossiers-etudiants':      ['dg','dir_peda','coordinateur','secretariat'],
  '/classes':                 ['dg','dir_peda','coordinateur'],
  '/emplois-du-temps':        ['dg','dir_peda','coordinateur','secretariat','enseignant'],
  '/emargement':              ['dg','dir_peda','coordinateur','secretariat','enseignant'],
  '/suivi-emargements':       ['dg','dir_peda','coordinateur','secretariat'],
  '/cahier-de-textes':        ['dg','dir_peda','coordinateur','secretariat','enseignant'],
  '/absences':                ['dg','dir_peda','coordinateur','secretariat'],
  '/notes-bulletins':         ['dg','dir_peda','coordinateur','enseignant'],
  '/enseignants':             ['dg','dir_peda','coordinateur','secretariat'],
  // Finances
  '/finance':                 ['dg','resp_fin'],
  '/paiements':               ['dg','resp_fin','secretariat'],
  '/suivi-paiements':         ['dg','resp_fin','secretariat'],
  '/caisse':                  ['dg','resp_fin','secretariat'],
  '/depenses':                ['dg','resp_fin'],
  '/vacations':               ['dg','resp_fin','coordinateur'],
  '/formations-individuelles':['dg','resp_fin','coordinateur'],
  // Communication
  '/communication':           ['dg','dir_peda','coordinateur','secretariat'],
  // Administration
  '/users':                   ['dg'],
  '/filieres':                ['dg','dir_peda'],
  '/parametres':              ['dg'],
}

/** Construit la map permissions depuis les défauts codés en dur */
function buildDefaultMap(): Record<string, Record<string, boolean>> {
  const map: Record<string, Record<string, boolean>> = {}
  for (const sec of PAGE_SECTIONS) {
    for (const page of sec.pages) {
      map[page.path] = {}
      for (const r of PERM_ROLES) {
        map[page.path]![r] = (DEFAULT_PERMS[page.path] ?? []).includes(r)
      }
    }
  }
  return map
}

// permissions[path][role] = true/false
// Initialisé immédiatement avec les défauts → les cases sont déjà cochées dès l'ouverture
const permissions = ref<Record<string, Record<string, boolean>>>(buildDefaultMap())

function getPerm(path: string, role: string): boolean {
  return permissions.value[path]?.[role] ?? false
}
function setPerm(path: string, role: string, val: boolean) {
  if (!permissions.value[path]) permissions.value[path] = {}
  permissions.value[path]![role] = val
}

async function loadPermissions() {
  permLoading.value = true
  try {
    // 1. Partir des défauts (déjà affichés) puis écraser avec ce que la DB a sauvegardé
    const map = buildDefaultMap()
    const { data } = await api.get('/role-permissions')
    for (const p of data) {
      if (map[p.page_path]) map[p.page_path]![p.role] = p.has_access
    }
    permissions.value = map
  } catch (_) {
    // En cas d'erreur réseau, on garde les défauts déjà affichés
  }
  permLoading.value = false
}

async function savePermissions() {
  permSaving.value = true
  const perms: any[] = []
  for (const [path, roleMap] of Object.entries(permissions.value)) {
    for (const [r, has] of Object.entries(roleMap)) {
      perms.push({ role: r, page_path: path, has_access: has })
    }
  }
  try {
    await api.put('/role-permissions', perms)
    permSaved.value = true
    setTimeout(() => { permSaved.value = false }, 3000)
  } catch (_) {}
  permSaving.value = false
}

// Synchronise avec la DB à chaque ouverture de l'onglet permissions
watch(activeTab, (tab) => {
  if (tab === 'permissions') loadPermissions()
})
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">

    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-gray-900">Utilisateurs</h1>
        <p class="text-sm text-gray-500 mt-0.5">Comptes d'accès à la plateforme</p>
      </div>
      <div class="flex gap-2">
        <button
          @click="bulkCreateEtudiants"
          :disabled="bulkCreating"
          class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
          </svg>
          {{ bulkCreating ? 'Création…' : 'Comptes étudiants' }}
        </button>
        <button
          @click="openCreate"
          class="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Nouveau compte
        </button>
      </div>
    </div>

    <!-- Tab switcher -->
    <div class="pm-tabs">
      <button :class="['pm-tab', activeTab==='users' ? 'pm-tab--active' : '']" @click="activeTab='users'">
        👥 Utilisateurs
      </button>
      <button :class="['pm-tab', activeTab==='permissions' ? 'pm-tab--active' : '']" @click="activeTab='permissions'">
        🔐 Permissions & Accès
      </button>
    </div>

    <!-- Users tab content -->
    <div v-if="activeTab==='users'">
      <!-- Filters -->
      <div class="flex flex-wrap gap-3 mb-4">
        <input v-model="searchQuery" type="text" placeholder="Rechercher par nom, prénom ou email…"
          class="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 w-64" />
        <select v-model="filterRole"
          class="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 bg-white">
          <option value="">Tous les rôles</option>
          <option v-for="(label, key) in roleLabels" :key="key" :value="key">{{ label }}</option>
        </select>
        <select v-model="filterStatut"
          class="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 bg-white">
          <option value="">Tous les statuts</option>
          <option value="actif">Actif</option>
          <option value="inactif">Inactif</option>
          <option value="suspendu">Suspendu</option>
          <option value="bloque">Bloqué</option>
        </select>
        <span class="ml-auto text-sm text-gray-500 self-center">{{ filtered.length }} utilisateur{{ filtered.length !== 1 ? 's' : '' }}</span>
      </div>

      <!-- Table -->
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div v-if="loading" class="p-12 text-center text-gray-400 text-sm">Chargement…</div>
        <div v-else-if="filtered.length === 0" class="p-12 text-center">
          <svg class="w-10 h-10 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <p class="text-gray-500 text-sm">Aucun utilisateur trouvé</p>
        </div>
        <table v-else class="w-full">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Utilisateur</th>
              <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Rôle</th>
              <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Statut</th>
              <th class="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Dernière connexion</th>
              <th class="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="u in filtered" :key="u.id" class="hover:bg-gray-50 transition">
              <td class="px-5 py-3.5">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                    <span class="text-xs font-bold text-red-700 uppercase">{{ u.prenom[0] }}{{ u.nom[0] }}</span>
                  </div>
                  <div>
                    <p class="text-sm font-medium text-gray-900">{{ u.prenom }} {{ u.nom }}</p>
                    <p class="text-xs text-gray-500">{{ u.email }}</p>
                  </div>
                </div>
              </td>
              <td class="px-5 py-3.5">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                  :class="roleColors[u.role] ?? 'bg-gray-100 text-gray-600'">
                  {{ roleLabels[u.role] ?? u.role }}
                </span>
              </td>
              <td class="px-5 py-3.5">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                  :class="statutColors[u.statut] ?? 'bg-gray-100 text-gray-600'">
                  {{ u.statut }}
                </span>
              </td>
              <td class="px-5 py-3.5 text-sm text-gray-500">{{ formatDate(u.last_login_at) }}</td>
              <td class="px-5 py-3.5 text-right">
                <div class="flex items-center justify-end gap-1">
                  <button @click="openEdit(u)" title="Modifier"
                    class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button @click="toggleStatut(u)"
                    :title="u.statut === 'actif' ? 'Bloquer le compte' : 'Débloquer le compte'"
                    :class="u.statut === 'actif'
                      ? 'p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition'
                      : 'p-1.5 text-red-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition'">
                    <svg v-if="u.statut !== 'actif'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                    <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </button>
                  <button @click="resetPassword(u)" :disabled="resetting === u.id" title="Réinitialiser le mot de passe"
                    class="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition disabled:opacity-50">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Permissions tab content -->
    <div v-else class="pm-wrap">
      <div class="pm-toolbar">
        <div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">Matrice des accès par rôle</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Cochez les accès autorisés pour chaque rôle. Le DG a toujours accès à tout.</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <transition name="pm-fade">
            <span v-if="permSaved" style="color:#16a34a;font-size:13px;font-weight:600;">✓ Sauvegardé</span>
          </transition>
          <button @click="savePermissions" :disabled="permSaving" class="pm-save-btn">
            {{ permSaving ? '⏳ Sauvegarde…' : '💾 Sauvegarder' }}
          </button>
        </div>
      </div>

      <div v-if="permLoading" style="padding:48px;text-align:center;color:#94a3b8;">Chargement…</div>

      <div v-else class="pm-scroll">
        <table class="pm-table">
          <thead>
            <tr>
              <th class="pm-th-page">Page / Section</th>
              <th v-for="r in PERM_ROLES" :key="r" class="pm-th-role">
                <span class="pm-role-badge" :style="{ background: PERM_ROLE_COLORS[r]+'18', color: PERM_ROLE_COLORS[r], border: '1px solid '+PERM_ROLE_COLORS[r]+'40' }">
                  {{ PERM_ROLE_LABELS[r] }}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="section in PAGE_SECTIONS" :key="section.label">
              <!-- Section header row -->
              <tr class="pm-section-row">
                <td :colspan="PERM_ROLES.length + 1" class="pm-section-label">{{ section.label }}</td>
              </tr>
              <!-- Page rows -->
              <tr v-for="page in section.pages" :key="page.path" class="pm-page-row">
                <td class="pm-td-page">{{ page.label }}</td>
                <td v-for="r in PERM_ROLES" :key="r" class="pm-td-check">
                  <label class="pm-check-wrap">
                    <input
                      type="checkbox"
                      class="pm-checkbox"
                      :disabled="r === 'dg'"
                      :checked="getPerm(page.path, r)"
                      @change="setPerm(page.path, r, ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="pm-check-box" :style="r==='dg' ? 'opacity:.4' : ''"></span>
                  </label>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Form modal -->
    <Teleport to="body">
      <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40" @click="closeForm" />
        <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
          <h2 class="text-base font-semibold text-gray-900 mb-4">
            {{ editTarget ? 'Modifier le compte' : 'Nouveau compte' }}
          </h2>
          <div v-if="!editTarget" class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            Le mot de passe par défaut sera <strong>Uptech@2026</strong> — l'utilisateur devra le changer à la première connexion.
          </div>
          <div v-if="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{{ error }}</div>

          <form @submit.prevent="save" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Prénom <span class="text-red-500">*</span></label>
                <input v-model="form.prenom" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Nom <span class="text-red-500">*</span></label>
                <input v-model="form.nom" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Email <span class="text-red-500">*</span></label>
              <input v-model="form.email" type="email" required
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Téléphone</label>
              <input v-model="form.telephone"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="+221 77 000 00 00" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Rôle <span class="text-red-500">*</span></label>
              <select v-model="form.role" required :disabled="!!editTarget"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white disabled:bg-gray-50 disabled:text-gray-500">
                <option v-for="(label, key) in roleLabels" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div v-if="editTarget">
              <label class="block text-xs font-medium text-gray-700 mb-1">Statut</label>
              <select v-model="form.statut"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white">
                <option value="actif">Actif</option>
                <option value="inactif">Inactif</option>
                <option value="suspendu">Suspendu</option>
                <option value="bloque">Bloqué</option>
              </select>
            </div>
            <div class="flex gap-3 pt-2">
              <button type="button" @click="closeForm"
                class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition">
                Annuler
              </button>
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

<style scoped>
/* ── Tab switcher ─────────────────────────────── */
.pm-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  background: #f1f5f9;
  border-radius: 10px;
  padding: 4px;
  width: fit-content;
}
.pm-tab {
  padding: 8px 20px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  font-family: 'Poppins', sans-serif;
}
.pm-tab--active {
  background: #fff;
  color: #1e293b;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}

/* ── Permissions matrix ───────────────────────── */
.pm-wrap {
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.07);
  overflow: clip;
}
.pm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f1f5f9;
}
.pm-save-btn {
  background: linear-gradient(135deg,#4f46e5,#6366f1);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 9px 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  box-shadow: 0 2px 8px rgba(79,70,229,0.3);
}
.pm-save-btn:disabled { opacity: 0.6; cursor: default; }
.pm-scroll { overflow-x: auto; }
.pm-table {
  width: 100%;
  border-collapse: collapse;
}
.pm-table th, .pm-table td {
  text-align: center;
  padding: 0;
  border-bottom: 1px solid #f1f5f9;
}
.pm-th-page {
  text-align: left !important;
  padding: 10px 16px !important;
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  min-width: 200px;
  position: sticky;
  left: 0;
  background: #f8fafc;
  z-index: 2;
  border-collapse: separate;
}
.pm-th-role {
  padding: 10px 12px !important;
  min-width: 100px;
  background: #f8fafc;
}
.pm-role-badge {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 20px;
  white-space: nowrap;
}
.pm-section-row td {
  background: #f8fafc;
  text-align: left !important;
}
.pm-section-label {
  padding: 8px 16px !important;
  font-size: 11.5px;
  font-weight: 700;
  color: #475569;
  letter-spacing: 0.3px;
  text-align: left !important;
}
.pm-td-page {
  text-align: left !important;
  padding: 12px 16px !important;
  font-size: 13px;
  color: #334155;
  font-weight: 500;
  position: sticky;
  left: 0;
  background: #fff;
  z-index: 1;
}
.pm-page-row:hover .pm-td-page,
.pm-page-row:hover td {
  background: #f8f9ff !important;
}
.pm-td-check {
  padding: 10px !important;
}
.pm-check-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.pm-checkbox {
  display: none;
}
.pm-check-box {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 2px solid #cbd5e1;
  background: #fff;
  display: inline-block;
  position: relative;
  transition: all 0.15s;
  cursor: pointer;
}
.pm-checkbox:checked + .pm-check-box {
  background: #4f46e5;
  border-color: #4f46e5;
}
.pm-checkbox:checked + .pm-check-box::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -52%);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}
.pm-checkbox:disabled + .pm-check-box {
  cursor: default;
  background: #e2e8f0;
  border-color: #cbd5e1;
}
.pm-checkbox:disabled:checked + .pm-check-box {
  background: #818cf8;
  border-color: #818cf8;
}
.pm-fade-enter-active, .pm-fade-leave-active { transition: opacity 0.3s; }
.pm-fade-enter-from, .pm-fade-leave-to { opacity: 0; }
</style>
