<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'
import UcFormGrid from '@/components/ui/UcFormGrid.vue'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import UcDraftBanner from '@/components/ui/UcDraftBanner.vue'
import { useFormAutoSave } from '@/composables/useFormAutoSave'

const auth = useAuthStore()
const toast = useToast()
const canWrite    = ['resp_fin', 'dg'].includes(auth.user?.role ?? '')
const canValidate = auth.user?.role === 'dg'

// ── Types ───────────────────────────────────────────────────────────────────
interface Depense {
  id: number; libelle: string; categorie: string; montant: number
  mode_paiement: string | null; statut: string; beneficiaire: string | null
  reference_facture: string | null; notes: string | null
  date_depense: string; created_at: string; validated_at: string | null
  type_source: string | null; source_id: number | null; mois_concerne: string | null
  motif_rejet: string | null
}
interface Personnel {
  id: number; nom: string; prenom: string; poste: string
  type_contrat: string; salaire_brut: number
  date_debut: string; date_fin: string | null; statut: string; notes: string | null
  contrat_url: string | null
}
interface ContratFixe {
  id: number; libelle: string; beneficiaire: string; montant: number
  periodicite: string; categorie: string
  date_debut: string; date_fin: string | null; statut: string; description: string | null
  contrat_url: string | null
}

// ── Clôtures ─────────────────────────────────────────────────────────────────
interface Cloture { id: number; periode: string; cloture_at: string; par_user: string | null; notes: string | null }

// ── Budget ───────────────────────────────────────────────────────────────────
interface BudgetSuivi {
  categorie_code: string; libelle: string; budget_id: number | null
  montant_prevu: number; montant_reel: number; restant: number; pct: number
}
const budgets        = ref<BudgetSuivi[]>([])
const budgetAnnee    = ref(String(new Date().getFullYear()))
const loadingBudget  = ref(false)
const editingBudget  = ref<{ code: string; val: string } | null>(null)
const savingBudget   = ref(false)

async function loadBudget() {
  loadingBudget.value = true
  try {
    const { data } = await api.get('/budgets/suivi', { params: { annee: budgetAnnee.value } })
    budgets.value = data
  } finally { loadingBudget.value = false }
}
async function saveBudget(code: string) {
  if (!editingBudget.value) return
  savingBudget.value = true
  try {
    await api.post('/budgets', {
      categorie_code: code,
      montant_prevu: Number(String(editingBudget.value.val).replace(/[\s\u00a0]/g, '').replace(',', '.')),
      annee: Number(budgetAnnee.value)
    })
    editingBudget.value = null
    await loadBudget()
  } finally { savingBudget.value = false }
}
async function resetBudget(b: BudgetSuivi) {
  if (!b.budget_id) return
  if (!confirm(`Supprimer le budget "${b.libelle}" pour ${budgetAnnee.value} ?`)) return
  await api.delete(`/budgets/${b.budget_id}`)
  await loadBudget()
}

// ── Tabs ────────────────────────────────────────────────────────────────────
const activeTab    = ref<'fixes' | 'variables' | 'journal' | 'budget' | 'clotures'>('fixes')
const activeSubTab = ref<'personnel' | 'contrats' | 'vacations' | 'autres'>('personnel')

function setTab(t: typeof activeTab.value) {
  activeTab.value = t
  if (t === 'fixes')    activeSubTab.value = 'personnel'
  if (t === 'variables') activeSubTab.value = 'vacations'
  if (t === 'budget')   loadBudget()
  if (t === 'clotures') loadClotures()
}

// ── State ────────────────────────────────────────────────────────────────────
const depenses     = ref<Depense[]>([])
const personnel    = ref<Personnel[]>([])
const contrats     = ref<ContratFixe[]>([])
const categoriesDep = ref<{ id: number; code: string; libelle: string; description: string | null; ordre: number; actif: boolean }[]>([])
const loading      = ref(true)
const saving       = ref(false)
const generating   = ref(false)
const moisGen      = ref(new Date().toISOString().slice(0, 7))

// Modals
const showPersonnelModal = ref(false)
const showContratModal   = ref(false)
const showDepenseModal   = ref(false)
const showDetailModal    = ref(false)
const showEditDepModal   = ref(false)
const editPersonnel      = ref<Personnel | null>(null)
const editContrat        = ref<ContratFixe | null>(null)
const selectedDep        = ref<Depense | null>(null)
const editingDep         = ref<Depense | null>(null)
const formEditDep        = ref({ libelle: '', montant: '', date_depense: '', categorie: '', mode_paiement: '', beneficiaire: '', notes: '' })
const savingEditDep      = ref(false)

// Export comptabilité (modèle ANAQ-Sup)
const showExportCompta  = ref(false)
const exportAnnee       = ref(new Date().getFullYear())
const exportSoldeInitial = ref(0)
const exportingCompta   = ref(false)

function openExportComptabilite() {
  exportAnnee.value = new Date().getFullYear()
  exportSoldeInitial.value = 0
  showExportCompta.value = true
}

async function doExportComptabilite() {
  exportingCompta.value = true
  try {
    const { exportSuiviComptabilite } = await import('@/utils/comptabiliteExport')
    await exportSuiviComptabilite(Number(exportAnnee.value), Number(exportSoldeInitial.value) || 0)
    showExportCompta.value = false
  } catch (e: any) {
    toast.apiError(e, 'Erreur lors de la génération de l\'export')
  } finally {
    exportingCompta.value = false
  }
}

// Formulaires
const formPersonnel = ref({ nom: '', prenom: '', poste: '', type_contrat: 'CDI', salaire_brut: '' as string | number, date_debut: '', date_fin: '', statut: 'actif', notes: '', contrat_url: '' })
const formContrat   = ref({ libelle: '', beneficiaire: '', montant: '' as string | number, periodicite: 'mensuelle', categorie: 'prestation', date_debut: '', date_fin: '', statut: 'actif', description: '', contrat_url: '' })
const formDepense   = ref({ libelle: '', categorie: 'autre', montant: '' as string | number, mode_paiement: 'especes', beneficiaire: '', reference_facture: '', notes: '', date_depense: new Date().toISOString().slice(0, 10) })

// ── Clôtures state ───────────────────────────────────────────────────────────
const clotures       = ref<Cloture[]>([])
const loadingClotures = ref(false)
const showClotureModal = ref(false)
const formCloture    = ref({ periode: new Date().toISOString().slice(0, 7), notes: '' })
const savingCloture  = ref(false)

const filtersJournal = ref({ search: '', categorie: '', statut: '' })
const journalSort    = ref<{ key: string; dir: 1 | -1 }>({ key: 'date_depense', dir: -1 })
const varSort        = ref<{ key: string; dir: 1 | -1 }>({ key: 'date_depense', dir: -1 })

function toggleSort(key: string) {
  if (journalSort.value.key === key) journalSort.value.dir = journalSort.value.dir === 1 ? -1 : 1
  else { journalSort.value.key = key; journalSort.value.dir = key === 'montant' ? -1 : 1 }
}
function toggleVarSort(key: string) {
  if (varSort.value.key === key) varSort.value.dir = varSort.value.dir === 1 ? -1 : 1
  else { varSort.value.key = key; varSort.value.dir = key === 'montant' ? -1 : 1 }
}
function sortList<T extends Record<string, unknown>>(list: T[], key: string, dir: 1 | -1): T[] {
  return [...list].sort((a, b) => {
    let va: string | number = '', vb: string | number = ''
    if (key === 'montant')      { va = Number(a.montant);  vb = Number(b.montant) }
    else if (key === 'date_depense') { va = String(a.date_depense ?? ''); vb = String(b.date_depense ?? '') }
    else if (key === 'mois')    { va = String(a.mois_concerne ?? ''); vb = String(b.mois_concerne ?? '') }
    else if (key === 'libelle') { va = String(a.libelle ?? '').toLowerCase(); vb = String(b.libelle ?? '').toLowerCase() }
    else if (key === 'beneficiaire') { va = String(a.beneficiaire ?? '').toLowerCase(); vb = String(b.beneficiaire ?? '').toLowerCase() }
    else if (key === 'categorie') { va = (catLabels.value[String(a.categorie ?? '')] ?? String(a.categorie ?? '')).toLowerCase(); vb = (catLabels.value[String(b.categorie ?? '')] ?? String(b.categorie ?? '')).toLowerCase() }
    else if (key === 'statut')  { va = String(a.statut ?? ''); vb = String(b.statut ?? '') }
    if (va < vb) return -dir; if (va > vb) return dir; return 0
  })
}

const sortedVacations = computed(() =>
  sortList(depenses.value.filter(d => d.type_source === 'vacation'), varSort.value.key, varSort.value.dir)
)
const sortedAutres = computed(() =>
  sortList(depenses.value.filter(d => !d.type_source || ['consommable','autre'].includes(d.type_source ?? '')), varSort.value.key, varSort.value.dir)
)

// ── Filtre période (KPI cards) ────────────────────────────────────────────────
const periodeMode   = ref<'mois' | 'annee' | 'tout'>('mois')
const periodeMois   = ref(new Date().toISOString().slice(0, 7))
const periodeAnnee  = ref(String(new Date().getFullYear()))

const anneesDisponibles = computed(() => {
  const annees = new Set<string>()
  depenses.value.forEach(d => annees.add(d.date_depense.slice(0, 4)))
  const arr = Array.from(annees).sort().reverse()
  if (!arr.includes(String(new Date().getFullYear()))) arr.unshift(String(new Date().getFullYear()))
  return arr
})
const periodLabel = computed(() => {
  if (periodeMode.value === 'tout')   return 'Toutes périodes'
  if (periodeMode.value === 'annee')  return `Année ${periodeAnnee.value}`
  return new Date(periodeMois.value + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
})
function matchPeriode(date: string): boolean {
  if (periodeMode.value === 'tout')  return true
  if (periodeMode.value === 'annee') return date.startsWith(periodeAnnee.value)
  return date.startsWith(periodeMois.value)
}

// ── Filtre période JOURNAL (indépendant des KPIs) ─────────────────────────────
const jPeriodeMode  = ref<'mois' | 'annee' | 'tout'>('tout')   // par défaut: tout visible
const jPeriodeMois  = ref(new Date().toISOString().slice(0, 7))
const jPeriodeAnnee = ref(String(new Date().getFullYear()))

const jPeriodeLabel = computed(() => {
  if (jPeriodeMode.value === 'tout')   return 'Toutes périodes'
  if (jPeriodeMode.value === 'annee')  return `Année ${jPeriodeAnnee.value}`
  return new Date(jPeriodeMois.value + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
})
function jMatchPeriode(date: string): boolean {
  if (jPeriodeMode.value === 'tout')  return true
  if (jPeriodeMode.value === 'annee') return date.startsWith(jPeriodeAnnee.value)
  return date.startsWith(jPeriodeMois.value)
}

// ── Labels ───────────────────────────────────────────────────────────────────
// catLabels calculé dynamiquement depuis la base
const catLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(categoriesDep.value.map(c => [c.code, c.libelle]))
)
const periodeLabels: Record<string, string> = { mensuelle: 'Mensuelle', trimestrielle: 'Trimestrielle', annuelle: 'Annuelle' }
const modeLabels: Record<string, string> = { virement: 'Virement', wave: 'Wave', orange_money: 'Orange Money', especes: 'Espèces', cheque: 'Chèque', prelevement: 'Prélèvement' }
const sourceLabels: Record<string, string> = { salaire: 'Salaire', contrat: 'Contrat', vacation: 'Vacation', consommable: 'Consommable', autre: 'Autre' }

// ── KPIs (réactifs à la période sélectionnée) ────────────────────────────────
const depensesPeriode = computed(() =>
  depenses.value.filter(d => matchPeriode(d.date_depense))
)
const kpiMois     = computed(() => depensesPeriode.value.filter(d => d.statut !== 'rejetee').reduce((s, d) => s + Number(d.montant), 0))
const kpiValidees = computed(() => depensesPeriode.value.filter(d => d.statut === 'validee').reduce((s, d) => s + Number(d.montant), 0))
const kpiAttente  = computed(() => depensesPeriode.value.filter(d => d.statut === 'en_attente').reduce((s, d) => s + Number(d.montant), 0))
const kpiPersonnel = computed(() => personnel.value.filter(p => p.statut === 'actif').reduce((s, p) => s + Number(p.salaire_brut), 0))

// ── Filtrages journal ────────────────────────────────────────────────────────
const filteredJournal = computed(() => {
  let list = depenses.value.filter(d => jMatchPeriode(d.date_depense))
  if (filtersJournal.value.categorie) list = list.filter(d => d.categorie === filtersJournal.value.categorie)
  if (filtersJournal.value.statut)    list = list.filter(d => d.statut === filtersJournal.value.statut)
  if (filtersJournal.value.search) {
    const s = filtersJournal.value.search.toLowerCase()
    list = list.filter(d => d.libelle.toLowerCase().includes(s) || (d.beneficiaire ?? '').toLowerCase().includes(s))
  }
  const { key, dir } = journalSort.value
  return list.sort((a, b) => {
    let va: string | number = ''
    let vb: string | number = ''
    if (key === 'montant') { va = Number(a.montant); vb = Number(b.montant) }
    else if (key === 'date_depense') { va = a.date_depense; vb = b.date_depense }
    else if (key === 'libelle')  { va = a.libelle.toLowerCase(); vb = b.libelle.toLowerCase() }
    else if (key === 'type')     { va = (a.type_source ?? '').toLowerCase(); vb = (b.type_source ?? '').toLowerCase() }
    else if (key === 'categorie'){ va = (catLabels.value[a.categorie] ?? a.categorie ?? '').toLowerCase(); vb = (catLabels.value[b.categorie] ?? b.categorie ?? '').toLowerCase() }
    else if (key === 'statut')   { va = a.statut; vb = b.statut }
    if (va < vb) return -dir; if (va > vb) return dir; return 0
  })
})

const depensesVariables = computed(() =>
  depenses.value.filter(d => ['vacation', 'consommable', 'autre', null].includes(d.type_source) && !['salaire', 'contrat'].includes(d.type_source ?? ''))
)

// ── Chargements ──────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  try {
    const [depRes, perRes, ctRes, catRes] = await Promise.all([
      api.get('/depenses'),
      api.get('/personnel'),
      api.get('/contrats-fixes'),
      api.get('/categories-depenses'),
    ])
    depenses.value     = depRes.data.data ?? depRes.data
    personnel.value    = perRes.data
    contrats.value     = ctRes.data
    categoriesDep.value = catRes.data
  } finally {
    loading.value = false
  }
}

// ── Personnel CRUD ───────────────────────────────────────────────────────────
function openAddPersonnel() {
  editPersonnel.value = null
  formPersonnel.value = { nom: '', prenom: '', poste: '', type_contrat: 'CDI', salaire_brut: '', date_debut: '', date_fin: '', statut: 'actif', notes: '', contrat_url: '' }
  showPersonnelModal.value = true
}
function openEditPersonnel(p: Personnel) {
  editPersonnel.value = p
  formPersonnel.value = { ...p, salaire_brut: p.salaire_brut, date_fin: p.date_fin ?? '', notes: p.notes ?? '', contrat_url: p.contrat_url ?? '' }
  showPersonnelModal.value = true
}
async function savePersonnel() {
  saving.value = true
  try {
    const body = { ...formPersonnel.value, salaire_brut: Number(formPersonnel.value.salaire_brut), date_fin: formPersonnel.value.date_fin || null }
    if (editPersonnel.value) await api.put(`/personnel/${editPersonnel.value.id}`, body)
    else await api.post('/personnel', body)
    showPersonnelModal.value = false
    await load()
  } finally { saving.value = false }
}
async function deletePersonnel(p: Personnel) {
  if (!confirm(`Supprimer ${p.prenom} ${p.nom} ?`)) return
  await api.delete(`/personnel/${p.id}`)
  await load()
}

// ── Contrats CRUD ────────────────────────────────────────────────────────────
function openAddContrat() {
  editContrat.value = null
  formContrat.value = { libelle: '', beneficiaire: '', montant: '', periodicite: 'mensuelle', categorie: 'prestation', date_debut: '', date_fin: '', statut: 'actif', description: '', contrat_url: '' }
  showContratModal.value = true
}
function openEditContrat(ct: ContratFixe) {
  editContrat.value = ct
  formContrat.value = { ...ct, montant: ct.montant, date_fin: ct.date_fin ?? '', description: ct.description ?? '', contrat_url: ct.contrat_url ?? '' }
  showContratModal.value = true
}
async function saveContrat() {
  saving.value = true
  try {
    const body = { ...formContrat.value, montant: Number(formContrat.value.montant), date_fin: formContrat.value.date_fin || null }
    if (editContrat.value) await api.put(`/contrats-fixes/${editContrat.value.id}`, body)
    else await api.post('/contrats-fixes', body)
    showContratModal.value = false
    await load()
  } finally { saving.value = false }
}
async function deleteContrat(ct: ContratFixe) {
  if (!confirm(`Supprimer le contrat "${ct.libelle}" ?`)) return
  await api.delete(`/contrats-fixes/${ct.id}`)
  await load()
}

// ── Génération dépenses ──────────────────────────────────────────────────────
async function genererMois() {
  generating.value = true
  try {
    const { data } = await api.post('/depenses/generer-mois', { mois: moisGen.value })
    toast.success(`${data.message}`)
    await load()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Erreur lors de la génération.'
    toast.warning(msg)
  } finally { generating.value = false }
}

async function calculerVacations() {
  generating.value = true
  try {
    const { data } = await api.post('/depenses/calculer-vacations', { mois: moisGen.value })
    toast.success(`${data.generated} vacation(s) calculée(s) pour ${moisGen.value}`)
    await load()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Erreur lors du calcul.'
    toast.warning(msg)
  } finally { generating.value = false }
}

// ── Journal dépense ad-hoc ────────────────────────────────────────────────────
function openAddDepense() {
  formDepense.value = { libelle: '', categorie: 'autre', montant: '', mode_paiement: 'especes', beneficiaire: '', reference_facture: '', notes: '', date_depense: new Date().toISOString().slice(0, 10) }
  showDepenseModal.value = true
  if (depenseDraft.hasDraft.value) depenseDraftBanner.value = true
}
async function saveDepense() {
  saving.value = true
  try {
    await api.post('/depenses', { ...formDepense.value, montant: Number(formDepense.value.montant) })
    depenseDraft.clearDraft()
    depenseDraftBanner.value = false
    showDepenseModal.value = false
    await load()
  } finally { saving.value = false }
}

// Auto-save brouillon dépense (uniquement pendant que le modal est ouvert)
const depenseDraft = useFormAutoSave(formDepense, {
  key: 'depense-nouveau',
  pause: () => !showDepenseModal.value,
})
const depenseDraftBanner = ref(false)
function restoreDepenseDraft() { depenseDraft.restoreDraft(); depenseDraftBanner.value = false; toast.success('Brouillon restauré.') }
function discardDepenseDraft() { depenseDraft.clearDraft(); depenseDraftBanner.value = false }

async function valider(d: Depense) {
  await api.post(`/depenses/${d.id}/valider`)
  await load(); showDetailModal.value = false
}
async function rejeter(d: Depense) {
  const motif = prompt('Motif du rejet :') ?? ''
  await api.post(`/depenses/${d.id}/rejeter`, { motif })
  await load(); showDetailModal.value = false
}
function openEditDep(d: Depense) {
  editingDep.value = d
  formEditDep.value = {
    libelle:       d.libelle,
    montant:       String(Number(d.montant)),
    date_depense:  d.date_depense,
    categorie:     d.categorie ?? 'autre',
    mode_paiement: d.mode_paiement ?? 'especes',
    beneficiaire:  d.beneficiaire ?? '',
    notes:         d.notes ?? ''
  }
  showEditDepModal.value = true
}
async function saveEditDep() {
  if (!editingDep.value) return
  savingEditDep.value = true
  try {
    await api.put(`/depenses/${editingDep.value.id}`, {
      ...formEditDep.value,
      montant: Number(String(formEditDep.value.montant).replace(/[\s\u00a0]/g, '').replace(',', '.'))
    })
    await load()
    showEditDepModal.value = false
  } catch(e: unknown) {
    if ((e as any)?.response?.status === 423) {
      toast.warning('Cette période est clôturée. Déverrouillez-la d\'abord.')
    } else {
      toast.apiError(e, 'Erreur lors de la modification.')
    }
  } finally {
    savingEditDep.value = false
  }
}

async function supprimerDepense(d: Depense) {
  const msg = d.statut === 'validee'
    ? `⚠ ATTENTION — Cette dépense est déjà VALIDÉE.\n\nSupprimer "${d.libelle}" (${fmt(Number(d.montant))}) effacera définitivement cette écriture comptable.\n\nConfirmer quand même ?`
    : `Supprimer "${d.libelle}" (${fmt(Number(d.montant))}) ?\nCette action est irréversible.`
  if (!confirm(msg)) return
  try {
    await api.delete(`/depenses/${d.id}`)
    await load(); showDetailModal.value = false
  } catch (e: unknown) {
    if ((e as any)?.response?.status === 423) {
      toast.warning('Cette période est clôturée. Déverrouillez-la d\'abord.')
    } else {
      toast.apiError(e, 'Erreur lors de la suppression.')
    }
  }
}

// ── Génération PDF ────────────────────────────────────────────────────────────
const ETAB    = 'UPTECH Campus'
const ADRESSE = 'Dakar, Sénégal'
const COULEUR: [number, number, number] = [227, 6, 19]   // rouge UPTECH (accent uniquement)
const NOIR: [number, number, number]    = [17, 17, 17]
const GRIS_HEADER: [number, number, number] = [240, 240, 240]

// Entête officielle (identique au reçu de paiement étudiant) : logo à gauche,
// tagline rouge, nom complet, NINEA/adresse/tel, agrément, filet rouge en bas.
// PAS de fond rouge — le rouge n'est utilisé que comme accent (tagline, filet).
const INSTITUT_NOM_LONG = "Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication"
const INSTITUT_META     = 'NINEA : 006118310 — BP 50281 RP DAKAR  |  Sicap Amitié 1, Villa N° 3031 — Dakar  |  Tél : 33 821 34 25 / 77 841 50 44'
const INSTITUT_AGREE    = "Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021 — N°14191/MFPAA/SG/DFPT"

// Cache du logo pour éviter de re-fetcher à chaque génération PDF
let _logoDataUrlCache: string | null = null
async function loadLogoDataUrl(): Promise<string | null> {
  if (_logoDataUrlCache) return _logoDataUrlCache
  try {
    const r = await fetch('/icons/icon-192.png')
    if (!r.ok) return null
    const blob = await r.blob()
    _logoDataUrlCache = await new Promise<string>(resolve => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.readAsDataURL(blob)
    })
    return _logoDataUrlCache
  } catch { return null }
}

async function pdfHeader(doc: jsPDF, titre: string, sous: string): Promise<number> {
  const W = doc.internal.pageSize.getWidth()
  const logo = await loadLogoDataUrl()

  // Logo (18×18 mm) à gauche
  if (logo) {
    try { doc.addImage(logo, 'PNG', 14, 10, 18, 18) } catch { /* ignore */ }
  }

  // Bloc texte entête — à droite du logo
  const txtX = logo ? 36 : 14
  // Tagline rouge
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...COULEUR)
  doc.text('INSTITUT DE FORMATION', txtX, 13)
  // Nom complet (wrap sur 2 lignes si besoin)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NOIR)
  const nomLines = doc.splitTextToSize(INSTITUT_NOM_LONG, W - txtX - 14)
  doc.text(nomLines, txtX, 17.5)
  const afterNom = 17.5 + nomLines.length * 3.8
  // Méta (NINEA, adresse, tel)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(90, 90, 90)
  doc.text(INSTITUT_META, txtX, afterNom + 1.5)
  doc.setFontSize(6.5); doc.setTextColor(130, 130, 130)
  doc.text(INSTITUT_AGREE, txtX, afterNom + 5)

  // Filet rouge en bas de l'entête
  doc.setDrawColor(...COULEUR); doc.setLineWidth(0.8)
  doc.line(14, 32, W - 14, 32)
  doc.setLineWidth(0.2)

  // Titre du document
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...NOIR)
  doc.text(titre.toUpperCase(), W / 2, 40, { align: 'center' })
  // Sous-titre gris
  doc.setTextColor(80, 80, 80); doc.setFont('helvetica', 'italic'); doc.setFontSize(9)
  doc.text(sous, W / 2, 46, { align: 'center' })
  doc.setTextColor(30, 30, 30)

  return 52  // y de départ du corps
}

function pdfLigne(doc: jsPDF, label: string, val: string, y: number, x1 = 14, x2 = 80): number {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(90, 90, 90)
  doc.text(label, x1, y)
  doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20)
  doc.text(val, x2, y)
  return y + 6
}

function pdfFooter(doc: jsPDF, ref_: string) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  doc.setDrawColor(200); doc.setLineWidth(0.3); doc.line(14, H - 18, W - 14, H - 18)
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(150)
  doc.text(`Réf : ${ref_}  —  Document généré le ${new Date().toLocaleDateString('fr-FR')} — ${ETAB}`, W / 2, H - 11, { align: 'center' })
}

// ── 1. Bulletin de salaire ────────────────────────────────────────────────────
async function genererBulletinSalaire(p: Personnel, moisCible?: string) {
  const mois = moisCible || new Date().toISOString().slice(0, 7)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  let y = await pdfHeader(doc, 'Bulletin de Salaire', `Période : ${fmtMois(mois)}`)

  // Encadré employé
  doc.setFillColor(248, 250, 252); doc.setDrawColor(220)
  doc.roundedRect(14, y, W - 28, 36, 3, 3, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 20)
  doc.text(`${p.prenom} ${p.nom}`.toUpperCase(), 20, y + 9)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80, 80, 80)
  doc.text(p.poste, 20, y + 16)
  doc.text(`Contrat : ${p.type_contrat}`, 20, y + 22)
  doc.text(`Date d'entrée : ${fmtDateStr(p.date_debut)}`, 20, y + 28)
  // Numéro réf à droite
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(120)
  doc.text(`Ref. BS-${p.id}-${mois.replace('-', '')}`, W - 20, y + 9, { align: 'right' })
  y += 42

  // Tableau rémunération
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30)
  doc.text('DÉTAIL DE LA RÉMUNÉRATION', 14, y); y += 3
  autoTable(doc, {
    startY: y,
    head: [['Rubrique', 'Base', 'Montant (F CFA)']],
    body: [
      ['Salaire de base', '100%', fmt(p.salaire_brut)],
      ['Brut imposable', '',     fmt(p.salaire_brut)],
      ['Net à payer', '',        fmt(p.salaire_brut)],
    ],
    styles: { fontSize: 9.5, cellPadding: 4 },
    headStyles: { fillColor: GRIS_HEADER, textColor: NOIR, fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } },
    alternateRowStyles: { fillColor: [250, 250, 252] },
    margin: { left: 14, right: 14 },
  })
  y = (doc as any).lastAutoTable.finalY + 8

  // Montant net encadré (bordure noire, pas de fond rouge)
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.6)
  doc.roundedRect(W / 2 - 10, y, W / 2 - 4, 14, 2, 2, 'S')
  doc.setLineWidth(0.2)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NOIR)
  doc.text(`NET À PAYER : ${fmt(p.salaire_brut)}`, W - 18, y + 9, { align: 'right' })
  y += 22

  // Zone signatures
  const sigY = Math.max(y + 10, 200)
  doc.setDrawColor(180); doc.setLineWidth(0.3)
  const sigCols = [14, W / 2 + 10]
  const sigLabels = ['Signature de l\'employé(e)', 'Le Directeur Général']
  sigCols.forEach((x, i) => {
    doc.line(x, sigY + 18, x + 70, sigY + 18)
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100)
    doc.text(sigLabels[i] ?? '', x, sigY + 23)
  })

  pdfFooter(doc, `BS-${p.id}-${mois.replace('-', '')}`)
  doc.save(`Bulletin_Salaire_${p.nom}_${p.prenom}_${mois}.pdf`)
}

function fmtDateStr(d: string | null) {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—'
}

// ── 2. Reçu de prestation ─────────────────────────────────────────────────────
async function genererRecuPrestation(ct: ContratFixe, moisCible?: string) {
  const mois = moisCible || new Date().toISOString().slice(0, 7)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const ref_ = `PREST-${ct.id}-${mois.replace('-', '')}`
  let y = await pdfHeader(doc, 'Reçu de Prestation de Service', `Période : ${fmtMois(mois)}`)

  // Parties
  doc.setFillColor(248, 250, 252); doc.setDrawColor(220)
  doc.roundedRect(14, y, W - 28, 28, 3, 3, 'FD')
  y += 7
  y = pdfLigne(doc, 'Prestataire :', ct.beneficiaire, y, 20, 65)
  y = pdfLigne(doc, 'Service :', ct.libelle, y, 20, 65)
  if (ct.description) { y = pdfLigne(doc, 'Description :', ct.description, y, 20, 65) }
  y = pdfLigne(doc, 'Périodicité :', ct.periodicite, y, 20, 65)
  y += 10

  // Tableau montant
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30)
  doc.text('DÉTAIL DU PAIEMENT', 14, y); y += 3
  autoTable(doc, {
    startY: y,
    head: [['Désignation', 'Période', 'Montant (F CFA)']],
    body: [[ct.libelle, fmtMois(mois), fmt(ct.montant)]],
    styles: { fontSize: 9.5, cellPadding: 4 },
    headStyles: { fillColor: GRIS_HEADER, textColor: NOIR, fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  })
  y = (doc as any).lastAutoTable.finalY + 8

  // Montant encadré (bordure noire)
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.6)
  doc.roundedRect(W / 2 - 10, y, W / 2 - 4, 14, 2, 2, 'S')
  doc.setLineWidth(0.2)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NOIR)
  doc.text(`MONTANT DÛ : ${fmt(ct.montant)}`, W - 18, y + 9, { align: 'right' })
  y += 22

  // Signatures
  const sigY = Math.max(y + 10, 200)
  doc.setDrawColor(180); doc.setLineWidth(0.3)
  const sigCols2 = [14, W / 2 + 10]
  ;['Signature du prestataire', 'Cachet & Signature UPTECH'].forEach((lbl, i) => {
    const x = sigCols2[i] ?? 14
    doc.line(x, sigY + 18, x + 70, sigY + 18)
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100)
    doc.text(lbl, x, sigY + 23)
  })

  pdfFooter(doc, ref_)
  doc.save(`Recu_Prestation_${ct.beneficiaire.replace(/\s+/g, '_')}_${mois}.pdf`)
}

// ── 3. Reçu de paiement (dépense quelconque) ─────────────────────────────────
async function genererRecuPaiement(d: Depense) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()

  // Référence séquentielle courte — N° pièce pour la comptabilité.
  // Ex: REC-00123-20260417. La référence_facture (si saisie) est affichée
  // en plus dans le corps sous « Pièce externe ».
  const idPadded = String(d.id).padStart(5, '0')
  const ref_ = `REC-${idPadded}-${shortDate(d.date_depense)}`

  let y = await pdfHeader(doc, 'Reçu de Paiement', `Date de paiement : ${fmtDateStr(d.date_depense)}`)

  // ── Marquage BROUILLON si non validé (gris, pas rouge) ─────────────────────
  if (d.statut !== 'validee') {
    doc.setGState(new (doc as any).GState({ opacity: 0.08 }))
    doc.setFont('helvetica', 'bold'); doc.setFontSize(90)
    doc.setTextColor(80, 80, 80)
    doc.text(d.statut === 'rejetee' ? 'REJETE' : 'BROUILLON', W / 2, H / 2, {
      align: 'center', angle: 30,
    })
    doc.setGState(new (doc as any).GState({ opacity: 1 }))
    doc.setTextColor(30, 30, 30)
  }

  // ── Bloc infos ─────────────────────────────────────────────────────────────
  const hasMois = !!d.mois_concerne
  const hasRefExt = !!d.reference_facture
  const linesCount = 5 + (hasMois ? 1 : 0) + (hasRefExt ? 1 : 0) // réf, bénéf, libellé, catégorie, mode
  const blocH = linesCount * 6 + 8
  doc.setFillColor(248, 250, 252); doc.setDrawColor(220)
  doc.roundedRect(14, y, W - 28, blocH, 3, 3, 'FD')
  y += 7
  y = pdfLigne(doc, 'N° de pièce :', ref_, y, 20, 75)
  y = pdfLigne(doc, 'Bénéficiaire :', d.beneficiaire || '…………………………………………', y, 20, 75)
  y = pdfLigne(doc, 'Libellé :', d.libelle, y, 20, 75)
  y = pdfLigne(doc, 'Catégorie :', catLabels.value[d.categorie] ?? d.categorie, y, 20, 75)
  y = pdfLigne(doc, 'Mode de paiement :', d.mode_paiement ? (modeLabels[d.mode_paiement] ?? d.mode_paiement) : '—', y, 20, 75)
  if (hasMois) { y = pdfLigne(doc, 'Mois concerné :', fmtMois(d.mois_concerne), y, 20, 75) }
  if (hasRefExt) { y = pdfLigne(doc, 'Pièce externe :', d.reference_facture!, y, 20, 75) }
  y += 6

  // ── Bandeau montant (encadré noir épais, pas de fond rouge) ───────────────
  doc.setDrawColor(...NOIR); doc.setLineWidth(0.8)
  doc.roundedRect(14, y, W - 28, 18, 3, 3, 'S')
  doc.setLineWidth(0.2)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...NOIR)
  doc.text(`MONTANT PAYÉ : ${fmtFCFA(Number(d.montant))}`, W / 2, y + 12, { align: 'center' })
  y += 22

  // ── Montant en lettres (comptabilité SN) ───────────────────────────────────
  doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(60, 60, 60)
  const lettres = `Arrêté le présent reçu à la somme de : ${montantEnLettres(Number(d.montant))} francs CFA.`
  const lettreLines = doc.splitTextToSize(lettres, W - 28)
  doc.text(lettreLines, 14, y)
  y += lettreLines.length * 5 + 4

  // ── Notes ──────────────────────────────────────────────────────────────────
  if (d.notes) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80)
    const lines = doc.splitTextToSize(`Note : ${d.notes}`, W - 28)
    doc.text(lines, 14, y); y += lines.length * 5 + 4
  }

  // ── Badge statut (sans emoji, rendu propre) ────────────────────────────────
  const statutCfg =
    d.statut === 'validee' ? { txt: 'VALIDE',      col: [22, 163, 74]  as [number, number, number], bg: [220, 252, 231] as [number, number, number] }
  : d.statut === 'rejetee' ? { txt: 'REJETE',      col: [185, 28, 28]  as [number, number, number], bg: [254, 226, 226] as [number, number, number] }
                           : { txt: 'EN ATTENTE', col: [180, 83, 9]   as [number, number, number], bg: [254, 243, 199] as [number, number, number] }
  doc.setFillColor(...statutCfg.bg); doc.setDrawColor(...statutCfg.col)
  doc.roundedRect(14, y, 48, 8, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...statutCfg.col)
  doc.text(statutCfg.txt, 38, y + 5.5, { align: 'center' })
  if (d.statut === 'validee' && d.validated_at) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100)
    doc.text(`Validé le ${fmtDateStr(d.validated_at)}`, 64, y + 5.5)
  }
  if (d.statut === 'rejetee' && d.motif_rejet) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100)
    doc.text(`Motif : ${d.motif_rejet}`, 64, y + 5.5)
  }
  y += 16

  // ── Zone signatures ────────────────────────────────────────────────────────
  const sigY = Math.max(y + 4, 215)
  doc.setDrawColor(180); doc.setLineWidth(0.3)
  const sigs = [
    { lbl: 'Émetteur / Caissier', sub: 'Nom, prénom, signature' },
    { lbl: 'Bénéficiaire',        sub: 'Reçu la somme ci-dessus' },
    { lbl: 'Le Directeur Général', sub: 'Validation' },
  ]
  sigs.forEach((s, i) => {
    const x = 14 + i * ((W - 28) / 3)
    doc.line(x, sigY + 18, x + 52, sigY + 18)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(60)
    doc.text(s.lbl, x, sigY + 23)
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(130)
    doc.text(s.sub, x, sigY + 27)
  })

  pdfFooter(doc, ref_)
  doc.save(`Recu_Paiement_${safeFilename(ref_)}.pdf`)
}

// ── État modal mois pour bulletin/reçu prestation ─────────────────────────────
const showMoisModal  = ref(false)
const moisModalType  = ref<'salaire' | 'prestation'>('salaire')
const moisModalCible = ref(new Date().toISOString().slice(0, 7))
const moisModalItem  = ref<Personnel | ContratFixe | null>(null)

function openMoisModal(type: 'salaire' | 'prestation', item: Personnel | ContratFixe) {
  moisModalType.value  = type
  moisModalCible.value = new Date().toISOString().slice(0, 7)
  moisModalItem.value  = item
  showMoisModal.value  = true
}
async function confirmMoisModal() {
  if (!moisModalItem.value) return
  if (moisModalType.value === 'salaire') {
    await genererBulletinSalaire(moisModalItem.value as Personnel, moisModalCible.value)
  } else {
    await genererRecuPrestation(moisModalItem.value as ContratFixe, moisModalCible.value)
  }
  showMoisModal.value = false
}

// ── Utilitaires ──────────────────────────────────────────────────────────────
// Intl.NumberFormat('fr-FR') insère un U+202F (narrow NBSP) que jsPDF rend
// comme « / ». On le remplace par une espace ASCII pour un rendu propre.
function fmtNumber(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\s/g, ' ')
}
function fmt(n: number) { return fmtNumber(n) + ' F' }
function fmtFCFA(n: number) { return fmtNumber(n) + ' FCFA' }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('fr-FR') : '—' }

// "YYYYMMDD" à partir d'un ISO — pour références / noms de fichiers
function shortDate(iso: string | null | undefined) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}${m[2]}${m[3]}` : ''
}

// Nettoie une chaîne pour usage dans un nom de fichier
function safeFilename(s: string) {
  return s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

// Conversion FCFA → lettres (français, entiers positifs jusqu'à ~999 999 999)
function montantEnLettres(n: number): string {
  n = Math.round(Math.max(0, n))
  if (n === 0) return 'zéro'
  const u = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']
  function below100(x: number): string {
    if (x < 17) return u[x] ?? ''
    if (x < 20) return 'dix-' + (u[x - 10] ?? '')
    if (x < 60) {
      const t = Math.floor(x / 10), r = x % 10
      const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante'][t] ?? ''
      if (r === 0) return tens
      if (r === 1) return tens + '-et-un'
      return tens + '-' + (u[r] ?? '')
    }
    if (x < 80) {
      const r = x - 60
      if (r === 0) return 'soixante'
      if (r === 11) return 'soixante-et-onze'
      return 'soixante-' + below100(r)
    }
    const r = x - 80
    if (r === 0) return 'quatre-vingts'
    return 'quatre-vingt-' + below100(r)
  }
  function below1000(x: number): string {
    if (x < 100) return below100(x)
    const h = Math.floor(x / 100), r = x % 100
    const cent = h === 1 ? 'cent' : u[h] + ' cent' + (r === 0 ? 's' : '')
    return r === 0 ? cent : cent + ' ' + below100(r)
  }
  const parts: string[] = []
  const mios = Math.floor(n / 1_000_000)
  const mils = Math.floor((n % 1_000_000) / 1000)
  const res  = n % 1000
  if (mios) parts.push((mios === 1 ? 'un' : below1000(mios)) + ' million' + (mios > 1 ? 's' : ''))
  if (mils) parts.push((mils === 1 ? '' : below1000(mils) + ' ') + 'mille')
  if (res)  parts.push(below1000(res))
  return parts.join(' ').trim().replace(/\s+/g, ' ')
}

// Retourne le statut d'expiration d'un contrat : 'expired' | 'danger' | 'warning' | 'ok' | 'none'
function expiryStatus(dateFin: string | null): 'expired' | 'danger' | 'warning' | 'ok' | 'none' {
  if (!dateFin) return 'none'
  const diff = Math.ceil((new Date(dateFin).getTime() - Date.now()) / 86400000)
  if (diff < 0)  return 'expired'
  if (diff <= 30) return 'danger'
  if (diff <= 90) return 'warning'
  return 'ok'
}
function expiryLabel(dateFin: string | null): string {
  if (!dateFin) return ''
  const diff = Math.ceil((new Date(dateFin).getTime() - Date.now()) / 86400000)
  if (diff < 0)  return `Expiré depuis ${Math.abs(diff)}j`
  if (diff === 0) return 'Expire aujourd\'hui'
  return `Expire dans ${diff}j`
}
function fmtMois(s: string | null) {
  if (!s) return '—'
  return new Date(s + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

// Couleur type_contrat
const contratColor: Record<string, string> = { CDI: '#1a1a1a', CDD: '#7a4700', Stage: '#005580' }
const contratBg: Record<string, string>    = { CDI: '#f5f5f5', CDD: '#fff7e6', Stage: '#e6f4ff' }

// ── Import CSV ────────────────────────────────────────────────────────────────
const importing    = ref(false)
const importResult = ref<{ created: number; errors: number; details_erreurs: { ligne: number; erreur: string }[]; message: string } | null>(null)
const showImportModal = ref(false)

// ── Validation en masse ───────────────────────────────────────────────────────
const selectedIds      = ref<Set<number>>(new Set())
const validatingMasse  = ref(false)

const enAttenteJournal = computed(() => filteredJournal.value.filter(d => d.statut === 'en_attente'))
const allEnAttenteSelected = computed(() =>
  enAttenteJournal.value.length > 0 && enAttenteJournal.value.every(d => selectedIds.value.has(d.id))
)

function toggleSelectAll() {
  if (allEnAttenteSelected.value) {
    enAttenteJournal.value.forEach(d => selectedIds.value.delete(d.id))
  } else {
    enAttenteJournal.value.forEach(d => selectedIds.value.add(d.id))
  }
  selectedIds.value = new Set(selectedIds.value)
}

function toggleSelectDep(id: number) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
  selectedIds.value = new Set(selectedIds.value)
}

async function validerMasse(idsArg?: number[]) {
  const toValidate = idsArg ?? [...selectedIds.value]
  const totalEnAttente = depenses.value.filter(d => d.statut === 'en_attente').length
  const msg = toValidate.length > 0
    ? `Valider ${toValidate.length} dépense(s) sélectionnée(s) ?`
    : `Valider TOUTES les dépenses en attente (${totalEnAttente}) ?\nCette action est irréversible.`
  if (!confirm(msg)) return
  validatingMasse.value = true
  try {
    const payload = toValidate.length > 0 ? { ids: toValidate } : {}
    const { data } = await api.post('/depenses/valider-masse', payload)
    toast.success(`${data.message}`)
    selectedIds.value = new Set()
    await load()
  } catch (e: unknown) {
    toast.apiError(e, 'Erreur lors de la validation.')
  } finally { validatingMasse.value = false }
}

function downloadTemplate() {
  const a = document.createElement('a')
  a.href = '/modele_import_depenses.xlsx'
  a.download = 'modele_import_depenses.xlsx'
  a.click()
}

function triggerImportFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    importing.value = true
    try {
      let csvText: string

      if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
        // Parse Excel côté client avec SheetJS
        const buffer = await file.arrayBuffer()
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
        const sheetName = workbook.SheetNames[0]
        if (!sheetName) throw new Error('Aucune feuille trouvée dans le fichier Excel.')
        const sheet = workbook.Sheets[sheetName]!
        const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, {
          header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd'
        })

        // Trouver la ligne d'en-tête (contient "Désignation" ou "Designation")
        let headerIdx = 3 // défaut : ligne 4 (index 3)
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
          const row = rows[i] as string[]
          if (row.some(c => String(c).toLowerCase().replace(/[^a-z]/g, '').includes('designation') || String(c).toLowerCase().includes('libelle'))) {
            headerIdx = i; break
          }
        }

        const escape = (s: string) => (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s

        const csvRows = ['date_depense,libelle,montant,categorie,mode_paiement,beneficiaire,notes']
        for (const rawRow of rows.slice(headerIdx + 1)) {
          const row = rawRow as string[]
          const date     = String(row[0] ?? '').trim()
          const libelle  = String(row[1] ?? '').trim()
          const montant  = String(row[2] ?? '').trim().replace(/\s/g, '').replace(',', '.')
          const categorie = String(row[3] ?? '').trim()
          const mode     = String(row[4] ?? '').trim()
          const benef    = String(row[5] ?? '').trim()
          const notes    = String(row[6] ?? '').trim()

          // Ignorer lignes vides, totaux, solde d'ouverture
          if (!date && !libelle && !montant) continue
          const lib = libelle.toUpperCase()
          if (lib.includes('TOTAL') || lib.includes("SOLDE D'OUVERTURE") || lib.includes('SOLDE OUVERTURE')) continue

          csvRows.push([escape(date), escape(libelle), escape(montant), escape(categorie), escape(mode), escape(benef), escape(notes)].join(','))
        }
        csvText = csvRows.join('\n')
      } else {
        csvText = await file.text()
      }

      const { data } = await api.post('/depenses/import', csvText, { headers: { 'Content-Type': 'text/csv' } })
      importResult.value = data
      showImportModal.value = true
      if (data.created > 0) await load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Erreur lors de l\'import.'
      toast.warning(msg)
    } finally { importing.value = false }
  }
  input.click()
}

// ── Clôtures CRUD ────────────────────────────────────────────────────────────
async function loadClotures() {
  loadingClotures.value = true
  try {
    const { data } = await api.get('/clotures')
    clotures.value = data
  } finally { loadingClotures.value = false }
}

async function saveCloture() {
  savingCloture.value = true
  try {
    await api.post('/clotures', { periode: formCloture.value.periode, notes: formCloture.value.notes || null })
    showClotureModal.value = false
    await loadClotures()
  } catch (e: unknown) {
    toast.apiError(e, 'Erreur lors de la clôture.')
  } finally { savingCloture.value = false }
}

async function unlockCloture(c: Cloture) {
  if (!confirm(`ATTENTION — Déverrouiller la période ${c.periode} ?\n\nCela permettra à nouveau de modifier, ajouter ou supprimer des dépenses sur cette période.\n\nConfirmer ?`)) return
  try {
    await api.delete(`/clotures/${c.id}`)
    await loadClotures()
  } catch (e: unknown) {
    toast.apiError(e, 'Erreur.')
  }
}

function isPeriodeLocked(periode: string): boolean {
  return clotures.value.some(c => c.periode === periode)
}

onMounted(() => {
  load()
  const hint = sessionStorage.getItem('depenses_tab')
  if (hint && ['fixes','variables','journal','budget','clotures'].includes(hint)) {
    activeTab.value = hint as typeof activeTab.value
    sessionStorage.removeItem('depenses_tab')
  }
})
watch(budgetAnnee, loadBudget)
</script>

<template>
  <div class="uc-content">

    <UcPageHeader title="Dépenses" subtitle="Gestion des charges fixes et dépenses variables">
      <template #actions>
        <button @click="setTab('journal')" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#E30613;color:#fff;font-size:12px;font-weight:600;border:none;cursor:pointer;">
          💸 Journal des dépenses
        </button>
        <router-link to="/vacations" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#1e293b;color:#fff;font-size:12px;font-weight:600;text-decoration:none;">
          👨‍🏫 Vacataires
        </router-link>
        <button v-if="canWrite" @click="downloadTemplate" class="dep-btn-secondary" title="Télécharger le modèle Excel (Livre de caisse) à remplir">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Modèle Excel
        </button>
        <button v-if="canWrite" @click="triggerImportFile" :disabled="importing" class="dep-btn-secondary" title="Importer un fichier Excel (.xlsx) ou CSV de dépenses">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
          {{ importing ? 'Import…' : 'Importer Excel / CSV' }}
        </button>
        <button v-if="canWrite" @click="openAddDepense" class="dep-btn-secondary">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          Dépense ponctuelle
        </button>
        <button v-if="canWrite" @click="openExportComptabilite" class="dep-btn-secondary" title="Exporter le suivi comptabilité annuel (modèle ANAQ-Sup)">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          Export comptabilité
        </button>
      </template>
    </UcPageHeader>

    <!-- Modal export comptabilité -->
    <UcModal v-model="showExportCompta" title="Exporter le suivi comptabilité" width="440px">
      <div style="font-size:13px;color:#475569;line-height:1.55;margin-bottom:12px;">
        Génère un classeur Excel <strong>au format ANAQ-Sup</strong> (13 feuilles : un livre par mois + récapitulatif annuel).<br/>
        Sont incluses uniquement les <strong>entrées validées</strong> :
        <ul style="margin:6px 0 0 18px;padding:0;">
          <li>Paiements étudiants confirmés</li>
          <li>Autres recettes validées</li>
          <li>Dépenses validées</li>
        </ul>
      </div>
      <UcFormGrid :cols="2">
        <UcFormGroup label="Année" :required="true">
          <select v-model="exportAnnee" class="uc-input">
            <option v-for="y in [new Date().getFullYear() + 1, new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2]"
                    :key="y" :value="y">{{ y }}</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Solde initial (FCFA)" hint="Trésorerie au 1er janvier">
          <input v-model.number="exportSoldeInitial" type="number" min="0" class="uc-input" />
        </UcFormGroup>
      </UcFormGrid>
      <template #footer>
        <button @click="showExportCompta = false" class="uc-btn-outline">Annuler</button>
        <button @click="doExportComptabilite" :disabled="exportingCompta" class="uc-btn-primary">
          {{ exportingCompta ? 'Génération…' : 'Télécharger' }}
        </button>
      </template>
    </UcModal>

    <!-- Sélecteur de période (global, pilote KPIs + Journal) -->
    <div class="dep-periode-bar">
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0;color:#666;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
      <span style="font-size:12px;font-weight:600;color:#444;white-space:nowrap;">Période :</span>

      <div class="dep-periode-modes">
        <button :class="['dep-periode-mode', { active: periodeMode==='mois' }]" @click="periodeMode='mois'">Par mois</button>
        <button :class="['dep-periode-mode', { active: periodeMode==='annee' }]" @click="periodeMode='annee'">Par année</button>
        <button :class="['dep-periode-mode', { active: periodeMode==='tout' }]" @click="periodeMode='tout'">Tout</button>
      </div>

      <input
        v-if="periodeMode==='mois'"
        v-model="periodeMois"
        type="month"
        class="dep-input-sm"
        style="width:170px;"
      />
      <select
        v-else-if="periodeMode==='annee'"
        v-model="periodeAnnee"
        class="dep-input-sm"
        style="width:130px;"
      >
        <option v-for="a in anneesDisponibles" :key="a" :value="a">{{ a }}</option>
      </select>

      <span class="dep-periode-label">
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4"/></svg>
        {{ periodLabel }}
      </span>
    </div>

    <!-- KPI Cards -->
    <div class="dep-kpi-row">
      <div class="dep-kpi">
        <div class="dep-kpi-label">Charges — {{ periodLabel }}</div>
        <div class="dep-kpi-val">{{ loading ? '…' : fmt(kpiMois) }}</div>
        <div class="dep-kpi-sub">En attente + validées</div>
      </div>
      <div class="dep-kpi">
        <div class="dep-kpi-label">En attente — {{ periodLabel }}</div>
        <div class="dep-kpi-val" style="color:#92400e;">{{ loading ? '…' : fmt(kpiAttente) }}</div>
        <div class="dep-kpi-sub">À valider par DG</div>
      </div>
      <div class="dep-kpi dep-kpi-accent">
        <div class="dep-kpi-label">Validées — {{ periodLabel }}</div>
        <div class="dep-kpi-val">{{ loading ? '…' : fmt(kpiValidees) }}</div>
        <div class="dep-kpi-sub">{{ depensesPeriode.filter(d=>d.statut==='validee').length }} dépense(s)</div>
      </div>
      <div class="dep-kpi">
        <div class="dep-kpi-label">Masse salariale mensuelle</div>
        <div class="dep-kpi-val">{{ loading ? '…' : fmt(kpiPersonnel) }}</div>
        <div class="dep-kpi-sub">{{ personnel.filter(p=>p.statut==='actif').length }} personnel actif</div>
      </div>
    </div>

    <!-- Tabs principaux -->
    <div class="dep-tabs-bar">
      <button :class="['dep-tab', { active: activeTab==='fixes' }]" @click="setTab('fixes')">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/></svg>
        Charges fixes
      </button>
      <button :class="['dep-tab', { active: activeTab==='variables' }]" @click="setTab('variables')">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        Dépenses variables
      </button>
      <button :class="['dep-tab', { active: activeTab==='journal' }]" @click="setTab('journal')">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        Journal complet
        <span class="dep-tab-badge">{{ depenses.length }}</span>
      </button>
      <button :class="['dep-tab', { active: activeTab==='budget' }]" @click="setTab('budget')">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        Budget
      </button>
      <button :class="['dep-tab', { active: activeTab==='clotures' }]" @click="setTab('clotures')">
        🔒 Clôtures
        <span v-if="clotures.length > 0" class="dep-tab-badge">{{ clotures.length }}</span>
      </button>
    </div>

    <!-- ══════════ CHARGES FIXES ══════════ -->
    <div v-if="activeTab==='fixes'" class="dep-panel">

      <!-- Barre génération -->
      <div v-if="canWrite" class="dep-gen-bar">
        <div style="display:flex;align-items:center;gap:10px;flex:1;flex-wrap:wrap;">
          <span style="font-size:12.5px;font-weight:600;color:#111;">Générer les charges de :</span>
          <input v-model="moisGen" type="month" class="dep-input-sm" style="width:160px;" />
        </div>
        <button @click="genererMois" :disabled="generating" class="dep-btn-gen">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          {{ generating ? 'Génération…' : 'Générer le mois' }}
        </button>
      </div>

      <!-- Sous-onglets -->
      <div class="dep-subtabs">
        <button :class="['dep-subtab', { active: activeSubTab==='personnel' }]" @click="activeSubTab='personnel'">
          Personnel ({{ personnel.length }})
        </button>
        <button :class="['dep-subtab', { active: activeSubTab==='contrats' }]" @click="activeSubTab='contrats'">
          Contrats de prestation ({{ contrats.length }})
        </button>
      </div>

      <!-- Personnel -->
      <div v-if="activeSubTab==='personnel'">
        <div class="dep-subtab-header">
          <span style="font-size:12px;color:#666;">{{ personnel.filter(p=>p.statut==='actif').length }} actif(s) · masse salariale {{ fmt(kpiPersonnel) }}/mois</span>
          <button v-if="canWrite" @click="openAddPersonnel" class="dep-btn-add">
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Ajouter
          </button>
        </div>
        <div v-if="loading" class="dep-empty">Chargement…</div>
        <div v-else-if="!personnel.length" class="dep-empty">Aucun personnel enregistré</div>
        <table v-else class="dep-table">
          <thead><tr>
            <th>Nom & Prénom</th><th>Poste</th><th>Contrat</th>
            <th>Salaire brut</th><th>Période</th><th>Statut</th><th>Fichier</th>
            <th v-if="canWrite"></th>
          </tr></thead>
          <tbody>
            <tr v-for="p in personnel" :key="p.id">
              <td><strong>{{ p.prenom }} {{ p.nom }}</strong></td>
              <td style="color:#555;">{{ p.poste }}</td>
              <td>
                <span class="dep-contract-badge" :style="{ background: contratBg[p.type_contrat] ?? '#f5f5f5', color: contratColor[p.type_contrat] ?? '#333' }">
                  {{ p.type_contrat }}
                </span>
              </td>
              <td style="font-weight:700;color:#E30613;">{{ fmt(p.salaire_brut) }}</td>
              <td style="font-size:11.5px;">
                <span style="color:#888;">{{ fmtDate(p.date_debut) }} → {{ p.date_fin ? fmtDate(p.date_fin) : '∞' }}</span>
                <span v-if="expiryStatus(p.date_fin) !== 'none' && expiryStatus(p.date_fin) !== 'ok'"
                  :style="{ display:'block', fontSize:'10px', fontWeight:'600', marginTop:'2px',
                    color: expiryStatus(p.date_fin)==='expired' ? '#b91c1c' : expiryStatus(p.date_fin)==='danger' ? '#dc2626' : '#d97706' }">
                  ⚠ {{ expiryLabel(p.date_fin) }}
                </span>
              </td>
              <td>
                <span :class="p.statut==='actif' ? 'dep-badge-ok' : 'dep-badge-off'">{{ p.statut === 'actif' ? 'Actif' : 'Inactif' }}</span>
              </td>
              <td>
                <a v-if="p.contrat_url" :href="p.contrat_url" target="_blank" class="dep-contrat-link" title="Voir le contrat">📄 Contrat</a>
                <span v-else style="color:#ccc;font-size:11px;">—</span>
              </td>
              <td style="white-space:nowrap;display:flex;gap:4px;align-items:center;">
                <button @click="openMoisModal('salaire', p)" class="dep-btn-icon" title="Générer bulletin de salaire" style="color:#0369a1;">📄</button>
                <button v-if="canWrite" @click="openEditPersonnel(p)" class="dep-btn-icon" title="Modifier">✏️</button>
                <button v-if="canValidate" @click="deletePersonnel(p)" class="dep-btn-icon" title="Supprimer">🗑</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Contrats de prestation -->
      <div v-if="activeSubTab==='contrats'">
        <div class="dep-subtab-header">
          <span style="font-size:12px;color:#666;">{{ contrats.filter(c=>c.statut==='actif').length }} actif(s)</span>
          <button v-if="canWrite" @click="openAddContrat" class="dep-btn-add">
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Ajouter
          </button>
        </div>
        <!-- Alerte contrats suspendus ou futurs -->
        <div v-if="contrats.some(ct => ct.statut==='suspendu' || new Date(ct.date_debut) > new Date())"
          style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 14px;margin-bottom:10px;font-size:12px;color:#92400e;">
          ⚠ Les contrats <strong>suspendus</strong> ou dont la <strong>date de début est future</strong> ne seront pas inclus dans la génération mensuelle.
          Passez-les en <strong>Actif</strong> au moment voulu.
        </div>
        <div v-if="loading" class="dep-empty">Chargement…</div>
        <div v-else-if="!contrats.length" class="dep-empty">Aucun contrat enregistré</div>
        <table v-else class="dep-table">
          <thead><tr>
            <th>Libellé</th><th>Bénéficiaire</th><th>Périodicité</th>
            <th>Montant</th><th>Fin de contrat</th><th>Statut</th><th>Fichier</th>
            <th v-if="canWrite"></th>
          </tr></thead>
          <tbody>
            <tr v-for="ct in contrats" :key="ct.id">
              <td>
                <strong>{{ ct.libelle }}</strong>
                <div style="font-size:11px;color:#aaa;">{{ catLabels[ct.categorie] ?? ct.categorie }}</div>
              </td>
              <td style="color:#555;">{{ ct.beneficiaire }}</td>
              <td style="font-size:11.5px;color:#888;">{{ periodeLabels[ct.periodicite] ?? ct.periodicite }}</td>
              <td style="font-weight:700;color:#E30613;">{{ fmt(ct.montant) }}</td>
              <td style="font-size:11.5px;">
                <span style="color:#888;">{{ ct.date_fin ? fmtDate(ct.date_fin) : '∞' }}</span>
                <span v-if="expiryStatus(ct.date_fin) !== 'none' && expiryStatus(ct.date_fin) !== 'ok'"
                  :style="{ display:'block', fontSize:'10px', fontWeight:'600', marginTop:'2px',
                    color: expiryStatus(ct.date_fin)==='expired' ? '#b91c1c' : expiryStatus(ct.date_fin)==='danger' ? '#dc2626' : '#d97706' }">
                  ⚠ {{ expiryLabel(ct.date_fin) }}
                </span>
              </td>
              <td>
                <span :class="ct.statut==='actif' ? 'dep-badge-ok' : ct.statut==='suspendu' ? 'dep-badge-warn' : 'dep-badge-off'">
                  {{ ct.statut === 'actif' ? 'Actif' : ct.statut === 'suspendu' ? 'Suspendu' : 'Terminé' }}
                </span>
              </td>
              <td>
                <a v-if="ct.contrat_url" :href="ct.contrat_url" target="_blank" class="dep-contrat-link" title="Voir le contrat">📄 Contrat</a>
                <span v-else style="color:#ccc;font-size:11px;">—</span>
              </td>
              <td style="white-space:nowrap;display:flex;gap:4px;align-items:center;">
                <button @click="openMoisModal('prestation', ct)" class="dep-btn-icon" title="Générer reçu de prestation" style="color:#0369a1;">📄</button>
                <button v-if="canWrite" @click="openEditContrat(ct)" class="dep-btn-icon" title="Modifier">✏️</button>
                <button v-if="canValidate" @click="deleteContrat(ct)" class="dep-btn-icon" title="Supprimer">🗑</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ══════════ DÉPENSES VARIABLES ══════════ -->
    <div v-if="activeTab==='variables'" class="dep-panel">

      <!-- Barre calcul vacations -->
      <div v-if="canWrite" class="dep-gen-bar">
        <div style="display:flex;align-items:center;gap:10px;flex:1;flex-wrap:wrap;">
          <span style="font-size:12.5px;font-weight:600;color:#111;">Mois de référence :</span>
          <input v-model="moisGen" type="month" class="dep-input-sm" style="width:160px;" />
        </div>
        <button @click="calculerVacations" :disabled="generating" class="dep-btn-gen">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5z"/></svg>
          {{ generating ? 'Calcul…' : 'Calculer vacations' }}
        </button>
        <button @click="openAddDepense" class="dep-btn-secondary" style="margin-left:6px;">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          Autre dépense
        </button>
      </div>

      <!-- Sous-onglets -->
      <div class="dep-subtabs">
        <button :class="['dep-subtab', { active: activeSubTab==='vacations' }]" @click="activeSubTab='vacations'">
          Vacations ({{ depenses.filter(d=>d.type_source==='vacation').length }})
        </button>
        <button :class="['dep-subtab', { active: activeSubTab==='autres' }]" @click="activeSubTab='autres'">
          Consommables & Autres ({{ depenses.filter(d=>!d.type_source || ['consommable','autre',null].includes(d.type_source)).length }})
        </button>
      </div>

      <!-- Liste vacations -->
      <div v-if="activeSubTab==='vacations'">
        <div v-if="loading" class="dep-empty">Chargement…</div>
        <div v-else-if="!depenses.filter(d=>d.type_source==='vacation').length" class="dep-empty">
          Aucune vacation calculée — utilisez le bouton ci-dessus pour calculer depuis les émargements.
        </div>
        <table v-else class="dep-table">
          <thead><tr>
            <th @click="toggleVarSort('libelle')" class="dep-th-sort" :class="{ active: varSort.key==='libelle' }">Libellé <span class="dep-sort-icon">{{ varSort.key==='libelle'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th @click="toggleVarSort('beneficiaire')" class="dep-th-sort" :class="{ active: varSort.key==='beneficiaire' }">Bénéficiaire <span class="dep-sort-icon">{{ varSort.key==='beneficiaire'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th @click="toggleVarSort('mois')" class="dep-th-sort" :class="{ active: varSort.key==='mois' }">Mois <span class="dep-sort-icon">{{ varSort.key==='mois'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th @click="toggleVarSort('montant')" class="dep-th-sort" :class="{ active: varSort.key==='montant' }">Montant <span class="dep-sort-icon">{{ varSort.key==='montant'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th @click="toggleVarSort('statut')" class="dep-th-sort" :class="{ active: varSort.key==='statut' }">Statut <span class="dep-sort-icon">{{ varSort.key==='statut'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th></th>
          </tr></thead>
          <tbody>
            <tr v-for="d in sortedVacations" :key="d.id">
              <td><strong>{{ d.libelle }}</strong></td>
              <td style="color:#555;">{{ d.beneficiaire ?? '—' }}</td>
              <td style="font-size:11.5px;color:#888;">{{ fmtMois(d.mois_concerne) }}</td>
              <td style="font-weight:700;color:#E30613;">{{ fmt(d.montant) }}</td>
              <td><span :class="d.statut==='validee'?'dep-badge-ok':d.statut==='rejetee'?'dep-badge-off':'dep-badge-warn'">{{ d.statut==='validee'?'Validée':d.statut==='rejetee'?'Rejetée':'En attente' }}</span></td>
              <td style="white-space:nowrap;display:flex;gap:4px;align-items:center;">
                <button @click="selectedDep=d;showDetailModal=true" class="dep-btn-voir">Voir</button>
                <button v-if="canValidate" @click="supprimerDepense(d)" class="dep-btn-icon" title="Supprimer" style="color:#dc2626;">🗑</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Consommables & Autres -->
      <div v-if="activeSubTab==='autres'">
        <div v-if="loading" class="dep-empty">Chargement…</div>
        <div v-else-if="!depenses.filter(d=>!d.type_source||['consommable','autre'].includes(d.type_source??'')).length" class="dep-empty">
          Aucune dépense variable enregistrée.
        </div>
        <table v-else class="dep-table">
          <thead><tr>
            <th @click="toggleVarSort('date_depense')" class="dep-th-sort" :class="{ active: varSort.key==='date_depense' }">Date <span class="dep-sort-icon">{{ varSort.key==='date_depense'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th @click="toggleVarSort('libelle')" class="dep-th-sort" :class="{ active: varSort.key==='libelle' }">Libellé <span class="dep-sort-icon">{{ varSort.key==='libelle'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th @click="toggleVarSort('categorie')" class="dep-th-sort" :class="{ active: varSort.key==='categorie' }">Catégorie <span class="dep-sort-icon">{{ varSort.key==='categorie'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th @click="toggleVarSort('montant')" class="dep-th-sort" :class="{ active: varSort.key==='montant' }">Montant <span class="dep-sort-icon">{{ varSort.key==='montant'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th @click="toggleVarSort('statut')" class="dep-th-sort" :class="{ active: varSort.key==='statut' }">Statut <span class="dep-sort-icon">{{ varSort.key==='statut'?(varSort.dir===1?'↑':'↓'):'↕' }}</span></th>
            <th></th>
          </tr></thead>
          <tbody>
            <tr v-for="d in sortedAutres" :key="d.id">
              <td style="color:#888;font-size:11.5px;">{{ fmtDate(d.date_depense) }}</td>
              <td><strong>{{ d.libelle }}</strong><div v-if="d.beneficiaire" style="font-size:11px;color:#aaa;">{{ d.beneficiaire }}</div></td>
              <td><span class="dep-cat-chip">{{ catLabels[d.categorie] ?? d.categorie }}</span></td>
              <td style="font-weight:700;color:#E30613;">{{ fmt(d.montant) }}</td>
              <td><span :class="d.statut==='validee'?'dep-badge-ok':d.statut==='rejetee'?'dep-badge-off':'dep-badge-warn'">{{ d.statut==='validee'?'Validée':d.statut==='rejetee'?'Rejetée':'En attente' }}</span></td>
              <td style="white-space:nowrap;display:flex;gap:4px;align-items:center;">
                <button @click="selectedDep=d;showDetailModal=true" class="dep-btn-voir">Voir</button>
                <button v-if="canValidate" @click="supprimerDepense(d)" class="dep-btn-icon" title="Supprimer" style="color:#dc2626;">🗑</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ══════════ JOURNAL COMPLET ══════════ -->
    <div v-if="activeTab==='journal'" class="dep-panel">

      <!-- Barre filtres -->
      <!-- Filtre période propre au journal -->
      <div class="dep-periode-bar" style="margin-bottom:10px;">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0;color:#666;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        <div class="dep-periode-modes">
          <button :class="['dep-periode-mode', { active: jPeriodeMode==='mois' }]"  @click="jPeriodeMode='mois'">Par mois</button>
          <button :class="['dep-periode-mode', { active: jPeriodeMode==='annee' }]" @click="jPeriodeMode='annee'">Par année</button>
          <button :class="['dep-periode-mode', { active: jPeriodeMode==='tout' }]"  @click="jPeriodeMode='tout'">Tout</button>
        </div>
        <input v-if="jPeriodeMode==='mois'"  v-model="jPeriodeMois"  type="month" class="dep-input-sm" style="width:170px;" />
        <select v-else-if="jPeriodeMode==='annee'" v-model="jPeriodeAnnee" class="dep-input-sm" style="width:130px;">
          <option v-for="a in anneesDisponibles" :key="a" :value="a">{{ a }}</option>
        </select>
        <span class="dep-periode-label">
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4"/></svg>
          {{ filteredJournal.length }} dépense(s) · {{ jPeriodeLabel }}
        </span>
      </div>

      <div class="dep-journal-toolbar">
        <div style="position:relative;flex:1;min-width:160px;">
          <svg style="position:absolute;left:9px;top:50%;transform:translateY(-50%);width:13px;height:13px;color:#aaa;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input v-model="filtersJournal.search" type="text" placeholder="Rechercher…" class="dep-search" />
        </div>
        <select v-model="filtersJournal.categorie" class="dep-select">
          <option value="">Toutes catégories</option>
          <option v-for="(label, key) in catLabels" :key="key" :value="key">{{ label }}</option>
        </select>
        <select v-model="filtersJournal.statut" class="dep-select">
          <option value="">Tous statuts</option>
          <option value="validee">Validée</option>
          <option value="en_attente">En attente</option>
          <option value="rejetee">Rejetée</option>
        </select>
      </div>

      <!-- Barre actions en masse (visible DG uniquement) -->
      <div v-if="canValidate && depenses.filter(d=>d.statut==='en_attente').length > 0" class="dep-masse-bar">
        <div style="display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap;">
          <span style="font-size:12px;color:#666;">
            <strong style="color:#92400e;">{{ depenses.filter(d=>d.statut==='en_attente').length }}</strong>
            dépense(s) en attente de validation
          </span>
          <span v-if="selectedIds.size > 0" style="font-size:12px;font-weight:600;color:#E30613;">
            · {{ selectedIds.size }} sélectionnée(s)
          </span>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <button
            v-if="selectedIds.size > 0"
            @click="validerMasse()"
            :disabled="validatingMasse"
            class="dep-btn-valider-masse">
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            {{ validatingMasse ? 'Validation…' : `Valider la sélection (${selectedIds.size})` }}
          </button>
          <button
            @click="validerMasse([])"
            :disabled="validatingMasse"
            class="dep-btn-valider-tout">
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            Tout valider
          </button>
        </div>
      </div>

      <div v-if="loading" class="dep-empty">Chargement…</div>
      <div v-else-if="!filteredJournal.length" class="dep-empty">Aucune dépense trouvée</div>
      <table v-else class="dep-table">
        <thead>
          <tr>
            <th v-if="canValidate" style="width:34px;padding:8px 6px;">
              <input
                type="checkbox"
                :checked="allEnAttenteSelected"
                :indeterminate="selectedIds.size > 0 && !allEnAttenteSelected"
                @change="toggleSelectAll"
                title="Sélectionner toutes les dépenses en attente visibles"
                style="cursor:pointer;width:14px;height:14px;"
              />
            </th>
            <th @click="toggleSort('date_depense')" class="dep-th-sort" :class="{ active: journalSort.key==='date_depense' }">
              Date <span class="dep-sort-icon">{{ journalSort.key==='date_depense' ? (journalSort.dir===1?'↑':'↓') : '↕' }}</span>
            </th>
            <th @click="toggleSort('libelle')" class="dep-th-sort" :class="{ active: journalSort.key==='libelle' }">
              Libellé <span class="dep-sort-icon">{{ journalSort.key==='libelle' ? (journalSort.dir===1?'↑':'↓') : '↕' }}</span>
            </th>
            <th @click="toggleSort('type')" class="dep-th-sort" :class="{ active: journalSort.key==='type' }">
              Type <span class="dep-sort-icon">{{ journalSort.key==='type' ? (journalSort.dir===1?'↑':'↓') : '↕' }}</span>
            </th>
            <th @click="toggleSort('categorie')" class="dep-th-sort" :class="{ active: journalSort.key==='categorie' }">
              Catégorie <span class="dep-sort-icon">{{ journalSort.key==='categorie' ? (journalSort.dir===1?'↑':'↓') : '↕' }}</span>
            </th>
            <th @click="toggleSort('montant')" class="dep-th-sort" :class="{ active: journalSort.key==='montant' }" style="text-align:right">
              Montant <span class="dep-sort-icon">{{ journalSort.key==='montant' ? (journalSort.dir===1?'↑':'↓') : '↕' }}</span>
            </th>
            <th @click="toggleSort('statut')" class="dep-th-sort" :class="{ active: journalSort.key==='statut' }">
              Statut <span class="dep-sort-icon">{{ journalSort.key==='statut' ? (journalSort.dir===1?'↑':'↓') : '↕' }}</span>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in filteredJournal" :key="d.id" :class="{ 'dep-row-selected': selectedIds.has(d.id) }">
            <td v-if="canValidate" style="padding:8px 6px;">
              <input
                v-if="d.statut === 'en_attente'"
                type="checkbox"
                :checked="selectedIds.has(d.id)"
                @change="toggleSelectDep(d.id)"
                style="cursor:pointer;width:14px;height:14px;"
              />
            </td>
            <td style="font-size:11.5px;color:#888;">{{ fmtDate(d.date_depense) }}<span v-if="isPeriodeLocked(d.date_depense.slice(0,7))" title="Période clôturée" style="font-size:10px;margin-left:4px;">🔒</span></td>
            <td>
              <p style="font-size:12.5px;font-weight:600;color:#111;margin:0;">{{ d.libelle }}</p>
              <p v-if="d.beneficiaire" style="font-size:11px;color:#aaa;margin:0;">{{ d.beneficiaire }}</p>
            </td>
            <td>
              <span v-if="d.type_source" class="dep-source-chip">{{ sourceLabels[d.type_source] ?? d.type_source }}</span>
              <span v-else style="color:#ccc;font-size:11px;">—</span>
            </td>
            <td><span class="dep-cat-chip">{{ catLabels[d.categorie] ?? d.categorie }}</span></td>
            <td style="text-align:right;font-weight:700;color:#E30613;font-size:13px;">{{ fmt(d.montant) }}</td>
            <td><span :class="d.statut==='validee'?'dep-badge-ok':d.statut==='rejetee'?'dep-badge-off':'dep-badge-warn'">{{ d.statut==='validee'?'Validée':d.statut==='rejetee'?'Rejetée':'En attente' }}</span></td>
            <td style="white-space:nowrap;display:flex;gap:4px;align-items:center;">
              <button @click="selectedDep=d;showDetailModal=true" class="dep-btn-voir">Voir</button>
              <button v-if="canWrite" @click="openEditDep(d)" class="dep-btn-icon" title="Modifier">✏️</button>
              <button v-if="canValidate" @click="supprimerDepense(d)" class="dep-btn-icon" title="Supprimer" style="color:#dc2626;">🗑</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ══════════ BUDGET PRÉVISIONNEL ══════════ -->
    <div v-if="activeTab==='budget'" class="dep-panel">

      <!-- En-tête sélecteur année + résumé -->
      <div class="dep-budget-header">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#666;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          <span style="font-size:12px;font-weight:600;color:#444;">Année :</span>
          <select v-model="budgetAnnee" class="dep-input-sm" style="width:110px;">
            <option v-for="y in Array.from({length:6},(_,i)=>String(new Date().getFullYear()-i+1))" :key="y" :value="y">{{ y }}</option>
          </select>
        </div>
        <div class="dep-budget-kpi-row">
          <div class="dep-budget-kpi">
            <span class="dep-budget-kpi-label">Budget total prévu</span>
            <span class="dep-budget-kpi-val">{{ fmt(budgets.reduce((s,b)=>s+b.montant_prevu,0)) }}</span>
          </div>
          <div class="dep-budget-kpi">
            <span class="dep-budget-kpi-label">Total réalisé</span>
            <span class="dep-budget-kpi-val" style="color:#E30613;">{{ fmt(budgets.reduce((s,b)=>s+b.montant_reel,0)) }}</span>
          </div>
          <div class="dep-budget-kpi">
            <span class="dep-budget-kpi-label">Reste global</span>
            <span class="dep-budget-kpi-val" :style="{ color: budgets.reduce((s,b)=>s+b.restant,0) >= 0 ? '#15803d' : '#E30613' }">
              {{ fmt(Math.abs(budgets.reduce((s,b)=>s+b.restant,0))) }}
              {{ budgets.reduce((s,b)=>s+b.restant,0) >= 0 ? '' : '(dépassé)' }}
            </span>
          </div>
        </div>
        <div style="font-size:11.5px;color:#888;margin-left:auto;flex-shrink:0;">
          Cliquez sur un montant pour le modifier
        </div>
      </div>

      <div v-if="loadingBudget" class="dep-empty">Chargement…</div>
      <table v-else class="dep-table dep-budget-table">
        <thead>
          <tr>
            <th>Catégorie</th>
            <th style="text-align:right;">Budget prévu</th>
            <th style="text-align:right;">Réalisé</th>
            <th style="text-align:right;">Restant</th>
            <th style="text-align:center;width:60px;">%</th>
            <th style="width:150px;">Progression</th>
            <th style="width:36px;"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in budgets" :key="b.categorie_code"
            :class="{ 'dep-budget-row-danger': b.montant_prevu>0 && b.pct>90, 'dep-budget-row-warn': b.montant_prevu>0 && b.pct>70 && b.pct<=90 }">

            <td style="font-weight:500;color:#111;">{{ b.libelle }}</td>

            <!-- Budget éditable au clic -->
            <td style="text-align:right;">
              <span v-if="editingBudget?.code !== b.categorie_code"
                @click="canWrite && (editingBudget = { code: b.categorie_code, val: String(b.montant_prevu||'') })"
                :style="{ cursor: canWrite ? 'pointer' : 'default', textDecoration: canWrite ? 'underline dotted' : 'none', color: b.montant_prevu>0 ? '#111' : '#aaa', fontWeight: b.montant_prevu>0 ? '600' : '400' }"
                :title="canWrite ? 'Cliquer pour modifier' : ''">
                {{ b.montant_prevu > 0 ? fmt(b.montant_prevu) : '— Définir' }}
              </span>
              <span v-else style="display:inline-flex;gap:5px;align-items:center;">
                <input
                  v-model="editingBudget!.val"
                  type="number"
                  class="dep-input-sm"
                  style="width:120px;text-align:right;"
                  placeholder="Ex: 500000"
                  @keyup.enter="saveBudget(b.categorie_code)"
                  @keyup.escape="editingBudget=null"
                  autofocus
                />
                <button @click="saveBudget(b.categorie_code)" :disabled="savingBudget" style="background:#E30613;color:#fff;border:none;border-radius:4px;padding:4px 9px;font-size:12px;cursor:pointer;">✓</button>
                <button @click="editingBudget=null" style="background:#f0f0f0;border:none;border-radius:4px;padding:4px 9px;font-size:12px;cursor:pointer;">✕</button>
              </span>
            </td>

            <td style="text-align:right;font-weight:600;"
              :style="{ color: b.montant_reel > 0 ? '#E30613' : '#bbb' }">
              {{ b.montant_reel > 0 ? fmt(b.montant_reel) : '—' }}
            </td>

            <td style="text-align:right;font-weight:700;"
              :style="{ color: b.montant_prevu===0 ? '#bbb' : b.restant>=0 ? '#15803d' : '#E30613' }">
              {{ b.montant_prevu===0 ? '—' : (b.restant >= 0 ? fmt(b.restant) : '−' + fmt(Math.abs(b.restant))) }}
            </td>

            <td style="text-align:center;">
              <span v-if="b.montant_prevu > 0"
                style="font-size:12px;font-weight:700;padding:2px 7px;border-radius:10px;"
                :style="{
                  background: b.pct>100 ? '#fee2e2' : b.pct>90 ? '#fff0f0' : b.pct>70 ? '#fff7ed' : '#f0fdf4',
                  color:      b.pct>90  ? '#E30613'  : b.pct>70 ? '#b45309' : '#15803d'
                }">
                {{ Math.round(b.pct) }}&nbsp;%
              </span>
              <span v-else style="color:#ddd;font-size:11px;">—</span>
            </td>

            <td style="padding-right:14px;">
              <div v-if="b.montant_prevu > 0" style="height:8px;background:#f0f0f0;border-radius:5px;overflow:hidden;">
                <div style="height:100%;border-radius:5px;transition:width 0.5s;"
                  :style="{
                    width: Math.min(b.pct, 100).toFixed(1) + '%',
                    background: b.pct>100 ? '#E30613' : b.pct>90 ? '#E30613' : b.pct>70 ? '#f97316' : '#22c55e'
                  }" />
              </div>
            </td>

            <td>
              <button v-if="b.budget_id && canWrite" @click="resetBudget(b)" class="dep-btn-icon" title="Supprimer ce budget" style="color:#aaa;font-size:13px;">🗑</button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Légende -->
      <div style="display:flex;gap:16px;margin-top:14px;padding-top:12px;border-top:1px solid #f0f0f0;flex-wrap:wrap;">
        <span style="font-size:11px;color:#15803d;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;"></span> &lt; 70 % — Normal</span>
        <span style="font-size:11px;color:#b45309;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;background:#f97316;border-radius:2px;"></span> 70–90 % — Attention</span>
        <span style="font-size:11px;color:#E30613;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;background:#E30613;border-radius:2px;"></span> &gt; 90 % — Alerte</span>
      </div>
    </div>

    <!-- ══════════ CLÔTURES MENSUELLES ══════════ -->
    <div v-if="activeTab==='clotures'" class="dep-panel">

      <!-- Info banner -->
      <div class="dep-cloture-banner">
        🔒 <strong>Clôture mensuelle</strong> — Verrouiller une période interdit toute création, modification ou suppression de dépenses sur ce mois. Seul le DG peut déverrouiller.
      </div>

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
        <div style="font-size:12.5px;font-weight:600;color:#555;">
          {{ clotures.length }} période{{ clotures.length !== 1 ? 's' : '' }} verrouillée{{ clotures.length !== 1 ? 's' : '' }}
        </div>
        <button v-if="canValidate" @click="showClotureModal=true;formCloture={periode:new Date().toISOString().slice(0,7),notes:''}" class="dep-btn-add">
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          Clôturer un mois
        </button>
      </div>

      <div v-if="loadingClotures" class="dep-empty">Chargement…</div>
      <div v-else-if="clotures.length === 0" class="dep-empty">Aucune période clôturée</div>
      <table v-else class="dep-table">
        <thead>
          <tr>
            <th>Période</th>
            <th>Clôturé par</th>
            <th>Date clôture</th>
            <th>Notes</th>
            <th v-if="canValidate"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in clotures" :key="c.id">
            <td style="font-weight:700;color:#111;font-size:13px;">🔒 {{ c.periode }}</td>
            <td style="color:#555;font-size:12.5px;">{{ c.par_user ?? '—' }}</td>
            <td style="font-size:11.5px;color:#888;">{{ fmtDate(c.cloture_at) }}</td>
            <td style="font-size:12px;color:#666;">{{ c.notes ?? '—' }}</td>
            <td v-if="canValidate">
              <button @click="unlockCloture(c)" style="padding:4px 12px;border:1.5px solid #fca5a5;background:#fff0f0;border-radius:4px;font-family:'Poppins',sans-serif;font-size:11.5px;color:#b91c1c;cursor:pointer;">
                🔓 Déverrouiller
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ══════════ MODAL CLÔTURE ══════════ -->
    <UcModal v-model="showClotureModal" title="Clôturer un mois" width="420px" @close="showClotureModal=false">
      <form @submit.prevent="saveCloture" style="display:flex;flex-direction:column;gap:14px;">
        <UcFormGroup label="Période à clôturer (YYYY-MM)" :required="true">
          <input v-model="formCloture.periode" type="month" required />
        </UcFormGroup>
        <UcFormGroup label="Notes (optionnel)">
          <textarea v-model="formCloture.notes" rows="2" style="resize:none;" placeholder="Ex : Clôture fin de mois janvier 2026"></textarea>
        </UcFormGroup>
        <div class="dep-cloture-banner" style="margin:0;">
          ⚠ Cette action bloquera toute modification de dépense sur ce mois. Vous pourrez la révoquer si nécessaire.
        </div>
      </form>
      <template #footer>
        <button @click="showClotureModal=false" class="dep-btn-cancel">Annuler</button>
        <button @click="saveCloture" :disabled="savingCloture || !formCloture.periode" class="dep-btn-save">
          {{ savingCloture ? 'Clôture…' : '🔒 Clôturer' }}
        </button>
      </template>
    </UcModal>

    <!-- ══════════ MODAL MODIFIER DÉPENSE ══════════ -->
    <UcModal v-model="showEditDepModal" title="Modifier la dépense" width="500px" @close="showEditDepModal=false">
      <form @submit.prevent="saveEditDep" style="display:flex;flex-direction:column;gap:14px;">
        <UcFormGroup label="Libellé" :required="true">
          <input v-model="formEditDep.libelle" required placeholder="Ex : Fournitures bureau" />
        </UcFormGroup>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Montant (F CFA)" :required="true">
            <input v-model="formEditDep.montant" type="text" required placeholder="Ex : 40000" />
          </UcFormGroup>
          <UcFormGroup label="Date" :required="true">
            <input v-model="formEditDep.date_depense" type="date" required />
          </UcFormGroup>
        </UcFormGrid>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Catégorie">
            <select v-model="formEditDep.categorie">
              <option v-for="c in categoriesDep" :key="c.code" :value="c.code">{{ c.libelle }}</option>
            </select>
          </UcFormGroup>
          <UcFormGroup label="Mode de paiement">
            <select v-model="formEditDep.mode_paiement">
              <option value="especes">Espèces</option>
              <option value="virement">Virement</option>
              <option value="wave">Wave</option>
              <option value="orange_money">Orange Money</option>
              <option value="cheque">Chèque</option>
              <option value="prelevement">Prélèvement</option>
            </select>
          </UcFormGroup>
        </UcFormGrid>
        <UcFormGroup label="Bénéficiaire">
          <input v-model="formEditDep.beneficiaire" placeholder="Ex : Mme Mboup" />
        </UcFormGroup>
        <UcFormGroup label="Notes">
          <textarea v-model="formEditDep.notes" rows="2" placeholder="Remarques…" style="resize:vertical;" />
        </UcFormGroup>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px;">
          <button type="button" @click="showEditDepModal=false" style="padding:8px 18px;border:1px solid #ddd;border-radius:5px;background:#fff;cursor:pointer;font-size:13px;">Annuler</button>
          <button type="submit" :disabled="savingEditDep" style="padding:8px 20px;background:#E30613;color:#fff;border:none;border-radius:5px;font-weight:600;cursor:pointer;font-size:13px;">
            {{ savingEditDep ? 'Enregistrement…' : 'Enregistrer' }}
          </button>
        </div>
      </form>
    </UcModal>

    <!-- ══════════ MODAL PERSONNEL ══════════ -->
    <UcModal v-model="showPersonnelModal" :title="editPersonnel ? 'Modifier le personnel' : 'Ajouter un membre du personnel'" width="520px" @close="showPersonnelModal=false">
      <form @submit.prevent="savePersonnel" style="display:flex;flex-direction:column;gap:14px;">
        <UcFormGrid :cols="2">
          <UcFormGroup label="Prénom" :required="true"><input v-model="formPersonnel.prenom" required /></UcFormGroup>
          <UcFormGroup label="Nom" :required="true"><input v-model="formPersonnel.nom" required /></UcFormGroup>
        </UcFormGrid>
        <UcFormGroup label="Poste / Fonction" :required="true"><input v-model="formPersonnel.poste" required placeholder="Ex : Directeur des études" /></UcFormGroup>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Type de contrat" :required="true">
            <select v-model="formPersonnel.type_contrat" required>
              <option value="CDI">CDI</option>
              <option value="CDD">CDD</option>
              <option value="Stage">Stage</option>
            </select>
          </UcFormGroup>
          <UcFormGroup label="Salaire brut (FCFA)" :required="true">
            <input v-model="formPersonnel.salaire_brut" type="number" min="0" required />
          </UcFormGroup>
        </UcFormGrid>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Date début" :required="true"><input v-model="formPersonnel.date_debut" type="date" required /></UcFormGroup>
          <UcFormGroup label="Date fin (CDD/Stage)"><input v-model="formPersonnel.date_fin" type="date" /></UcFormGroup>
        </UcFormGrid>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Statut">
            <select v-model="formPersonnel.statut">
              <option value="actif">Actif</option>
              <option value="inactif">Inactif</option>
            </select>
          </UcFormGroup>
        </UcFormGrid>
        <UcFormGroup label="Lien vers le contrat (Google Drive, Dropbox…)">
          <input v-model="formPersonnel.contrat_url" type="url" placeholder="https://drive.google.com/…" />
        </UcFormGroup>
        <UcFormGroup label="Notes"><textarea v-model="formPersonnel.notes" rows="2" style="resize:none;"></textarea></UcFormGroup>
      </form>
      <template #footer>
        <button @click="showPersonnelModal=false" class="dep-btn-cancel">Annuler</button>
        <button @click="savePersonnel" :disabled="saving||!formPersonnel.nom||!formPersonnel.poste||!formPersonnel.salaire_brut||!formPersonnel.date_debut" class="dep-btn-save">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
      </template>
    </UcModal>

    <!-- ══════════ MODAL CONTRAT ══════════ -->
    <UcModal v-model="showContratModal" :title="editContrat ? 'Modifier le contrat' : 'Nouveau contrat de prestation'" width="520px" @close="showContratModal=false">
      <form @submit.prevent="saveContrat" style="display:flex;flex-direction:column;gap:14px;">
        <UcFormGroup label="Libellé" :required="true"><input v-model="formContrat.libelle" required placeholder="Ex : Cabinet Diallo & Associés — Comptabilité" /></UcFormGroup>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Bénéficiaire" :required="true"><input v-model="formContrat.beneficiaire" required /></UcFormGroup>
          <UcFormGroup label="Montant (FCFA)" :required="true"><input v-model="formContrat.montant" type="number" min="0" required /></UcFormGroup>
        </UcFormGrid>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Périodicité">
            <select v-model="formContrat.periodicite">
              <option value="mensuelle">Mensuelle</option>
              <option value="trimestrielle">Trimestrielle</option>
              <option value="annuelle">Annuelle</option>
            </select>
          </UcFormGroup>
          <UcFormGroup label="Catégorie">
            <select v-model="formContrat.categorie">
              <option v-for="c in categoriesDep.filter(x=>x.actif)" :key="c.code" :value="c.code">{{ c.libelle }}</option>
            </select>
            <div v-if="categoriesDep.find(c=>c.code===formContrat.categorie)?.description"
              style="margin-top:6px;background:#fafafa;border:1px solid #f0f0f0;border-radius:5px;padding:8px 10px;font-size:11.5px;color:#666;white-space:pre-line;line-height:1.6;">
              {{ categoriesDep.find(c=>c.code===formContrat.categorie)?.description }}
            </div>
          </UcFormGroup>
        </UcFormGrid>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Date début" :required="true"><input v-model="formContrat.date_debut" type="date" required /></UcFormGroup>
          <UcFormGroup label="Date fin (optionnel)"><input v-model="formContrat.date_fin" type="date" /></UcFormGroup>
        </UcFormGrid>
        <UcFormGroup label="Statut">
          <select v-model="formContrat.statut">
            <option value="actif">Actif</option>
            <option value="suspendu">Suspendu</option>
            <option value="termine">Terminé</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Lien vers le contrat (Google Drive, Dropbox…)">
          <input v-model="formContrat.contrat_url" type="url" placeholder="https://drive.google.com/…" />
        </UcFormGroup>
        <UcFormGroup label="Description"><textarea v-model="formContrat.description" rows="2" style="resize:none;" placeholder="Détails du contrat…"></textarea></UcFormGroup>
      </form>
      <template #footer>
        <button @click="showContratModal=false" class="dep-btn-cancel">Annuler</button>
        <button @click="saveContrat" :disabled="saving||!formContrat.libelle||!formContrat.beneficiaire||!formContrat.montant||!formContrat.date_debut" class="dep-btn-save">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
      </template>
    </UcModal>

    <!-- ══════════ MODAL DÉPENSE AD-HOC ══════════ -->
    <UcModal v-model="showDepenseModal" title="Nouvelle dépense" width="480px" @close="showDepenseModal=false">
      <form @submit.prevent="saveDepense" style="display:flex;flex-direction:column;gap:14px;">
        <UcDraftBanner :show="depenseDraftBanner && depenseDraft.hasDraft.value" :age-label="depenseDraft.draftAgeLabel()"
          @restore="restoreDepenseDraft" @discard="discardDepenseDraft" />
        <UcFormGroup label="Libellé" :required="true"><input v-model="formDepense.libelle" required /></UcFormGroup>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Date" :required="true"><input v-model="formDepense.date_depense" type="date" required /></UcFormGroup>
          <UcFormGroup label="Montant (FCFA)" :required="true"><input v-model="formDepense.montant" type="number" min="0" required /></UcFormGroup>
        </UcFormGrid>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Catégorie">
            <select v-model="formDepense.categorie">
              <option v-for="c in categoriesDep.filter(x=>x.actif)" :key="c.code" :value="c.code">{{ c.libelle }}</option>
            </select>
            <div v-if="categoriesDep.find(c=>c.code===formDepense.categorie)?.description"
              style="margin-top:6px;background:#fafafa;border:1px solid #f0f0f0;border-radius:5px;padding:8px 10px;font-size:11.5px;color:#666;white-space:pre-line;line-height:1.6;">
              {{ categoriesDep.find(c=>c.code===formDepense.categorie)?.description }}
            </div>
          </UcFormGroup>
          <UcFormGroup label="Mode de paiement">
            <select v-model="formDepense.mode_paiement">
              <option v-for="(label,key) in modeLabels" :key="key" :value="key">{{ label }}</option>
            </select>
          </UcFormGroup>
        </UcFormGrid>
        <UcFormGrid :cols="2">
          <UcFormGroup label="Bénéficiaire"><input v-model="formDepense.beneficiaire" /></UcFormGroup>
          <UcFormGroup label="Réf. facture"><input v-model="formDepense.reference_facture" /></UcFormGroup>
        </UcFormGrid>
        <UcFormGroup label="Notes"><textarea v-model="formDepense.notes" rows="2" style="resize:none;"></textarea></UcFormGroup>
      </form>
      <template #footer>
        <button @click="showDepenseModal=false" class="dep-btn-cancel">Annuler</button>
        <button @click="saveDepense" :disabled="saving||!formDepense.libelle||!formDepense.montant" class="dep-btn-save">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
      </template>
    </UcModal>

    <!-- ══════════ MODAL DÉTAIL DÉPENSE ══════════ -->
    <UcModal v-if="selectedDep" v-model="showDetailModal" :title="selectedDep.libelle" width="440px" @close="showDetailModal=false">
      <div style="font-size:28px;font-weight:700;color:#E30613;margin-bottom:14px;">{{ fmt(selectedDep.montant) }}</div>
      <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
        <span class="dep-cat-chip">{{ catLabels[selectedDep.categorie] ?? selectedDep.categorie }}</span>
        <span v-if="selectedDep.type_source" class="dep-source-chip">{{ sourceLabels[selectedDep.type_source] ?? selectedDep.type_source }}</span>
        <span :class="selectedDep.statut==='validee'?'dep-badge-ok':selectedDep.statut==='rejetee'?'dep-badge-off':'dep-badge-warn'">
          {{ selectedDep.statut==='validee'?'Validée':selectedDep.statut==='rejetee'?'Rejetée':'En attente' }}
        </span>
      </div>
      <UcFormGrid :cols="2" gap="10px 16px" style="font-size:12.5px;margin-bottom:12px;">
        <div><div class="dep-detail-label">Date</div><div>{{ fmtDate(selectedDep.date_depense) }}</div></div>
        <div v-if="selectedDep.mois_concerne"><div class="dep-detail-label">Mois concerné</div><div>{{ fmtMois(selectedDep.mois_concerne) }}</div></div>
        <div v-if="selectedDep.beneficiaire"><div class="dep-detail-label">Bénéficiaire</div><div>{{ selectedDep.beneficiaire }}</div></div>
        <div v-if="selectedDep.mode_paiement"><div class="dep-detail-label">Mode</div><div>{{ modeLabels[selectedDep.mode_paiement] ?? selectedDep.mode_paiement }}</div></div>
        <div v-if="selectedDep.reference_facture"><div class="dep-detail-label">Réf. facture</div><div>{{ selectedDep.reference_facture }}</div></div>
      </UcFormGrid>
      <p v-if="selectedDep.notes" style="font-size:12px;color:#666;background:#f9f9f9;border-radius:4px;padding:10px;margin-bottom:12px;">{{ selectedDep.notes }}</p>
      <p v-if="selectedDep.motif_rejet" style="font-size:12px;color:#b91c1c;background:#fff0f0;border-radius:4px;padding:10px;">Motif rejet : {{ selectedDep.motif_rejet }}</p>
      <template #footer>
        <button @click="showDetailModal=false" class="dep-btn-cancel">Fermer</button>
        <button v-if="canValidate"
          @click="supprimerDepense(selectedDep!)"
          style="background:#fff;color:#b91c1c;border:1px solid #fca5a5;border-radius:4px;padding:9px 18px;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;margin-right:auto;">
          🗑 Supprimer
        </button>
        <button @click="genererRecuPaiement(selectedDep!)"
          style="background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;border-radius:4px;padding:9px 18px;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;">
          📄 Reçu PDF
        </button>
        <template v-if="canValidate && selectedDep.statut==='en_attente'">
          <button @click="rejeter(selectedDep!)" style="background:#111;color:#fff;border:none;border-radius:4px;padding:9px 18px;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;">Rejeter</button>
          <button @click="valider(selectedDep!)" style="background:#E30613;color:#fff;border:none;border-radius:4px;padding:9px 18px;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;">Valider</button>
        </template>
      </template>
    </UcModal>

    <!-- ══════════ MODAL CHOIX MOIS (bulletin / reçu prestation) ══════════ -->
    <UcModal v-model="showMoisModal" :title="moisModalType==='salaire' ? '📄 Bulletin de salaire' : '📄 Reçu de prestation'" width="360px" @close="showMoisModal=false">
      <div style="font-size:13px;color:#444;margin-bottom:16px;">
        <span v-if="moisModalType==='salaire' && moisModalItem">
          Générer le bulletin de <strong>{{ (moisModalItem as any).prenom }} {{ (moisModalItem as any).nom }}</strong>
        </span>
        <span v-else-if="moisModalItem">
          Générer le reçu pour <strong>{{ (moisModalItem as any).beneficiaire }}</strong>
        </span>
      </div>
      <UcFormGroup label="Mois concerné">
        <input v-model="moisModalCible" type="month" class="uc-input" />
      </UcFormGroup>
      <div v-if="moisModalType==='salaire' && moisModalItem" style="margin-top:10px;background:#f8fafc;border-radius:6px;padding:10px 14px;font-size:12.5px;color:#334155;">
        <div>Salarié : <strong>{{ (moisModalItem as any).prenom }} {{ (moisModalItem as any).nom }}</strong></div>
        <div style="margin-top:4px;">Poste : {{ (moisModalItem as any).poste }}</div>
        <div style="margin-top:4px;color:#E30613;font-weight:700;">Net à payer : {{ fmt((moisModalItem as any).salaire_brut) }}</div>
      </div>
      <div v-else-if="moisModalItem" style="margin-top:10px;background:#f8fafc;border-radius:6px;padding:10px 14px;font-size:12.5px;color:#334155;">
        <div>Prestataire : <strong>{{ (moisModalItem as any).beneficiaire }}</strong></div>
        <div style="margin-top:4px;">{{ (moisModalItem as any).libelle }}</div>
        <div style="margin-top:4px;color:#E30613;font-weight:700;">Montant : {{ fmt((moisModalItem as any).montant) }}</div>
      </div>
      <template #footer>
        <button @click="showMoisModal=false" class="dep-btn-cancel">Annuler</button>
        <button @click="confirmMoisModal"
          style="background:#E30613;color:#fff;border:none;border-radius:4px;padding:9px 20px;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;">
          📄 Générer PDF
        </button>
      </template>
    </UcModal>

    <!-- ══════════ MODAL RÉSULTAT IMPORT CSV ══════════ -->
    <UcModal v-if="importResult" v-model="showImportModal" title="Résultat de l'import CSV" width="500px" @close="showImportModal=false">
      <!-- Résumé -->
      <div style="display:flex;gap:12px;margin-bottom:18px;">
        <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:14px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#15803d;">{{ importResult.created }}</div>
          <div style="font-size:11.5px;font-weight:600;color:#166534;margin-top:2px;">Dépense{{ importResult.created !== 1 ? 's' : '' }} importée{{ importResult.created !== 1 ? 's' : '' }}</div>
        </div>
        <div v-if="importResult.errors > 0" style="flex:1;background:#fff7f7;border:1px solid #fecaca;border-radius:6px;padding:14px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#dc2626;">{{ importResult.errors }}</div>
          <div style="font-size:11.5px;font-weight:600;color:#b91c1c;margin-top:2px;">Ligne{{ importResult.errors !== 1 ? 's' : '' }} ignorée{{ importResult.errors !== 1 ? 's' : '' }}</div>
        </div>
        <div v-if="importResult.errors === 0" style="flex:1;background:#f9f9f9;border:1px solid #e5e5e5;border-radius:6px;padding:14px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#16a34a;">✓</div>
          <div style="font-size:11.5px;font-weight:600;color:#166534;margin-top:2px;">Aucune erreur</div>
        </div>
      </div>
      <!-- Message général -->
      <p style="font-size:12.5px;color:#555;margin-bottom:14px;">{{ importResult.message }}</p>
      <!-- Détail des erreurs -->
      <div v-if="importResult.details_erreurs?.length" style="background:#fff7f7;border:1px solid #fecaca;border-radius:6px;padding:12px 14px;max-height:220px;overflow-y:auto;">
        <div style="font-size:11.5px;font-weight:700;color:#b91c1c;margin-bottom:8px;">Détail des erreurs :</div>
        <div v-for="err in importResult.details_erreurs" :key="err.ligne"
          style="font-size:11.5px;color:#7f1d1d;padding:4px 0;border-bottom:1px solid #fecaca;last:border-none;">
          <span style="font-weight:700;background:#fca5a5;border-radius:3px;padding:1px 6px;margin-right:8px;color:#7f1d1d;">Ligne {{ err.ligne }}</span>
          {{ err.erreur }}
        </div>
      </div>
      <template #footer>
        <button @click="showImportModal=false" class="dep-btn-save">Fermer</button>
      </template>
    </UcModal>

  </div>
</template>

<style scoped>
/* ── Budget ────────────────────────────────────────────────────────── */
.dep-budget-header {
  display:flex; align-items:center; gap:16px; flex-wrap:wrap;
  background:#fff; border:1.5px solid #e5e5e5; border-radius:7px;
  padding:12px 16px; margin-bottom:14px; box-shadow:0 1px 4px rgba(0,0,0,0.04);
}
.dep-budget-kpi-row { display:flex; gap:20px; flex-wrap:wrap; }
.dep-budget-kpi     { display:flex; flex-direction:column; gap:2px; }
.dep-budget-kpi-label { font-size:10.5px; color:#888; font-weight:500; }
.dep-budget-kpi-val   { font-size:13.5px; font-weight:700; color:#111; }
.dep-budget-table tr.dep-budget-row-danger { background:#fff5f5; }
.dep-budget-table tr.dep-budget-row-warn   { background:#fffbeb; }

/* ── En-têtes triables ────────────────────────────────────────────────── */
.dep-th-sort {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: color 0.15s, background 0.15s;
}
.dep-th-sort:hover { color: #E30613; background: #fff5f5; }
.dep-th-sort.active { color: #E30613; }
.dep-sort-icon { font-size: 10px; opacity: 0.5; margin-left: 3px; }
.dep-th-sort.active .dep-sort-icon { opacity: 1; }

/* ── Barre période ────────────────────────────────────────────────────── */
.dep-periode-bar {
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  background:#fff; border:1.5px solid #e5e5e5; border-radius:7px;
  padding:10px 16px; margin-bottom:14px;
  box-shadow:0 1px 4px rgba(0,0,0,0.04);
}
.dep-periode-modes { display:flex; background:#f5f5f5; border-radius:5px; padding:2px; gap:2px; }
.dep-periode-mode {
  padding:5px 12px; border:none; border-radius:4px; background:transparent;
  font-family:'Poppins',sans-serif; font-size:11.5px; font-weight:600; color:#888;
  cursor:pointer; transition:all 0.15s; white-space:nowrap;
}
.dep-periode-mode.active { background:#fff; color:#E30613; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
.dep-periode-mode:hover:not(.active) { color:#333; }
.dep-periode-label {
  display:inline-flex; align-items:center; gap:4px;
  font-size:11.5px; font-weight:700; color:#16a34a;
  background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px;
  padding:4px 10px; margin-left:auto;
}

/* ── Layout ───────────────────────────────────────────────────────────── */
.dep-kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
@media(max-width:900px){ .dep-kpi-row{ grid-template-columns:repeat(2,1fr); } }

.dep-kpi {
  background:#fff; border-radius:6px; padding:16px 18px;
  box-shadow:0 2px 8px rgba(0,0,0,0.05);
  border-left: 3px solid #e5e5e5;
}
.dep-kpi-accent { border-left-color: #E30613; }
.dep-kpi-label { font-size:11px; font-weight:600; color:#888; text-transform:uppercase; letter-spacing:0.4px; margin-bottom:6px; }
.dep-kpi-val   { font-size:22px; font-weight:700; color:#111; margin-bottom:4px; }
.dep-kpi-sub   { font-size:11px; color:#aaa; }

/* ── Tabs ─────────────────────────────────────────────────────────────── */
.dep-tabs-bar {
  display:flex; gap:0; border-bottom:2px solid #f0f0f0; margin-bottom:16px;
}
.dep-tab {
  display:flex; align-items:center; gap:7px;
  padding:10px 20px; font-family:'Poppins',sans-serif; font-size:12.5px;
  font-weight:600; color:#888; background:transparent; border:none; cursor:pointer;
  border-bottom:2px solid transparent; margin-bottom:-2px; transition:all 0.15s;
}
.dep-tab:hover { color:#111; }
.dep-tab.active { color:#E30613; border-bottom-color:#E30613; }
.dep-tab-badge {
  background:#f0f0f0; color:#666; font-size:10px; font-weight:700;
  padding:2px 6px; border-radius:10px;
}
.dep-tab.active .dep-tab-badge { background:#fdecea; color:#E30613; }

/* ── Sous-onglets ─────────────────────────────────────────────────────── */
.dep-subtabs {
  display:flex; gap:4px; margin-bottom:14px;
  border-bottom:1px solid #f0f0f0; padding-bottom:0;
}
.dep-subtab {
  padding:7px 16px; font-family:'Poppins',sans-serif; font-size:12px;
  font-weight:500; color:#888; background:transparent; border:none; cursor:pointer;
  border-bottom:2px solid transparent; margin-bottom:-1px; transition:all 0.15s;
}
.dep-subtab:hover { color:#111; }
.dep-subtab.active { color:#111; border-bottom-color:#111; font-weight:600; }

/* ── Panel ────────────────────────────────────────────────────────────── */
.dep-panel {
  background:#fff; border-radius:6px;
  box-shadow:0 2px 8px rgba(0,0,0,0.05); padding:20px;
}

/* ── Barre génération ─────────────────────────────────────────────────── */
.dep-gen-bar {
  display:flex; align-items:center; gap:12px; padding:14px 16px;
  background:#fafafa; border:1px solid #f0f0f0; border-radius:5px;
  margin-bottom:16px; flex-wrap:wrap;
}
.dep-btn-gen {
  display:flex; align-items:center; gap:7px;
  padding:8px 18px; background:#111; color:#fff;
  border:none; border-radius:4px; font-family:'Poppins',sans-serif;
  font-size:12.5px; font-weight:600; cursor:pointer; white-space:nowrap;
  transition:background 0.15s;
}
.dep-btn-gen:hover:not(:disabled) { background:#333; }
.dep-btn-gen:disabled { opacity:0.5; cursor:not-allowed; }

/* ── En-tête sous-section ─────────────────────────────────────────────── */
.dep-subtab-header {
  display:flex; justify-content:space-between; align-items:center;
  margin-bottom:12px;
}
.dep-btn-add {
  display:flex; align-items:center; gap:6px;
  padding:6px 14px; background:#E30613; color:#fff;
  border:none; border-radius:4px; font-family:'Poppins',sans-serif;
  font-size:12px; font-weight:600; cursor:pointer; transition:background 0.15s;
}
.dep-btn-add:hover { background:#c0050f; }

/* ── Table ────────────────────────────────────────────────────────────── */
.dep-table { width:100%; border-collapse:collapse; font-family:'Poppins',sans-serif; }
.dep-table th {
  font-size:10.5px; font-weight:700; color:#aaa; text-transform:uppercase;
  letter-spacing:0.4px; padding:8px 12px; border-bottom:1px solid #f0f0f0;
  text-align:left;
}
.dep-table td {
  padding:10px 12px; font-size:12.5px; color:#333;
  border-bottom:1px solid #f9f9f9;
}
.dep-table tbody tr:hover { background:#fafafa; }

/* ── Badges ───────────────────────────────────────────────────────────── */
.dep-badge-ok   { display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600;background:#f0fdf4;color:#15803d; }
.dep-badge-warn { display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600;background:#fefce8;color:#854d0e; }
.dep-badge-off  { display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600;background:#fff0f0;color:#b91c1c; }

.dep-contract-badge { padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:700; }
.dep-cat-chip    { display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;font-size:10.5px;font-weight:600;background:#f5f5f5;color:#444; }
.dep-contrat-link { display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#E30613;text-decoration:none;padding:3px 8px;border:1px solid #fca5a5;border-radius:4px;background:#fff0f0; }
.dep-contrat-link:hover { background:#ffe4e4; }
.dep-source-chip { display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;font-size:10.5px;font-weight:600;background:#fdecea;color:#E30613; }

/* ── Boutons ──────────────────────────────────────────────────────────── */
.dep-btn-voir {
  border:1.5px solid #e5e5e5; background:#fff; border-radius:4px;
  padding:4px 12px; font-family:'Poppins',sans-serif; font-size:11.5px;
  color:#555; cursor:pointer; transition:all 0.15s;
}
.dep-btn-voir:hover { border-color:#E30613; color:#E30613; }
.dep-btn-icon { background:none;border:none;cursor:pointer;padding:4px;font-size:13px;opacity:0.7;transition:opacity 0.15s; }
.dep-btn-icon:hover { opacity:1; }
.dep-btn-secondary {
  display:flex; align-items:center; gap:7px;
  padding:7px 16px; background:#fff; color:#111;
  border:1.5px solid #e5e5e5; border-radius:4px; font-family:'Poppins',sans-serif;
  font-size:12.5px; font-weight:600; cursor:pointer; transition:all 0.15s;
}
.dep-btn-secondary:hover { border-color:#111; }
.dep-btn-cancel {
  border:1.5px solid #e5e5e5; background:#fff; border-radius:4px;
  padding:9px 18px; font-family:'Poppins',sans-serif; font-size:12.5px;
  font-weight:600; color:#555; cursor:pointer; transition:all 0.15s;
}
.dep-btn-cancel:hover { border-color:#111; color:#111; }
.dep-btn-save {
  background:#E30613; color:#fff; border:none; border-radius:4px;
  padding:9px 18px; font-family:'Poppins',sans-serif; font-size:12.5px;
  font-weight:600; cursor:pointer; transition:background 0.15s;
}
.dep-btn-save:hover:not(:disabled) { background:#c0050f; }
.dep-btn-save:disabled { opacity:0.5; cursor:not-allowed; }

/* ── Validation en masse ──────────────────────────────────────────────── */
.dep-masse-bar {
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  background:#fffbeb; border:1px solid #fde68a; border-radius:6px;
  padding:10px 14px; margin-bottom:12px;
}
.dep-btn-valider-masse {
  display:inline-flex; align-items:center; gap:6px;
  background:#E30613; color:#fff; border:none; border-radius:4px;
  padding:8px 16px; font-family:'Poppins',sans-serif; font-size:12px; font-weight:600;
  cursor:pointer; transition:background 0.15s;
}
.dep-btn-valider-masse:hover:not(:disabled) { background:#c00010; }
.dep-btn-valider-masse:disabled { opacity:0.6; cursor:not-allowed; }
.dep-btn-valider-tout {
  display:inline-flex; align-items:center; gap:6px;
  background:#111; color:#fff; border:none; border-radius:4px;
  padding:8px 16px; font-family:'Poppins',sans-serif; font-size:12px; font-weight:600;
  cursor:pointer; transition:background 0.15s;
}
.dep-btn-valider-tout:hover:not(:disabled) { background:#333; }
.dep-btn-valider-tout:disabled { opacity:0.6; cursor:not-allowed; }
.dep-row-selected td { background:#fff8f0 !important; }

/* ── Journal ──────────────────────────────────────────────────────────── */
.dep-journal-toolbar { display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap; }
.dep-search {
  width:100%; border:1.5px solid #e5e5e5; border-radius:4px;
  padding:8px 12px 8px 30px; font-family:'Poppins',sans-serif;
  font-size:12.5px; color:#111; outline:none; background:#fff;
  transition:border-color 0.2s;
}
.dep-search:focus { border-color:#E30613; }
.dep-select {
  border:1.5px solid #e5e5e5; border-radius:4px; padding:8px 12px;
  font-family:'Poppins',sans-serif; font-size:12px; color:#444;
  background:#fff; outline:none; cursor:pointer;
}
.dep-select:focus { border-color:#E30613; }
.dep-input-sm {
  border:1.5px solid #e5e5e5; border-radius:4px; padding:6px 10px;
  font-family:'Poppins',sans-serif; font-size:12px; outline:none;
  transition:border-color 0.2s;
}
.dep-input-sm:focus { border-color:#E30613; }

/* ── Détail modal ─────────────────────────────────────────────────────── */
.dep-detail-label { font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px; }

/* ── Empty state ──────────────────────────────────────────────────────── */
.dep-empty { padding:40px;text-align:center;font-size:12px;color:#aaa;font-style:italic; }

/* Clôtures */
.dep-cloture-banner { background:#fffbeb; border:1.5px solid #fde68a; border-radius:7px; padding:12px 16px; margin-bottom:14px; font-size:12px; color:#92400e; }

/* ═══════════════════════════════════════════════════════════
   RESPONSIVE MOBILE
   ═══════════════════════════════════════════════════════════ */
@media (max-width: 768px) {

  /* ── KPI row ──────────────────────────────────────────────── */
  .dep-kpi-row { grid-template-columns: 1fr 1fr !important; gap: 8px; }
  .dep-kpi { padding: 12px 14px; }
  .dep-kpi-val { font-size: 18px; }

  /* ── Tabs : défilement horizontal sans barre ──────────────── */
  .dep-tabs-bar {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    flex-wrap: nowrap;
  }
  .dep-tabs-bar::-webkit-scrollbar { display: none; }
  .dep-tab { flex-shrink: 0; padding: 10px 14px; font-size: 12px; }

  /* ── Sous-onglets ─────────────────────────────────────────── */
  .dep-subtabs {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    flex-wrap: nowrap;
  }
  .dep-subtabs::-webkit-scrollbar { display: none; }
  .dep-subtab { flex-shrink: 0; }

  /* ── Panel ────────────────────────────────────────────────── */
  .dep-panel { padding: 12px 10px; }

  /* ── Barre de génération ──────────────────────────────────── */
  .dep-gen-bar { flex-direction: column; align-items: stretch; gap: 8px; }
  .dep-btn-gen { width: 100%; justify-content: center; }

  /* ── En-tête sous-section ─────────────────────────────────── */
  .dep-subtab-header { flex-direction: column; align-items: stretch; gap: 8px; }
  .dep-btn-add { width: 100%; justify-content: center; }

  /* ── Tables : défilement horizontal ──────────────────────── */
  .dep-table {
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .dep-table th { padding: 7px 8px; font-size: 10px; }
  .dep-table td { padding: 8px 8px; font-size: 12px; }

  /* ── Période bar ──────────────────────────────────────────── */
  .dep-periode-bar { padding: 8px 10px; gap: 6px; }
  .dep-periode-mode { padding: 5px 9px; font-size: 11px; }
  .dep-periode-label { margin-left: 0; font-size: 11px; }

  /* ── Journal toolbar ──────────────────────────────────────── */
  .dep-journal-toolbar { flex-direction: column; align-items: stretch; gap: 6px; }

  /* ── Barre validation en masse ────────────────────────────── */
  .dep-masse-bar { flex-direction: column; align-items: stretch; gap: 6px; }
  .dep-btn-valider-masse,
  .dep-btn-valider-tout { width: 100%; justify-content: center; }

  /* ── Budget ───────────────────────────────────────────────── */
  .dep-budget-header { flex-direction: column; gap: 8px; }
  .dep-budget-kpi-row { flex-direction: column; gap: 10px; }

  /* ── Boutons page header ──────────────────────────────────── */
  .dep-btn-secondary { width: 100%; justify-content: center; }
}

@media (max-width: 480px) {
  .dep-kpi-row { grid-template-columns: 1fr !important; }
  .dep-tab { padding: 8px 10px; font-size: 11px; }
  .dep-kpi-val { font-size: 16px; }
  .dep-panel { padding: 10px 8px; }
}
</style>
