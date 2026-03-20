<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { UcModal, UcFormGroup, UcFormGrid, UcPageHeader, UcTable } from '@/components/ui'

const auth = useAuthStore()
const canWrite = ['dg', 'coordinateur'].includes(auth.user?.role ?? '')

// ── Interfaces ───────────────────────────────────────────────────────
interface TypeFormation { id: number; nom: string; code: string; has_niveau?: boolean }
interface MatiereSimple { id: number; nom: string; code: string; pivot?: { coefficient: number; credits: number; ordre: number } }
interface Filiere { id: number; nom: string; code: string; type_formation_id: number | null; matieres?: MatiereSimple[] }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }
interface Parcours { id: number; nom: string; code: string; type_formation_id: number | null }
interface EnseignantForUE { id: number; nom: string; prenom: string; filieres?: { filiere_id: number }[] }
interface UE {
  id: number
  classe_id: number
  enseignant_id: number | null
  matiere_id: number | null
  code: string
  intitule: string
  coefficient: number
  credits_ects: number
  ordre: number
  enseignant?: { id: number; nom: string; prenom: string }
}
interface Classe {
  id: number
  nom: string
  niveau?: number
  est_tronc_commun: boolean
  tronc_commun_id?: number | null
  tronc_commun?: { id: number; nom: string } | null
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
  niveau: 1 as number,
  filiere_id: null as number | null,
  annee_academique_id: null as number | null,
  parcours_ids: [] as number[],
  est_tronc_commun: false,
  tronc_commun_id: null as number | null,
})

// Classes qui sont tronc commun (pour le sélecteur de liaison)
const troncCommunClasses = computed(() =>
  classes.value.filter(c => c.est_tronc_commun)
)

function niveauLabel(n?: number): string {
  if (!n) return '—'
  if (n === 1) return '1ère année'
  return `${n}ème année`
}

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
const enseignantsAll = ref<EnseignantForUE[]>([])
const ueForm = ref({
  enseignant_id: null as number | null,
  matiere_id: null as number | null,
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

// Tous les enseignants disponibles (l'affectation d'une matière se fait via l'UE de la classe)
const enseignantsForUE = computed(() => enseignantsAll.value)

// Matières de la filière de la classe courante
const matieresForUE = computed((): MatiereSimple[] => {
  const fId = classeForStudents.value?.filiere?.id
  if (!fId) return []
  const filiere = filieres.value.find(f => Number(f.id) === Number(fId))
  return filiere?.matieres ?? []
})

const filteredFilieres = computed(() => {
  if (!selectedType.value) return filieres.value
  const filtered = filieres.value.filter(f => f.type_formation_id === selectedType.value)
  // En mode édition : toujours inclure la filière actuelle même si hors du filtre
  const currentId = form.value.filiere_id
  if (currentId && !filtered.find(f => f.id === currentId)) {
    const current = filieres.value.find(f => f.id === currentId)
    if (current) return [current, ...filtered]
  }
  return filtered
})

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

// Vrai seulement pour les types ayant "has_niveau = true"
const isAcademique = computed(() => {
  if (!selectedType.value) return false
  const t = typesFormation.value.find(t => t.id === selectedType.value)
  return t?.has_niveau ?? false
})
// IDs des filières appartenant à un type "has_niveau = true"
// On croise filieres (chargées) + typesFormation — plus fiable que passer par la jointure SQL
const academicFiliereIds = computed(() => {
  const acadTypeIds = new Set(typesFormation.value.filter(t => t.has_niveau).map(t => t.id))
  return new Set(filieres.value.filter(f => f.type_formation_id != null && acadTypeIds.has(f.type_formation_id!)).map(f => f.id))
})

// ── Fonctions formulaire classe ───────────────────────────────────────
function onTypeChange() {
  form.value.filiere_id = null
  form.value.parcours_ids = []
  if (!isAcademique.value) form.value.niveau = 1
}

function openCreate() {
  const anneeActive = annees.value.find(a => a.actif)
  editTarget.value = null
  selectedType.value = null
  form.value = {
    nom: '',
    niveau: 1,
    filiere_id: null,
    annee_academique_id: anneeActive?.id ?? annees.value[0]?.id ?? null,
    parcours_ids: [],
    est_tronc_commun: false,
    tronc_commun_id: null,
  }
  error.value = ''
  showForm.value = true
}

function openEdit(c: Classe) {
  editTarget.value = c
  form.value = {
    nom: c.nom,
    niveau: c.niveau ?? 1,
    filiere_id: (c as any).filiere_id ?? c.filiere?.id ?? null,
    annee_academique_id: (c as any).annee_academique_id ?? c.annee_academique?.id ?? null,
    parcours_ids: c.parcours?.map(p => p.id) ?? [],
    est_tronc_commun: c.est_tronc_commun ?? false,
    tronc_commun_id: (c as any).tronc_commun_id ?? null,
  }
  selectedType.value = c.filiere?.type_formation_id ?? null
  error.value = ''
  showForm.value = true
}

function toggleParcours(id: number) {
  const idx = form.value.parcours_ids.indexOf(id)
  if (idx === -1) form.value.parcours_ids.push(id)
  else form.value.parcours_ids.splice(idx, 1)
}

// Reconstitue l'objet classe enrichi (filière, année, parcours) depuis les données locales
// car POST/PUT retournent uniquement la ligne brute SQL (sans jointures)
function enrichClasse(raw: any) {
  return {
    ...raw,
    filiere: filieres.value.find(f => f.id === raw.filiere_id) ?? null,
    annee_academique: annees.value.find(a => a.id === raw.annee_academique_id) ?? null,
    parcours: parcoursList.value.filter(p => form.value.parcours_ids.includes(p.id)),
  }
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
      const enriched = enrichClasse(data)
      const idx = classes.value.findIndex(c => c.id === data.id)
      if (idx !== -1) classes.value[idx] = enriched
    } else {
      const { data } = await api.post('/classes', form.value)
      classes.value.unshift(enrichClasse(data))
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

async function loadEnseignants() {
  if (enseignantsAll.value.length > 0) return
  const { data } = await api.get('/enseignants')
  enseignantsAll.value = Array.isArray(data) ? data : (data.data ?? [])
}

function openAddUe() {
  editingUe.value = null
  ueError.value = ''
  ueForm.value = {
    enseignant_id: null, matiere_id: null, intitule: '', code: '',
    coefficient: 1, credits_ects: 0, ordre: uesForClasse.value.length,
  }
  showUeForm.value = true
}

function openEditUe(ue: UE) {
  editingUe.value = ue
  ueError.value = ''
  ueForm.value = {
    enseignant_id: ue.enseignant_id,
    matiere_id: ue.matiere_id ?? null,
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
  if (mat) {
    ueForm.value.matiere_id = mat.id
    ueForm.value.code = mat.code
    // Auto-remplir coefficient et crédits depuis le pivot filière-matière
    if (mat.pivot) {
      ueForm.value.coefficient  = mat.pivot.coefficient ?? 1
      ueForm.value.credits_ects = mat.pivot.credits ?? 0
    }
  } else {
    ueForm.value.matiere_id = null
  }
}

async function saveUe() {
  if (!classeForStudents.value) return
  savingUe.value = true
  ueError.value = ''
  try {
    const payload = {
      classe_id: classeForStudents.value.id,
      enseignant_id: ueForm.value.enseignant_id || null,
      matiere_id: ueForm.value.matiere_id || null,
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
    // Recharger les filières pour avoir les matières fraîches (avec pivot)
    const [, f] = await Promise.all([
      Promise.all([loadUes(), loadEnseignants()]),
      api.get('/filieres'),
    ])
    filieres.value = f.data
  }
}

// ── Affectation étudiants ─────────────────────────────────────────────
async function openStudents(c: Classe) {
  classeForStudents.value = c
  studentsTab.value = 'dans-classe'
  showUeForm.value = false
  uesForClasse.value = []
  enseignantsAll.value = []
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

async function retirerEtudiant(inscriptionId: number) {
  if (!confirm('Retirer cet étudiant de la classe ? Il retournera dans le pool de sa filière.')) return
  affectingId.value = inscriptionId
  try {
    await api.put(`/inscriptions/${inscriptionId}/affecter-classe`, { classe_id: null })
    await refreshStudents()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur lors du retrait')
  } finally {
    affectingId.value = null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
const statutLabel: Record<string, string> = {
  pre_inscrit: 'Pré-inscrit', en_examen: 'En examen', inscrit_actif: 'Inscrit actif',
  suspendu: 'Suspendu', abandonne: 'Abandonné', diplome: 'Diplômé',
}

onMounted(load)
</script>

<template>
  <div class="uc-content">

    <!-- Header -->
    <UcPageHeader
      title="Classes"
      subtitle="Groupes d'étudiants par filière et année académique"
    >
      <template #actions>
        <button v-if="canWrite" @click="openCreate" class="uc-btn-primary">+ Nouvelle classe</button>
      </template>
    </UcPageHeader>

    <!-- Filtres -->
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;">
      <select v-model="filterAnnee" class="cl-select">
        <option value="">Toutes les années</option>
        <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
      </select>
      <span style="margin-left:auto;font-size:12px;color:#888;">{{ filtered.length }} classe{{ filtered.length !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Table -->
    <div v-if="loading" style="padding:40px;text-align:center;color:#aaa;font-size:13px;">Chargement…</div>
    <UcTable
      v-else
      :cols="[
        { key: 'classe',   label: 'Classe' },
        { key: 'filiere',  label: 'Filière' },
        { key: 'niveau',   label: 'Année d\'étude' },
        { key: 'annee',    label: 'Année acad.' },
        { key: 'parcours', label: 'Parcours' },
        { key: 'actions',  label: 'Actions', align: 'right' },
      ]"
      :data="filtered"
      empty-text="Aucune classe trouvée"
    >
      <template #row="{ item: c }">
        <td>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button @click="openStudents(c as any)" class="cl-link-btn">{{ (c as any).nom }}</button>
            <span v-if="(c as any).est_tronc_commun" class="cl-badge-tronc">🏫 Tronc commun</span>
            <span v-if="(c as any).tronc_commun" style="font-size:10px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:10px;padding:1px 7px;font-weight:600;">
              🔗 {{ (c as any).tronc_commun.nom }}
            </span>
          </div>
        </td>
        <td>
          <div v-if="(c as any).filiere">
            <p style="font-size:13px;font-weight:500;color:#333;margin:0;">{{ (c as any).filiere.nom }}</p>
            <span style="font-size:11px;color:#aaa;font-family:monospace;">{{ (c as any).filiere.code }}</span>
          </div>
          <span v-else style="color:#ccc;">—</span>
        </td>
        <td>
          <span v-if="academicFiliereIds.has((c as any).filiere_id)" style="font-size:13px;font-weight:600;color:#1a56db;">
            {{ niveauLabel((c as any).niveau) }}
          </span>
          <span v-else style="font-size:11px;color:#aaa;font-style:italic;">—</span>
        </td>
        <td>
          <span style="font-size:13px;color:#555;">{{ (c as any).annee_academique?.libelle ?? '—' }}</span>
          <span v-if="(c as any).annee_academique?.actif" class="cl-badge-actif">active</span>
        </td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            <span v-for="p in (c as any).parcours" :key="p.id" class="cl-badge-parcours">{{ p.code }}</span>
            <span v-if="!(c as any).parcours?.length" style="font-size:11px;color:#ccc;font-style:italic;">Aucun</span>
          </div>
        </td>
        <td style="text-align:right;">
          <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
            <button @click="openStudents(c as any)" class="cl-btn-students">Étudiants</button>
            <button v-if="canWrite" @click="openEdit(c as any)" title="Modifier" class="cl-icon-btn">✏️</button>
            <button v-if="canWrite" @click="confirmDelete = (c as any)" title="Supprimer" class="cl-icon-btn cl-icon-btn--danger">🗑</button>
          </div>
        </td>
      </template>
    </UcTable>

    <!-- Modal Étudiants -->
    <UcModal
      v-model="showStudents"
      :title="classeForStudents?.nom ?? ''"
      :subtitle="`Filière : ${classeForStudents?.filiere?.nom ?? '—'}`"
      width="680px"
      @close="showStudents = false"
    >
      <!-- Onglets -->
      <div class="cl-tabs" style="margin: -18px -22px 16px;">
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

      <div v-if="loadingStudents" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">Chargement…</div>

      <!-- Dans la classe -->
      <template v-else-if="studentsTab === 'dans-classe'">
        <div v-if="inscriptionsInClasse.length === 0" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">
          Aucun étudiant affecté à cette classe.
        </div>
        <UcTable
          v-else
          :cols="[
            { key: 'etudiant', label: 'Étudiant' },
            { key: 'niveau',   label: 'Niveau' },
            { key: 'statut',   label: 'Statut', align: 'center' },
            { key: 'action',   label: '', align: 'right' },
          ]"
          :data="inscriptionsInClasse"
          empty-text="Aucun étudiant"
        >
          <template #row="{ item: ins }">
            <td>
              <p style="font-weight:600;color:#333;margin:0;">{{ (ins as any).etudiant?.prenom }} {{ (ins as any).etudiant?.nom }}</p>
              <p style="font-size:11px;color:#aaa;font-family:monospace;margin:0;">{{ (ins as any).etudiant?.numero_etudiant }}</p>
            </td>
            <td style="color:#555;">{{ (ins as any).niveau_entree?.nom ?? '—' }}</td>
            <td style="text-align:center;">
              <span class="cl-badge-statut" :class="`cl-statut-${(ins as any).statut}`">
                {{ statutLabel[(ins as any).statut] ?? (ins as any).statut }}
              </span>
            </td>
            <td style="text-align:right;">
              <button
                v-if="canWrite"
                @click="retirerEtudiant((ins as any).id)"
                :disabled="affectingId === (ins as any).id"
                title="Retirer de la classe"
                style="font-size:11px;padding:3px 8px;border:1px solid #fca5a5;background:#fff;color:#dc2626;border-radius:5px;cursor:pointer;white-space:nowrap;"
              >
                {{ affectingId === (ins as any).id ? '…' : '↩ Retirer' }}
              </button>
            </td>
          </template>
        </UcTable>
      </template>

      <!-- Pool à affecter -->
      <template v-else-if="studentsTab === 'pool'">
        <!-- Filière verrouillée sur celle de la classe — pas de sélection libre -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:8px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;">
          <svg width="15" height="15" fill="none" stroke="#0284c7" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span style="font-size:12px;color:#0369a1;">
            Affichage des étudiants inscrits en
            <strong>{{ classeForStudents?.filiere?.nom ?? '—' }}</strong>
            sans classe affectée
          </span>
        </div>
        <div v-if="inscriptionsPool.length === 0" style="text-align:center;padding:32px;color:#aaa;font-size:13px;">
          Aucun étudiant sans classe dans la filière <strong>{{ classeForStudents?.filiere?.nom }}</strong>.
        </div>
        <div v-else>
          <p style="font-size:12px;color:#888;margin-bottom:10px;">
            {{ inscriptionsPool.length }} étudiant{{ inscriptionsPool.length > 1 ? 's' : '' }} disponibles
          </p>
          <UcTable
            :cols="[
              { key: 'etudiant', label: 'Étudiant' },
              { key: 'niveau',   label: 'Niveau' },
              { key: 'action',   label: 'Action', align: 'right' },
            ]"
            :data="inscriptionsPool"
            empty-text="Aucun étudiant"
          >
            <template #row="{ item: ins }">
              <td>
                <p style="font-weight:600;color:#333;margin:0;">{{ (ins as any).etudiant?.prenom }} {{ (ins as any).etudiant?.nom }}</p>
                <p style="font-size:11px;color:#aaa;font-family:monospace;margin:0;">{{ (ins as any).etudiant?.numero_etudiant }}</p>
              </td>
              <td style="color:#555;">{{ (ins as any).niveau_entree?.nom ?? '—' }}</td>
              <td style="text-align:right;">
                <button @click="affecterEtudiant((ins as any).id)" :disabled="affectingId === (ins as any).id" class="cl-btn-affecter">
                  {{ affectingId === (ins as any).id ? 'Affectation…' : '+ Affecter' }}
                </button>
              </td>
            </template>
          </UcTable>
        </div>
      </template>

      <!-- Onglet Enseignants (UE) -->
      <template v-else-if="studentsTab === 'enseignants'">
        <div v-if="loadingUes" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">Chargement…</div>
        <template v-else>

          <!-- Formulaire ajout / édition UE -->
          <div v-if="showUeForm" class="ue-form-panel">
            <h3 class="ue-form-title">{{ editingUe ? 'Modifier l\'affectation' : 'Affecter un enseignant' }}</h3>
            <div v-if="ueError" class="cl-error-msg" style="margin-bottom:10px;">{{ ueError }}</div>
            <UcFormGroup label="Enseignant">
              <select v-model="ueForm.enseignant_id" class="cl-input" style="width:100%;">
                <option :value="null">— Sans enseignant —</option>
                <option v-for="i in enseignantsForUE" :key="i.id" :value="i.id">
                  {{ i.prenom }} {{ i.nom }}
                </option>
              </select>
            </UcFormGroup>
            <UcFormGroup label="Matière" :required="true" style="margin-top:10px;">
              <select v-if="matieresForUE.length > 0"
                v-model="ueForm.intitule" required class="cl-input" style="width:100%;"
                @change="onUeIntituleChange">
                <option value="">— Choisir une matière de la filière —</option>
                <option v-for="m in matieresForUE" :key="m.id" :value="m.nom">
                  {{ m.nom }}{{ m.pivot ? ` — Coeff. ${m.pivot.coefficient} | ${m.pivot.credits} crédits` : '' }}
                </option>
              </select>
              <input v-else v-model="ueForm.intitule" required placeholder="Ex : Algorithmique"
                class="cl-input" style="width:100%;box-sizing:border-box;" />
              <div v-if="matieresForUE.length === 0" style="font-size:11px;color:#e67e22;margin-top:4px;">
                ⚠️ Aucune matière n'est assignée à cette filière. Ajoutez-en d'abord dans les Filières.
              </div>
            </UcFormGroup>
            <UcFormGrid :cols="3" style="margin-top:10px;">
              <UcFormGroup label="Code" :required="true">
                <input v-model="ueForm.code" required placeholder="Ex : ALGO" class="cl-input" style="width:100%;box-sizing:border-box;" />
              </UcFormGroup>
              <UcFormGroup label="Coefficient">
                <input v-model.number="ueForm.coefficient" type="number" min="0" step="0.5" class="cl-input" style="width:100%;box-sizing:border-box;" />
              </UcFormGroup>
              <UcFormGroup label="Crédits ECTS">
                <input v-model.number="ueForm.credits_ects" type="number" min="0" class="cl-input" style="width:100%;box-sizing:border-box;" />
              </UcFormGroup>
            </UcFormGrid>
            <!-- Aide sur les deux systèmes -->
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:8px 12px;font-size:11px;color:#0369a1;margin-top:8px;line-height:1.6;">
              <strong>Coefficient</strong> → Formations professionnelles (calcul de moyenne pondérée)<br>
              <strong>Crédits ECTS</strong> → Système LMD (60 crédits = passage, &lt; 42 = redoublement)
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
          <UcTable
            v-else-if="uesForClasse.length > 0"
            :cols="[
              { key: 'matiere',    label: 'Matière' },
              { key: 'enseignant', label: 'Enseignant' },
              { key: 'coeff',      label: 'Coeff.', align: 'center' },
              { key: 'vol',        label: 'Vol. h',  align: 'center' },
              { key: 'actions',    label: 'Actions',  align: 'right' },
            ]"
            :data="uesForClasse"
            empty-text="Aucun enseignant"
          >
            <template #row="{ item: ue }">
              <td>
                <p style="font-weight:600;color:#333;margin:0;">{{ (ue as any).intitule }}</p>
                <span style="font-size:11px;color:#aaa;font-family:monospace;">{{ (ue as any).code }}</span>
              </td>
              <td>
                <span v-if="(ue as any).enseignant" style="font-size:13px;color:#333;">
                  {{ (ue as any).enseignant.prenom }} {{ (ue as any).enseignant.nom }}
                </span>
                <span v-else style="font-size:11px;color:#ccc;font-style:italic;">Non assigné</span>
              </td>
              <td style="text-align:center;">
                <span class="cl-badge-parcours">{{ (ue as any).coefficient }}</span>
              </td>
              <td style="text-align:center;">
                <span v-if="(ue as any).credits_ects > 0" class="ue-badge-vol">{{ (ue as any).credits_ects }}h</span>
                <span v-else style="color:#ccc;">—</span>
              </td>
              <td style="text-align:right;">
                <div style="display:flex;gap:6px;justify-content:flex-end;">
                  <button @click="openEditUe(ue as any)" class="cl-icon-btn" title="Modifier">✏️</button>
                  <button @click="deleteUe(ue as any)" class="cl-icon-btn cl-icon-btn--danger"
                    :disabled="deletingUeId === (ue as any).id" title="Supprimer">🗑</button>
                </div>
              </td>
            </template>
          </UcTable>
        </template>
      </template>
    </UcModal>

    <!-- Modal Formulaire Classe -->
    <UcModal
      v-model="showForm"
      :title="editTarget ? 'Modifier la classe' : 'Nouvelle classe'"
      width="500px"
      @close="showForm = false"
    >
      <div v-if="error" class="cl-error-msg">{{ error }}</div>
      <form @submit.prevent="save" style="display:flex;flex-direction:column;gap:14px;">
        <UcFormGroup label="Nom de la classe" :required="true">
          <input v-model="form.nom" required placeholder="ex: BTS SIO 1 — 2025/2026" class="cl-input" style="width:100%;box-sizing:border-box;" />
        </UcFormGroup>
        <UcFormGroup v-if="isAcademique" label="Année d'étude" :required="true">
          <select v-model.number="form.niveau" class="cl-input" style="width:100%;box-sizing:border-box;">
            <option :value="1">1ère année</option>
            <option :value="2">2ème année</option>
            <option :value="3">3ème année</option>
            <option :value="4">4ème année</option>
            <option :value="5">5ème année</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Type de formation">
          <select v-model="selectedType" @change="onTypeChange" class="cl-input" style="width:100%;box-sizing:border-box;">
            <option :value="null">— Tous les types —</option>
            <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }} ({{ t.code }})</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Filière" :required="true">
          <select v-model="form.filiere_id" required class="cl-input" style="width:100%;box-sizing:border-box;">
            <option :value="null" disabled>— Choisir une filière —</option>
            <option v-for="f in filteredFilieres" :key="f.id" :value="f.id">{{ f.nom }}</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Année académique" :required="true">
          <select v-model="form.annee_academique_id" required class="cl-input" style="width:100%;box-sizing:border-box;">
            <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
          </select>
        </UcFormGroup>
        <!-- Tronc commun toggle -->
        <div style="background:#f8fafc;border:1.5px solid #e5e5e5;border-radius:8px;padding:12px 14px;">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
            <input type="checkbox" v-model="form.est_tronc_commun" @change="() => { if(form.est_tronc_commun) form.tronc_commun_id = null }" style="width:16px;height:16px;accent-color:#E30613;" />
            <div>
              <div style="font-size:13px;font-weight:600;color:#1e3a5f;">🏫 Cette classe est un Tronc Commun</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px;">Ses UEs seront automatiquement partagées avec les classes qui lui sont liées</div>
            </div>
          </label>
        </div>

        <!-- Lier à un tronc commun (uniquement si pas elle-même tronc commun) -->
        <UcFormGroup v-if="!form.est_tronc_commun" label="Lier à un Tronc Commun">
          <select v-model="form.tronc_commun_id" class="cl-input" style="width:100%;box-sizing:border-box;">
            <option :value="null">— Aucun tronc commun —</option>
            <option v-for="tc in troncCommunClasses" :key="tc.id" :value="tc.id">{{ tc.nom }}</option>
          </select>
          <p v-if="troncCommunClasses.length === 0" style="font-size:11px;color:#f59e0b;margin:4px 0 0;">Aucune classe tronc commun créée. Créez d'abord une classe avec l'option ci-dessus.</p>
        </UcFormGroup>

        <div>
          <label class="cl-label" style="margin-bottom:6px;">Parcours associés</label>
          <div style="max-height:140px;overflow-y:auto;border:1.5px solid #e5e5e5;border-radius:4px;padding:6px;">
            <label v-for="p in filteredParcours" :key="p.id" style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;">
              <input type="checkbox" :value="p.id" :checked="form.parcours_ids.includes(p.id)" @change="toggleParcours(p.id)" />
              <span style="font-size:13px;color:#333;flex:1;">{{ p.nom }}</span>
              <span style="font-size:10px;font-family:monospace;color:#aaa;">{{ p.code }}</span>
            </label>
            <p v-if="filteredParcours.length === 0" style="font-size:12px;color:#ccc;text-align:center;padding:8px;">Aucun parcours disponible</p>
          </div>
        </div>
      </form>
      <template #footer>
        <button type="button" @click="showForm = false" class="cl-btn-cancel">Annuler</button>
        <button type="button" @click="save" :disabled="saving" class="cl-btn-save">{{ saving ? 'Enregistrement…' : 'Enregistrer' }}</button>
      </template>
    </UcModal>

    <!-- Modal Confirm suppression -->
    <UcModal
      :model-value="!!confirmDelete"
      title="Supprimer la classe"
      width="400px"
      @close="confirmDelete = null"
    >
      <p style="font-size:13px;color:#555;margin:0;">
        Voulez-vous supprimer <strong>{{ confirmDelete?.nom }}</strong> ? Cette action est irréversible.
      </p>
      <template #footer>
        <button @click="confirmDelete = null" class="cl-btn-cancel">Annuler</button>
        <button @click="deleteClasse" class="cl-btn-delete">Supprimer</button>
      </template>
    </UcModal>

  </div>
</template>

<style scoped>
.uc-content {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
  font-family: 'Poppins', sans-serif;
}

.uc-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  background: #E30613;
  color: #fff;
  border: none;
  border-radius: 5px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.uc-btn-primary:hover { background: #c0040f; }

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

.cl-tabs { display:flex; border-bottom:1px solid #f0f0f0; padding:0 22px; gap:4px; }
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
.ue-badge-vol { background:#ecfdf5; color:#059669; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:700; }

@media (max-width: 768px) {
  .cl-tabs { overflow-x: auto; padding: 0 12px; }
}
</style>
