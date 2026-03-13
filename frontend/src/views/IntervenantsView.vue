<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const canWrite = computed(() => ['dg', 'secretariat'].includes(auth.user?.role ?? ''))

interface Matiere { id: number; nom: string; code: string }
interface Filiere { id: number; nom: string; code: string; matieres?: Matiere[] }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }
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
  annee_academique_id: number
  annee_academique?: AnneeAcademique
  filieres?: IntervenantFiliere[]
}

const intervenants = ref<Intervenant[]>([])
const filieres = ref<Filiere[]>([])
const annees = ref<AnneeAcademique[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)
const editTarget = ref<Intervenant | null>(null)
const search = ref('')
const filterStatut = ref('')
let searchTimer: ReturnType<typeof setTimeout>

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

// Pagination
const page = ref(1)
const perPage = ref(20)
const total = ref(0)
const lastPage = ref(1)

// Form state
const form = ref({
  nom: '',
  prenom: '',
  email: '',
  telephone: '',
  annee_academique_id: null as number | null,
  filieres: [] as { filiere_id: number | null; matiere: string }[],
})

function openCreate() {
  editTarget.value = null
  const anneeActive = annees.value.find(a => a.actif)
  form.value = {
    nom: '',
    prenom: '',
    email: '',
    telephone: '',
    annee_academique_id: anneeActive?.id ?? annees.value[0]?.id ?? null,
    filieres: [],
  }
  error.value = ''
  showForm.value = true
}

function openEdit(i: Intervenant) {
  editTarget.value = i
  form.value = {
    nom: i.nom,
    prenom: i.prenom,
    email: i.email,
    telephone: i.telephone ?? '',
    annee_academique_id: i.annee_academique_id,
    filieres: (i.filieres ?? []).map(f => ({ filiere_id: f.filiere_id, matiere: f.matiere })),
  }
  error.value = ''
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  error.value = ''
}

function addFiliere() {
  form.value.filieres.push({ filiere_id: null, matiere: '' })
}

function removeFiliere(idx: number) {
  form.value.filieres.splice(idx, 1)
}

// Retourne les matières de la filière sélectionnée
function matieresForFiliere(filiere_id: number | null): Matiere[] {
  if (!filiere_id) return []
  return filieres.value.find(f => f.id === filiere_id)?.matieres ?? []
}

// Quand on change de filière, on réinitialise la matière
function onFiliereChange(item: { filiere_id: number | null; matiere: string }) {
  item.matiere = ''
}

function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; load() }, 350)
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: page.value }
    if (search.value) params.search = search.value
    if (filterStatut.value) params.statut = filterStatut.value
    const { data } = await api.get('/intervenants', { params })
    intervenants.value = data.data
    total.value = data.total
    lastPage.value = data.last_page
  } finally {
    loading.value = false
  }
}

async function loadRefs() {
  const [f, a] = await Promise.all([api.get('/filieres'), api.get('/annees-academiques')])
  filieres.value = f.data
  annees.value = a.data
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const payload: any = {
      nom: form.value.nom,
      prenom: form.value.prenom,
      email: form.value.email,
      telephone: form.value.telephone || null,
      annee_academique_id: form.value.annee_academique_id,
      filieres: form.value.filieres.filter(f => f.filiere_id && f.matiere),
    }
    if (editTarget.value) {
      const { data } = await api.put(`/intervenants/${editTarget.value.id}`, payload)
      const idx = intervenants.value.findIndex(i => i.id === data.id)
      if (idx !== -1) intervenants.value[idx] = data
    } else {
      await api.post('/intervenants', payload)
      await load()
    }
    closeForm()
  } catch (e: any) {
    const errs = e.response?.data?.errors as Record<string, string[]> | undefined
    error.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? e.response?.data?.message ?? 'Erreur'
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await Promise.all([load(), loadRefs()])
})
</script>

<template>
  <div class="uc-content">

    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-gray-900">Intervenants</h1>
        <p class="text-sm text-gray-500 mt-0.5">Gestion des formateurs et vacataires</p>
      </div>
      <button
        v-if="canWrite"
        @click="openCreate"
        style="background:#E30613;color:#fff;border:none;border-radius:4px;padding:9px 16px;font-weight:600;font-family:'Poppins',sans-serif;cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:6px;"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Nouvel intervenant
      </button>
    </div>

    <!-- Filters -->
    <div class="flex gap-3 mb-4">
      <div class="relative flex-1 max-w-xs">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input v-model="search" @input="onSearchInput" placeholder="Rechercher…" class="uc-iv-search" />
      </div>
      <select v-model="filterStatut" @change="page = 1; load()" class="uc-iv-select">
        <option value="">Tous les statuts</option>
        <option value="en_attente">En attente</option>
        <option value="actif">Actif</option>
        <option value="inactif">Inactif</option>
        <option value="suspendu">Suspendu</option>
      </select>
      <span class="ml-auto text-sm text-gray-500 self-center">{{ total }} intervenant{{ total !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Table -->
    <div class="uc-table-wrap-iv">
      <div v-if="loading" class="p-12 text-center text-gray-400 text-sm">Chargement…</div>
      <div v-else-if="intervenants.length === 0" class="p-12 text-center">
        <svg class="w-10 h-10 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01" />
        </svg>
        <p class="text-gray-500 text-sm">Aucun intervenant trouvé</p>
      </div>
      <table v-else>
        <thead>
          <tr>
            <th>Intervenant</th>
            <th>N° Contrat</th>
            <th>Statut</th>
            <th>Filières</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in intervenants" :key="i.id">
            <td>
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <span class="text-xs font-bold text-orange-700 uppercase">{{ i.prenom[0] }}{{ i.nom[0] }}</span>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900">{{ i.prenom }} {{ i.nom }}</p>
                  <p class="text-xs text-gray-500">{{ i.email }}</p>
                </div>
              </div>
            </td>
            <td>
              <span class="text-xs font-mono text-gray-600">{{ i.numero_contrat }}</span>
            </td>
            <td>
              <span
                :class="{
                  'iv-badge-actif': i.statut === 'actif',
                  'iv-badge-attente': i.statut === 'en_attente',
                  'iv-badge-inactif': i.statut === 'inactif' || !['actif','en_attente','suspendu'].includes(i.statut),
                  'iv-badge-suspendu': i.statut === 'suspendu',
                }"
              >
                {{ statutLabels[i.statut] ?? i.statut }}
              </span>
            </td>
            <td>
              <div v-if="i.filieres?.length" class="flex flex-wrap gap-1">
                <span v-for="f in i.filieres" :key="f.filiere_id"
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-indigo-50 text-indigo-700">
                  {{ f.filiere?.nom ?? f.filiere_id }}
                </span>
              </div>
              <span v-else class="text-xs text-gray-400">—</span>
            </td>
            <td style="text-align:right;">
              <div class="flex items-center justify-end gap-1">
                <button v-if="canWrite" @click="openEdit(i)" title="Modifier"
                  class="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button @click="router.push(`/intervenants/${i.id}`)" title="Voir le dossier"
                  class="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="lastPage > 1" class="px-5 py-3 border-t border-gray-200 flex items-center justify-between">
        <p class="text-sm text-gray-500">Page {{ page }} / {{ lastPage }}</p>
        <div class="flex gap-2">
          <button :disabled="page === 1" @click="page--; load()"
            class="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
            Précédent
          </button>
          <button :disabled="page === lastPage" @click="page++; load()"
            class="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
            Suivant
          </button>
        </div>
      </div>
    </div>

    <!-- Form modal -->
    <Teleport to="body">
      <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40" @click="closeForm" />
        <div class="relative uc-modal-iv">
          <div class="uc-modal-header-iv">
            <h2>{{ editTarget ? 'Modifier l\'intervenant' : 'Nouvel intervenant' }}</h2>
            <button type="button" @click="closeForm" style="background:none;border:none;cursor:pointer;color:#888;font-size:20px;line-height:1;">&times;</button>
          </div>

          <div style="padding: 18px 22px;">
            <div v-if="!editTarget" class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              Un compte d'accès sera automatiquement créé avec le mot de passe <strong>Uptech@2026</strong>.
            </div>
            <div v-if="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{{ error }}</div>

            <form @submit.prevent="save" class="space-y-4">
              <div class="grid grid-cols-2 gap-3">
                <div class="form-group-iv">
                  <label>Prénom <span style="color:#E30613;">*</span></label>
                  <input v-model="form.prenom" required />
                </div>
                <div class="form-group-iv">
                  <label>Nom <span style="color:#E30613;">*</span></label>
                  <input v-model="form.nom" required />
                </div>
              </div>
              <div class="form-group-iv">
                <label>Email <span style="color:#E30613;">*</span></label>
                <input v-model="form.email" type="email" required />
              </div>
              <div class="form-group-iv">
                <label>Téléphone</label>
                <input v-model="form.telephone" placeholder="+221 77 000 00 00" />
              </div>
              <div v-if="!editTarget" class="form-group-iv">
                <label>Année académique <span style="color:#E30613;">*</span></label>
                <select v-model="form.annee_academique_id" required>
                  <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
                </select>
              </div>

              <!-- Filières assignées -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="form-group-iv" style="margin-bottom:0;">Filières enseignées</label>
                  <button type="button" @click="addFiliere"
                    style="font-size:12px;color:#E30613;background:none;border:none;cursor:pointer;font-weight:600;font-family:'Poppins',sans-serif;">+ Ajouter</button>
                </div>
                <div v-if="form.filieres.length === 0" class="text-xs text-gray-400 italic">Aucune filière assignée</div>
                <div v-for="(item, idx) in form.filieres" :key="idx" class="flex gap-2 mb-2">
                  <!-- Select filière -->
                  <select
                    v-model="item.filiere_id"
                    @change="onFiliereChange(item)"
                    style="flex:1;border:1.5px solid #e5e5e5;border-radius:4px;padding:7px 10px;font-family:'Poppins',sans-serif;font-size:12.5px;background:#fafafa;outline:none;"
                  >
                    <option :value="null">— Filière —</option>
                    <option v-for="f in filieres" :key="f.id" :value="f.id">{{ f.nom }}</option>
                  </select>

                  <!-- Select matière (peuplé selon la filière choisie) -->
                  <select
                    v-model="item.matiere"
                    :disabled="!item.filiere_id"
                    style="flex:1;border:1.5px solid #e5e5e5;border-radius:4px;padding:7px 10px;font-family:'Poppins',sans-serif;font-size:12.5px;background:#fafafa;outline:none;opacity:1;"
                    :style="!item.filiere_id ? 'opacity:0.5;cursor:not-allowed;' : ''"
                  >
                    <option value="">— Matière —</option>
                    <template v-if="matieresForFiliere(item.filiere_id).length">
                      <option v-for="m in matieresForFiliere(item.filiere_id)" :key="m.id" :value="m.nom">
                        {{ m.nom }}
                      </option>
                    </template>
                    <option v-else-if="item.filiere_id" disabled value="">Aucune matière dans cette filière</option>
                  </select>

                  <button type="button" @click="removeFiliere(idx)"
                    class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition flex-shrink-0">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </div>

          <div class="uc-modal-footer-iv">
            <button type="button" @click="closeForm" class="btn-cancel-iv">Annuler</button>
            <button type="button" @click="save" :disabled="saving" class="btn-save-iv">
              {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
.uc-table-wrap-iv {
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  overflow: hidden;
}
.uc-table-wrap-iv table { width: 100%; border-collapse: collapse; }
.uc-table-wrap-iv thead tr { background: #f9f9f9; border-bottom: 2px solid #f0f0f0; }
.uc-table-wrap-iv thead th { padding: 11px 14px; text-align: left; font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.4px; }
.uc-table-wrap-iv tbody tr { border-bottom: 1px solid #f5f5f5; transition: background 0.12s; }
.uc-table-wrap-iv tbody tr:hover { background: #fafafa; }
.uc-table-wrap-iv tbody td { padding: 11px 14px; font-size: 12.5px; color: #222; vertical-align: middle; }
.uc-modal-iv { background: #fff; border-radius: 8px; width: 560px; max-height: 88vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.25); }
.uc-modal-header-iv { padding: 18px 22px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; justify-content: space-between; }
.uc-modal-header-iv h2 { font-size: 15px; font-weight: 700; color: #111; }
.uc-modal-footer-iv { padding: 16px 22px; border-top: 1px solid #f0f0f0; display: flex; justify-content: flex-end; gap: 10px; }
.btn-cancel-iv { border: 1.5px solid #e5e5e5; background: #fff; border-radius: 4px; padding: 10px 20px; font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 600; color: #555; cursor: pointer; }
.btn-cancel-iv:hover { border-color: #111; color: #111; }
.btn-save-iv { background: #E30613; color: #fff; border: none; border-radius: 4px; padding: 10px 20px; font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-save-iv:disabled { opacity: 0.5; cursor: not-allowed; }
.form-group-iv { margin-bottom: 14px; }
.form-group-iv label { display: block; font-size: 11px; font-weight: 600; color: #333; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 5px; }
.form-group-iv input, .form-group-iv select, .form-group-iv textarea { width: 100%; border: 1.5px solid #e5e5e5; border-radius: 4px; padding: 9px 11px; font-family: 'Poppins', sans-serif; font-size: 12.5px; color: #111; outline: none; background: #fafafa; transition: border-color 0.2s; }
.form-group-iv input:focus, .form-group-iv select:focus, .form-group-iv textarea:focus { border-color: #E30613; background: #fff; }
.iv-badge-actif { background:#f0fdf4;color:#15803d; display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600; }
.iv-badge-attente { background:#fefce8;color:#854d0e; display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600; }
.iv-badge-inactif { background:#f5f5f5;color:#888; display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600; }
.iv-badge-suspendu { background:#fff0f0;color:#b91c1c; display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600; }
.uc-iv-search { width:100%;border:1.5px solid #e5e5e5;border-radius:4px;padding:9px 12px 9px 35px;font-family:'Poppins',sans-serif;font-size:12.5px;color:#111;outline:none;background:#fff;transition:border-color 0.2s; }
.uc-iv-search:focus { border-color: #E30613; }
.uc-iv-search::placeholder { color: #ccc; }
.uc-iv-select { border:1.5px solid #e5e5e5;border-radius:4px;padding:9px 12px;font-family:'Poppins',sans-serif;font-size:12px;color:#444;background:#fff;outline:none;cursor:pointer;transition:border-color 0.2s; }
.uc-iv-select:focus { border-color: #E30613; }
</style>
