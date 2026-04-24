<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { UcModal, UcFormGroup, UcFormGrid, UcPageHeader, UcTable } from '@/components/ui'

const auth = useAuthStore()
const canWrite = ['dg', 'dir_peda', 'coordinateur'].includes(auth.user?.role ?? '')
// Édition de la date de début des cours : le secrétariat en a aussi besoin
// (utile lors des inscriptions et du pilotage des échéances).
const canEditDateDebut = ['dg', 'dir_peda', 'coordinateur', 'secretariat', 'resp_fin'].includes(auth.user?.role ?? '')

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
  intitule_ue?: string
  coefficient: number
  credits_ects: number
  volume_horaire: number
  ordre: number
  semestre?: number
  categorie_ue?: string
  cm?: number; td?: number; tp?: number; tpe?: number
  enseignant?: { id: number; nom: string; prenom: string }
}
interface Classe {
  id: number
  nom: string
  niveau?: number
  est_tronc_commun: boolean
  tronc_commun_ids?: number[]
  troncs_commun?: { id: number; nom: string }[]
  filiere?: Filiere
  annee_academique?: AnneeAcademique
  parcours?: Parcours[]
  date_debut_cours?: string | null
  exempt_tenue?: boolean
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
  tronc_commun_ids: [] as number[],
  date_debut_cours: '' as string,
  exempt_tenue: false,
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

// ── Saisie rapide date début cours ──────────────────────────────────
const quickDateClasseId = ref<number | null>(null)
const quickDateValue = ref('')
const quickDateSaving = ref(false)

function openQuickDate(c: any) {
  quickDateClasseId.value = c.id
  quickDateValue.value = c.date_debut_cours ? String(c.date_debut_cours).slice(0, 10) : ''
}

async function saveQuickDate(c: any) {
  quickDateSaving.value = true
  try {
    await api.patch(`/classes/${c.id}/date-debut-cours`, { date_debut_cours: quickDateValue.value || null })
    c.date_debut_cours = quickDateValue.value || null
    quickDateClasseId.value = null
  } catch (e: any) {
    alert(e.response?.data?.error || 'Erreur')
  } finally {
    quickDateSaving.value = false
  }
}

function formatDateCourte(d: string | null | undefined) {
  if (!d) return null
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Gestion étudiants d'une classe ───────────────────────────────────
const showStudents = ref(false)
const classeForStudents = ref<Classe | null>(null)
const studentsTab = ref<'dans-classe' | 'pool' | 'enseignants' | 'affectations' | 'suivi-paiements'>('dans-classe')
const collapsedSemesters = ref<Set<number>>(new Set())
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
const generatingMaquette = ref(false)
const nettoyageDoublons = ref(false)
const enseignantsAll = ref<EnseignantForUE[]>([])
const matieresGlobal = ref<MatiereSimple[]>([])
const ueForm = ref({
  enseignant_id: null as number | null,
  matiere_id: null as number | null,
  intitule: '',
  intitule_ue: '',
  code: '',
  coefficient: 1 as number,
  credits_ects: 0 as number,
  volume_horaire: 0 as number,
  ordre: 0 as number,
  semestre: 1 as number,
})
const activeSemestre = ref<number>(0) // 0 = tous les semestres

// ── Computed ─────────────────────────────────────────────────────────
const filtered = computed(() =>
  classes.value.filter(c => !filterAnnee.value || c.annee_academique?.id === filterAnnee.value)
)

// Tous les enseignants disponibles (l'affectation d'une matière se fait via l'UE de la classe)
const enseignantsForUE = computed(() => enseignantsAll.value)

// Matières disponibles pour le formulaire UE
// - Tronc commun → toutes les matières globales
// - Filière normale → matières de la filière (avec pivot coefficient/crédits)
const isTroncCommunClasse = computed(() => !!(classeForStudents.value as any)?.est_tronc_commun)

const matieresForUE = computed((): MatiereSimple[] => {
  let list: MatiereSimple[]
  if (isTroncCommunClasse.value) {
    // Tronc commun : matières des UEs générées, sauf celles déjà assignées à un enseignant
    const assignedMatiereIds = new Set(
      uesForClasse.value
        .filter(ue => ue.enseignant_id)
        .map(ue => ue.matiere_id)
    )
    const uesMatieres = uesForClasse.value
      .filter(ue => ue.matiere_id)
      .map(ue => ({ id: ue.matiere_id!, nom: ue.intitule, code: ue.code }))
    // Dédupliquer par id
    const seen = new Set<number>()
    list = uesMatieres.filter(m => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
    // En édition, garder la matière en cours
    const editingNom = editingUe.value?.intitule?.toLowerCase().trim()
    return list.filter(m => {
      const nom = m.nom.toLowerCase().trim()
      if (editingNom && nom === editingNom) return true
      return !assignedMatiereIds.has(m.id)
    })
  } else {
    const fId = classeForStudents.value?.filiere?.id
    if (!fId) return []
    const filiere = filieres.value.find(f => Number(f.id) === Number(fId))
    list = filiere?.matieres ?? []
  }
  // En édition, ne pas filtrer la matière en cours d'édition
  const editingNom = editingUe.value?.intitule?.toLowerCase().trim()
  // Filtrer les matières déjà affectées (sauf celle en cours d'édition)
  return list.filter(m => {
    const nom = m.nom.toLowerCase().trim()
    if (editingNom && nom === editingNom) return true
    return !matieresDejaAffectees.value.has(nom)
  })
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

// Auto-détecter le type de formation depuis la filière choisie
// Cas 1 : création → l'utilisateur choisit d'abord la filière
// Cas 2 : modification → la filière est pré-sélectionnée mais type_formation_id peut être null sur l'ancienne filière
watch(() => form.value.filiere_id, (newId) => {
  if (!newId) return
  const f = filieres.value.find(f => f.id === newId)
  if (f?.type_formation_id) {
    selectedType.value = f.type_formation_id
  }
})

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
    tronc_commun_ids: [],
    date_debut_cours: '',
    exempt_tenue: false,
  }
  error.value = ''
  showForm.value = true
}

function openEdit(c: Classe) {
  editTarget.value = c
  const tcIds = c.troncs_commun?.map(tc => Number(tc.id)) ?? []
  form.value = {
    nom: c.nom,
    niveau: c.niveau ?? 1,
    filiere_id: (c as any).filiere_id ?? c.filiere?.id ?? null,
    annee_academique_id: (c as any).annee_academique_id ?? c.annee_academique?.id ?? null,
    parcours_ids: c.parcours?.map(p => p.id) ?? [],
    est_tronc_commun: c.est_tronc_commun ?? false,
    tronc_commun_ids: tcIds,
    date_debut_cours: (c as any).date_debut_cours ? String((c as any).date_debut_cours).slice(0, 10) : '',
    exempt_tenue: (c as any).exempt_tenue === true,
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

function toggleTroncCommun(id: number) {
  const numId = Number(id)
  const idx = form.value.tronc_commun_ids.indexOf(numId)
  if (idx === -1) form.value.tronc_commun_ids.push(numId)
  else form.value.tronc_commun_ids.splice(idx, 1)
}

// Reconstitue l'objet classe enrichi (filière, année, parcours) depuis les données locales
// car POST/PUT retournent uniquement la ligne brute SQL (sans jointures)
function enrichClasse(raw: any) {
  const tcIds = form.value.tronc_commun_ids.map(Number)
  return {
    ...raw,
    filiere: filieres.value.find(f => f.id === raw.filiere_id) ?? null,
    annee_academique: annees.value.find(a => a.id === raw.annee_academique_id) ?? null,
    parcours: parcoursList.value.filter(p => form.value.parcours_ids.includes(p.id)),
    troncs_commun: troncCommunClasses.value
      .filter(tc => tcIds.includes(tc.id))
      .map(tc => ({ id: tc.id, nom: tc.nom })),
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
      await api.put(`/classes/${editTarget.value.id}`, form.value)
    } else {
      await api.post('/classes', form.value)
    }
    showForm.value = false
    await load()
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

async function loadMatieresGlobal() {
  if (matieresGlobal.value.length > 0) return
  const { data } = await api.get('/matieres')
  matieresGlobal.value = Array.isArray(data) ? data : (data.data ?? [])
}

function openAddUe() {
  editingUe.value = null
  ueError.value = ''
  ueForm.value = {
    enseignant_id: null, matiere_id: null, intitule: '', intitule_ue: '', code: '',
    coefficient: 1, credits_ects: 0, volume_horaire: 0, ordre: uesForClasse.value.length,
    semestre: activeSemestre.value || 1,
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
    intitule_ue: (ue as any).intitule_ue ?? '',
    code: ue.code,
    coefficient: ue.coefficient,
    credits_ects: ue.credits_ects,
    volume_horaire: ue.volume_horaire ?? 0,
    ordre: ue.ordre,
    semestre: (ue as any).semestre ?? 1,
  }
  showUeForm.value = true
}

function onUeIntituleChange() {
  const mat = matieresForUE.value.find(m => m.nom === ueForm.value.intitule)
  if (mat) {
    ueForm.value.matiere_id = mat.id
    ueForm.value.code = mat.code
    // Auto-remplir coefficient et crédits depuis le pivot filière-matière (non tronc commun seulement)
    if (!isTroncCommunClasse.value && mat.pivot) {
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
      intitule_ue: ueForm.value.intitule_ue || null,
      coefficient: ueForm.value.coefficient,
      credits_ects: ueForm.value.credits_ects,
      volume_horaire: ueForm.value.volume_horaire,
      ordre: ueForm.value.ordre,
      semestre: ueForm.value.semestre,
    }
    if (editingUe.value) {
      // Mode édition : mettre à jour l'UE existante
      await api.put(`/ues/${editingUe.value.id}`, payload)
    } else if (isTroncCommunClasse.value && ueForm.value.matiere_id) {
      // Tronc commun : trouver l'UE existante (de la maquette) et la mettre à jour
      const existingUe = uesForClasse.value.find(
        ue => ue.matiere_id === ueForm.value.matiere_id && !ue.enseignant_id
      )
      if (existingUe) {
        // Mettre à jour l'UE existante avec l'enseignant (garder les infos maquette)
        await api.put(`/ues/${existingUe.id}`, {
          ...payload,
          // Conserver les valeurs de la maquette si non modifiées
          code: existingUe.code || payload.code,
          coefficient: existingUe.coefficient ?? payload.coefficient,
          credits_ects: existingUe.credits_ects ?? payload.credits_ects,
          volume_horaire: payload.volume_horaire || existingUe.volume_horaire || 0,
        })
      } else {
        await api.post('/ues', payload)
      }
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

// Maquette disponible pour cette classe ?
const hasMaquette = computed(() => {
  if (!classeForStudents.value) return false
  const fId = classeForStudents.value.filiere?.id
  if (!fId) return false
  const filiere = filieres.value.find(f => Number(f.id) === Number(fId))
  return (filiere?.matieres?.length ?? 0) > 0 // filiere_matiere a des entrées
})

// Structurer les UEs par semestre > UE groupée
const uesBySemestre = computed(() => {
  const ues = uesForClasse.value
  // Grouper par semestre
  const semMap: Record<number, any[]> = {}
  for (const ue of ues) {
    const sem = (ue as any).semestre || 0
    if (!semMap[sem]) semMap[sem] = []
    semMap[sem].push(ue)
  }
  return Object.entries(semMap).map(([sem, items]) => {
    // Grouper par code UE
    const groupeMap: Record<string, { code: string; intitule_ue: string; categorie: string; ues: any[]; totalCredits: number }> = {}
    for (const ue of items) {
      const key = (ue as any).code || `_${ue.id}`
      if (!groupeMap[key]) {
        groupeMap[key] = { code: key, intitule_ue: (ue as any).intitule_ue || '', categorie: (ue as any).categorie_ue || '', ues: [], totalCredits: 0 }
      }
      groupeMap[key].ues.push(ue)
      groupeMap[key].totalCredits += parseFloat((ue as any).credits_ects) || 0
    }
    return {
      semestre: parseInt(sem),
      groupes: Object.values(groupeMap).map(g => ({ ...g, totalCredits: Math.round(g.totalCredits * 10) / 10 }))
    }
  }).sort((a, b) => a.semestre - b.semestre)
})

// Semestres disponibles (pour les onglets)
const semestresDisponibles = computed(() => {
  const sems = new Set<number>()
  for (const ue of uesForClasse.value) {
    sems.add((ue as any).semestre || 0)
  }
  return Array.from(sems).sort((a, b) => a - b)
})

// UEs filtrées par semestre actif
const uesBySemestreFiltered = computed(() => {
  if (activeSemestre.value === 0) return uesBySemestre.value
  return uesBySemestre.value.filter(s => s.semestre === activeSemestre.value)
})

// Matières déjà affectées (par intitulé) — pour cacher du dropdown
const matieresDejaAffectees = computed(() => {
  return new Set(uesForClasse.value.map(ue => (ue as any).intitule?.toLowerCase().trim()))
})

// ── Tronc commun : sélection matières ───────────────────────────────
const showTcModal = ref(false)
const tcMatieres = ref<any[]>([])
const tcFilieres = ref<any[]>([])
const tcSelected = ref<Set<number>>(new Set())
const loadingTc = ref(false)

async function openTcMaquette() {
  if (!classeForStudents.value) return
  loadingTc.value = true
  showTcModal.value = true
  try {
    const { data } = await api.get(`/classes/${classeForStudents.value.id}/maquette-tc`)
    tcMatieres.value = data.matieres || []
    tcFilieres.value = data.filieres || []
    // Pré-sélectionner toutes
    tcSelected.value = new Set(tcMatieres.value.map((m: any) => m.matiere_id))
  } catch (e: any) {
    alert(e.response?.data?.error || 'Erreur chargement maquettes')
    showTcModal.value = false
  } finally { loadingTc.value = false }
}

function toggleTcMatiere(id: number) {
  if (tcSelected.value.has(id)) tcSelected.value.delete(id)
  else tcSelected.value.add(id)
  tcSelected.value = new Set(tcSelected.value) // réactivité
}

function tcSelectAll() { tcSelected.value = new Set(tcMatieres.value.map((m: any) => m.matiere_id)) }
function tcDeselectAll() { tcSelected.value = new Set() }

async function genererUesTc() {
  if (!classeForStudents.value || tcSelected.value.size === 0) return
  const nb = uesForClasse.value.length
  if (nb > 0 && !confirm(`Cette classe a déjà ${nb} UE(s). Les nouvelles matières seront ajoutées, les existantes seront conservées. Continuer ?`)) return

  generatingMaquette.value = true
  try {
    const { data } = await api.post(`/classes/${classeForStudents.value.id}/generer-ues`, {
      matiere_ids: Array.from(tcSelected.value)
    })
    alert(`${data.total} UE(s) générée(s) pour le tronc commun.`)
    showTcModal.value = false
    await loadUes()
  } catch (e: any) {
    alert(e.response?.data?.error || 'Erreur')
  } finally { generatingMaquette.value = false }
}

async function genererUesMaquette() {
  if (!classeForStudents.value) return
  const cls = classeForStudents.value

  // Tronc commun → ouvrir la modal de sélection
  if (cls.est_tronc_commun) {
    await openTcMaquette()
    return
  }

  const nb = uesForClasse.value.length
  const msg = nb > 0
    ? `Cette classe a déjà ${nb} UE(s). Les nouvelles matières seront ajoutées, les existantes conservées. Continuer ?`
    : `Générer automatiquement les UEs depuis la maquette de la filière "${cls.filiere?.nom}" ?`
  if (!confirm(msg)) return

  generatingMaquette.value = true
  try {
    const { data } = await api.post(`/classes/${cls.id}/generer-ues`)
    alert(`${data.total} UE(s) générée(s) depuis la maquette.`)
    await loadUes()
  } catch (e: any) {
    alert(e.response?.data?.error || 'Erreur lors de la génération')
  } finally {
    generatingMaquette.value = false
  }
}

async function nettoyerDoublonsUes() {
  if (!classeForStudents.value) return
  const doublons = uesForClasse.value
    .filter(u => u.matiere_id)
    .reduce((acc, u) => {
      acc[u.matiere_id!] = (acc[u.matiere_id!] || 0) + 1
      return acc
    }, {} as Record<number, number>)
  const nbDoublons = Object.values(doublons).filter(n => n > 1).reduce((a, n) => a + (n - 1), 0)
  if (nbDoublons === 0) { alert('Aucun doublon détecté.'); return }
  if (!confirm(`${nbDoublons} doublon(s) détecté(s). Supprimer automatiquement ? (Les enseignants affectés seront conservés sur la première occurrence.)`) ) return
  nettoyageDoublons.value = true
  try {
    const { data } = await api.post(`/classes/${classeForStudents.value.id}/nettoyer-doublons`)
    alert(typeof data?.message === 'string' ? data.message : JSON.stringify(data))
    await loadUes()
  } catch (e: any) {
    const msg = e.response?.data?.error || e.response?.data?.message || e.message || 'Erreur lors du nettoyage'
    alert(typeof msg === 'string' ? msg : JSON.stringify(msg))
  } finally {
    nettoyageDoublons.value = false
  }
}

// ── Suivi paiements ──────────────────────────────────────────────────
interface SuiviEtudiant {
  inscription_id: number
  etudiant_id: number
  nom: string
  prenom: string
  numero_etudiant: string
  telephone: string
  email: string
  date_inscription: string
  ancre: string
  mensualite: number
  mensualites_dues: number
  mensualites_payees: number
  retard: number
  montant_du: number
  total_paye: number
  frais_inscription_paye: boolean
  statut: string
}
interface SuiviResume {
  total_etudiants: number
  a_jour: number
  en_retard: number
  total_creances: number
  total_paye: number
}
interface ComptaData {
  tresorerie: number
  ca_reconnu: number
  pca: number
  creances: number
  total_du: number
  taux_recouvrement: number
  nb_inscrits: number
}

const suiviEtudiants = ref<SuiviEtudiant[]>([])
const suiviResume = ref<SuiviResume | null>(null)
const comptaData = ref<ComptaData | null>(null)
const loadingSuivi = ref(false)
const moisControle = ref(new Date().toISOString().slice(0, 7)) // YYYY-MM
const dateDebutCoursEdit = ref('')
const savingDateDebut = ref(false)

async function saveDebutCours() {
  if (!classeForStudents.value) return
  savingDateDebut.value = true
  try {
    await api.patch(`/classes/${classeForStudents.value.id}/date-debut-cours`, {
      date_debut_cours: dateDebutCoursEdit.value || null,
    })
    // Mettre à jour la classe locale
    ;(classeForStudents.value as any).date_debut_cours = dateDebutCoursEdit.value || null
    // Recharger le suivi avec la nouvelle ancre
    await loadSuiviPaiements()
  } catch (e: any) {
    alert(e.response?.data?.error || 'Erreur')
  } finally {
    savingDateDebut.value = false
  }
}

async function loadSuiviPaiements() {
  if (!classeForStudents.value) return
  loadingSuivi.value = true
  try {
    const [suiviRes, comptaRes] = await Promise.all([
      api.get(`/classes/${classeForStudents.value.id}/suivi-paiements?mois_controle=${moisControle.value}`),
      api.get(`/classes/${classeForStudents.value.id}/comptabilite?mois=${moisControle.value}`),
    ])
    suiviEtudiants.value = suiviRes.data.etudiants
    suiviResume.value = suiviRes.data.resume
    comptaData.value = comptaRes.data
  } catch (e: any) {
    console.error('Erreur suivi:', e)
    suiviEtudiants.value = []
    suiviResume.value = null
    comptaData.value = null
  } finally {
    loadingSuivi.value = false
  }
}

function statutBadge(statut: string) {
  switch (statut) {
    case 'a_jour': return { bg: '#dcfce7', color: '#166534', label: 'À jour' }
    case 'pas_encore_du': return { bg: '#f0f9ff', color: '#0369a1', label: 'Pas encore dû' }
    case 'retard_leger': return { bg: '#fef3c7', color: '#92400e', label: '1 mois de retard' }
    case 'en_retard': return { bg: '#fef2f2', color: '#dc2626', label: 'En retard' }
    default: return { bg: '#f5f5f5', color: '#666', label: statut }
  }
}

function formatFCFA(n: number) {
  return new Intl.NumberFormat('fr-FR').format(n) + ' F'
}

async function onTabChange(tab: 'dans-classe' | 'pool' | 'enseignants' | 'affectations' | 'suivi-paiements') {
  studentsTab.value = tab
  if (tab === 'suivi-paiements') {
    const ddc = (classeForStudents.value as any)?.date_debut_cours
    dateDebutCoursEdit.value = ddc ? String(ddc).slice(0, 10) : ''
    await loadSuiviPaiements()
    return
  }
  if (tab === 'dans-classe') {
    // Charger le suivi en arrière-plan si date_debut_cours définie (pour afficher les badges retard)
    const ddc = (classeForStudents.value as any)?.date_debut_cours
    if (ddc && suiviEtudiants.value.length === 0) {
      dateDebutCoursEdit.value = String(ddc).slice(0, 10)
      loadSuiviPaiements() // async sans await — non-bloquant
    }
    return
  }
  if (tab === 'affectations') {
    if (uesForClasse.value.length === 0) await loadUes()
    return
  }
  if (tab === 'enseignants') {
    const promises: Promise<any>[] = [
      Promise.all([loadUes(), loadEnseignants()]),
    ]
    // Tronc commun → charger matières globales ; sinon recharger filières (pivot)
    if (isTroncCommunClasse.value) {
      matieresGlobal.value = [] // forcer le rechargement
      promises.push(loadMatieresGlobal())
    } else {
      promises.push(api.get('/filieres').then(f => { filieres.value = f.data }))
    }
    await Promise.all(promises)
  }
}

// ── Affectation étudiants ─────────────────────────────────────────────
async function openStudents(c: Classe) {
  classeForStudents.value = c
  studentsTab.value = 'dans-classe'
  showUeForm.value = false
  uesForClasse.value = []
  enseignantsAll.value = []
  suiviEtudiants.value = []
  suiviResume.value = null
  comptaData.value = null
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
        <a href="/filieres" style="display:inline-flex;align-items:center;gap:7px;padding:8px 16px;background:#E30613;color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
          Filières
        </a>
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
        { key: 'classe',      label: 'Classe' },
        { key: 'filiere',     label: 'Filière' },
        { key: 'niveau',      label: 'Année d\'étude' },
        { key: 'annee',       label: 'Année acad.' },
        { key: 'debut_cours', label: 'Début cours' },
        { key: 'parcours',    label: 'Parcours' },
        { key: 'actions',     label: 'Actions', align: 'right' },
      ]"
      :data="filtered"
      empty-text="Aucune classe trouvée"
    >
      <template #row="{ item: c }">
        <td>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button @click="openStudents(c as any)" class="cl-link-btn">{{ (c as any).nom }}</button>
            <span v-if="(c as any).est_tronc_commun" class="cl-badge-tronc">🏫 Tronc commun</span>
            <span v-for="tc in ((c as any).troncs_commun || [])" :key="tc.id" style="font-size:10px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:10px;padding:1px 7px;font-weight:600;">
              🔗 {{ tc.nom }}
            </span>
          </div>
        </td>
        <td>
          <div v-if="(c as any).est_tronc_commun" style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:12px;color:#0369a1;background:#e0f2fe;border-radius:10px;padding:2px 8px;font-weight:600;">Multi-filières</span>
          </div>
          <div v-else-if="(c as any).filiere">
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
        <!-- Début cours avec saisie rapide inline -->
        <td style="min-width:140px;">
          <template v-if="quickDateClasseId === (c as any).id">
            <div style="display:flex;gap:4px;align-items:center;">
              <input type="date" v-model="quickDateValue" autofocus
                style="padding:4px 6px;border:1.5px solid #1d4ed8;border-radius:5px;font-size:11px;width:120px;" />
              <button @click="saveQuickDate(c)" :disabled="quickDateSaving"
                style="padding:3px 8px;background:#1d4ed8;color:#fff;border:none;border-radius:5px;font-size:11px;cursor:pointer;white-space:nowrap;">
                {{ quickDateSaving ? '…' : '✓' }}
              </button>
              <button @click="quickDateClasseId = null"
                style="padding:3px 6px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;border-radius:5px;font-size:11px;cursor:pointer;">✕</button>
            </div>
          </template>
          <template v-else>
            <div style="display:flex;align-items:center;gap:6px;">
              <span v-if="(c as any).date_debut_cours"
                style="font-size:12px;font-weight:600;color:#1e293b;">
                📅 {{ formatDateCourte((c as any).date_debut_cours) }}
              </span>
              <span v-else
                style="font-size:11px;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;border-radius:10px;padding:2px 8px;font-weight:600;">
                Non définie
              </span>
              <button v-if="canEditDateDebut" @click="openQuickDate(c)"
                :title="(c as any).date_debut_cours ? 'Modifier la date de début' : 'Définir la date de début des cours'"
                style="padding:2px 6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;font-size:10px;cursor:pointer;color:#64748b;">
                ✏️
              </button>
            </div>
          </template>
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
      :subtitle="classeForStudents?.est_tronc_commun ? '🏫 Tronc commun — Multi-filières' : `Filière : ${classeForStudents?.filiere?.nom ?? '—'}`"
      width="680px"
      @close="showStudents = false"
    >
      <!-- Onglets -->
      <div class="cl-tabs" style="margin: -18px -22px 16px;">
        <button v-for="tab in [
            { key: 'dans-classe', label: '🎓 Étudiants', count: inscriptionsInClasse.length },
            { key: 'pool', label: 'Pool à affecter', count: inscriptionsPool.length },
            { key: 'affectations', label: '📋 Affectations', count: uesForClasse.length },
            { key: 'enseignants', label: '⚙️ Gérer UEs', count: uesForClasse.length },
            { key: 'suivi-paiements', label: 'Suivi paiements', count: suiviEtudiants.length }
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
            { key: 'paiement', label: 'Paiement', align: 'center' },
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
            <td style="text-align:center;">
              <!-- Indicateur retard depuis le suivi chargé, sinon lien vers suivi -->
              <template v-if="suiviEtudiants.length > 0">
                <span v-if="suiviEtudiants.find(s => s.inscription_id === (ins as any).id) as any"
                  :style="{
                    display: 'inline-block', padding: '2px 8px', borderRadius: '99px',
                    fontSize: '10px', fontWeight: 600,
                    background: statutBadge((suiviEtudiants.find(s => s.inscription_id === (ins as any).id) as any)?.statut || '').bg,
                    color: statutBadge((suiviEtudiants.find(s => s.inscription_id === (ins as any).id) as any)?.statut || '').color,
                  }">
                  {{ statutBadge((suiviEtudiants.find(s => s.inscription_id === (ins as any).id) as any)?.statut || '').label }}
                </span>
                <span v-else style="font-size:11px;color:#ccc;">—</span>
              </template>
              <button v-else @click="onTabChange('suivi-paiements')"
                style="font-size:10px;color:#1d4ed8;background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;">
                Voir suivi
              </button>
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
      <!-- Suivi paiements -->
      <template v-else-if="studentsTab === 'suivi-paiements'">
        <div v-if="loadingSuivi" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">Chargement…</div>
        <template v-else>
          <!-- Contrôles : date début cours + mois de contrôle -->
          <div style="display:flex;align-items:flex-end;gap:16px;margin-bottom:16px;flex-wrap:wrap;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;">
            <div style="flex:1;min-width:180px;">
              <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px;">Début des cours (ancre)</label>
              <div style="display:flex;gap:6px;align-items:center;">
                <input type="date" v-model="dateDebutCoursEdit"
                  style="padding:6px 10px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;font-family:'Poppins',sans-serif;flex:1;" />
                <button @click="saveDebutCours" :disabled="savingDateDebut"
                  style="padding:6px 12px;font-size:11px;font-weight:600;border:none;border-radius:6px;cursor:pointer;background:#1d4ed8;color:#fff;white-space:nowrap;">
                  {{ savingDateDebut ? '...' : 'Appliquer' }}
                </button>
              </div>
              <div v-if="!dateDebutCoursEdit" style="font-size:10px;color:#e67e22;margin-top:3px;">
                Aucune date définie — l'ancre utilisera la date d'inscription de chaque étudiant
              </div>
            </div>
            <div style="min-width:160px;">
              <label style="display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px;">Mois de contrôle</label>
              <input type="month" v-model="moisControle" @change="loadSuiviPaiements"
                style="padding:6px 10px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;font-family:'Poppins',sans-serif;width:100%;" />
            </div>
          </div>

          <!-- Résumé comptable -->
          <div v-if="comptaData" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;text-align:center;">
              <div style="font-size:10px;font-weight:600;color:#166534;text-transform:uppercase;letter-spacing:0.5px;">Trésorerie</div>
              <div style="font-size:16px;font-weight:700;color:#166534;margin-top:2px;">{{ formatFCFA(comptaData.tresorerie) }}</div>
            </div>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;text-align:center;">
              <div style="font-size:10px;font-weight:600;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;">CA reconnu</div>
              <div style="font-size:16px;font-weight:700;color:#1d4ed8;margin-top:2px;">{{ formatFCFA(comptaData.ca_reconnu) }}</div>
            </div>
            <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;text-align:center;">
              <div style="font-size:10px;font-weight:600;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">PCA</div>
              <div style="font-size:16px;font-weight:700;color:#92400e;margin-top:2px;">{{ formatFCFA(comptaData.pca) }}</div>
              <div style="font-size:9px;color:#a16207;margin-top:1px;">Produits constatés d'avance</div>
            </div>
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;text-align:center;">
              <div style="font-size:10px;font-weight:600;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;">Créances</div>
              <div style="font-size:16px;font-weight:700;color:#dc2626;margin-top:2px;">{{ formatFCFA(comptaData.creances) }}</div>
              <div style="font-size:9px;color:#dc2626;margin-top:1px;">Recouvrement {{ comptaData.taux_recouvrement }}%</div>
            </div>
          </div>

          <!-- Résumé étudiants -->
          <div v-if="suiviResume" style="display:flex;gap:16px;margin-bottom:14px;padding:10px 12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
            <div style="font-size:12px;"><span style="font-weight:700;color:#334155;">{{ suiviResume.total_etudiants }}</span> étudiant(s)</div>
            <div style="font-size:12px;"><span style="font-weight:700;color:#166534;">{{ suiviResume.a_jour }}</span> à jour</div>
            <div style="font-size:12px;"><span style="font-weight:700;color:#dc2626;">{{ suiviResume.en_retard }}</span> en retard</div>
            <div style="font-size:12px;margin-left:auto;"><span style="font-weight:700;color:#dc2626;">{{ formatFCFA(suiviResume.total_creances) }}</span> impayés</div>
          </div>

          <!-- Tableau étudiants -->
          <div v-if="suiviEtudiants.length === 0" style="text-align:center;padding:32px;color:#aaa;font-size:13px;">
            Aucun étudiant inscrit dans cette classe.
          </div>
          <div v-else style="max-height:400px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:#f8fafc;position:sticky;top:0;z-index:1;">
                  <th style="padding:8px;text-align:left;font-weight:600;color:#475569;">Étudiant</th>
                  <th style="padding:8px;text-align:center;font-weight:600;color:#475569;">Ancre</th>
                  <th style="padding:8px;text-align:right;font-weight:600;color:#475569;">Mensualité</th>
                  <th style="padding:8px;text-align:center;font-weight:600;color:#475569;" title="Nombre de mensualités attendues à ce mois">Attendues</th>
                  <th style="padding:8px;text-align:center;font-weight:600;color:#475569;">Payées</th>
                  <th style="padding:8px;text-align:center;font-weight:600;color:#475569;">Retard</th>
                  <th style="padding:8px;text-align:right;font-weight:600;color:#475569;">Montant dû</th>
                  <th style="padding:8px;text-align:center;font-weight:600;color:#475569;">Statut</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="et in suiviEtudiants" :key="et.inscription_id"
                  :style="{ borderBottom: '1px solid #f1f5f9', background: et.statut === 'en_retard' ? '#fffbfb' : 'transparent' }">
                  <td style="padding:6px 8px;">
                    <div style="font-weight:600;color:#1e293b;">{{ et.prenom }} {{ et.nom }}</div>
                    <div style="font-size:10px;color:#94a3b8;">{{ et.numero_etudiant }}</div>
                  </td>
                  <td style="padding:6px 8px;text-align:center;font-size:11px;color:#64748b;">{{ et.ancre?.slice(0,7) }}</td>
                  <td style="padding:6px 8px;text-align:right;font-size:11px;color:#475569;">{{ formatFCFA((et as any).mensualite || 0) }}</td>
                  <td style="padding:6px 8px;text-align:center;font-weight:600;">{{ et.mensualites_dues }}</td>
                  <td style="padding:6px 8px;text-align:center;font-weight:600;color:#166534;">{{ et.mensualites_payees }}</td>
                  <td style="padding:6px 8px;text-align:center;">
                    <span v-if="et.retard > 0" style="font-weight:700;color:#dc2626;">{{ et.retard }}</span>
                    <span v-else style="color:#16a34a;">0</span>
                  </td>
                  <td style="padding:6px 8px;text-align:right;">
                    <span v-if="et.montant_du > 0" style="font-weight:600;color:#dc2626;">{{ formatFCFA(et.montant_du) }}</span>
                    <span v-else style="color:#16a34a;">—</span>
                  </td>
                  <td style="padding:6px 8px;text-align:center;">
                    <span :style="{
                      display:'inline-block', padding:'2px 8px', borderRadius:'99px', fontSize:'10px', fontWeight:600,
                      background: statutBadge(et.statut).bg, color: statutBadge(et.statut).color
                    }">{{ statutBadge(et.statut).label }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>

      <!-- ── Onglet Affectations ─────────────────────────────────────── -->
      <template v-else-if="studentsTab === 'affectations'">
        <div v-if="loadingUes" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">Chargement…</div>
        <div v-else-if="uesForClasse.length === 0" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">
          Aucune matière configurée pour cette classe.<br>
          <span style="font-size:11px;">Utilisez l'onglet ⚙️ Gérer UEs pour générer ou affecter des matières.</span>
        </div>
        <div v-else>
          <!-- KPIs -->
          <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
            <div style="flex:1;min-width:120px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#16a34a;">{{ uesForClasse.filter(u => u.enseignant_id).length }}</div>
              <div style="font-size:11px;color:#166534;margin-top:2px;">Matières affectées</div>
            </div>
            <div style="flex:1;min-width:120px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#dc2626;">{{ uesForClasse.filter(u => !u.enseignant_id).length }}</div>
              <div style="font-size:11px;color:#991b1b;margin-top:2px;">Sans professeur</div>
            </div>
            <div style="flex:1;min-width:120px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#0369a1;">{{ uesForClasse.reduce((s, u) => s + (u.volume_horaire || 0), 0) }}h</div>
              <div style="font-size:11px;color:#075985;margin-top:2px;">Volume horaire total</div>
            </div>
          </div>

          <!-- Par semestre — accordéon rétractable -->
          <template v-for="sem in uesBySemestre" :key="sem.semestre">
            <!-- En-tête accordéon cliquable -->
            <div @click="collapsedSemesters.has(sem.semestre) ? collapsedSemesters.delete(sem.semestre) : collapsedSemesters.add(sem.semestre)"
              style="margin:10px 0 0;padding:9px 14px;background:linear-gradient(90deg,#1e3a5f,#0369a1);border-radius:7px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:14px;color:#fff;transition:transform 0.2s;"
                  :style="{ transform: collapsedSemesters.has(sem.semestre) ? 'rotate(-90deg)' : 'rotate(0deg)' }">▼</span>
                <span style="font-size:13px;font-weight:700;color:#fff;">{{ sem.semestre > 0 ? `Semestre ${sem.semestre}` : 'Sans semestre' }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:11px;color:#bae6fd;">
                  {{ sem.groupes.flatMap((g:any) => g.ues).filter((u:any) => u.enseignant_id).length }}/{{ sem.groupes.flatMap((g:any) => g.ues).length }} affectée(s)
                </span>
                <span style="font-size:11px;background:rgba(255,255,255,0.15);color:#fff;padding:2px 8px;border-radius:10px;">
                  {{ sem.groupes.flatMap((g:any) => g.ues).reduce((s:number,u:any) => s+(u.volume_horaire||0),0) }}h
                </span>
              </div>
            </div>
            <!-- Contenu rétractable -->
            <div v-show="!collapsedSemesters.has(sem.semestre)" style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 7px 7px;overflow:hidden;margin-bottom:6px;">
              <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
                <thead>
                  <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
                    <th style="padding:7px 10px;text-align:left;font-weight:600;color:#475569;font-size:11px;">Matière</th>
                    <th style="padding:7px 10px;text-align:left;font-weight:600;color:#475569;font-size:11px;">Professeur</th>
                    <th style="padding:7px 6px;text-align:center;font-weight:600;color:#475569;font-size:11px;">VH</th>
                    <th style="padding:7px 6px;text-align:center;font-weight:600;color:#475569;font-size:11px;">Coef</th>
                    <th style="padding:7px 6px;text-align:center;font-weight:600;color:#475569;font-size:11px;">Cr.</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="(groupe, gi) in sem.groupes" :key="gi">
                    <tr v-if="groupe.intitule_ue && groupe.ues.length > 1" style="background:#f8fafc;">
                      <td colspan="5" style="padding:4px 10px;font-size:11px;font-weight:700;color:#64748b;font-style:italic;">
                        📁 {{ groupe.code }} — {{ groupe.intitule_ue }}
                      </td>
                    </tr>
                    <tr v-for="ue in groupe.ues" :key="(ue as any).id"
                      :style="{ borderBottom:'1px solid #f1f5f9', background:(ue as any).enseignant_id?'#fff':'#fffbeb' }">
                      <td style="padding:8px 10px;">
                        <div style="font-weight:600;color:#1e293b;">{{ (ue as any).intitule }}</div>
                        <div v-if="(ue as any).cm || (ue as any).td || (ue as any).tp" style="font-size:10px;color:#94a3b8;margin-top:2px;">
                          <span v-if="(ue as any).cm">CM:{{ (ue as any).cm }}h </span>
                          <span v-if="(ue as any).td">TD:{{ (ue as any).td }}h </span>
                          <span v-if="(ue as any).tp">TP:{{ (ue as any).tp }}h</span>
                        </div>
                      </td>
                      <td style="padding:8px 10px;">
                        <div v-if="(ue as any).enseignant" style="display:flex;align-items:center;gap:6px;">
                          <div style="width:28px;height:28px;border-radius:50%;background:#1e3a5f;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;">
                            {{ ((ue as any).enseignant.prenom?.[0]||'') + ((ue as any).enseignant.nom?.[0]||'') }}
                          </div>
                          <span style="font-weight:600;color:#1e293b;font-size:12px;">{{ (ue as any).enseignant.prenom }} {{ (ue as any).enseignant.nom }}</span>
                        </div>
                        <div v-else style="display:flex;align-items:center;gap:5px;">
                          <span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;display:inline-block;flex-shrink:0;"></span>
                          <span style="font-size:11px;color:#b45309;font-style:italic;">Non assigné</span>
                        </div>
                      </td>
                      <td style="padding:8px 6px;text-align:center;color:#0369a1;font-weight:600;">{{ (ue as any).volume_horaire||0 }}h</td>
                      <td style="padding:8px 6px;text-align:center;color:#92400e;">{{ (ue as any).coefficient }}</td>
                      <td style="padding:8px 6px;text-align:center;color:#0369a1;">{{ (ue as any).credits_ects }}</td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </template>

      <template v-else-if="studentsTab === 'enseignants'">
        <div v-if="loadingUes" style="text-align:center;padding:40px;color:#aaa;font-size:13px;">Chargement…</div>
        <template v-else>

          <!-- Formulaire ajout / édition UE -->
          <div v-if="showUeForm" class="ue-form-panel">
            <h3 class="ue-form-title">{{ editingUe ? 'Modifier l\'affectation' : 'Affecter un enseignant' }}</h3>

            <!-- Bandeau tronc commun -->
            <div v-if="isTroncCommunClasse" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:8px 12px;font-size:11px;color:#0369a1;margin-bottom:10px;line-height:1.6;">
              🏫 <strong>Tronc commun</strong> — Indiquez seulement le prof et la matière.<br>
              Les coefficients/crédits seront ceux de la <strong>filière de chaque étudiant</strong> au moment du calcul des notes.
            </div>

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
                <option value="">{{ isTroncCommunClasse ? '— Choisir une matière —' : '— Choisir une matière de la filière —' }}</option>
                <option v-for="m in matieresForUE" :key="m.id" :value="m.nom">
                  {{ m.nom }}{{ (!isTroncCommunClasse && m.pivot) ? ` — Coeff. ${m.pivot.coefficient} | ${m.pivot.credits} crédits` : '' }}
                </option>
              </select>
              <input v-else v-model="ueForm.intitule" required placeholder="Ex : Algorithmique"
                class="cl-input" style="width:100%;box-sizing:border-box;" />
              <div v-if="matieresForUE.length === 0 && !isTroncCommunClasse" style="font-size:11px;color:#e67e22;margin-top:4px;">
                ⚠️ Aucune matière n'est assignée à cette filière. Ajoutez-en d'abord dans les Filières.
              </div>
              <div v-if="matieresForUE.length === 0 && isTroncCommunClasse" style="font-size:11px;color:#e67e22;margin-top:4px;">
                ⚠️ Aucune matière globale trouvée. Ajoutez-en d'abord dans Paramètres → Matières.
              </div>
            </UcFormGroup>

            <!-- Section UE -->
            <div style="margin-top:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;padding:10px 12px;">
              <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
                🗂 Unité d'Enseignement (UE)
              </div>
              <UcFormGrid :cols="2">
                <UcFormGroup label="Code UE" :required="true">
                  <input v-model="ueForm.code" required placeholder="Ex : INF1" class="cl-input" style="width:100%;box-sizing:border-box;" />
                </UcFormGroup>
                <UcFormGroup label="Semestre">
                  <select v-model.number="ueForm.semestre" class="cl-input" style="width:100%;box-sizing:border-box;">
                    <option v-for="s in [1,2,3,4,5,6,7,8]" :key="s" :value="s">Semestre {{ s }}</option>
                  </select>
                </UcFormGroup>
              </UcFormGrid>
              <UcFormGroup label="Intitulé UE" style="margin-top:8px;">
                <input v-model="ueForm.intitule_ue" placeholder="Ex : Informatique fondamentale  (laisser vide si pas de regroupement UE)" class="cl-input" style="width:100%;box-sizing:border-box;" />
              </UcFormGroup>
              <div style="font-size:10px;color:#94a3b8;margin-top:4px;">
                L'intitulé UE regroupe plusieurs ECs. Laisser vide si la matière est une UE à elle seule.
              </div>
            </div>

            <!-- Section EC -->
            <div style="margin-top:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:10px 12px;">
              <div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
                📚 Élément Constitutif (EC / Matière)
              </div>
              <UcFormGrid :cols="3">
                <UcFormGroup label="Volume horaire (h)">
                  <input v-model.number="ueForm.volume_horaire" type="number" min="0" class="cl-input" style="width:100%;box-sizing:border-box;" placeholder="Ex : 30" />
                </UcFormGroup>
                <UcFormGroup label="Coefficient" v-if="!isTroncCommunClasse">
                  <input v-model.number="ueForm.coefficient" type="number" min="0" step="0.5" class="cl-input" style="width:100%;box-sizing:border-box;" />
                </UcFormGroup>
                <UcFormGroup label="Crédits ECTS" v-if="!isTroncCommunClasse">
                  <input v-model.number="ueForm.credits_ects" type="number" min="0" class="cl-input" style="width:100%;box-sizing:border-box;" />
                </UcFormGroup>
              </UcFormGrid>
            </div>

            <!-- Aide sur les deux systèmes -->
            <div v-if="!isTroncCommunClasse" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:7px 12px;font-size:10px;color:#0369a1;margin-top:6px;line-height:1.6;">
              <strong>Coefficient</strong> → Formations professionnelles &nbsp;|&nbsp; <strong>Crédits ECTS</strong> → Système LMD
            </div>
            <div style="display:flex;gap:8px;margin-top:14px;">
              <button @click="showUeForm = false" class="cl-btn-cancel" style="flex:1;">Annuler</button>
              <button @click="saveUe" :disabled="savingUe || !ueForm.intitule || !ueForm.code"
                class="cl-btn-save" style="flex:2;">
                {{ savingUe ? 'Enregistrement…' : (editingUe ? 'Modifier' : 'Affecter') }}
              </button>
            </div>
          </div>

          <!-- Boutons actions UE -->
          <div v-if="!showUeForm" style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
            <button v-if="classeForStudents?.filiere || isTroncCommunClasse"
              @click="genererUesMaquette" :disabled="generatingMaquette"
              style="padding:7px 14px;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer;border:1.5px solid #0284c7;background:#f0f9ff;color:#0284c7;">
              {{ generatingMaquette ? 'Génération…' : (isTroncCommunClasse ? '📋 Sélectionner depuis les maquettes' : '📋 Générer depuis la maquette') }}
            </button>
            <button v-if="uesForClasse.length > 0"
              @click="nettoyerDoublonsUes" :disabled="nettoyageDoublons"
              style="padding:7px 14px;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer;border:1.5px solid #ea580c;background:#fff7ed;color:#ea580c;">
              {{ nettoyageDoublons ? 'Nettoyage…' : '🧹 Nettoyer les doublons' }}
            </button>
            <button @click="openAddUe" class="cl-btn-affecter">+ Affecter un enseignant</button>
          </div>

          <!-- Onglets semestres -->
          <div v-if="!showUeForm && semestresDisponibles.length > 1" style="display:flex;gap:0;margin-bottom:14px;border-bottom:2px solid #e2e8f0;">
            <button
              @click="activeSemestre = 0"
              :style="{
                padding:'8px 16px', fontSize:'12px', fontWeight: activeSemestre === 0 ? '700' : '500',
                color: activeSemestre === 0 ? '#0369a1' : '#64748b',
                background: activeSemestre === 0 ? '#f0f9ff' : 'transparent',
                border:'none', borderBottom: activeSemestre === 0 ? '2px solid #0369a1' : '2px solid transparent',
                cursor:'pointer', fontFamily:'Poppins, sans-serif', marginBottom:'-2px', transition:'all 0.15s'
              }"
            >Tous</button>
            <button v-for="s in semestresDisponibles" :key="s"
              @click="activeSemestre = s"
              :style="{
                padding:'8px 16px', fontSize:'12px', fontWeight: activeSemestre === s ? '700' : '500',
                color: activeSemestre === s ? '#0369a1' : '#64748b',
                background: activeSemestre === s ? '#f0f9ff' : 'transparent',
                border:'none', borderBottom: activeSemestre === s ? '2px solid #0369a1' : '2px solid transparent',
                cursor:'pointer', fontFamily:'Poppins, sans-serif', marginBottom:'-2px', transition:'all 0.15s'
              }"
            >S{{ s }}</button>
          </div>

          <!-- Liste des UEs -->
          <div v-if="uesForClasse.length === 0 && !showUeForm"
            style="text-align:center;padding:32px;color:#aaa;font-size:13px;">
            Aucun enseignant affecté à cette classe.
          </div>
          <!-- Affichage structuré par semestre/UE si maquette importée -->
          <div v-else-if="uesForClasse.length > 0">
            <template v-for="sem in uesBySemestreFiltered" :key="sem.semestre">
              <h4 v-if="sem.semestre > 0" style="margin:16px 0 8px;font-size:13px;font-weight:700;color:#1e3a5f;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">
                Semestre {{ sem.semestre }}
              </h4>
              <template v-for="(groupe, gIdx) in sem.groupes" :key="gIdx">
                <div v-if="groupe.intitule_ue" style="display:flex;align-items:center;gap:8px;margin:10px 0 4px;padding:4px 8px;background:#f8fafc;border-radius:4px;">
                  <span style="font-size:11px;font-weight:700;color:#64748b;font-family:monospace;">{{ groupe.code }}</span>
                  <span style="font-size:12px;font-weight:600;color:#334155;">{{ groupe.intitule_ue }}</span>
                  <span v-if="groupe.categorie" :style="{
                    fontSize:'10px', fontWeight:600, padding:'1px 6px', borderRadius:'3px',
                    background: groupe.categorie === 'majeure' ? '#dbeafe' : groupe.categorie === 'mineure' ? '#fef3c7' : '#dcfce7',
                    color: groupe.categorie === 'majeure' ? '#1d4ed8' : groupe.categorie === 'mineure' ? '#92400e' : '#166534'
                  }">{{ groupe.categorie }}</span>
                  <span style="font-size:11px;color:#64748b;margin-left:auto;">{{ groupe.totalCredits }} cr.</span>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px;">
                  <tr v-for="ue in groupe.ues" :key="(ue as any).id"
                    style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:5px 8px;width:40%;">
                      <span style="font-weight:500;color:#333;">{{ (ue as any).intitule }}</span>
                      <span v-if="(ue as any).coefficient == 0" style="font-size:9px;background:#fef2f2;color:#dc2626;padding:1px 4px;border-radius:3px;margin-left:4px;">LMD seul</span>
                    </td>
                    <td style="padding:5px 4px;width:20%;color:#666;">
                      <span v-if="(ue as any).enseignant" style="font-size:11px;">
                        {{ (ue as any).enseignant.prenom }} {{ (ue as any).enseignant.nom }}
                      </span>
                      <span v-else style="font-size:10px;color:#ccc;font-style:italic;">Non assigné</span>
                    </td>
                    <td style="padding:5px 4px;text-align:center;width:8%;">
                      <span style="font-size:11px;color:#64748b;">{{ (ue as any).volume_horaire || 0 }}h</span>
                    </td>
                    <td style="padding:5px 4px;text-align:center;width:8%;">
                      <span style="font-size:11px;color:#0369a1;">{{ (ue as any).credits_ects }} cr</span>
                    </td>
                    <td style="padding:5px 4px;text-align:center;width:8%;">
                      <span v-if="(ue as any).coefficient > 0" style="font-size:11px;color:#92400e;">coef {{ (ue as any).coefficient }}</span>
                      <span v-else style="font-size:10px;color:#ccc;">—</span>
                    </td>
                    <td style="padding:5px 4px;text-align:right;width:10%;">
                      <button @click="openEditUe(ue as any)" class="cl-icon-btn" title="Modifier" style="font-size:11px;">✏️</button>
                      <button @click="deleteUe(ue as any)" class="cl-icon-btn cl-icon-btn--danger"
                        :disabled="deletingUeId === (ue as any).id" title="Supprimer" style="font-size:11px;">🗑</button>
                    </td>
                  </tr>
                </table>
              </template>
            </template>
          </div>
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
        <!-- Tronc commun toggle — EN PREMIER pour conditionner filière -->
        <div style="background:#f8fafc;border:1.5px solid #e5e5e5;border-radius:8px;padding:12px 14px;">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
            <input type="checkbox" v-model="form.est_tronc_commun" @change="() => { if(form.est_tronc_commun) { form.tronc_commun_ids = []; form.filiere_id = null } }" style="width:16px;height:16px;accent-color:#E30613;" />
            <div>
              <div style="font-size:13px;font-weight:600;color:#1e3a5f;">🏫 Cette classe est un Tronc Commun</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px;">Ses UEs seront automatiquement partagées avec les classes qui lui sont liées</div>
            </div>
          </label>
        </div>

        <template v-if="!form.est_tronc_commun">
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
        </template>
        <div v-else style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;font-size:12px;color:#0369a1;">
          🏫 <strong>Tronc commun</strong> — Pas de filière spécifique. Les étudiants de plusieurs filières peuvent y être inscrits. Les coefficients sont ceux de leur propre filière.
        </div>

        <UcFormGroup v-if="isAcademique" label="Année d'étude" :required="true">
          <select v-model.number="form.niveau" class="cl-input" style="width:100%;box-sizing:border-box;">
            <option :value="1">1ère année</option>
            <option :value="2">2ème année</option>
            <option :value="3">3ème année</option>
            <option :value="4">4ème année</option>
            <option :value="5">5ème année</option>
          </select>
        </UcFormGroup>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Année académique" :required="true">
            <select v-model="form.annee_academique_id" required class="cl-input" style="width:100%;box-sizing:border-box;">
              <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
            </select>
          </UcFormGroup>
          <UcFormGroup label="Début des cours">
            <input type="date" v-model="form.date_debut_cours" class="cl-input" style="width:100%;box-sizing:border-box;" />
          </UcFormGroup>
        </UcFormGrid>

        <!-- Lier à des tronc commun (many-to-many) -->
        <div v-if="!form.est_tronc_commun && troncCommunClasses.length > 0">
          <label class="cl-label" style="margin-bottom:6px;">Lier à des Tronc Commun</label>
          <div style="max-height:140px;overflow-y:auto;border:1.5px solid #e5e5e5;border-radius:4px;padding:6px;">
            <label v-for="tc in troncCommunClasses" :key="tc.id" style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;">
              <input type="checkbox" :value="tc.id" :checked="form.tronc_commun_ids.includes(Number(tc.id))" @change="toggleTroncCommun(Number(tc.id))" />
              <span style="font-size:13px;color:#333;flex:1;">🏫 {{ tc.nom }}</span>
            </label>
          </div>
          <p style="font-size:11px;color:#64748b;margin:4px 0 0;">Cochez les tronc commun auxquels cette classe participe.</p>
        </div>
        <p v-else-if="!form.est_tronc_commun && troncCommunClasses.length === 0" style="font-size:11px;color:#f59e0b;margin:4px 0 0;">Aucune classe tronc commun créée. Créez d'abord une classe avec l'option ci-dessus.</p>

        <!-- Exempter la tenue -->
        <div style="padding:10px 12px;border:1.5px solid #fed7aa;background:#fff7ed;border-radius:6px;">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
            <input type="checkbox" v-model="form.exempt_tenue" style="width:16px;height:16px;margin-top:2px;accent-color:#E30613;" />
            <span>
              <span style="font-size:13px;font-weight:600;color:#9a3412;">👕 Exempter les étudiants de la tenue</span>
              <span style="display:block;font-size:11px;color:#9a3412;margin-top:2px;">
                Cochez si les étudiants de cette classe ne doivent pas payer la tenue. L'échéance « tenue » ne sera pas générée (ou sera retirée si elle existe déjà, sauf si déjà payée).
              </span>
            </span>
          </label>
        </div>

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

    <!-- Modal Tronc Commun : sélection matières -->
    <UcModal v-model="showTcModal" title="Sélectionner les matières du tronc commun" width="700px" @close="showTcModal = false">
      <div v-if="loadingTc" style="text-align:center;padding:40px;color:#aaa;">Chargement des maquettes…</div>
      <template v-else>
        <div v-if="tcFilieres.length === 0" style="text-align:center;padding:20px;color:#dc2626;font-size:13px;">
          Aucune classe n'est rattachée à ce tronc commun. Liez d'abord des classes dans leur configuration.
        </div>
        <template v-else>
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:8px 12px;font-size:12px;color:#0369a1;margin-bottom:12px;">
            Filières rattachées : <strong>{{ tcFilieres.map((f: any) => f.filiere_nom).join(', ') }}</strong>
          </div>

          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <button @click="tcSelectAll" style="font-size:11px;padding:4px 10px;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;background:#fff;">Tout sélectionner</button>
            <button @click="tcDeselectAll" style="font-size:11px;padding:4px 10px;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;background:#fff;">Tout désélectionner</button>
            <span style="margin-left:auto;font-size:12px;color:#64748b;align-self:center;">{{ tcSelected.size }} / {{ tcMatieres.length }} sélectionnée(s)</span>
          </div>

          <div style="max-height:400px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:#f8fafc;position:sticky;top:0;">
                  <th style="padding:6px 8px;text-align:left;width:30px;"></th>
                  <th style="padding:6px 8px;text-align:left;">EC</th>
                  <th style="padding:6px 8px;text-align:left;">UE</th>
                  <th style="padding:6px 8px;text-align:center;">S</th>
                  <th style="padding:6px 8px;text-align:center;">VHT</th>
                  <th style="padding:6px 8px;text-align:center;">Coeff</th>
                  <th style="padding:6px 8px;text-align:left;">Filières</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in tcMatieres" :key="m.matiere_id"
                  @click="toggleTcMatiere(m.matiere_id)"
                  :style="{ cursor: 'pointer', background: tcSelected.has(m.matiere_id) ? '#eff6ff' : '#fff', borderBottom: '1px solid #f1f5f9' }">
                  <td style="padding:5px 8px;text-align:center;">
                    <input type="checkbox" :checked="tcSelected.has(m.matiere_id)" @click.stop="toggleTcMatiere(m.matiere_id)" style="accent-color:#1d4ed8;" />
                  </td>
                  <td style="padding:5px 8px;font-weight:500;">
                    {{ m.intitule }}
                    <span v-if="m.coefficient == 0" style="font-size:9px;background:#fef2f2;color:#dc2626;padding:1px 4px;border-radius:3px;margin-left:4px;">LMD</span>
                  </td>
                  <td style="padding:5px 8px;color:#64748b;font-size:11px;">{{ m.intitule_ue }}</td>
                  <td style="padding:5px 8px;text-align:center;color:#64748b;">{{ m.semestre }}</td>
                  <td style="padding:5px 8px;text-align:center;">{{ m.vht }}h</td>
                  <td style="padding:5px 8px;text-align:center;">{{ m.coefficient > 0 ? m.coefficient : '—' }}</td>
                  <td style="padding:5px 8px;font-size:10px;color:#64748b;">{{ m.filieres?.join(', ') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>

      <template #footer>
        <button @click="showTcModal = false" style="padding:8px 16px;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;background:#fff;">Annuler</button>
        <button @click="genererUesTc" :disabled="generatingMaquette || tcSelected.size === 0"
          style="padding:8px 16px;font-weight:600;border:none;border-radius:6px;cursor:pointer;background:#1d4ed8;color:#fff;">
          {{ generatingMaquette ? 'Génération…' : `Générer ${tcSelected.size} UE(s)` }}
        </button>
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
