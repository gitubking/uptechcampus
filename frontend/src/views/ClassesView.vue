<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const canWrite = ['dg', 'coordinateur'].includes(auth.user?.role ?? '')

// ── Interfaces ───────────────────────────────────────────────────────
interface TypeFormation { id: number; nom: string; code: string }
interface MatiereSimple { id: number; nom: string; code: string }
interface Filiere { id: number; nom: string; code: string; type_formation_id: number | null; matieres?: MatiereSimple[] }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }
interface Parcours { id: number; nom: string; code: string; type_formation_id: number | null }
interface IntervForUE { id: number; nom: string; prenom: string; filieres?: { filiere_id: number }[] }
interface UE {
  id: number
  classe_id: number
  intervenant_id: number | null
  code: string
  intitule: string
  coefficient: number
  credits_ects: number
  ordre: number
  intervenant?: { id: number; nom: string; prenom: string }
}
interface Classe {
  id: number
  nom: string
  est_tronc_commun: boolean
  filiere?: Filiere
  annee_academique?: AnneeAcademique
  parcours?: Parcours[]
}

interface InscriptionItem {
  id: number
  statut: string
  acces_bloque: boolean
  frais_inscription: number
  mensualite: number
  etudiant?: { id: number; nom: string; prenom: string; numero_etudiant: string }
  filiere?: { id: number; nom: string }
  niveau_entree?: { id: number; nom: string }
  classe?: { id: number; nom: string } | null
}

// ── État général ─────────────────────────────────────────────────────
const classes = ref<Classe[]>([])
const filieres = ref<Filiere[]>([])
const annees = ref<AnneeAcademique[]>([])
const parcoursList = ref<Parcours[]>([])
const typesFormation = ref<TypeFormation[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)
const editTarget = ref<Classe | null>(null)
const filterAnnee = ref<number | ''>('')
const confirmDelete = ref<Classe | null>(null)

// Filtre type formation dans le formulaire
const selectedType = ref<number | null>(null)

const form = ref({
  nom: '',
  filiere_id: null as number | null,
  annee_academique_id: null as number | null,
  parcours_ids: [] as number[],
})

// ── Gestion étudiants d'une classe ───────────────────────────────────
const showStudents = ref(false)
const classeForStudents = ref<Classe | null>(null)
const studentsTab = ref<'dans-classe' | 'pool' | 'enseignants'>('dans-classe')
const inscriptionsInClasse = ref<InscriptionItem[]>([])
const inscriptionsPool = ref<InscriptionItem[]>([])
const loadingStudents = ref(false)
const affectingId = ref<number | null>(null)
const poolFilterType = ref<number | null>(null)
const poolFilterFiliere = ref<number | null>(null)

// ── Gestion UE / enseignants d'une classe ─────────────────────────────
const uesForClasse = ref<UE[]>([])
const loadingUes = ref(false)
const showUeForm = ref(false)
const editingUe = ref<UE | null>(null)
const savingUe = ref(false)
const deletingUeId = ref<number | null>(null)
const ueError = ref('')
const intervenantsAll = ref<IntervForUE[]>([])
const ueForm = ref({
  intervenant_id: null as number | null,
  intitule: '',
  code: '',
  coefficient: 1 as number,
  credits_ects: 0 as number,
  ordre: 0 as number,
})

// ── Computed ─────────────────────────────────────────────────────────
const filtered = computed(() =>
  classes.value.filter(c => !filterAnnee.value || c.annee_academique?.id === filterAnnee.value)
)

// Intervenants filtrés sur la filière de la classe courante
const intervenantsForUE = computed(() => {
  const fId = classeForStudents.value?.filiere?.id
  if (!fId) return intervenantsAll.value
  const filtered2 = intervenantsAll.value.filter(i => i.filieres?.some(f => f.filiere_id === fId))
  return filtered2.length > 0 ? filtered2 : intervenantsAll.value
})

// Matières de la filière de la classe courante
const matieresForUE = computed((): MatiereSimple[] => {
  const fId = classeForStudents.value?.filiere?.id
  if (!fId) return []
  return filieres.value.find(f => f.id === fId)?.matieres ?? []
})

const filteredFilieres = computed(() =>
  selectedType.value
    ? filieres.value.filter(f => f.type_formation_id === selectedType.value)
    : filieres.value
)

const filteredParcours = computed(() =>
  selectedType.value
    ? parcoursList.value.filter(p => p.type_formation_id === selectedType.value)
    : parcoursList.value
)

const filteredFilieresForPool = computed(() =>
  poolFilterType.value
    ? filieres.value.filter(f => f.type_formation_id === poolFilterType.value)
    : filieres.value
)

// ── Fonctions formulaire classe ───────────────────────────────────────
function onTypeChange() {
  form.value.filiere_id = null
  form.value.parcours_ids = []
}

function openCreate() {
  const anneeActive = annees.value.find(a => a.actif)
  editTarget.value = null
  selectedType.value = null
  form.value = {
    nom: '',
    filiere_id: null,
    annee_academique_id: anneeActive?.id ?? annees.value[0]?.id ?? null,
    parcours_ids: [],
  }
  error.value = ''
  showForm.value = true
}

function openEdit(c: Classe) {
  editTarget.value = c
  const filiereType = c.filiere?.type_formation_id ?? null
  selectedType.value = filiereType
  form.value = {
    nom: c.nom,
    filiere_id: c.filiere?.id ?? null,
    annee_academique_id: c.annee_academique?.id ?? null,
    parcours_ids: c.parcours?.map(p => p.id) ?? [],
  }
  error.value = ''
  showForm.value = true
}

function toggleParcours(id: number) {
  const idx = form.value.parcours_ids.indexOf(id)
  if (idx === -1) form.value.parcours_ids.push(id)
  else form.value.parcours_ids.splice(idx, 1)
}

// ── API Classe ────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  try {
    const [c, f, a, p, t] = await Promise.all([
      api.get('/classes'),
      api.get('/filieres'),
      api.get('/annees-academiques'),
      api.get('/parcours'),
      api.get('/types-formation'),
    ])
    classes.value = c.data
    filieres.value = f.data
    annees.value = a.data
    parcoursList.value = p.data
    typesFormation.value = t.data
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (editTarget.value) {
      const { data } = await api.put(`/classes/${editTarget.value.id}`, form.value)
      const idx = classes.value.findIndex(c => c.id === data.id)
      if (idx !== -1) classes.value[idx] = data
    } else {
      const { data } = await api.post('/classes', form.value)
      classes.value.unshift(data)
    }
    showForm.value = false
  } catch (e: any) {
    const errs = e.response?.data?.errors as Record<string, string[]> | undefined
    error.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? e.response?.data?.message ?? 'Erreur'
  } finally {
    saving.value = false
  }
}

async function deleteClasse() {
  if (!confirmDelete.value) return
  try {
    await api.delete(`/classes/${confirmDelete.value.id}`)
    classes.value = classes.value.filter(c => c.id !== confirmDelete.value!.id)
    confirmDelete.value = null
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Impossible de supprimer cette classe')
  }
}

// ── UE / Enseignants ──────────────────────────────────────────────────
async function loadUes() {
  if (!classeForStudents.value) return
  loadingUes.value = true
  try {
    const { data } = await api.get('/ues', { params: { classe_id: classeForStudents.value.id } })
    uesForClasse.value = Array.isArray(data) ? data : (data.data ?? [])
  } finally {
    loadingUes.value = false
  }
}

async function loadIntervenants() {
  if (intervenantsAll.value.length > 0) return
  const { data } = await api.get('/intervenants')
  intervenantsAll.value = Array.isArray(data) ? data : (data.data ?? [])
}

function openAddUe() {
  editingUe.value = null
  ueError.value = ''
  ueForm.value = {
    intervenant_id: null, intitule: '', code: '',
    coefficient: 1, credits_ects: 0, ordre: uesForClasse.value.length,
  }
  showUeForm.value = true
}

function openEditUe(ue: UE) {
  editingUe.value = ue
  ueError.value = ''
  ueForm.value = {
    intervenant_id: ue.intervenant_id,
    intitule: ue.intitule,
    code: ue.code,
    coefficient: ue.coefficient,
    credits_ects: ue.credits_ects,
    ordre: ue.ordre,
  }
  showUeForm.value = true
}

function onUeIntituleChange() {
  const mat = matieresForUE.value.find(m => m.nom === ueForm.value.intitule)
  if (mat) ueForm.value.code = mat.code
}

async function saveUe() {
  if (!classeForStudents.value) return
  savingUe.value = true
  ueError.value = ''
  try {
    const payload = {
      classe_id: classeForStudents.value.id,
      intervenant_id: ueForm.value.intervenant_id || null,
      code: ueForm.value.code,
      intitule: ueForm.value.intitule,
      coefficient: ueForm.value.coefficient,
      credits_ects: ueForm.value.credits_ects,
      ordre: ueForm.value.ordre,
    }
    if (editingUe.value) {
      await api.put(`/ues/${editingUe.value.id}`, payload)
    } else {
      await api.post('/ues', payload)
    }
    showUeForm.value = false
    await loadUes()
  } catch (e: any) {
    ueError.value = e.response?.data?.message ?? 'Erreur lors de l\'enregistrement'
  } finally {
    savingUe.value = false
  }
}

async function deleteUe(ue: UE) {
  if (!confirm(`Supprimer l'UE "${ue.intitule}" ?`)) return
  deletingUeId.value = ue.id
  try {
    await api.delete(`/ues/${ue.id}`)
    uesForClasse.value = uesForClasse.value.filter(u => u.id !== ue.id)
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  } finally {
    deletingUeId.value = null
  }
}

async function onTabChange(tab: 'dans-classe' | 'pool' | 'enseignants') {
  studentsTab.value = tab
  if (tab === 'enseignants') {
    await Promise.all([loadUes(), loadIntervenants()])
  }
}

// ── Affectation étudiants ─────────────────────────────────────────────
async function openStudents(c: Classe) {
  classeForStudents.value = c
  studentsTab.value = 'dans-classe'
  showUeForm.value = false
  uesForClasse.value = []
  intervenantsAll.value = []
  // Pré-remplir les filtres du pool avec la filière de la classe
  poolFilterType.value = c.filiere?.type_formation_id ?? null
  poolFilterFiliere.value = c.filiere?.id ?? null
  showStudents.value = true
  await refreshStudents()
}

function onPoolTypeChange() {
  poolFilterFiliere.value = null
  inscriptionsPool.value = []
}

async function refreshPool() {
  if (!poolFilterFiliere.value) {
    inscriptionsPool.value = []
    return
  }
  loadingStudents.value = true
  try {
    const { data } = await api.get('/inscriptions', {
      params: { sans_classe: 1, filiere_id: poolFilterFiliere.value, per_page: 200 }
    })
    inscriptionsPool.value = data.data ?? data
  } finally {
    loadingStudents.value = false
  }
}

async function refreshStudents() {
  if (!classeForStudents.value) return
  loadingStudents.value = true
  try {
    const { data } = await api.get('/inscriptions', {
      params: { classe_id: classeForStudents.value.id, per_page: 200 }
    })
    inscriptionsInClasse.value = data.data ?? data
    if (poolFilterFiliere.value) {
      const pool = await api.get('/inscriptions', {
        params: { sans_classe: 1, filiere_id: poolFilterFiliere.value, per_page: 200 }
      })
      inscriptionsPool.value = pool.data.data ?? pool.data
    } else {
      inscriptionsPool.value = []
    }
  } finally {
    loadingStudents.value = false
  }
}

async function affecterEtudiant(inscriptionId: number) {
  if (!classeForStudents.value) return
  affectingId.value = inscriptionId
  try {
    await api.put(`/inscriptions/${inscriptionId}/affecter-classe`, {
      classe_id: classeForStudents.value.id,
    })
    await refreshStudents()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur lors de l\'affectation')
  } finally {
    affectingId.value = null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
const statutConfig: Record<string, string> = {
  pre_inscrit:   'bg-blue-100 text-blue-700',
  en_examen:     'bg-yellow-100 text-yellow-700',
  inscrit_actif: 'bg-green-100 text-green-700',
  suspendu:      'bg-orange-100 text-orange-700',
  abandonne:     'bg-red-100 text-red-700',
  diplome:       'bg-purple-100 text-purple-700',
}
const statutLabel: Record<string, string> = {
  pre_inscrit: 'Pré-inscrit', en_examen: 'En examen', inscrit_actif: 'Inscrit actif',
  suspendu: 'Suspendu', abandonne: 'Abandonné', diplome: 'Diplômé',
}

onMounted(load)
</script>

<template>
  <div class="uc-content">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div>
        <h1 style="font-size:18px;font-weight:700;color:#111;margin:0;">Classes</h1>
        <p style="font-size:12px;color:#888;margin:4px 0 0;">Groupes d'étudiants par filière et année académique</p>
      </div>
      <button v-if="canWrite" @click="openCreate" class="uc-btn-primary">
        + Nouvelle classe
      </button>
    </div>

    <!-- Filtres -->
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;">
      <select v-model="filterAnnee" class="cl-select">
        <option value="">Toutes les années</option>
        <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
      </select>
      <span style="margin-left:auto;font-size:12px;color:#888;">{{ filtered.length }} classe{{ filtered.length !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Table -->
    <div class="cl-table-wrap">
      <div v-if="loading" style="padding:40px;text-align:center;color:#aaa;font-size:13px;">Chargement…</div>
      <div v-else-if="filtered.length === 0" style="padding:40px;text-align:center;color:#aaa;font-size:13px;">Aucune classe trouvée</div>
      <table v-else class="cl-table">
        <thead>
          <tr>
            <th>Classe</th>
            <th>Filière</th>
            <th>Année</th>
            <th>Parcours</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in filtered" :key="c.id">
            <td>
              <div style="display:flex;align-items:center;gap:8px;">
                <button @click="openStudents(c)" class="cl-link-btn">{{ c.nom }}</button>
                <span v-if="c.est_tronc_commun" class="cl-badge-tronc">Tronc commun</span>
              </div>
            </td>
            <td>
              <div v-if="c.filiere">
                <p style="font-size:13px;font-weight:500;color:#333;margin:0;">{{ c.filiere.nom }}</p>
                <span style="font-size:11px;color:#aaa;font-family:monospace;">{{ c.filiere.code }}</span>
              </div>
              <span v-else style="color:#ccc;">—</span>
            </td>
            <td>
              <span style="font-size:13px;color:#555;">{{ c.annee_academique?.libelle ?? '—' }}</span>
              <span v-if="c.annee_academique?.actif" class="cl-badge-actif">active</span>
            </td>
            <td>
              <div style="display:flex;flex-wrap:wrap;gap:4px;">
                <span v-for="p in c.parcours" :key="p.id" class="cl-badge-parcours">{{ p.code }}</span>
                <span v-if="!c.parcours?.length" style="font-size:11px;color:#ccc;font-style:italic;">Aucun</span>
              </div>
            </td>
            <td style="text-align:right;">
              <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
                <button @click="openStudents(c)" class="cl-btn-students">Étudiants</button>
                <button v-if="canWrite" @click="openEdit(c)" title="Modifier" class="cl-icon-btn">✏️</button>
                <button v-if="canWrite" @click="confirmDelete = c" title="Supprimer" class="cl-icon-btn cl-icon-btn--danger">🗑</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal Étudiants -->
    <Teleport to="body">
      <div v-if="showStudents" class="cl-overlay" @click.self="showStudents = false">
        <div class="cl-modal-lg">
          <div class="cl-modal-header">
            <div>
              <h2 class="cl-modal-title">{{ classeForStudents?.nom }}</h2>
              <p class="cl-modal-sub">Filière : {{ classeForStudents?.filiere?.nom ?? '—' }}</p>
            </div>
            <button @click="showStudents = false" class="cl-close-btn">✕</button>
          </div>

          <!-- Onglets -->
          <div class="cl-tabs">
            <button v-for="tab in [
                { key: 'dans-classe', label: 'Étudiants', count: inscriptionsInClasse.length },
                { key: 'pool', label: 'Pool à affecter', count: inscriptionsPool.length },
                { key: 'enseignants', label: 'Enseignants', count: uesForClasse.length }
              ]" :key="tab.key"
              @click="onTabChange(tab.key as any)"
              class="cl-tab" :class="studentsTab === tab.key ? 'cl-tab--active' : ''">
              {{ tab.label }}
              <span class="cl-tab-count" :class="studentsTab === tab.key ? 'cl-tab-count--active' : ''">{{ tab.count }}</span>
            </button>
          </div>

          <div class="cl-modal-body">
            <div v-if="loadingStudents" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">Chargement…</div>

            <!-- Dans la classe -->
            <template v-else-if="studentsTab === 'dans-classe'">
              <div v-if="inscriptionsInClasse.length === 0" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">
                Aucun étudiant affecté à cette classe.
              </div>
              <div v-else class="cl-table-wrap">
                <table class="cl-table">
                  <thead><tr><th>Étudiant</th><th>Niveau</th><th style="text-align:center;">Statut</th></tr></thead>
                  <tbody>
                    <tr v-for="ins in inscriptionsInClasse" :key="ins.id">
                      <td>
                        <p style="font-weight:600;color:#333;margin:0;">{{ ins.etudiant?.prenom }} {{ ins.etudiant?.nom }}</p>
                        <p style="font-size:11px;color:#aaa;font-family:monospace;margin:0;">{{ ins.etudiant?.numero_etudiant }}</p>
                      </td>
                      <td style="color:#555;">{{ ins.niveau_entree?.nom ?? '—' }}</td>
                      <td style="text-align:center;">
                        <span class="cl-badge-statut" :class="`cl-statut-${ins.statut}`">
                          {{ statutLabel[ins.statut] ?? ins.statut }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>

            <!-- Pool à affecter -->
            <template v-else-if="studentsTab === 'pool'">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                <div>
                  <label class="cl-label">Type de formation</label>
                  <select v-model="poolFilterType" @change="onPoolTypeChange" class="cl-input" style="width:100%;">
                    <option :value="null">— Tous les types —</option>
                    <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }}</option>
                  </select>
                </div>
                <div>
                  <label class="cl-label">Filière *</label>
                  <select v-model="poolFilterFiliere" @change="refreshPool" class="cl-input" style="width:100%;">
                    <option :value="null">— Choisir une filière —</option>
                    <option v-for="f in filteredFilieresForPool" :key="f.id" :value="f.id">{{ f.nom }}</option>
                  </select>
                </div>
              </div>
              <div v-if="!poolFilterFiliere" style="text-align:center;padding:32px;color:#aaa;font-size:13px;">
                Sélectionnez une filière pour voir les étudiants disponibles.
              </div>
              <div v-else-if="inscriptionsPool.length === 0" style="text-align:center;padding:32px;color:#aaa;font-size:13px;">
                Aucun étudiant sans classe dans cette filière.
              </div>
              <div v-else>
                <p style="font-size:12px;color:#888;margin-bottom:10px;">
                  {{ inscriptionsPool.length }} étudiant{{ inscriptionsPool.length > 1 ? 's' : '' }} disponibles
                </p>
                <div class="cl-table-wrap">
                  <table class="cl-table">
                    <thead><tr><th>Étudiant</th><th>Niveau</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>
                      <tr v-for="ins in inscriptionsPool" :key="ins.id">
                        <td>
                          <p style="font-weight:600;color:#333;margin:0;">{{ ins.etudiant?.prenom }} {{ ins.etudiant?.nom }}</p>
                          <p style="font-size:11px;color:#aaa;font-family:monospace;margin:0;">{{ ins.etudiant?.numero_etudiant }}</p>
                        </td>
                        <td style="color:#555;">{{ ins.niveau_entree?.nom ?? '—' }}</td>
                        <td style="text-align:right;">
                          <button @click="affecterEtudiant(ins.id)" :disabled="affectingId === ins.id" class="cl-btn-affecter">
                            {{ affectingId === ins.id ? 'Affectation…' : '+ Affecter' }}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>

            <!-- ── Onglet Enseignants (UE) ── -->
            <template v-else-if="studentsTab === 'enseignants'">
              <div v-if="loadingUes" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">Chargement…</div>
              <template v-else>

                <!-- Formulaire ajout / édition UE -->
                <div v-if="showUeForm" class="ue-form-panel">
                  <h3 class="ue-form-title">{{ editingUe ? 'Modifier l\'affectation' : 'Affecter un enseignant' }}</h3>
                  <div v-if="ueError" class="cl-error-msg" style="margin-bottom:10px;">{{ ueError }}</div>
                  <div class="ue-form-grid">
                    <!-- Intervenant -->
                    <div class="ue-form-group ue-full">
                      <label class="cl-label">Enseignant</label>
                      <select v-model="ueForm.intervenant_id" class="cl-input" style="width:100%;">
                        <option :value="null">— Sans enseignant —</option>
                        <option v-for="i in intervenantsForUE" :key="i.id" :value="i.id">
                          {{ i.prenom }} {{ i.nom }}
                        </option>
                      </select>
                    </div>
                    <!-- Matière / Intitulé -->
                    <div class="ue-form-group ue-full">
                      <label class="cl-label">Matière / Intitulé *</label>
                      <select v-if="matieresForUE.length > 0"
                        v-model="ueForm.intitule" required class="cl-input" style="width:100%;"
                        @change="onUeIntituleChange">
                        <option value="">— Sélectionner une matière —</option>
                        <option v-for="m in matieresForUE" :key="m.id" :value="m.nom">{{ m.nom }}</option>
                      </select>
                      <input v-else v-model="ueForm.intitule" required placeholder="Ex : Algorithmique"
                        class="cl-input" style="width:100%;box-sizing:border-box;" />
                    </div>
                    <!-- Code -->
                    <div class="ue-form-group">
                      <label class="cl-label">Code *</label>
                      <input v-model="ueForm.code" required placeholder="Ex : ALGO" class="cl-input" style="width:100%;box-sizing:border-box;" />
                    </div>
                    <!-- Coefficient -->
                    <div class="ue-form-group">
                      <label class="cl-label">Coefficient</label>
                      <input v-model.number="ueForm.coefficient" type="number" min="0" step="0.5" class="cl-input" style="width:100%;box-sizing:border-box;" />
                    </div>
                    <!-- Crédits / Volume horaire -->
                    <div class="ue-form-group">
                      <label class="cl-label">Volume horaire (h)</label>
                      <input v-model.number="ueForm.credits_ects" type="number" min="0" class="cl-input" style="width:100%;box-sizing:border-box;" />
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;margin-top:14px;">
                    <button @click="showUeForm = false" class="cl-btn-cancel" style="flex:1;">Annuler</button>
                    <button @click="saveUe" :disabled="savingUe || !ueForm.intitule || !ueForm.code"
                      class="cl-btn-save" style="flex:2;">
                      {{ savingUe ? 'Enregistrement…' : (editingUe ? 'Modifier' : 'Affecter') }}
                    </button>
                  </div>
                </div>

                <!-- Bouton + Affecter -->
                <div v-if="!showUeForm" style="display:flex;justify-content:flex-end;margin-bottom:12px;">
                  <button @click="openAddUe" class="cl-btn-affecter">+ Affecter un enseignant</button>
                </div>

                <!-- Liste des UEs -->
                <div v-if="uesForClasse.length === 0 && !showUeForm"
                  style="text-align:center;padding:32px;color:#aaa;font-size:13px;">
                  Aucun enseignant affecté à cette classe.
                </div>
                <div v-else-if="uesForClasse.length > 0" class="cl-table-wrap">
                  <table class="cl-table">
                    <thead>
                      <tr>
                        <th>Matière</th>
                        <th>Enseignant</th>
                        <th style="text-align:center;">Coeff.</th>
                        <th style="text-align:center;">Vol. h</th>
                        <th style="text-align:right;">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="ue in uesForClasse" :key="ue.id">
                        <td>
                          <p style="font-weight:600;color:#333;margin:0;">{{ ue.intitule }}</p>
                          <span style="font-size:11px;color:#aaa;font-family:monospace;">{{ ue.code }}</span>
                        </td>
                        <td>
                          <span v-if="ue.intervenant" style="font-size:13px;color:#333;">
                            {{ ue.intervenant.prenom }} {{ ue.intervenant.nom }}
                          </span>
                          <span v-else style="font-size:11px;color:#ccc;font-style:italic;">Non assigné</span>
                        </td>
                        <td style="text-align:center;">
                          <span class="cl-badge-parcours">{{ ue.coefficient }}</span>
                        </td>
                        <td style="text-align:center;">
                          <span v-if="ue.credits_ects > 0" class="ue-badge-vol">{{ ue.credits_ects }}h</span>
                          <span v-else style="color:#ccc;">—</span>
                        </td>
                        <td style="text-align:right;">
                          <div style="display:flex;gap:6px;justify-content:flex-end;">
                            <button @click="openEditUe(ue)" class="cl-icon-btn" title="Modifier">✏️</button>
                            <button @click="deleteUe(ue)" class="cl-icon-btn cl-icon-btn--danger"
                              :disabled="deletingUeId === ue.id" title="Supprimer">🗑</button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
            </template>

          </div>
        </div>
      </div>
    </Teleport>

    <!-- Modal Formulaire Classe -->
    <Teleport to="body">
      <div v-if="showForm" class="cl-overlay" @click.self="showForm = false">
        <div class="cl-modal">
          <h2 class="cl-modal-title" style="margin-bottom:16px;">
            {{ editTarget ? 'Modifier la classe' : 'Nouvelle classe' }}
          </h2>
          <div v-if="error" class="cl-error-msg">{{ error }}</div>
          <form @submit.prevent="save" style="display:flex;flex-direction:column;gap:14px;">
            <div>
              <label class="cl-label">Nom de la classe *</label>
              <input v-model="form.nom" required placeholder="ex: BTS SIO 1 — 2025/2026" class="cl-input" style="width:100%;box-sizing:border-box;" />
            </div>
            <div>
              <label class="cl-label">Type de formation</label>
              <select v-model="selectedType" @change="onTypeChange" class="cl-input" style="width:100%;box-sizing:border-box;">
                <option :value="null">— Tous les types —</option>
                <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }} ({{ t.code }})</option>
              </select>
            </div>
            <div>
              <label class="cl-label">Filière *</label>
              <select v-model="form.filiere_id" required class="cl-input" style="width:100%;box-sizing:border-box;">
                <option :value="null" disabled>— Choisir une filière —</option>
                <option v-for="f in filteredFilieres" :key="f.id" :value="f.id">{{ f.nom }}</option>
              </select>
            </div>
            <div>
              <label class="cl-label">Année académique *</label>
              <select v-model="form.annee_academique_id" required class="cl-input" style="width:100%;box-sizing:border-box;">
                <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
              </select>
            </div>
            <div>
              <label class="cl-label" style="margin-bottom:6px;">Parcours associés</label>
              <p style="font-size:11px;color:#aaa;margin:0 0 8px;">Si plusieurs types sélectionnés → tronc commun détecté automatiquement.</p>
              <div style="max-height:140px;overflow-y:auto;border:1.5px solid #e5e5e5;border-radius:4px;padding:6px;">
                <label v-for="p in filteredParcours" :key="p.id" style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;">
                  <input type="checkbox" :value="p.id" :checked="form.parcours_ids.includes(p.id)" @change="toggleParcours(p.id)" />
                  <span style="font-size:13px;color:#333;flex:1;">{{ p.nom }}</span>
                  <span style="font-size:10px;font-family:monospace;color:#aaa;">{{ p.code }}</span>
                </label>
                <p v-if="filteredParcours.length === 0" style="font-size:12px;color:#ccc;text-align:center;padding:8px;">Aucun parcours disponible</p>
              </div>
            </div>
            <div style="display:flex;gap:10px;margin-top:4px;">
              <button type="button" @click="showForm = false" class="cl-btn-cancel">Annuler</button>
              <button type="submit" :disabled="saving" class="cl-btn-save">{{ saving ? 'Enregistrement…' : 'Enregistrer' }}</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Confirm suppression -->
      <div v-if="confirmDelete" class="cl-overlay" @click.self="confirmDelete = null">
        <div class="cl-modal-sm">
          <h2 class="cl-modal-title" style="margin-bottom:8px;">Supprimer la classe</h2>
          <p style="font-size:13px;color:#555;margin-bottom:20px;">
            Voulez-vous supprimer <strong>{{ confirmDelete.nom }}</strong> ? Cette action est irréversible.
          </p>
          <div style="display:flex;gap:10px;">
            <button @click="confirmDelete = null" class="cl-btn-cancel">Annuler</button>
            <button @click="deleteClasse" class="cl-btn-delete">Supprimer</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.cl-table-wrap { background:#fff; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.05); overflow:hidden; }
.cl-table { width:100%; border-collapse:collapse; }
.cl-table thead tr { background:#f9f9f9; }
.cl-table th { padding:10px 16px; text-align:left; font-size:11px; font-weight:600; color:#888; text-transform:uppercase; letter-spacing:0.05em; border-bottom:1px solid #f0f0f0; }
.cl-table td { padding:12px 16px; border-top:1px solid #f4f4f4; vertical-align:middle; font-size:13px; }
.cl-table tr:hover td { background:#fafafa; }

.cl-select { border:1.5px solid #e5e5e5; border-radius:4px; padding:8px 11px; font-family:'Poppins',sans-serif; font-size:12px; color:#333; background:#fff; }
.cl-link-btn { background:none; border:none; cursor:pointer; color:#E30613; font-weight:600; font-size:13px; font-family:'Poppins',sans-serif; padding:0; text-align:left; }
.cl-link-btn:hover { text-decoration:underline; }

.cl-badge-tronc { background:#f3e8ff; color:#7c3aed; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:600; }
.cl-badge-actif { background:#f0fdf4; color:#16a34a; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:600; margin-left:6px; }
.cl-badge-parcours { background:#eff6ff; color:#1d4ed8; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:600; }

.cl-btn-students { background:#f0f7ff; color:#1d4ed8; border:none; border-radius:4px; padding:5px 10px; font-size:11px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.cl-btn-students:hover { background:#dbeafe; }
.cl-icon-btn { background:none; border:none; cursor:pointer; padding:4px 6px; border-radius:4px; font-size:13px; color:#888; }
.cl-icon-btn:hover { background:#f0f0f0; color:#333; }
.cl-icon-btn--danger:hover { background:#fff0f0; color:#E30613; }

/* Modal */
.cl-overlay { position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.4); padding:16px; }
.cl-modal-lg { background:#fff; border-radius:8px; width:100%; max-width:680px; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.2); }
.cl-modal { background:#fff; border-radius:8px; width:100%; max-width:500px; max-height:90vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.2); }
.cl-modal-sm { background:#fff; border-radius:8px; width:100%; max-width:400px; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.2); }
.cl-modal-header { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid #f0f0f0; flex-shrink:0; }
.cl-modal-title { font-size:15px; font-weight:700; color:#111; margin:0; }
.cl-modal-sub { font-size:11px; color:#888; margin:3px 0 0; }
.cl-modal-body { flex:1; overflow-y:auto; padding:18px 22px; }
.cl-close-btn { background:none; border:none; cursor:pointer; color:#aaa; font-size:16px; padding:4px; border-radius:4px; }
.cl-close-btn:hover { background:#f0f0f0; color:#333; }

.cl-tabs { display:flex; border-bottom:1px solid #f0f0f0; padding:0 22px; gap:4px; flex-shrink:0; }
.cl-tab { padding:10px 16px; font-size:12px; font-weight:600; border:none; border-bottom:2px solid transparent; background:none; cursor:pointer; color:#888; font-family:'Poppins',sans-serif; display:flex; align-items:center; gap:6px; margin-bottom:-1px; }
.cl-tab--active { border-bottom-color:#E30613; color:#E30613; }
.cl-tab-count { background:#f0f0f0; color:#888; padding:1px 6px; border-radius:20px; font-size:10px; font-weight:700; }
.cl-tab-count--active { background:#fde8e8; color:#E30613; }

.cl-badge-statut { padding:3px 8px; border-radius:20px; font-size:10.5px; font-weight:600; }
.cl-statut-inscrit_actif { background:#f0fdf4; color:#15803d; }
.cl-statut-pre_inscrit { background:#eff6ff; color:#1d4ed8; }
.cl-statut-en_examen { background:#fefce8; color:#854d0e; }
.cl-statut-suspendu { background:#fff7ed; color:#c2410c; }
.cl-statut-abandonne { background:#fff0f0; color:#b91c1c; }
.cl-statut-diplome { background:#f5f3ff; color:#6d28d9; }

.cl-label { display:block; font-size:11px; font-weight:600; color:#555; text-transform:uppercase; margin-bottom:4px; }
.cl-input { border:1.5px solid #e5e5e5; border-radius:4px; padding:9px 11px; font-family:'Poppins',sans-serif; font-size:13px; color:#333; background:#fff; }
.cl-input:focus { outline:none; border-color:#E30613; }
.cl-error-msg { background:#fff0f0; border:1px solid #fca5a5; border-radius:4px; padding:10px 12px; font-size:12px; color:#b91c1c; margin-bottom:14px; }

.cl-btn-affecter { background:#E30613; color:#fff; border:none; border-radius:4px; padding:6px 12px; font-size:11px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.cl-btn-affecter:hover { background:#c00; }
.cl-btn-affecter:disabled { opacity:0.5; cursor:not-allowed; }
.cl-btn-cancel { flex:1; border:1.5px solid #e5e5e5; background:#fff; color:#555; border-radius:4px; padding:9px; font-size:13px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.cl-btn-save { flex:1; background:#E30613; color:#fff; border:none; border-radius:4px; padding:9px; font-size:13px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.cl-btn-save:disabled { opacity:0.5; }
.cl-btn-delete { flex:1; background:#E30613; color:#fff; border:none; border-radius:4px; padding:9px; font-size:13px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }

/* UE / Enseignants */
.ue-form-panel { background:#f9fafb; border:1.5px solid #e5e7eb; border-radius:8px; padding:16px; margin-bottom:16px; }
.ue-form-title { font-size:13px; font-weight:700; color:#111; margin:0 0 14px; }
.ue-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.ue-form-group { display:flex; flex-direction:column; gap:4px; }
.ue-full { grid-column:1 / -1; }
.ue-badge-vol { background:#ecfdf5; color:#059669; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:700; }

@media (max-width: 768px) {
  .cl-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .cl-table { min-width: 520px; }
  .ue-form-grid { grid-template-columns: 1fr !important; }
  .cl-modal-lg { max-height: 95vh; }
  .cl-tabs { overflow-x: auto; padding: 0 12px; }
}
</style>
