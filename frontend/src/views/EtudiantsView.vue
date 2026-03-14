<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import UcTable from '@/components/ui/UcTable.vue'

const router = useRouter()
const auth = useAuthStore()
const canWrite = computed(() => ['dg', 'secretariat'].includes(auth.user?.role ?? ''))

// ── Interfaces ────────────────────────────────────────────────────────
interface InscriptionActive {
  id: number
  statut: string
  acces_bloque: boolean
  frais_inscription: number
  mensualite: number
  frais_tenue: number
  contrat_path: string | null
  annee_academique_id: number | null
  annee_academique: { id: number; libelle: string } | null
  filiere: { id: number; nom: string; code: string } | null
  niveau_entree: { id: number; nom: string } | null
  niveau_bourse: { id: number; nom: string; pourcentage: number } | null
  classe: { id: number; nom: string } | null
}

interface Etudiant {
  id: number
  numero_etudiant: string
  nom: string
  prenom: string
  email: string
  telephone: string | null
  photo_path: string | null
  inscription_active: InscriptionActive | null
}

interface Pagination {
  data: Etudiant[]
  current_page: number
  last_page: number
  total: number
}

interface TypeFormation { id: number; nom: string; code: string }
interface Filiere {
  id: number; nom: string; code: string
  type_formation_id: number | null
  frais_inscription: number; mensualite: number; duree_mois: number | null
}
interface NiveauEntree { id: number; nom: string; code: string; est_superieur_bac: boolean; actif: boolean }
interface NiveauBourse { id: number; nom: string; pourcentage: number; applique_inscription: boolean; actif: boolean }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }

// ── Liste étudiants ──────────────────────────────────────────────────
const pagination = ref<Pagination>({ data: [], current_page: 1, last_page: 1, total: 0 })
const loading = ref(false)
const search = ref('')
const page = ref(1)

async function fetchEtudiants() {
  loading.value = true
  try {
    const { data } = await api.get('/etudiants', {
      params: { search: search.value || undefined, page: page.value },
    })
    pagination.value = data
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout>
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; fetchEtudiants() }, 350)
})
watch(page, fetchEtudiants)

// ── Statuts ───────────────────────────────────────────────────────────
const statutLabel: Record<string, string> = {
  inscrit_actif: 'Actif', pre_inscrit: 'Pré-inscrit', en_examen: 'En examen',
  diplome: 'Diplômé', abandonne: 'Abandonné', suspendu: 'Suspendu',
}
const statutClass: Record<string, string> = {
  inscrit_actif: 'bg-green-100 text-green-700',
  pre_inscrit: 'bg-amber-100 text-amber-700',
  en_examen: 'bg-blue-100 text-blue-700',
  diplome: 'bg-purple-100 text-purple-700',
  abandonne: 'bg-red-100 text-red-700',
  suspendu: 'bg-orange-100 text-orange-700',
}

// ── Données refs (formulaires) ────────────────────────────────────────
const filieres = ref<Filiere[]>([])
const niveauxEntree = ref<NiveauEntree[]>([])
const niveauxBourse = ref<NiveauBourse[]>([])
const annees = ref<AnneeAcademique[]>([])
const typesFormation = ref<TypeFormation[]>([])
const refsLoaded = ref(false)

async function loadRefs() {
  if (refsLoaded.value) return
  const [f, ne, nb, a, t] = await Promise.all([
    api.get('/filieres'),
    api.get('/niveaux-entree'),
    api.get('/niveaux-bourse'),
    api.get('/annees-academiques'),
    api.get('/types-formation'),
  ])
  filieres.value = f.data
  niveauxEntree.value = (ne.data ?? []).filter((n: NiveauEntree) => n.actif)
  niveauxBourse.value = (nb.data ?? []).filter((b: NiveauBourse) => b.actif)
  annees.value = a.data
  typesFormation.value = t.data
  refsLoaded.value = true
}

// ── Modal (popup centré) ───────────────────────────────────────────────
type PanelMode = 'inscrire' | 'edit-etudiant' | 'gerer-inscription'
const showPanel = ref(false)
const panelMode = ref<PanelMode>('inscrire')
const panelLoading = ref(false)
const panelError = ref('')
const currentStep = ref(1)   // 1 = identité, 2 = inscription, 3 = succès (mode inscrire)
const lastCreatedData = ref<{ etudiant: any; insc: any; anneeLabel: string } | null>(null)

function goToStep2() {
  if (!studentForm.value.prenom.trim() || !studentForm.value.nom.trim() || !studentForm.value.email.trim()) {
    panelError.value = 'Veuillez remplir les champs obligatoires : Prénom, Nom et Email.'
    return
  }
  panelError.value = ''
  currentStep.value = 2
}

function goToStep1() {
  panelError.value = ''
  currentStep.value = 1
}

// ── Formulaire étudiant ───────────────────────────────────────────────
const editingEtudiantId = ref<number | null>(null)
const studentForm = ref({
  prenom: '', nom: '', email: '', telephone: '',
  date_naissance: '', lieu_naissance: '', adresse: '', cni_numero: '',
  nom_parent: '', telephone_parent: '',
})

// ── Formulaire inscription ────────────────────────────────────────────
const selectedType = ref<number | null>(null)
const selectedFiliereObj = ref<Filiere | null>(null)
const inscriptionForm = ref({
  filiere_id: null as number | null,
  niveau_entree_id: null as number | null,
  niveau_bourse_id: null as number | null,
  annee_academique_id: null as number | null,
  frais_tenue: 0,
  statut: 'inscrit_actif',
})

const filteredFilieres = computed(() =>
  selectedType.value
    ? filieres.value.filter(f => f.type_formation_id === selectedType.value)
    : filieres.value
)
const fraisInscriptionPrevu = computed(() => {
  if (!selectedFiliereObj.value) return null
  let frais = selectedFiliereObj.value.frais_inscription
  const b = niveauxBourse.value.find(b => b.id === inscriptionForm.value.niveau_bourse_id)
  if (b?.applique_inscription) frais = frais * (1 - b.pourcentage / 100)
  return frais
})
const mensualitePrevu = computed(() => {
  if (!selectedFiliereObj.value) return null
  let m = selectedFiliereObj.value.mensualite
  const b = niveauxBourse.value.find(b => b.id === inscriptionForm.value.niveau_bourse_id)
  if (b) m = m * (1 - b.pourcentage / 100)
  return m
})
const selectedBourse = computed(() =>
  niveauxBourse.value.find(b => b.id === inscriptionForm.value.niveau_bourse_id) ?? null
)

function onTypeChange() {
  inscriptionForm.value.filiere_id = null
  selectedFiliereObj.value = null
}
function onFiliereChange() {
  selectedFiliereObj.value = filieres.value.find(f => f.id === inscriptionForm.value.filiere_id) ?? null
}

// ── Gestion inscription existante ─────────────────────────────────────
const currentEtudiant = ref<Etudiant | null>(null)
const currentInscription = ref<InscriptionActive | null>(null)
const updatingStatut = ref(false)
const uploadingContrat = ref(false)
const editingInscription = ref(false)
const savingInscription = ref(false)
const inscriptionEditType = ref<number | null>(null)
const inscriptionEditForm = ref({
  filiere_id: null as number | null,
  niveau_entree_id: null as number | null,
  niveau_bourse_id: null as number | null,
  annee_academique_id: null as number | null,
  frais_tenue: 0,
})
const filteredFilieresForEdit = computed(() =>
  inscriptionEditType.value
    ? filieres.value.filter(f => f.type_formation_id === inscriptionEditType.value)
    : filieres.value
)

// ── Ouverture des panels ──────────────────────────────────────────────
async function openInscrire() {
  panelMode.value = 'inscrire'
  panelError.value = ''
  currentStep.value = 1
  editingEtudiantId.value = null
  studentForm.value = { prenom: '', nom: '', email: '', telephone: '', date_naissance: '', lieu_naissance: '', adresse: '', cni_numero: '', nom_parent: '', telephone_parent: '' }
  selectedType.value = null
  selectedFiliereObj.value = null
  const anneeActive = annees.value.find(a => a.actif)
  inscriptionForm.value = {
    filiere_id: null, niveau_entree_id: null, niveau_bourse_id: null,
    annee_academique_id: anneeActive?.id ?? annees.value[0]?.id ?? null,
    frais_tenue: 0, statut: 'inscrit_actif',
  }
  await loadRefs()
  showPanel.value = true
}

function openEditEtudiant(etudiant: Etudiant) {
  panelMode.value = 'edit-etudiant'
  panelError.value = ''
  editingEtudiantId.value = etudiant.id
  studentForm.value = {
    prenom: etudiant.prenom, nom: etudiant.nom, email: etudiant.email,
    telephone: etudiant.telephone ?? '', date_naissance: '', lieu_naissance: '', adresse: '', cni_numero: '',
    nom_parent: '', telephone_parent: '',
  }
  showPanel.value = true
}

async function openGererInscription(etudiant: Etudiant) {
  panelMode.value = 'gerer-inscription'
  panelError.value = ''
  currentEtudiant.value = etudiant
  currentInscription.value = null
  showPanel.value = true
  // Charger l'inscription complète
  try {
    const { data } = await api.get('/inscriptions', { params: { etudiant_id: etudiant.id, per_page: 1 } })
    const list = data.data ?? data
    currentInscription.value = list[0] ?? null
  } catch {
    panelError.value = 'Impossible de charger l\'inscription.'
  }
}

// ── Submit ────────────────────────────────────────────────────────────
async function submitInscrire() {
  panelError.value = ''
  panelLoading.value = true
  try {
    // 1. Créer l'étudiant
    const studentPayload = Object.fromEntries(
      Object.entries(studentForm.value).filter(([, v]) => v !== '')
    )
    const { data: etudiant } = await api.post('/etudiants', studentPayload)

    // 2. Créer l'inscription
    const { data: inscription } = await api.post('/inscriptions', {
      etudiant_id: etudiant.id,
      filiere_id: inscriptionForm.value.filiere_id,
      niveau_entree_id: inscriptionForm.value.niveau_entree_id,
      niveau_bourse_id: inscriptionForm.value.niveau_bourse_id || null,
      annee_academique_id: inscriptionForm.value.annee_academique_id,
      frais_tenue: inscriptionForm.value.frais_tenue || 0,
      statut: inscriptionForm.value.statut,
    })

    // 3. Stocker les données pour la fiche + passer à l'étape succès
    lastCreatedData.value = {
      etudiant: { ...studentForm.value, ...etudiant },
      insc: {
        ...inscription,
        filiere: selectedFiliereObj.value ? { nom: selectedFiliereObj.value.nom } : inscription?.filiere,
        niveau_entree: niveauxEntree.value.find(n => n.id === inscriptionForm.value.niveau_entree_id) ?? inscription?.niveau_entree,
        niveau_bourse: niveauxBourse.value.find(b => b.id === inscriptionForm.value.niveau_bourse_id) ?? null,
        frais_inscription: fraisInscriptionPrevu.value ?? inscription?.frais_inscription,
        mensualite: mensualitePrevu.value ?? inscription?.mensualite,
        frais_tenue: inscriptionForm.value.frais_tenue || 0,
        statut: inscriptionForm.value.statut,
      },
      anneeLabel: annees.value.find(a => a.id === inscriptionForm.value.annee_academique_id)?.libelle ?? '',
    }
    currentStep.value = 3
    fetchEtudiants()
  } catch (err: any) {
    const errs = err.response?.data?.errors as Record<string, string[]> | undefined
    panelError.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? err.response?.data?.message ?? 'Une erreur est survenue.'
  } finally {
    panelLoading.value = false
  }
}

async function submitEditEtudiant() {
  if (!editingEtudiantId.value) return
  panelError.value = ''
  panelLoading.value = true
  try {
    const payload = Object.fromEntries(
      Object.entries(studentForm.value).filter(([, v]) => v !== '')
    )
    await api.put(`/etudiants/${editingEtudiantId.value}`, payload)
    showPanel.value = false
    fetchEtudiants()
  } catch (err: any) {
    const errs = err.response?.data?.errors as Record<string, string[]> | undefined
    panelError.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? err.response?.data?.message ?? 'Une erreur est survenue.'
  } finally {
    panelLoading.value = false
  }
}

async function changerStatut(statut: string) {
  if (!currentInscription.value) return
  updatingStatut.value = true
  try {
    await api.put(`/inscriptions/${currentInscription.value.id}/statut`, { statut })
    currentInscription.value.statut = statut
    fetchEtudiants()
  } catch (err: any) {
    panelError.value = err.response?.data?.message ?? 'Erreur lors du changement de statut.'
  } finally {
    updatingStatut.value = false
  }
}

async function validerInscription() {
  if (!currentInscription.value) return
  if (!confirm('Confirmer la validation du dossier ? Un compte étudiant sera activé.')) return
  updatingStatut.value = true
  try {
    await api.post(`/inscriptions/${currentInscription.value.id}/valider`)
    currentInscription.value.statut = 'inscrit_actif'
    fetchEtudiants()
  } catch (err: any) {
    panelError.value = err.response?.data?.message ?? 'Erreur lors de la validation.'
  } finally {
    updatingStatut.value = false
  }
}

async function onUploadContrat(event: Event) {
  if (!currentInscription.value) return
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploadingContrat.value = true
  try {
    const fd = new FormData()
    fd.append('contrat', file)
    await api.post(`/inscriptions/${currentInscription.value.id}/contrat`, fd)
    currentInscription.value.statut = 'en_examen'
    currentInscription.value.contrat_path = 'uploaded'
    fetchEtudiants()
  } catch (err: any) {
    panelError.value = err.response?.data?.message ?? 'Erreur lors de l\'upload.'
  } finally {
    uploadingContrat.value = false
    ;(event.target as HTMLInputElement).value = ''
  }
}

function openEditInscription() {
  if (!currentInscription.value) return
  const insc = currentInscription.value
  // Trouver le type de formation depuis la filière
  const f = filieres.value.find(f => f.id === insc.filiere?.id)
  inscriptionEditType.value = f?.type_formation_id ?? null
  inscriptionEditForm.value = {
    filiere_id: insc.filiere?.id ?? null,
    niveau_entree_id: insc.niveau_entree?.id ?? null,
    niveau_bourse_id: insc.niveau_bourse?.id ?? null,
    annee_academique_id: insc.annee_academique?.id ?? insc.annee_academique_id ?? null,
    frais_tenue: insc.frais_tenue ?? 0,
  }
  editingInscription.value = true
}

async function submitEditInscription() {
  if (!currentInscription.value) return
  savingInscription.value = true
  panelError.value = ''
  try {
    const { data } = await api.put(`/inscriptions/${currentInscription.value.id}`, inscriptionEditForm.value)
    currentInscription.value = {
      ...currentInscription.value,
      filiere: data.filiere,
      niveau_entree: data.niveau_entree,
      niveau_bourse: data.niveau_bourse,
      frais_inscription: data.frais_inscription,
      mensualite: data.mensualite,
    }
    editingInscription.value = false
    fetchEtudiants()
  } catch (err: any) {
    const errs = err.response?.data?.errors as Record<string, string[]> | undefined
    panelError.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? err.response?.data?.message ?? 'Erreur lors de la modification.'
  } finally {
    savingInscription.value = false
  }
}

function formatAmount(n: number | null) {
  if (n == null) return '—'
  return new Intl.NumberFormat('fr-FR').format(n) + ' FCFA'
}

// ── Fiche d'inscription ───────────────────────────────────────────────
function printFiche(etd: any, insc: any, anneeLabel?: string) {
  const fmt = (n: number | null | undefined) =>
    n != null ? new Intl.NumberFormat('fr-FR').format(n) + ' FCFA' : '—'
  const val = (v: any) => v || '—'
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) }
    catch { return d }
  }
  const filiere = insc?.filiere?.nom ?? '—'
  const niveau = insc?.niveau_entree?.nom ?? '—'
  const bourse = insc?.niveau_bourse?.nom
    ? `${insc.niveau_bourse.nom} (${insc.niveau_bourse.pourcentage}%)`
    : 'Aucune'
  const annee = anneeLabel ?? insc?.annee_academique?.libelle ?? '—'
  const sLabel = (statutLabel as Record<string, string>)[insc?.statut] ?? insc?.statut ?? '—'
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const dots = '◦ '.repeat(80)

  const html = `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"/>
<title>Fiche d'inscription — ${etd.prenom} ${etd.nom}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:11.5px;color:#111;background:#fff;padding:6mm 15mm}
@page{size:A4 portrait;margin:0}
@media print{body{padding:6mm 15mm}}

/* ── En-tête ── */
.hdr{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:4px;gap:0}
.hdr img{width:113px;height:113px;object-fit:contain;display:block;margin-bottom:-18px}
.hdr-info{text-align:center;line-height:1.4}
.hdr-info h1{font-size:28px;font-weight:900;color:#E30613;letter-spacing:3px;margin-bottom:0}
.hdr-info .tagline{font-size:10px;font-weight:700;color:#111;margin-bottom:1px}
.hdr-info .meta{font-size:9px;color:#333;line-height:1.4;margin-bottom:1px}
.hdr-info .agree{font-size:8.5px;color:#333;font-weight:700;text-decoration:underline}
.dots{font-size:8px;color:#E30613;letter-spacing:1px;overflow:hidden;white-space:nowrap;margin:8px 0 16px;opacity:.7}

/* ── Titre fiche ── */
.fiche-title{text-align:center;margin-bottom:18px}
.fiche-title h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:2px;border:2px solid #111;display:inline-block;padding:6px 24px}
.fiche-title .meta-row{font-size:10px;color:#555;margin-top:6px;display:flex;justify-content:center;gap:24px}
.fiche-title .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;background:#dcfce7;color:#166534;border:1px solid #bbf7d0}

/* ── Sections ── */
.sec{margin-bottom:14px}
.sec-title{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#fff;background:#E30613;padding:4px 10px;margin-bottom:0}
table{width:100%;border-collapse:collapse}
td{padding:5px 9px;border:1px solid #ccc;vertical-align:middle;font-size:11px}
td.lbl{font-weight:700;color:#444;width:32%;background:#f5f5f5;white-space:nowrap}
td.lbl2{font-weight:700;color:#444;width:18%;background:#f5f5f5;white-space:nowrap}

/* ── Financier ── */
.fin-wrap{display:flex;gap:16px}
.fin-wrap table{flex:1}
.fin-tbl td:last-child{text-align:right;font-weight:600}

/* ── Signatures ── */
.sign-row{display:flex;gap:16px;margin-top:24px}
.sign-box{flex:1;border:1px solid #ccc;padding:12px 14px;min-height:90px}
.sign-box h4{font-size:9.5px;font-weight:700;text-transform:uppercase;color:#555;margin-bottom:50px;border-bottom:1px dashed #ddd;padding-bottom:6px}
.sign-box .sign-line{border-top:1px solid #bbb;padding-top:4px;font-size:9px;color:#aaa;text-align:center}

/* ── Pied de page ── */
.mention{margin-top:16px;font-size:8.5px;color:#777;text-align:center;font-style:italic}
.footer-bar{margin-top:10px;border-top:2px solid #E30613;padding-top:6px;font-size:9px;text-align:center;color:#333}

/* ── Page 2 : Règlement intérieur ── */
.page2{page-break-before:always;padding-top:10mm}
.ri-hdr{text-align:center;margin-bottom:16px}
.ri-hdr h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:2px;border:2px solid #E30613;display:inline-block;padding:6px 28px;color:#E30613}
.ri-hdr p{font-size:9.5px;color:#555;margin-top:5px}
.ri-art{margin-bottom:10px}
.ri-art-title{font-size:10px;font-weight:700;text-transform:uppercase;color:#fff;background:#111;padding:3px 10px;margin-bottom:5px;display:block}
.ri-art ul{margin:0;padding-left:18px;list-style:disc}
.ri-art ul li{font-size:10px;color:#222;line-height:1.6;margin-bottom:1px}
.ri-sign{margin-top:28px;border-top:2px solid #E30613;padding-top:16px}
.ri-sign-title{font-size:10px;font-weight:700;text-transform:uppercase;color:#E30613;margin-bottom:12px;text-align:center;letter-spacing:1px}
.ri-sign-text{font-size:9.5px;color:#333;text-align:center;margin-bottom:20px;font-style:italic}
.ri-sign-boxes{display:flex;gap:20px;margin-top:8px}
.ri-sign-box{flex:1;border:1px solid #ccc;padding:12px 14px}
.ri-sign-box h4{font-size:9px;font-weight:700;text-transform:uppercase;color:#555;margin-bottom:50px;border-bottom:1px dashed #ddd;padding-bottom:5px}
.ri-sign-box .sign-line{border-top:1px solid #bbb;padding-top:4px;font-size:9px;color:#aaa;text-align:center}
</style>
</head><body>

<!-- En-tête UPTECH -->
<div class="hdr">
  <img src="${logoUrl}" alt="UP'TECH"/>
  <div class="hdr-info">
    <div class="tagline">Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</div>
    <div class="meta">NINEA 006118310 &nbsp;_&nbsp; BP 50281 RP DAKAR</div>
    <div class="agree">Agréé par l'État&nbsp;: N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT</div>
  </div>
</div>
<div class="dots">${dots}</div>

<!-- Titre -->
<div class="fiche-title">
  <h2>Fiche d'Inscription</h2>
  <div class="meta-row">
    <span>Année académique&nbsp;: <strong>${annee}</strong></span>
    ${etd.numero_etudiant ? `<span>N° Étudiant&nbsp;: <strong>${etd.numero_etudiant}</strong></span>` : ''}
    <span>Statut&nbsp;: <span class="badge">${sLabel}</span></span>
    <span>Imprimé le&nbsp;: <strong>${new Date().toLocaleDateString('fr-FR')}</strong></span>
  </div>
</div>

<!-- Identité -->
<div class="sec">
  <div class="sec-title">Identité de l'étudiant(e)</div>
  <table>
    <tr><td class="lbl">Prénom</td><td>${val(etd.prenom)}</td><td class="lbl2">Nom</td><td>${val(etd.nom)}</td></tr>
    <tr><td class="lbl">Date de naissance</td><td>${fmtDate(etd.date_naissance)}</td><td class="lbl2">Lieu de naissance</td><td>${val(etd.lieu_naissance)}</td></tr>
    <tr><td class="lbl">Email</td><td>${val(etd.email)}</td><td class="lbl2">Téléphone</td><td>${val(etd.telephone)}</td></tr>
    <tr><td class="lbl">Adresse</td><td colspan="3">${val(etd.adresse)}</td></tr>
    <tr><td class="lbl">N° CNI / Passeport</td><td colspan="3">${val(etd.cni_numero)}</td></tr>
    <tr><td class="lbl">Parent / Tuteur</td><td>${val(etd.nom_parent)}</td><td class="lbl2">Tél. parent</td><td>${val(etd.telephone_parent)}</td></tr>
  </table>
</div>

<!-- Inscription -->
<div class="sec">
  <div class="sec-title">Paramètres d'inscription</div>
  <table>
    <tr><td class="lbl">Filière</td><td>${filiere}</td><td class="lbl2">Niveau d'entrée</td><td>${niveau}</td></tr>
    <tr><td class="lbl">Année académique</td><td>${annee}</td><td class="lbl2">Bourse</td><td>${bourse}</td></tr>
    <tr><td class="lbl">Classe affectée</td><td colspan="3">${insc?.classe?.nom ?? 'Pool (à affecter ultérieurement)'}</td></tr>
  </table>
</div>

<!-- Financier -->
<div class="sec">
  <div class="sec-title">Conditions financières</div>
  <table class="fin-tbl">
    <tr><td class="lbl" style="width:40%">Frais d'inscription</td><td>${fmt(insc?.frais_inscription)}</td></tr>
    <tr><td class="lbl">Mensualité</td><td>${fmt(insc?.mensualite)}</td></tr>
    ${insc?.frais_tenue ? `<tr><td class="lbl">Frais de tenue</td><td>${fmt(insc.frais_tenue)}</td></tr>` : ''}
  </table>
</div>

<!-- Signatures -->
<div class="sign-row">
  <div class="sign-box">
    <h4>Signature de l'étudiant(e)</h4>
    <div class="sign-line">Lu et approuvé — Signature</div>
  </div>
  <div class="sign-box">
    <h4>Cachet et signature de la Direction</h4>
    <div class="sign-line">Tampon + Signature</div>
  </div>
</div>

<div class="mention">En signant cette fiche, l'étudiant(e) reconnaît avoir pris connaissance du règlement intérieur de l'établissement et s'engage à respecter ses obligations académiques et financières.</div>
<div class="footer-bar">Amitié 1, Villa n°3031 — Dakar, Sénégal &nbsp;|&nbsp; +221 77 841 50 44 / 77 618 45 52 &nbsp;|&nbsp; uptechformation.com</div>

<!-- ═══════════════════════════════════════════════
     PAGE 2 — RÈGLEMENT INTÉRIEUR
     ═══════════════════════════════════════════════ -->
<div class="page2">

  <!-- En-tête page 2 -->
  <div class="ri-hdr">
    <h2>Règlement Intérieur</h2>
    <p>UP'TECH — Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</p>
  </div>

  <!-- Art. 1 -->
  <div class="ri-art">
    <span class="ri-art-title">Article 1 — Assiduité et ponctualité</span>
    <ul>
      <li>La présence aux cours, travaux pratiques et examens est <strong>obligatoire</strong>.</li>
      <li>Tout retard ou absence doit être justifié dans les 48 heures auprès du secrétariat.</li>
      <li>Au-delà de 30 % d'absences non justifiées, l'étudiant(e) peut être exclu(e) des examens.</li>
      <li>Les retards répétés sont sanctionnés et signalés au responsable pédagogique.</li>
    </ul>
  </div>

  <!-- Art. 2 -->
  <div class="ri-art">
    <span class="ri-art-title">Article 2 — Tenue et comportement</span>
    <ul>
      <li>Une tenue correcte et décente est exigée au sein de l'établissement.</li>
      <li>Le respect mutuel entre étudiants, enseignants et personnel administratif est impératif.</li>
      <li>Tout comportement irrespectueux, violent ou discriminatoire entraîne des sanctions disciplinaires.</li>
      <li>L'usage du téléphone portable est interdit en salle de cours, sauf autorisation expresse.</li>
    </ul>
  </div>

  <!-- Art. 3 -->
  <div class="ri-art">
    <span class="ri-art-title">Article 3 — Obligations financières</span>
    <ul>
      <li>Les frais d'inscription sont dus avant le début de l'année académique.</li>
      <li>Les mensualités sont payables au plus tard le <strong>5 de chaque mois</strong>.</li>
      <li>Tout retard de paiement peut entraîner la suspension temporaire de l'accès aux cours et examens.</li>
      <li>Aucun remboursement des frais d'inscription n'est accordé après validation du dossier.</li>
    </ul>
  </div>

  <!-- Art. 4 -->
  <div class="ri-art">
    <span class="ri-art-title">Article 4 — Utilisation du matériel et des locaux</span>
    <ul>
      <li>Le matériel informatique mis à disposition doit être utilisé à des fins exclusivement pédagogiques.</li>
      <li>Tout dommage causé au matériel engage la responsabilité financière de l'étudiant(e).</li>
      <li>Il est interdit de manger, de fumer et de consommer de l'alcool dans les locaux.</li>
      <li>Les locaux doivent être laissés propres après chaque utilisation.</li>
    </ul>
  </div>

  <!-- Art. 5 -->
  <div class="ri-art">
    <span class="ri-art-title">Article 5 — Examens et évaluation</span>
    <ul>
      <li>Toute fraude lors des examens entraîne l'annulation de l'épreuve et des sanctions disciplinaires.</li>
      <li>Le plagiat dans les travaux rendus est strictement interdit et sanctionné.</li>
      <li>Les résultats sont définitifs après validation par le jury pédagogique.</li>
      <li>Les réclamations doivent être formulées par écrit dans un délai de 5 jours ouvrables.</li>
    </ul>
  </div>

  <!-- Art. 6 -->
  <div class="ri-art">
    <span class="ri-art-title">Article 6 — Sanctions disciplinaires</span>
    <ul>
      <li>Les manquements au présent règlement sont sanctionnés selon leur gravité : avertissement, blâme, suspension ou exclusion définitive.</li>
      <li>Tout recours doit être adressé par écrit à la Direction dans un délai de 5 jours.</li>
    </ul>
  </div>

  <!-- Signature engagement -->
  <div class="ri-sign">
    <div class="ri-sign-title">Engagement de l'étudiant(e)</div>
    <div class="ri-sign-text">
      Je soussigné(e) <strong>${val(etd.prenom)} ${val(etd.nom)}</strong>, inscrit(e) en <strong>${filiere}</strong> pour l'année académique <strong>${annee}</strong>,<br>
      déclare avoir lu et compris le règlement intérieur de l'établissement UP'TECH et m'engage à le respecter.<br>
      Fait à Dakar, le ___________________________
    </div>
    <div class="ri-sign-boxes">
      <div class="ri-sign-box">
        <h4>Signature de l'étudiant(e)</h4>
        <div class="sign-line">Signature précédée de la mention « Lu et approuvé »</div>
      </div>
      <div class="ri-sign-box">
        <h4>Cachet et signature de la Direction</h4>
        <div class="sign-line">Tampon + Signature</div>
      </div>
    </div>
  </div>

  <div class="footer-bar" style="margin-top:20px">UP'TECH Formation — Amitié 1, Villa n°3031, Dakar, Sénégal &nbsp;|&nbsp; +221 77 841 50 44 / 77 618 45 52</div>
</div>

<script>window.onload=()=>{window.print()}<\/script>
</body></html>`

  const w = window.open('', '_blank', 'width=820,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}

// ── Certificat d'inscription ──────────────────────────────────────────
function printCertificat(etd: any, insc: any, anneeLabel?: string) {
  const val = (v: any) => v || '—'
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) }
    catch { return d }
  }
  const filiere = insc?.filiere?.nom ?? '—'
  const niveau = insc?.niveau_entree?.nom ?? '—'
  const annee = anneeLabel ?? insc?.annee_academique?.libelle ?? '—'
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const refNum = `UPTECH/${new Date().getFullYear()}/${String(etd.id ?? Math.floor(Math.random()*9000+1000)).padStart(4,'0')}`
  const dateJour = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const dots = '◦ '.repeat(80)
  const civilite = (etd.genre === 'F' || etd.civilite === 'Mme') ? 'Madame' : 'Monsieur'

  const html = `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"/>
<title>Certificat d'inscription — ${etd.prenom} ${etd.nom}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff;padding:6mm 15mm}
@page{size:A4 portrait;margin:0}
@media print{body{padding:6mm 15mm}}

/* ── En-tête ── */
.hdr{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:4px;gap:0}
.hdr img{width:113px;height:113px;object-fit:contain;display:block;margin-bottom:-18px}
.hdr-info{text-align:center;line-height:1.4}
.hdr-info .tagline{font-size:10px;font-weight:700;color:#111;margin-bottom:1px}
.hdr-info .meta{font-size:9px;color:#333;line-height:1.4;margin-bottom:1px}
.hdr-info .agree{font-size:8.5px;color:#333;font-weight:700;text-decoration:underline}
.dots{font-size:8px;color:#E30613;letter-spacing:1px;overflow:hidden;white-space:nowrap;margin:8px 0 14px;opacity:.7}

/* ── Référence ── */
.ref-row{display:flex;justify-content:space-between;font-size:9.5px;color:#555;margin-bottom:28px}
.ref-row span strong{color:#111}

/* ── Titre ── */
.cert-title{text-align:center;margin-bottom:32px}
.cert-title h2{font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#111;border-bottom:3px solid #E30613;display:inline-block;padding-bottom:6px}
.cert-title p{font-size:10px;color:#888;margin-top:6px;letter-spacing:1px;text-transform:uppercase}

/* ── Corps ── */
.cert-body{font-size:12px;line-height:2;color:#111;text-align:justify;margin:0 10mm 28px}
.cert-body .highlight{font-weight:700;color:#111;font-size:13px}
.cert-body .underline{text-decoration:underline;font-weight:600}

/* ── Cadre info ── */
.cert-card{border:1px solid #ccc;border-left:4px solid #E30613;padding:12px 16px;margin:0 10mm 28px;background:#fafafa}
.cert-card table{width:100%;border-collapse:collapse}
.cert-card td{padding:4px 8px;font-size:11px;vertical-align:middle}
.cert-card td:first-child{font-weight:700;color:#555;width:38%;white-space:nowrap}

/* ── Usage ── */
.cert-usage{font-size:10px;color:#555;font-style:italic;text-align:center;margin:0 10mm 32px;padding:8px;border:1px dashed #ccc}

/* ── Signature ── */
.cert-sign{display:flex;justify-content:flex-end;margin:0 10mm}
.cert-sign-box{text-align:center;min-width:200px}
.cert-sign-box .sign-place{font-size:10px;color:#555;margin-bottom:4px}
.cert-sign-box .sign-name{font-size:10px;font-weight:700;color:#111;margin-bottom:2px}
.cert-sign-box .sign-title{font-size:9px;color:#888}
.cert-sign-box .sign-zone{height:60px;border-bottom:1px solid #bbb;margin:8px 0 4px}

/* ── Pied de page ── */
.footer-bar{margin-top:20px;border-top:2px solid #E30613;padding-top:6px;font-size:9px;text-align:center;color:#333}
</style>
</head><body>

<!-- En-tête -->
<div class="hdr">
  <img src="${logoUrl}" alt="UP'TECH"/>
  <div class="hdr-info">
    <div class="tagline">Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</div>
    <div class="meta">NINEA 006118310 &nbsp;_&nbsp; BP 50281 RP DAKAR</div>
    <div class="agree">Agréé par l'État&nbsp;: N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT</div>
  </div>
</div>
<div class="dots">${dots}</div>

<!-- Référence & date -->
<div class="ref-row">
  <span>Réf. : <strong>${refNum}</strong></span>
  <span>Dakar, le <strong>${dateJour}</strong></span>
</div>

<!-- Titre -->
<div class="cert-title">
  <h2>Certificat d'Inscription</h2>
  <p>Année académique ${annee}</p>
</div>

<!-- Corps du certificat -->
<div class="cert-body">
  Le Directeur Général de l'Institut Supérieur de Formation UP'TECH certifie que&nbsp;:
  <br><br>
  <span class="highlight">${civilite} ${etd.prenom?.toUpperCase()} ${etd.nom?.toUpperCase()}</span>
  ${etd.date_naissance ? `, né(e) le <span class="underline">${fmtDate(etd.date_naissance)}</span> à <span class="underline">${val(etd.lieu_naissance)}</span>,` : ''}
  ${etd.cni_numero ? `porteur/porteuse de la CNI N° <span class="underline">${etd.cni_numero}</span>,` : ''}
  <br><br>
  est régulièrement inscrit(e) dans notre établissement pour l'année académique
  <span class="underline">${annee}</span>, dans la filière ci-dessous&nbsp;:
</div>

<!-- Cadre informations -->
<div class="cert-card">
  <table>
    <tr><td>Numéro étudiant</td><td>${etd.numero_etudiant ?? '—'}</td></tr>
    <tr><td>Filière</td><td>${filiere}</td></tr>
    <tr><td>Niveau d'entrée</td><td>${niveau}</td></tr>
    <tr><td>Classe</td><td>${insc?.classe?.nom ?? 'Pool (à affecter)'}</td></tr>
    <tr><td>Statut</td><td>${(statutLabel as Record<string,string>)[insc?.statut] ?? insc?.statut ?? '—'}</td></tr>
  </table>
</div>

<!-- Mention d'usage -->
<div class="cert-usage">
  Ce certificat est délivré à l'intéressé(e) pour servir et valoir ce que de droit,
  notamment pour les démarches administratives, bancaires et auprès des autorités compétentes.
</div>

<!-- Signature direction -->
<div class="cert-sign">
  <div class="cert-sign-box">
    <div class="sign-place">Dakar, le ${dateJour}</div>
    <div class="sign-zone"></div>
    <div class="sign-name">Le Directeur Général</div>
    <div class="sign-title">UP'TECH Formation</div>
  </div>
</div>

<div class="footer-bar">UP'TECH Formation — Amitié 1, Villa n°3031, Dakar, Sénégal &nbsp;|&nbsp; +221 77 841 50 44 / 77 618 45 52 &nbsp;|&nbsp; uptechformation.com</div>

<script>window.onload=()=>{window.print()}<\/script>
</body></html>`

  const w = window.open('', '_blank', 'width=820,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}

const avatarColors = ['#E30613','#3b82f6','#7c3aed','#f97316','#0891b2','#be185d','#15803d','#92400e','#1d4ed8']
function avatarColor(prenom: string, nom: string): string {
  const idx = ((prenom.charCodeAt(0) ?? 0) + (nom.charCodeAt(0) ?? 0)) % avatarColors.length
  return avatarColors[idx] ?? '#E30613'
}

function statutBadgeClass(statut: string): string {
  const map: Record<string, string> = {
    inscrit_actif: 'uc-badge-active',
    pre_inscrit: 'uc-badge-preinsc',
    en_examen: 'uc-badge-examen',
    diplome: 'uc-badge-diplome',
    abandonne: 'uc-badge-abandon',
    suspendu: 'uc-badge-suspend',
  }
  return map[statut] ?? 'uc-badge-gray'
}

function statutDotClass(statut: string): string {
  const map: Record<string, string> = {
    inscrit_actif: 'dot-green',
    pre_inscrit: 'dot-blue',
    en_examen: 'dot-yellow',
    diplome: 'dot-purple',
    abandonne: 'dot-gray',
    suspendu: 'dot-red',
  }
  return map[statut] ?? 'dot-gray'
}

const tableCols = [
  { key: 'numero', label: 'N° Étudiant' },
  { key: 'etudiant', label: 'Étudiant' },
  { key: 'filiere', label: 'Filière / Parcours' },
  { key: 'statut', label: 'Statut' },
  { key: 'actions', label: 'Actions' },
]

onMounted(() => {
  fetchEtudiants()
  loadRefs()
})
</script>

<template>
  <div class="uc-content">

    <!-- En-tête -->
    <UcPageHeader
      title="Étudiants"
      :subtitle="`${pagination.total} étudiant${pagination.total !== 1 ? 's' : ''} au total`"
    >
      <template #actions>
        <button v-if="canWrite" @click="openInscrire" class="uc-btn-primary" style="display:flex;align-items:center;gap:6px;padding:9px 16px;font-size:12.5px;">
          <span style="font-size:16px;line-height:1;">+</span> Nouvel étudiant
        </button>
      </template>
    </UcPageHeader>

    <!-- Toolbar : Recherche -->
    <div style="display:flex;gap:10px;margin-bottom:14px;align-items:center;">
      <div style="position:relative;flex:1;min-width:200px;">
        <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#bbb;font-size:14px;">🔍</span>
        <input v-model="search" type="text" placeholder="Rechercher par nom, prénom ou N° étudiant…" class="uc-search-input" />
      </div>
    </div>

    <!-- Tableau -->
    <UcTable :cols="tableCols" :data="pagination.data" empty-text="Aucun étudiant trouvé">
      <template #row="{ item: etudiant }">
        <td class="td-num">{{ (etudiant as any).numero_etudiant }}</td>
        <td>
          <div class="student-name" style="cursor:pointer;" @click="router.push(`/etudiants/${(etudiant as any).id}`)">
            <div class="s-avatar" :style="{ background: avatarColor((etudiant as any).prenom, (etudiant as any).nom) }">
              {{ ((etudiant as any).prenom[0] ?? '') + ((etudiant as any).nom[0] ?? '') }}
            </div>
            <div class="s-name">
              <strong>{{ (etudiant as any).prenom }} {{ (etudiant as any).nom }}</strong>
              <span>{{ (etudiant as any).email }}</span>
            </div>
          </div>
        </td>
        <td @click="router.push(`/etudiants/${(etudiant as any).id}`)">
          <span v-if="(etudiant as any).inscription_active?.filiere">
            {{ (etudiant as any).inscription_active.filiere.nom }}<br>
            <span style="font-size:10.5px;color:#aaa;">{{ (etudiant as any).inscription_active.filiere.code }}</span>
          </span>
          <span v-else style="color:#aaa;">—</span>
        </td>
        <td @click="router.push(`/etudiants/${(etudiant as any).id}`)">
          <span v-if="(etudiant as any).inscription_active" class="uc-badge" :class="statutBadgeClass((etudiant as any).inscription_active.statut)">
            <span class="badge-dot" :class="statutDotClass((etudiant as any).inscription_active.statut)"></span>
            {{ statutLabel[(etudiant as any).inscription_active.statut] ?? (etudiant as any).inscription_active.statut }}
          </span>
          <span v-else class="uc-badge uc-badge-gray">Non inscrit</span>
        </td>
        <td>
          <div class="row-actions">
            <button v-if="canWrite" @click="openEditEtudiant(etudiant as any)" class="row-btn" title="Modifier">Modifier</button>
            <button v-if="canWrite && (etudiant as any).inscription_active" @click="openGererInscription(etudiant as any)" class="row-btn" title="Gérer inscription">Inscription</button>
          </div>
        </td>
      </template>
    </UcTable>

    <!-- Pagination -->
    <div v-if="pagination.last_page > 1" class="uc-pagination">
      <span class="uc-pagination-info">Page {{ pagination.current_page }} / {{ pagination.last_page }} — {{ pagination.total }} étudiants</span>
      <div class="uc-pagination-btns">
        <button :disabled="page <= 1" @click="page--" class="page-btn" :class="{ disabled: page <= 1 }">←</button>
        <button class="page-btn active">{{ page }}</button>
        <button :disabled="page >= pagination.last_page" @click="page++" class="page-btn" :class="{ disabled: page >= pagination.last_page }">→</button>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
         MODAL POPUP CENTRÉ
         ═══════════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showPanel" class="insc-overlay" @click.self="showPanel = false">
          <div class="insc-modal">

            <!-- ── Header ── -->
            <div class="insc-modal-header">
              <div>
                <h2 class="insc-modal-title">
                  <span v-if="panelMode === 'inscrire'">{{ currentStep === 3 ? 'Inscription créée' : 'Nouvel étudiant' }}</span>
                  <span v-else-if="panelMode === 'edit-etudiant'">Modifier l'étudiant</span>
                  <span v-else>Inscription — {{ currentEtudiant?.prenom }} {{ currentEtudiant?.nom }}</span>
                </h2>
                <!-- Indicateur d'étapes (mode inscrire seulement) -->
                <div v-if="panelMode === 'inscrire' && currentStep < 3" class="insc-steps">
                  <span class="insc-step" :class="{ 'insc-step--active': currentStep === 1, 'insc-step--done': currentStep > 1 }">
                    <span class="insc-step-num">{{ currentStep > 1 ? '✓' : '1' }}</span> Identité
                  </span>
                  <span class="insc-step-arrow">→</span>
                  <span class="insc-step" :class="{ 'insc-step--active': currentStep === 2 }">
                    <span class="insc-step-num">2</span> Inscription
                  </span>
                </div>
              </div>
              <button @click="showPanel = false" class="modal-close">✕</button>
            </div>

            <!-- ── Body ── -->
            <div class="insc-modal-body">
              <div v-if="panelError" class="insc-error">{{ panelError }}</div>

              <!-- ══ INSCRIRE — ÉTAPE 1 : Identité ══ -->
              <template v-if="panelMode === 'inscrire' && currentStep === 1">
                <div class="form-section-label">Informations personnelles</div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Prénom <span class="req">*</span></label>
                    <input v-model="studentForm.prenom" required type="text" placeholder="Ex : Mamadou" />
                  </div>
                  <div class="form-group">
                    <label>Nom <span class="req">*</span></label>
                    <input v-model="studentForm.nom" required type="text" placeholder="Ex : Diallo" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Email <span class="req">*</span></label>
                    <input v-model="studentForm.email" required type="email" placeholder="email@example.com" />
                  </div>
                  <div class="form-group">
                    <label>Téléphone</label>
                    <input v-model="studentForm.telephone" type="tel" placeholder="+221 77…" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Date de naissance</label>
                    <input v-model="studentForm.date_naissance" type="date" />
                  </div>
                  <div class="form-group">
                    <label>Lieu de naissance</label>
                    <input v-model="studentForm.lieu_naissance" type="text" placeholder="Dakar" />
                  </div>
                </div>
                <div class="form-row full">
                  <div class="form-group">
                    <label>Adresse</label>
                    <textarea v-model="studentForm.adresse" rows="2" style="resize:none;"></textarea>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>N° CNI</label>
                    <input v-model="studentForm.cni_numero" type="text" placeholder="1 234 567 890 12" />
                  </div>
                  <div class="form-group"></div>
                </div>
                <div class="form-section-label" style="margin-top:4px;">Contact parent / tuteur</div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Nom complet</label>
                    <input v-model="studentForm.nom_parent" type="text" placeholder="Nom complet" />
                  </div>
                  <div class="form-group">
                    <label>Téléphone</label>
                    <input v-model="studentForm.telephone_parent" type="tel" placeholder="+221 77..." />
                  </div>
                </div>
              </template>

              <!-- ══ INSCRIRE — ÉTAPE 2 : Inscription ══ -->
              <template v-else-if="panelMode === 'inscrire' && currentStep === 2">
                <div class="form-section-label">Paramètres d'inscription</div>

                <!-- Statut -->
                <div class="form-row-radio">
                  <label class="radio-card" :class="{ active: inscriptionForm.statut === 'inscrit_actif' }">
                    <input type="radio" v-model="inscriptionForm.statut" value="inscrit_actif" style="display:none;" />
                    <div class="radio-card-title">Inscrit actif</div>
                    <div class="radio-card-sub">Dossier validé</div>
                  </label>
                  <label class="radio-card" :class="{ active: inscriptionForm.statut === 'pre_inscrit', orange: true }">
                    <input type="radio" v-model="inscriptionForm.statut" value="pre_inscrit" style="display:none;" />
                    <div class="radio-card-title">Pré-inscrit</div>
                    <div class="radio-card-sub">En attente</div>
                  </label>
                </div>

                <div class="form-row">
                  <div class="form-group">
                    <label>Type de formation</label>
                    <select v-model="selectedType" @change="onTypeChange">
                      <option :value="null">— Tous les types —</option>
                      <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }} ({{ t.code }})</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Année académique <span class="req">*</span></label>
                    <select v-model="inscriptionForm.annee_academique_id" required>
                      <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}{{ a.actif ? ' (en cours)' : '' }}</option>
                    </select>
                  </div>
                </div>
                <div class="form-row full">
                  <div class="form-group">
                    <label>Filière <span class="req">*</span></label>
                    <select v-model="inscriptionForm.filiere_id" @change="onFiliereChange" required>
                      <option :value="null">— Sélectionner une filière —</option>
                      <option v-for="f in filteredFilieres" :key="f.id" :value="f.id">{{ f.nom }} ({{ f.code }})</option>
                    </select>
                    <div v-if="selectedFiliereObj" class="filiere-preview">
                      <span>Insc. : <strong>{{ new Intl.NumberFormat('fr-FR').format(selectedFiliereObj.frais_inscription) }} F</strong></span>
                      <span>Mens. : <strong>{{ new Intl.NumberFormat('fr-FR').format(selectedFiliereObj.mensualite) }} F</strong></span>
                      <span v-if="selectedFiliereObj.duree_mois">Durée : <strong>{{ selectedFiliereObj.duree_mois }} mois</strong></span>
                    </div>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Niveau d'entrée <span class="req">*</span></label>
                    <select v-model="inscriptionForm.niveau_entree_id" required>
                      <option :value="null">— Sélectionner —</option>
                      <option v-for="n in niveauxEntree" :key="n.id" :value="n.id">{{ n.nom }}</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Bourse</label>
                    <select v-model="inscriptionForm.niveau_bourse_id">
                      <option :value="null">— Aucune bourse —</option>
                      <option v-for="b in niveauxBourse" :key="b.id" :value="b.id">{{ b.nom }} ({{ b.pourcentage }}%)</option>
                    </select>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Frais de tenue (FCFA)</label>
                    <input v-model.number="inscriptionForm.frais_tenue" type="number" min="0" placeholder="0" />
                  </div>
                  <div class="form-group"></div>
                </div>

                <!-- Bourse info -->
                <div v-if="selectedBourse && selectedFiliereObj" class="bourse-info">
                  <span>Mensualité après bourse : <strong>{{ formatAmount(mensualitePrevu) }}</strong></span>
                  <span v-if="selectedBourse.applique_inscription"> — Frais insc. après bourse : <strong>{{ formatAmount(fraisInscriptionPrevu) }}</strong></span>
                </div>

                <!-- Résumé financier -->
                <div v-if="selectedFiliereObj" class="fin-recap">
                  <p class="fin-recap-title">Résumé financier</p>
                  <div class="fin-row"><span>Frais d'inscription</span><span>{{ formatAmount(fraisInscriptionPrevu) }}</span></div>
                  <div class="fin-row"><span>Mensualité</span><span>{{ formatAmount(mensualitePrevu) }}</span></div>
                  <div v-if="inscriptionForm.frais_tenue > 0" class="fin-row"><span>Tenue</span><span>{{ formatAmount(inscriptionForm.frais_tenue) }}</span></div>
                </div>
              </template>

              <!-- ══ INSCRIRE — ÉTAPE 3 : Succès ══ -->
              <template v-else-if="panelMode === 'inscrire' && currentStep === 3">
                <div style="text-align:center;padding:28px 0 16px;">
                  <div style="font-size:52px;line-height:1;">✅</div>
                  <h3 style="margin:14px 0 8px;font-size:16px;font-weight:700;color:#111;">Inscription créée avec succès !</h3>
                  <p style="color:#888;font-size:12px;margin-bottom:28px;">
                    <strong>{{ lastCreatedData?.etudiant.prenom }} {{ lastCreatedData?.etudiant.nom }}</strong>
                    a été inscrit(e).
                  </p>
                  <button
                    @click="lastCreatedData && printFiche(lastCreatedData.etudiant, lastCreatedData.insc, lastCreatedData.anneeLabel)"
                    class="uc-btn-primary"
                    style="padding:11px 24px;font-size:13px;display:inline-flex;align-items:center;gap:8px;">
                    🖨️ Imprimer la fiche d'inscription
                  </button>
                  <p style="font-size:10.5px;color:#bbb;margin-top:12px;">La fiche s'ouvre dans un nouvel onglet pour impression ou enregistrement en PDF.</p>
                </div>
              </template>

              <!-- ══ EDIT ÉTUDIANT ══ -->
              <template v-else-if="panelMode === 'edit-etudiant'">
                <div class="form-section-label">Informations personnelles</div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Prénom <span class="req">*</span></label>
                    <input v-model="studentForm.prenom" required type="text" />
                  </div>
                  <div class="form-group">
                    <label>Nom <span class="req">*</span></label>
                    <input v-model="studentForm.nom" required type="text" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Email <span class="req">*</span></label>
                    <input v-model="studentForm.email" required type="email" />
                  </div>
                  <div class="form-group">
                    <label>Téléphone</label>
                    <input v-model="studentForm.telephone" type="tel" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Date de naissance</label>
                    <input v-model="studentForm.date_naissance" type="date" />
                  </div>
                  <div class="form-group">
                    <label>Lieu de naissance</label>
                    <input v-model="studentForm.lieu_naissance" type="text" />
                  </div>
                </div>
                <div class="form-row full">
                  <div class="form-group">
                    <label>Adresse</label>
                    <textarea v-model="studentForm.adresse" rows="2" style="resize:none;"></textarea>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>N° CNI</label>
                    <input v-model="studentForm.cni_numero" type="text" />
                  </div>
                  <div class="form-group"></div>
                </div>
                <div class="form-section-label" style="margin-top:4px;">Contact parent / tuteur</div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Nom complet</label>
                    <input v-model="studentForm.nom_parent" type="text" />
                  </div>
                  <div class="form-group">
                    <label>Téléphone</label>
                    <input v-model="studentForm.telephone_parent" type="tel" />
                  </div>
                </div>
              </template>

              <!-- ══ GÉRER INSCRIPTION ══ -->
              <template v-else-if="panelMode === 'gerer-inscription'">
                <div v-if="!currentInscription" style="padding:32px;text-align:center;color:#aaa;font-size:12px;">Chargement…</div>
                <div v-else>
                  <!-- Infos inscription — lecture -->
                  <div v-if="!editingInscription" style="background:#f9f9f9;border-radius:4px;padding:14px;margin-bottom:16px;">
                    <div class="info-row"><span class="info-label">Filière</span><span class="info-value">{{ currentInscription.filiere?.nom ?? '—' }}</span></div>
                    <div class="info-row"><span class="info-label">Niveau d'entrée</span><span class="info-value">{{ currentInscription.niveau_entree?.nom ?? '—' }}</span></div>
                    <div class="info-row"><span class="info-label">Bourse</span><span class="info-value">{{ currentInscription.niveau_bourse?.nom ?? 'Aucune' }}</span></div>
                    <div class="info-row"><span class="info-label">Classe</span><span class="info-value">{{ currentInscription.classe?.nom ?? 'Pool' }}</span></div>
                    <div class="info-row" style="border-top:1px solid #e5e5e5;padding-top:8px;margin-top:4px;"><span class="info-label">Frais inscription</span><span class="info-value">{{ formatAmount(currentInscription.frais_inscription) }}</span></div>
                    <div class="info-row"><span class="info-label">Mensualité</span><span class="info-value">{{ formatAmount(currentInscription.mensualite) }}</span></div>
                    <div v-if="currentInscription.frais_tenue > 0" class="info-row"><span class="info-label">Frais de tenue</span><span class="info-value">{{ formatAmount(currentInscription.frais_tenue) }}</span></div>
                    <div v-if="canWrite" style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e5e5;">
                      <button @click="openEditInscription" class="btn-ghost" style="width:100%;">✏️ Modifier les paramètres d'inscription</button>
                    </div>
                  </div>

                  <!-- Formulaire d'édition inscription -->
                  <div v-else style="background:#fff5f5;border-radius:4px;padding:14px;margin-bottom:16px;border:1px solid #fecaca;">
                    <p style="font-size:10.5px;font-weight:700;color:#E30613;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Modifier l'inscription</p>
                    <div class="form-row full">
                      <div class="form-group">
                        <label>Type de formation</label>
                        <select v-model="inscriptionEditType" @change="inscriptionEditForm.filiere_id = null">
                          <option :value="null">— Tous les types —</option>
                          <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }}</option>
                        </select>
                      </div>
                    </div>
                    <div class="form-row full">
                      <div class="form-group">
                        <label>Filière <span class="req">*</span></label>
                        <select v-model="inscriptionEditForm.filiere_id">
                          <option :value="null" disabled>— Choisir —</option>
                          <option v-for="f in filteredFilieresForEdit" :key="f.id" :value="f.id">{{ f.nom }}</option>
                        </select>
                      </div>
                    </div>
                    <div class="form-row full">
                      <div class="form-group">
                        <label>Niveau d'entrée <span class="req">*</span></label>
                        <select v-model="inscriptionEditForm.niveau_entree_id">
                          <option :value="null" disabled>— Choisir —</option>
                          <option v-for="n in niveauxEntree" :key="n.id" :value="n.id">{{ n.nom }}</option>
                        </select>
                      </div>
                    </div>
                    <div class="form-row full">
                      <div class="form-group">
                        <label>Bourse</label>
                        <select v-model="inscriptionEditForm.niveau_bourse_id">
                          <option :value="null">Aucune bourse</option>
                          <option v-for="b in niveauxBourse" :key="b.id" :value="b.id">{{ b.nom }}</option>
                        </select>
                      </div>
                    </div>
                    <div class="form-row full">
                      <div class="form-group">
                        <label>Frais de tenue (FCFA)</label>
                        <input v-model.number="inscriptionEditForm.frais_tenue" type="number" min="0" placeholder="0" />
                      </div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:4px;">
                      <button @click="editingInscription = false" class="btn-ghost" style="flex:1;">Annuler</button>
                      <button @click="submitEditInscription" :disabled="savingInscription || !inscriptionEditForm.filiere_id || !inscriptionEditForm.niveau_entree_id"
                        class="uc-btn-primary" style="flex:1;padding:10px;font-size:12.5px;"
                        :style="{ opacity: (savingInscription || !inscriptionEditForm.filiere_id || !inscriptionEditForm.niveau_entree_id) ? '0.5' : '1' }">
                        {{ savingInscription ? 'Enregistrement…' : 'Enregistrer' }}
                      </button>
                    </div>
                  </div>

                  <!-- Documents imprimables -->
                  <div style="margin-bottom:14px;display:flex;flex-direction:column;gap:6px;">
                    <button @click="printFiche(currentEtudiant, currentInscription)" class="action-btn action-btn-ghost" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;">
                      🖨️ Fiche d'inscription
                    </button>
                    <button @click="printCertificat(currentEtudiant, currentInscription)" class="action-btn action-btn-ghost" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;">
                      📄 Certificat d'inscription
                    </button>
                  </div>

                  <!-- Statut actuel -->
                  <div style="margin-bottom:14px;">
                    <p style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Statut actuel</p>
                    <span class="uc-badge" :class="statutBadgeClass(currentInscription.statut)">
                      <span class="badge-dot" :class="statutDotClass(currentInscription.statut)"></span>
                      {{ statutLabel[currentInscription.statut] ?? currentInscription.statut }}
                    </span>
                    <span v-if="currentInscription.acces_bloque" style="margin-left:8px;font-size:11px;font-weight:600;color:#E30613;">🔒 Accès bloqué</span>
                  </div>

                  <!-- Actions selon statut -->
                  <div v-if="canWrite" style="display:flex;flex-direction:column;gap:8px;">
                    <template v-if="currentInscription.statut === 'pre_inscrit'">
                      <button @click="changerStatut('inscrit_actif')" :disabled="updatingStatut" class="action-btn action-btn-green">
                        {{ updatingStatut ? 'En cours…' : '✓ Activer l\'inscription' }}
                      </button>
                      <label class="action-btn action-btn-ghost" style="cursor:pointer;">
                        {{ uploadingContrat ? 'Upload…' : '↑ Téléverser le contrat signé (PDF)' }}
                        <input type="file" accept=".pdf" class="hidden" :disabled="uploadingContrat" @change="onUploadContrat" />
                      </label>
                    </template>
                    <button v-else-if="currentInscription.statut === 'en_examen'" @click="validerInscription" :disabled="updatingStatut" class="action-btn action-btn-green">
                      {{ updatingStatut ? 'Validation…' : '✓ Valider le dossier' }}
                    </button>
                    <div v-else-if="['inscrit_actif', 'suspendu', 'abandonne'].includes(currentInscription.statut)" class="form-group">
                      <label>Changer le statut</label>
                      <select :value="currentInscription.statut" :disabled="updatingStatut"
                        @change="changerStatut(($event.target as HTMLSelectElement).value)">
                        <option value="inscrit_actif">Actif</option>
                        <option value="suspendu">Suspendu</option>
                        <option value="abandonne">Abandonné</option>
                        <option value="diplome">Diplômé</option>
                      </select>
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <!-- ── Footer ── -->
            <div class="insc-modal-footer">
              <!-- Annuler / Fermer -->
              <button @click="showPanel = false" class="btn-ghost">
                {{ panelMode === 'gerer-inscription' ? 'Fermer' : 'Annuler' }}
              </button>

              <!-- Inscrire étape 3 → Fermer -->
              <button v-if="panelMode === 'inscrire' && currentStep === 3" @click="showPanel = false" class="uc-btn-primary" style="padding:9px 20px;">
                Fermer
              </button>

              <!-- Inscrire étape 1 → Suivant -->
              <button v-if="panelMode === 'inscrire' && currentStep === 1" @click="goToStep2" class="uc-btn-primary insc-btn-next">
                Suivant →
              </button>

              <!-- Inscrire étape 2 → Retour + Créer -->
              <template v-if="panelMode === 'inscrire' && currentStep === 2">
                <button @click="goToStep1" class="btn-ghost">← Retour</button>
                <button @click="submitInscrire" :disabled="panelLoading || !inscriptionForm.filiere_id || !inscriptionForm.niveau_entree_id"
                  class="uc-btn-primary"
                  :style="{ opacity: (panelLoading || !inscriptionForm.filiere_id || !inscriptionForm.niveau_entree_id) ? '0.55' : '1' }">
                  {{ panelLoading ? 'Création…' : 'Créer & Inscrire' }}
                </button>
              </template>

              <!-- Edit étudiant → Enregistrer -->
              <button v-if="panelMode === 'edit-etudiant'" @click="submitEditEtudiant" :disabled="panelLoading"
                class="uc-btn-primary" :style="{ opacity: panelLoading ? '0.6' : '1' }">
                {{ panelLoading ? 'Enregistrement…' : 'Enregistrer' }}
              </button>
            </div>

          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
/* ── Modal transitions ── */
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .insc-modal, .modal-fade-leave-active .insc-modal { transition: transform 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.2s; }
.modal-fade-enter-from .insc-modal, .modal-fade-leave-to .insc-modal { transform: scale(0.96); opacity: 0; }

/* ── Modal overlay / box ── */
.insc-overlay {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.45);
  padding: 16px;
}
.insc-modal {
  background: #fff; border-radius: 10px;
  width: 100%; max-width: 640px;
  max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 64px rgba(0,0,0,0.22);
  overflow: hidden;
}

/* ── Modal header ── */
.insc-modal-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 24px 14px;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}
.insc-modal-title {
  font-size: 16px; font-weight: 700; color: #111; margin: 0 0 8px;
}

/* ── Step indicator ── */
.insc-steps {
  display: flex; align-items: center; gap: 8px; margin-top: 4px;
}
.insc-step {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 600; color: #bbb;
}
.insc-step-num {
  width: 20px; height: 20px; border-radius: 50%; background: #e5e5e5; color: #888;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; flex-shrink: 0;
}
.insc-step--active { color: #E30613; }
.insc-step--active .insc-step-num { background: #E30613; color: #fff; }
.insc-step--done { color: #22c55e; }
.insc-step--done .insc-step-num { background: #22c55e; color: #fff; }
.insc-step-arrow { font-size: 12px; color: #ccc; }

/* ── Modal body (scrollable) ── */
.insc-modal-body {
  flex: 1; overflow-y: auto;
  padding: 20px 24px;
}

/* ── Modal footer ── */
.insc-modal-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
  flex-shrink: 0;
}

/* ── Error banner ── */
.insc-error {
  margin-bottom: 14px; padding: 10px 14px;
  background: #fff0f0; border-left: 3px solid #E30613;
  border-radius: 4px; font-size: 12.5px; color: #b91c1c;
}

/* ── Radio cards (statut) ── */
.form-row-radio {
  display: flex; gap: 10px; margin-bottom: 16px;
}

/* ── Filière preview ── */
.filiere-preview {
  margin-top: 6px; padding: 8px 10px;
  background: #fff5f5; border-radius: 4px;
  font-size: 11px; color: #E30613;
  display: flex; gap: 12px; flex-wrap: wrap;
}

/* ── Bourse info ── */
.bourse-info {
  margin-bottom: 12px; padding: 8px 10px;
  background: #f0fdf4; border-radius: 4px;
  font-size: 11px; color: #15803d;
}

/* ── Résumé financier ── */
.fin-recap {
  background: #f9f9f9; border-radius: 4px;
  padding: 12px; margin-top: 8px; margin-bottom: 4px;
}
.fin-recap-title {
  font-size: 10px; font-weight: 700; color: #888;
  text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
}

/* ── req asterisk ── */
.req { color: #E30613; }

/* ── Next button ── */
.insc-btn-next { min-width: 120px; justify-content: center; }

@media (max-width: 640px) {
  .insc-modal { max-height: 95vh; border-radius: 8px; }
  .insc-modal-header { padding: 16px 16px 12px; }
  .insc-modal-body { padding: 16px; }
  .insc-modal-footer { padding: 12px 16px; flex-wrap: wrap; }
  .insc-modal-footer > * { flex: 1; min-width: 0; }
  .insc-btn-next { width: 100%; }
}

/* Search input */
.uc-search-input {
  width: 100%;
  border: 1.5px solid #e5e5e5;
  border-radius: 4px;
  padding: 9px 12px 9px 35px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  color: #111;
  outline: none;
  background: #fff;
  transition: border-color 0.2s;
}
.uc-search-input:focus { border-color: #E30613; }
.uc-search-input::placeholder { color: #ccc; }

/* Student avatar */
.student-name { display: flex; align-items: center; gap: 9px; }
.s-avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  color: #fff; flex-shrink: 0;
  text-transform: uppercase;
}
.s-name strong { display: block; font-size: 12.5px; font-weight: 600; color: #111; }
.s-name span { font-size: 10.5px; color: #aaa; }

/* Row actions */
.row-actions { display: flex; gap: 6px; opacity: 0; transition: opacity 0.15s; }
.uc-table tbody tr:hover .row-actions { opacity: 1; }
.row-btn {
  border: 1px solid #e5e5e5;
  background: #fff;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #555;
  cursor: pointer;
  transition: all 0.15s;
  font-family: 'Poppins', sans-serif;
}
.row-btn:hover { border-color: #E30613; color: #E30613; }

/* Badges */
.uc-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 20px;
  font-size: 10.5px; font-weight: 600; white-space: nowrap;
}
.uc-badge-active { background: #f0fdf4; color: #15803d; }
.uc-badge-preinsc { background: #eff6ff; color: #1d4ed8; }
.uc-badge-suspend { background: #fff0f0; color: #b91c1c; }
.uc-badge-abandon { background: #f5f5f5; color: #888; }
.uc-badge-diplome { background: #fdf4ff; color: #7e22ce; }
.uc-badge-examen { background: #fefce8; color: #854d0e; }
.uc-badge-gray { background: #f5f5f5; color: #888; }

.badge-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #22c55e; }
.dot-blue { background: #3b82f6; }
.dot-red { background: #E30613; }
.dot-gray { background: #aaa; }
.dot-purple { background: #a855f7; }
.dot-yellow { background: #eab308; }

/* Pagination */
.uc-pagination {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-top: 1px solid #f0f0f0; background: #fafafa;
}
.uc-pagination-info { font-size: 11.5px; color: #888; }
.uc-pagination-btns { display: flex; gap: 4px; }
.page-btn {
  border: 1px solid #e5e5e5; background: #fff; border-radius: 4px;
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; color: #555; cursor: pointer; transition: all 0.15s;
  font-family: 'Poppins', sans-serif;
}
.page-btn:hover:not(.disabled) { border-color: #E30613; color: #E30613; }
.page-btn.active { background: #E30613; border-color: #E30613; color: #fff; }
.page-btn.disabled { opacity: 0.3; cursor: not-allowed; }

/* Modal close */
.modal-close {
  background: #f4f4f4; border: none; border-radius: 4px;
  width: 30px; height: 30px; cursor: pointer; font-size: 14px; color: #888;
  transition: all 0.15s; font-family: 'Poppins', sans-serif;
  display: flex; align-items: center; justify-content: center;
}
.modal-close:hover { background: #fff0f0; color: #E30613; }

/* Forms inside panel */
.form-section-label {
  font-size: 10px; font-weight: 700; color: #888;
  text-transform: uppercase; letter-spacing: 0.5px;
  padding: 0 0 8px; margin-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
  margin-top: 4px;
}
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.form-row.full { grid-template-columns: 1fr; }
.form-group label {
  display: block; font-size: 11px; font-weight: 600; color: #333;
  text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 5px;
}
.form-group input,
.form-group select,
.form-group textarea {
  width: 100%; border: 1.5px solid #e5e5e5; border-radius: 4px;
  padding: 9px 11px; font-family: 'Poppins', sans-serif; font-size: 12.5px;
  color: #111; outline: none; background: #fafafa; transition: border-color 0.2s;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus { border-color: #E30613; background: #fff; }

/* Radio cards */
.radio-card {
  flex: 1; padding: 10px; border: 1.5px solid #e5e5e5; border-radius: 4px;
  cursor: pointer; transition: all 0.15s;
}
.radio-card.active { border-color: #E30613; background: #fff5f5; }
.radio-card.orange.active { border-color: #f97316; background: #fff7ed; }
.radio-card-title { font-size: 12.5px; font-weight: 700; color: #111; }
.radio-card-sub { font-size: 11px; color: #888; margin-top: 1px; }

/* Info rows (gerer-inscription) */
.info-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 12px; }
.info-label { color: #888; font-weight: 500; }
.info-value { color: #111; font-weight: 600; }

/* Action buttons (gerer-inscription) */
.action-btn { width: 100%; padding: 10px; border-radius: 4px; border: none; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: 'Poppins', sans-serif; }
.action-btn-green { background: #22c55e; color: #fff; }
.action-btn-green:hover { background: #16a34a; }
.action-btn-green:disabled { opacity: 0.5; cursor: not-allowed; }
.action-btn-ghost { background: #f5f5f5; color: #555; border: 1px solid #e5e5e5; }
.action-btn-ghost:hover { background: #eee; }

/* ghost button */
.btn-ghost {
  border: 1px solid #e5e5e5; background: #fff; border-radius: 4px;
  padding: 8px 14px; font-size: 12px; font-weight: 600; color: #555;
  cursor: pointer; transition: all 0.15s; font-family: 'Poppins', sans-serif;
}
.btn-ghost:hover { border-color: #ccc; background: #fafafa; }

.hidden { display: none; }

.td-num { font-size: 11px; font-weight: 600; color: #888; font-family: monospace; }
</style>
