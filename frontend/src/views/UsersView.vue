<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
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
  intervenant: 'Intervenant',
  etudiant: 'Étudiant',
}

const roleColors: Record<string, string> = {
  dg: 'bg-purple-100 text-purple-700',
  dir_peda: 'bg-blue-100 text-blue-700',
  resp_fin: 'bg-emerald-100 text-emerald-700',
  coordinateur: 'bg-indigo-100 text-indigo-700',
  secretariat: 'bg-yellow-100 text-yellow-700',
  intervenant: 'bg-orange-100 text-orange-700',
  etudiant: 'bg-gray-100 text-gray-700',
}

const statutColors: Record<string, string> = {
  actif: 'bg-green-100 text-green-700',
  inactif: 'bg-gray-100 text-gray-500',
  suspendu: 'bg-yellow-100 text-yellow-700',
  bloque: 'bg-red-100 text-red-700',
}

const filtered = computed(() =>
  users.value.filter(u =>
    (!filterRole.value || u.role === filterRole.value) &&
    (!filterStatut.value || u.statut === filterStatut.value)
  )
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
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">

    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-gray-900">Utilisateurs</h1>
        <p class="text-sm text-gray-500 mt-0.5">Comptes d'accès à la plateforme</p>
      </div>
      <button
        @click="openCreate"
        class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Nouveau compte
      </button>
    </div>

    <!-- Filters -->
    <div class="flex gap-3 mb-4">
      <select v-model="filterRole"
        class="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
        <option value="">Tous les rôles</option>
        <option v-for="(label, key) in roleLabels" :key="key" :value="key">{{ label }}</option>
      </select>
      <select v-model="filterStatut"
        class="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
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
                <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <span class="text-xs font-bold text-indigo-700 uppercase">{{ u.prenom[0] }}{{ u.nom[0] }}</span>
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
                  class="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
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
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Nom <span class="text-red-500">*</span></label>
                <input v-model="form.nom" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Email <span class="text-red-500">*</span></label>
              <input v-model="form.email" type="email" required
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Téléphone</label>
              <input v-model="form.telephone"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="+221 77 000 00 00" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Rôle <span class="text-red-500">*</span></label>
              <select v-model="form.role" required :disabled="!!editTarget"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white disabled:bg-gray-50 disabled:text-gray-500">
                <option v-for="(label, key) in roleLabels" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div v-if="editTarget">
              <label class="block text-xs font-medium text-gray-700 mb-1">Statut</label>
              <select v-model="form.statut"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
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
