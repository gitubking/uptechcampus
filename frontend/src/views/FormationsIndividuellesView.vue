<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import UcDraftBanner from '@/components/ui/UcDraftBanner.vue'
import QRCode from 'qrcode'
import { useFormAutoSave } from '@/composables/useFormAutoSave'

const router = useRouter()
const toast = useToast()

const auth = useAuthStore()
// Dir. études et secrétariat ont été ajoutés : la secrétaire peut créer
// de nouvelles formations, le directeur des études fait l'emploi du temps
// (bouton "Planifier" sur chaque module).
const canWrite = computed(() => ['dg', 'dir_peda', 'coordinateur', 'secretariat'].includes(auth.user?.role ?? ''))
const canPay = computed(() => ['dg', 'coordinateur', 'comptable'].includes(auth.user?.role ?? ''))

// ── Types ──────────────────────────────────────────────────────────────
interface FI {
  id: number; etudiant: any; type_formation: any; annee_academique: any
  cout_total: number; pct_inscription: number; pct_formateur: number
  statut: string; date_debut: string; date_fin: string
  modules: FIModule[]; paiements: FIPaiement[]
}
interface FIModule {
  id: number; matiere_id: number; matiere_nom: string
  volume_horaire: number; heures_effectuees: number
  enseignant_id: number | null; enseignant_nom: string | null
}
interface FIPaiement {
  id: number; type: string; montant: number; montant_paye: number
  statut: string; date_echeance: string; date_paiement: string | null
}
interface Etudiant { id: number; nom: string; prenom: string; telephone: string }
interface Matiere { id: number; nom: string; code: string }
interface Enseignant { id: number; nom: string; prenom: string }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }

// ── Data ──────────────────────────────────────────────────────────────
const formations = ref<FI[]>([])
const etudiants = ref<Etudiant[]>([])
const matieres = ref<Matiere[]>([])
const enseignants = ref<Enseignant[]>([])
const annees = ref<AnneeAcademique[]>([])
const loading = ref(true)
const search = ref('')
const filterStatut = ref('')

// ── Formulaire création ───────────────────────────────────────────────
const showModal = ref(false)
const saving = ref(false)
const editingFI = ref<FI | null>(null)
const isGroupMode = ref(false)
const groupEtudiantIds = ref<number[]>([])
const groupEntreprise = ref('')
const groupCoutMode = ref<'par_personne' | 'total_groupe'>('par_personne')
const groupNewParticipants = ref<{ prenom: string; nom: string; telephone: string; email: string }[]>([])
const groupSearchExisting = ref('')
const createNewEtudiant = ref(false)
const newEtudiant = ref({ prenom: '', nom: '', telephone: '', email: '' })
const form = ref({
  etudiant_id: null as number | null,
  annee_academique_id: null as number | null,
  cout_total: 0,
  pct_inscription: 50,
  pct_formateur: 50,
  date_debut: '',
  date_fin: '',
  modules: [] as { matiere_id: number | null; volume_horaire: number; enseignant_id: number | null }[]
})

// ── Détail / Paiement ─────────────────────────────────────────────────
const selectedFI = ref<FI | null>(null)
const showDetail = ref(false)
const showPayModal = ref(false)
const payingEcheance = ref<FIPaiement | null>(null)
const payAmount = ref(0)
const payingLoading = ref(false)

// ── Computed ──────────────────────────────────────────────────────────
const filtered = computed(() => {
  let list = formations.value
  if (filterStatut.value) list = list.filter(f => f.statut === filterStatut.value)
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    list = list.filter(f =>
      f.etudiant?.nom?.toLowerCase().includes(q) ||
      f.etudiant?.prenom?.toLowerCase().includes(q) ||
      (f as any).entreprise?.toLowerCase().includes(q) ||
      f.modules?.some((m: FIModule) => m.matiere_nom?.toLowerCase().includes(q))
    )
  }
  return list
})

const groupTotalParticipants = computed(() => groupEtudiantIds.value.length + groupNewParticipants.value.filter(p => p.nom && p.prenom).length)
const groupCoutParPersonne = computed(() => {
  if (!isGroupMode.value || groupCoutMode.value === 'par_personne' || groupTotalParticipants.value === 0) return form.value.cout_total
  return Math.round(form.value.cout_total / groupTotalParticipants.value)
})
const montantInscriptionPreview = computed(() => {
  const base = isGroupMode.value ? groupCoutParPersonne.value : form.value.cout_total
  return Math.round(base * form.value.pct_inscription / 100)
})
const montantSoldePreview = computed(() => {
  const base = isGroupMode.value ? groupCoutParPersonne.value : form.value.cout_total
  return base - montantInscriptionPreview.value
})
const totalHeuresModules = computed(() => form.value.modules.reduce((s, m) => s + (m.volume_horaire || 0), 0))
const filteredExistingEtudiants = computed(() => {
  if (!groupSearchExisting.value.trim()) return etudiants.value.slice(0, 20)
  const q = groupSearchExisting.value.toLowerCase()
  return etudiants.value.filter(e => e.prenom?.toLowerCase().includes(q) || e.nom?.toLowerCase().includes(q) || e.telephone?.includes(q)).slice(0, 20)
})

// ── Chargement ────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  try {
    const [fiRes, etRes, matRes, ensRes, aaRes] = await Promise.all([
      api.get('/formations-individuelles'),
      api.get('/etudiants'),
      api.get('/matieres'),
      api.get('/enseignants?all=1'),
      api.get('/annees-academiques'),
    ])
    formations.value = fiRes.data
    etudiants.value = etRes.data?.data ?? etRes.data
    matieres.value = matRes.data
    enseignants.value = ensRes.data?.data ?? ensRes.data
    annees.value = aaRes.data
  } finally { loading.value = false }
}

// ── CRUD ──────────────────────────────────────────────────────────────
function openNew() {
  editingFI.value = null
  isGroupMode.value = false
  createNewEtudiant.value = false
  newEtudiant.value = { prenom: '', nom: '', telephone: '', email: '' }
  groupEtudiantIds.value = []
  groupEntreprise.value = ''
  groupCoutMode.value = 'par_personne'
  groupNewParticipants.value = []
  groupSearchExisting.value = ''
  form.value = {
    etudiant_id: null, annee_academique_id: null,
    cout_total: 0, pct_inscription: 50, pct_formateur: 50,
    date_debut: new Date().toISOString().slice(0, 10), date_fin: '',
    modules: [{ matiere_id: null, volume_horaire: 0, enseignant_id: null }]
  }
  showModal.value = true
  if (fiDraft.hasDraft.value) fiDraftBanner.value = true
}

// Auto-save brouillon FI (création)
const fiDraft = useFormAutoSave(form, {
  key: 'fi-nouveau-coord',
  pause: () => !showModal.value || editingFI.value !== null,
})
const fiDraftBanner = ref(false)
function restoreFiDraft() { fiDraft.restoreDraft(); fiDraftBanner.value = false; toast.success('Brouillon restauré.') }
function discardFiDraft() { fiDraft.clearDraft(); fiDraftBanner.value = false }

function openEdit(fi: FI) {
  editingFI.value = fi
  form.value = {
    etudiant_id: fi.etudiant?.id,
    annee_academique_id: fi.annee_academique?.id || null,
    cout_total: fi.cout_total,
    pct_inscription: fi.pct_inscription,
    pct_formateur: fi.pct_formateur,
    date_debut: fi.date_debut?.slice(0, 10) || '',
    date_fin: fi.date_fin?.slice(0, 10) || '',
    modules: fi.modules.map(m => ({ matiere_id: m.matiere_id, volume_horaire: m.volume_horaire, enseignant_id: m.enseignant_id }))
  }
  showModal.value = true
}

function addModule() {
  form.value.modules.push({ matiere_id: null, volume_horaire: 0, enseignant_id: null })
}
function removeModule(i: number) {
  form.value.modules.splice(i, 1)
}

async function save() {
  if (form.value.modules.some(m => !m.matiere_id)) {
    toast.warning('Chaque module doit avoir une matière')
    return
  }
  if (!form.value.cout_total || form.value.modules.length === 0) {
    toast.warning('Veuillez remplir le coût et au moins un module')
    return
  }

  // Mode groupe
  if (isGroupMode.value && !editingFI.value) {
    const validNew = groupNewParticipants.value.filter(p => p.nom && p.prenom)
    if (groupEtudiantIds.value.length === 0 && validNew.length === 0) {
      toast.warning('Ajoutez au moins un participant')
      return
    }
    saving.value = true
    try {
      await api.post('/formations-individuelles/groupe', {
        etudiant_ids: groupEtudiantIds.value,
        participants: validNew,
        entreprise: groupEntreprise.value || null,
        cout_mode: groupCoutMode.value,
        annee_academique_id: form.value.annee_academique_id,
        cout_total: form.value.cout_total,
        pct_inscription: form.value.pct_inscription,
        pct_formateur: form.value.pct_formateur,
        date_debut: form.value.date_debut,
        date_fin: form.value.date_fin,
        modules: form.value.modules,
      })
      showModal.value = false
      await load()
    } catch (e: any) {
      toast.apiError(e, 'Erreur')
    } finally { saving.value = false }
    return
  }

  // Mode individuel
  if (!form.value.etudiant_id && !createNewEtudiant.value) {
    toast.warning('Veuillez sélectionner un étudiant ou créer un nouveau')
    return
  }
  if (createNewEtudiant.value && (!newEtudiant.value.nom || !newEtudiant.value.prenom)) {
    toast.warning('Le nom et prénom du nouvel étudiant sont requis')
    return
  }
  saving.value = true
  try {
    const payload: any = { ...form.value }
    if (createNewEtudiant.value && !editingFI.value) {
      payload.etudiant_id = null
      payload.new_etudiant = { ...newEtudiant.value }
    }
    if (editingFI.value) {
      await api.put(`/formations-individuelles/${editingFI.value.id}`, payload)
    } else {
      await api.post('/formations-individuelles', payload)
      fiDraft.clearDraft()
      fiDraftBanner.value = false
    }
    showModal.value = false
    await load()
  } catch (e: any) {
    toast.apiError(e, 'Erreur')
  } finally { saving.value = false }
}

async function deleteFI(fi: FI) {
  if (!confirm(`Supprimer la formation de ${fi.etudiant?.prenom} ${fi.etudiant?.nom} ?`)) return
  try {
    await api.delete(`/formations-individuelles/${fi.id}`)
    await load()
  } catch (e: any) {
    toast.apiError(e, 'Erreur')
  }
}

// ── Mise à jour heures module ──────────────────────────────────────────
async function updateHeures(mod: FIModule, newHeures: number) {
  try {
    const { data } = await api.put(`/fi-modules/${mod.id}/heures`, { heures_effectuees: newHeures })
    mod.heures_effectuees = newHeures
    if (data.formation_terminee && selectedFI.value) {
      selectedFI.value.statut = 'termine'
      selectedFI.value.date_fin = new Date().toISOString().slice(0, 10)
      await load()
    }
  } catch (e: any) {
    toast.apiError(e, 'Erreur')
  }
}

// ── Planification séances ──────────────────────────────────────────────
const showPlanModal = ref(false)
const planModule = ref<FIModule | null>(null)
const planForm = ref({
  jours: [1] as number[],
  heure_debut: '08:00',
  heure_fin: '10:00',
  date_debut: '',
  mode: 'presentiel',
  salle: '',
})
const planLoading = ref(false)
const planResult = ref<any>(null)
const planSeances = ref<any[]>([])
const loadingSeances = ref(false)

const joursSemaine = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
]

function togglePlanJour(jour: number) {
  const idx = planForm.value.jours.indexOf(jour)
  if (idx >= 0) {
    if (planForm.value.jours.length > 1) planForm.value.jours.splice(idx, 1)
  } else {
    planForm.value.jours.push(jour)
    planForm.value.jours.sort()
  }
}

const planForGroupe = ref(false)

// Disponibilités de l'enseignant
const planDispos = ref<{ jour: number; heure_debut: string; heure_fin: string }[]>([])
const loadingDispos = ref(false)

async function loadPlanDispos(ensId: number) {
  if (!ensId) { planDispos.value = []; return }
  loadingDispos.value = true
  try {
    const { data } = await api.get(`/enseignants/${ensId}/disponibilites`)
    planDispos.value = data
  } catch { planDispos.value = [] }
  finally { loadingDispos.value = false }
}

function openPlanifier(mod: FIModule) {
  planModule.value = mod
  planResult.value = null
  planForm.value = {
    jours: [1],
    heure_debut: '08:00',
    heure_fin: '10:00',
    date_debut: selectedFI.value?.date_debut?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    mode: 'presentiel',
    salle: '',
  }
  showPlanModal.value = true
  loadModuleSeances(mod)
  if (mod.enseignant_id) loadPlanDispos(mod.enseignant_id)
  else planDispos.value = []
}

async function loadModuleSeances(mod: FIModule) {
  loadingSeances.value = true
  try {
    const { data } = await api.get('/seances', { params: { fi_module_id: mod.id } })
    planSeances.value = data.filter ? data.filter((s: any) => s.fi_module_id === mod.id) : []
  } catch {
    planSeances.value = []
  } finally { loadingSeances.value = false }
}

// Durée d'une séance en heures
const planSeanceDuree = computed(() => {
  const parts1 = planForm.value.heure_debut.split(':')
  const h1 = Number(parts1[0] ?? 0), m1 = Number(parts1[1] ?? 0)
  const parts2 = planForm.value.heure_fin.split(':')
  const h2 = Number(parts2[0] ?? 0), m2 = Number(parts2[1] ?? 0)
  return (h2 + m2 / 60) - (h1 + m1 / 60)
})

const previewNbSeances = computed(() => {
  if (!planModule.value) return 0
  const restant = planModule.value.volume_horaire - planModule.value.heures_effectuees
  if (restant <= 0 || planSeanceDuree.value <= 0) return 0
  return Math.ceil(restant / planSeanceDuree.value)
})

const planSeancesParSemaine = computed(() => planForm.value.jours.length)

// Estimation nb semaines
const planEstimSemaines = computed(() => {
  if (previewNbSeances.value <= 0 || planSeancesParSemaine.value <= 0) return 0
  return Math.ceil(previewNbSeances.value / planSeancesParSemaine.value)
})

async function submitPlan() {
  if (!planModule.value || !selectedFI.value) return
  const mod = planModule.value
  if (!mod.enseignant_id) {
    toast.warning('Ce module n\'a pas de formateur assigné')
    return
  }
  if (planForm.value.jours.length === 0) {
    toast.warning('Sélectionnez au moins un jour')
    return
  }
  planLoading.value = true
  try {
    let data: any
    const groupeFi = (selectedFI.value as any).groupe_fi
    if (planForGroupe.value && groupeFi) {
      // Planifier pour tout le groupe
      const res = await api.post('/seances/fi-planifier-groupe', {
        groupe_fi: groupeFi,
        matiere_id: mod.matiere_id,
        enseignant_id: mod.enseignant_id,
        matiere_nom: mod.matiere_nom,
        jours: planForm.value.jours,
        heure_debut: planForm.value.heure_debut,
        heure_fin: planForm.value.heure_fin,
        date_debut: planForm.value.date_debut,
        mode: planForm.value.mode,
        salle: planForm.value.salle,
      })
      data = res.data
    } else {
      const res = await api.post('/seances/fi-planifier', {
        fi_module_id: mod.id,
        formation_individuelle_id: selectedFI.value.id,
        enseignant_id: mod.enseignant_id,
        matiere_nom: mod.matiere_nom,
        volume_horaire: mod.volume_horaire,
        heures_effectuees: mod.heures_effectuees,
        jours: planForm.value.jours,
        heure_debut: planForm.value.heure_debut,
        heure_fin: planForm.value.heure_fin,
        date_debut: planForm.value.date_debut,
        mode: planForm.value.mode,
        salle: planForm.value.salle,
      })
      data = res.data
    }
    planResult.value = data
  } catch (e: any) {
    toast.apiError(e, 'Erreur lors de la planification')
  } finally { planLoading.value = false }
}

// ── Détail ─────────────────────────────────────────────────────────────
function openDetail(fi: FI) {
  selectedFI.value = fi
  showDetail.value = true
}

// ── Paiement ──────────────────────────────────────────────────────────
function openPay(echeance: FIPaiement) {
  payingEcheance.value = echeance
  payAmount.value = parseFloat(String(echeance.montant)) - parseFloat(String(echeance.montant_paye))
  showPayModal.value = true
}

async function confirmPay() {
  if (!payingEcheance.value || !selectedFI.value || payAmount.value <= 0) return
  payingLoading.value = true
  try {
    await api.post(`/formations-individuelles/${selectedFI.value.id}/payer`, {
      paiement_id: payingEcheance.value.id,
      montant: payAmount.value
    })
    showPayModal.value = false
    await load()
    // Rafraîchir le détail
    const updated = formations.value.find(f => f.id === selectedFI.value!.id)
    if (updated) selectedFI.value = updated
  } catch (e: any) {
    toast.apiError(e, 'Erreur')
  } finally { payingLoading.value = false }
}

function statutLabel(s: string) {
  const map: Record<string, string> = { en_cours: 'En cours', solde: 'Soldé', termine: 'Terminé', annule: 'Annulé' }
  return map[s] || s
}
function statutColor(s: string) {
  const map: Record<string, string> = { en_cours: '#3b82f6', solde: '#22c55e', termine: '#6b7280', annule: '#ef4444' }
  return map[s] || '#999'
}
function paiementStatutLabel(s: string) {
  const map: Record<string, string> = { non_paye: 'Non payé', partiel: 'Partiel', paye: 'Payé' }
  return map[s] || s
}
function paiementStatutColor(s: string) {
  const map: Record<string, string> = { non_paye: '#ef4444', partiel: '#f59e0b', paye: '#22c55e' }
  return map[s] || '#999'
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('fr-FR').format(n) + ' FCFA'
}

// ── Impression ──────────────────────────────────────────────────────
function openPrintWindow(html: string) {
  const w = window.open('', '_blank', 'width=800,height=600')
  if (!w) { toast.warning('Popup bloquée — autorisez les popups.'); return }
  w.document.write(html)
  w.document.close()
  w.onload = () => { w.focus(); w.print() }
}

function printRecuFI(fi: FI, p: FIPaiement) {
  const prenom = fi.etudiant?.prenom ?? ''
  const nom = fi.etudiant?.nom ?? ''
  const typeLabel = p.type === 'inscription' ? "Frais d'inscription (FI)" : 'Solde formation individuelle'
  const dateLabel = p.date_paiement
    ? new Date(p.date_paiement).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const montantStr = Number(p.montant_paye).toLocaleString('fr-FR')
  const modules = fi.modules.map(m => m.matiere_nom).join(', ')
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const numRecu = `FI-${fi.id}-${p.id}`

  const recuBlock = (exemplaire: string) => `
    <div class="recu-block">
      <div class="exemplaire">${exemplaire}</div>
      <div class="hdr">
        <img src="${logoUrl}" alt="Logo">
        <div class="hdr-info">
          <div class="tagline">Institut de Formation</div>
          <h1>Institut Sup. de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</h1>
          <div class="meta">NINEA : 006118310 _ BP 50281 RP DAKAR | Sicap Amitié 1, Villa N° 3031 — Dakar | Tél : 33 821 34 25 / 77 841 50 44</div>
          <div class="agree">Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT</div>
        </div>
      </div>
      <div class="content">
        <div class="recu-title">Reçu de paiement — Formation individuelle <span class="recu-num">${numRecu}</span></div>
        <div class="info-grid">
          <div class="info-box full"><label>Étudiant</label><span>${prenom} ${nom}</span></div>
          <div class="info-box"><label>Objet</label><span>${typeLabel}</span></div>
          <div class="info-box"><label>Date</label><span>${dateLabel}</span></div>
          <div class="info-box full"><label>Modules</label><span>${modules}</span></div>
        </div>
        <div class="montant-box" style="text-align:center;border:1.5px solid #111;border-radius:6px;padding:8px 16px;margin:10px 0;">
          <div style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:2px;">Montant payé</div>
          <div style="font-size:20px;font-weight:900;color:#111;">${montantStr} FCFA</div>
        </div>
        <div class="sign-area">
          <div class="sign-box"><div class="sign-line"></div><label>Signature du caissier</label></div>
          <div class="sign-box"><div class="sign-line"></div><label>Cachet de l'établissement</label></div>
        </div>
        <div class="footer-bar">Amitié 1, Villa n°3031 — Dakar | +221 77 841 50 44 / 77 618 45 52 | uptechformation.com</div>
      </div>
    </div>`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reçu ${numRecu}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:A4 portrait;margin:10mm}
    body{font-family:Arial,sans-serif;color:#111;font-size:11px}
    .recu-block{page-break-inside:avoid;padding-bottom:6px}
    .exemplaire{text-align:right;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#aaa;padding:4px 16px 2px}
    .hdr{display:flex;align-items:center;gap:14px;padding:10px 16px 8px;border-bottom:2px solid #E30613}
    .hdr img{width:52px;height:52px;object-fit:contain;flex-shrink:0}
    .hdr-info .tagline{font-size:7px;font-weight:700;color:#E30613;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
    .hdr-info h1{font-size:11px;font-weight:900;color:#111;line-height:1.2;margin-bottom:3px}
    .hdr-info .meta{font-size:8px;color:#555;line-height:1.5}
    .hdr-info .agree{font-size:7px;color:#888;margin-top:2px}
    .content{padding:10px 16px}
    .recu-title{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#111;margin-bottom:8px}
    .recu-num{font-size:11px;font-weight:400;color:#888;font-family:monospace;letter-spacing:1px}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}
    .info-box{background:#f9f9f9;border:1px solid #eee;border-radius:4px;padding:6px 10px}
    .info-box label{font-size:7px;text-transform:uppercase;color:#aaa;font-weight:700;letter-spacing:0.5px;display:block;margin-bottom:2px}
    .info-box span{font-size:11px;font-weight:700;color:#111}
    .full{grid-column:1/-1}
    .sign-area{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:10px;padding-top:8px;border-top:1px dashed #ddd}
    .sign-box{text-align:center}
    .sign-line{border-bottom:1px solid #ccc;height:30px;margin-bottom:4px}
    .sign-box label{font-size:7px;color:#aaa;text-transform:uppercase}
    .footer-bar{border-top:1px solid #ccc;color:#777;font-size:7px;text-align:center;padding:4px 16px;margin-top:10px}
    .cut-line{display:flex;align-items:center;gap:8px;margin:8px 0;color:#aaa;font-size:8px}
    .cut-line::before,.cut-line::after{content:'';flex:1;border-top:1px dashed #aaa}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head>
  <body>
    ${recuBlock('Exemplaire établissement')}
    <div class="cut-line">&#9986; &nbsp; Découper ici</div>
    ${recuBlock('Exemplaire étudiant')}
  </body></html>`

  openPrintWindow(html)
}

function printFicheEtudiant(fi: FI) {
  const prenom = fi.etudiant?.prenom ?? ''
  const nom = fi.etudiant?.nom ?? ''
  const dateDebut = fi.date_debut ? new Date(fi.date_debut).toLocaleDateString('fr-FR') : '—'
  const dateFin = fi.date_fin ? new Date(fi.date_fin).toLocaleDateString('fr-FR') : 'En cours'
  const annee = fi.annee_academique?.libelle ?? '—'
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const totalHeures = fi.modules.reduce((s, m) => s + m.volume_horaire, 0)
  const totalEffectuees = fi.modules.reduce((s, m) => s + m.heures_effectuees, 0)
  const totalPaye = fi.paiements.reduce((s, p) => s + parseFloat(String(p.montant_paye)), 0)
  const pctPaye = fi.cout_total > 0 ? Math.round(totalPaye / fi.cout_total * 100) : 0

  const modulesRows = fi.modules.map(m => {
    const pct = m.volume_horaire > 0 ? Math.round(m.heures_effectuees / m.volume_horaire * 100) : 0
    return `<tr>
      <td style="padding:6px 10px;font-weight:600;">${m.matiere_nom}</td>
      <td style="padding:6px 10px;">${m.enseignant_nom || '—'}</td>
      <td style="padding:6px 10px;text-align:center;">${m.volume_horaire}h</td>
      <td style="padding:6px 10px;text-align:center;">${m.heures_effectuees}h</td>
      <td style="padding:6px 10px;text-align:center;">
        <div style="display:inline-block;width:60px;height:5px;background:#eee;border-radius:3px;overflow:hidden;vertical-align:middle;">
          <div style="width:${pct}%;height:100%;background:${pct >= 100 ? '#22c55e' : '#3b82f6'};border-radius:3px;"></div>
        </div>
        <span style="font-size:10px;margin-left:4px;">${pct}%</span>
      </td>
    </tr>`
  }).join('')

  const paiementsRows = fi.paiements.map(p => {
    const statut = p.statut === 'paye' ? 'Payé' : p.statut === 'partiel' ? 'Partiel' : 'Non payé'
    const color = p.statut === 'paye' ? '#22c55e' : p.statut === 'partiel' ? '#f59e0b' : '#ef4444'
    return `<tr>
      <td style="padding:6px 10px;font-weight:600;">${p.type === 'inscription' ? "Inscription" : "Solde"}</td>
      <td style="padding:6px 10px;text-align:right;">${Number(p.montant).toLocaleString('fr-FR')} FCFA</td>
      <td style="padding:6px 10px;text-align:right;">${Number(p.montant_paye).toLocaleString('fr-FR')} FCFA</td>
      <td style="padding:6px 10px;text-align:center;"><span style="color:${color};font-weight:600;">${statut}</span></td>
      <td style="padding:6px 10px;">${p.date_paiement ? new Date(p.date_paiement).toLocaleDateString('fr-FR') : '—'}</td>
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fiche ${prenom} ${nom}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:A4 portrait;margin:12mm}
    body{font-family:Arial,sans-serif;color:#111;font-size:11px}
    .hdr{display:flex;align-items:center;gap:14px;padding:10px 0 8px;border-bottom:2px solid #E30613;margin-bottom:16px}
    .hdr img{width:56px;height:56px;object-fit:contain;flex-shrink:0}
    .hdr-info .tagline{font-size:7px;font-weight:700;color:#E30613;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
    .hdr-info h1{font-size:12px;font-weight:900;color:#111;line-height:1.2;margin-bottom:3px}
    .hdr-info .meta{font-size:8px;color:#555;line-height:1.5}
    .hdr-info .agree{font-size:7px;color:#888;margin-top:2px}
    h2{font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:1px;text-align:center;margin-bottom:14px;color:#111}
    .info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px}
    .info-box{background:#f9f9f9;border:1px solid #eee;border-radius:4px;padding:8px 12px}
    .info-box label{font-size:7px;text-transform:uppercase;color:#aaa;font-weight:700;letter-spacing:0.5px;display:block;margin-bottom:3px}
    .info-box span{font-size:12px;font-weight:700;color:#111}
    .full{grid-column:1/-1}
    .span2{grid-column:span 2}
    h3{font-size:12px;font-weight:700;margin:14px 0 6px;color:#333;border-bottom:1px solid #eee;padding-bottom:4px}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px}
    th{padding:6px 10px;text-align:left;font-size:9px;color:#888;text-transform:uppercase;border-bottom:1px solid #ddd;background:#fafafa}
    td{border-bottom:1px solid #f3f3f3}
    .summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
    .summary-box{border:1.5px solid #111;border-radius:6px;padding:10px 14px;text-align:center}
    .summary-box .lbl{font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:3px}
    .summary-box .val{font-size:18px;font-weight:900}
    .sign-area{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px;padding-top:10px;border-top:1px dashed #ddd}
    .sign-box{text-align:center}
    .sign-line{border-bottom:1px solid #ccc;height:40px;margin-bottom:4px}
    .sign-box label{font-size:7px;color:#aaa;text-transform:uppercase}
    .footer{border-top:1px solid #ccc;color:#777;font-size:7px;text-align:center;padding:6px 0;margin-top:16px}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head>
  <body>
    <div class="hdr">
      <img src="${logoUrl}" alt="Logo">
      <div class="hdr-info">
        <div class="tagline">Institut de Formation</div>
        <h1>Institut Sup. de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</h1>
        <div class="meta">NINEA : 006118310 _ BP 50281 RP DAKAR | Sicap Amitié 1, Villa N° 3031 — Dakar | Tél : 33 821 34 25 / 77 841 50 44</div>
        <div class="agree">Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT</div>
      </div>
    </div>

    <h2>Fiche de formation individuelle</h2>

    <div class="info-grid">
      <div class="info-box span2"><label>Étudiant</label><span>${prenom} ${nom}</span></div>
      <div class="info-box"><label>Statut</label><span>${fi.statut === 'en_cours' ? 'En cours' : fi.statut === 'solde' ? 'Soldé' : fi.statut === 'termine' ? 'Terminé' : fi.statut}</span></div>
      <div class="info-box"><label>Année académique</label><span>${annee}</span></div>
      <div class="info-box"><label>Date début</label><span>${dateDebut}</span></div>
      <div class="info-box"><label>Date fin</label><span>${dateFin}</span></div>
    </div>

    <h3>Modules de formation</h3>
    <table>
      <thead><tr><th>Matière</th><th>Formateur</th><th style="text-align:center">Volume</th><th style="text-align:center">Effectué</th><th style="text-align:center">Progression</th></tr></thead>
      <tbody>${modulesRows}</tbody>
      <tfoot><tr style="font-weight:700;background:#f8f8f8;"><td colspan="2">TOTAL</td><td style="text-align:center;padding:6px 10px;">${totalHeures}h</td><td style="text-align:center;padding:6px 10px;">${totalEffectuees}h</td><td style="text-align:center;padding:6px 10px;">${totalHeures > 0 ? Math.round(totalEffectuees/totalHeures*100) : 0}%</td></tr></tfoot>
    </table>

    <h3>Paiements</h3>
    <table>
      <thead><tr><th>Type</th><th style="text-align:right">Montant</th><th style="text-align:right">Payé</th><th style="text-align:center">Statut</th><th>Date paiement</th></tr></thead>
      <tbody>${paiementsRows}</tbody>
    </table>

    <div class="summary">
      <div class="summary-box">
        <div class="lbl">Coût total</div>
        <div class="val">${Number(fi.cout_total).toLocaleString('fr-FR')} FCFA</div>
      </div>
      <div class="summary-box">
        <div class="lbl">Total payé (${pctPaye}%)</div>
        <div class="val" style="color:${pctPaye >= 100 ? '#22c55e' : '#111'};">${totalPaye.toLocaleString('fr-FR')} FCFA</div>
      </div>
    </div>

    <div class="sign-area">
      <div class="sign-box"><div class="sign-line"></div><label>Le Directeur des Études</label></div>
      <div class="sign-box"><div class="sign-line"></div><label>Cachet de l'établissement</label></div>
    </div>

    <div class="footer">
      Fait à Dakar, le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
      &nbsp;|&nbsp; Amitié 1, Villa n°3031 — Dakar &nbsp;|&nbsp; +221 77 841 50 44 / 77 618 45 52 &nbsp;|&nbsp; uptechformation.com
    </div>
  </body></html>`

  openPrintWindow(html)
}

// ── Carte étudiant FI (Canvas) ────────────────────────────────────────────────
const showCardModal = ref(false)
const cardCanvas = ref<HTMLCanvasElement | null>(null)
const cardFI = ref<FI | null>(null)

function fiInscriptionPayee(fi: FI): boolean {
  return fi.paiements.some(p => p.type === 'inscription' && (p.statut === 'paye' || p.statut === 'partiel'))
}

async function generateCarteFI(fi: FI) {
  cardFI.value = fi
  showCardModal.value = true
  await new Promise(r => setTimeout(r, 100))
  const canvas = cardCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  const W = 856, H = 540, PW = 1010, PH = 638
  canvas.width = PW; canvas.height = PH
  ctx.scale(PW / W, PH / H)

  const etd = fi.etudiant
  const formation = fi.type_formation?.nom ?? 'Formation Individuelle'
  const annee = fi.annee_academique?.libelle ?? ''

  // Fond blanc
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)

  // Barre noire bas
  const barH = 55
  ctx.fillStyle = '#111'; ctx.fillRect(0, H - barH, W, barH)
  ctx.fillStyle = '#fff'
  const barText = "Institut supérieur de formation aux nouveaux métiers de l'Informatique et de la Communication"
  let fs = 22; ctx.font = `${fs}px Arial`
  while (ctx.measureText(barText).width > W - 24 && fs > 10) { fs--; ctx.font = `${fs}px Arial` }
  ctx.textAlign = 'center'; ctx.fillText(barText, W / 2, H - barH + barH / 2 + fs / 3); ctx.textAlign = 'left'

  // Colonne gauche
  const pad = 18, leftColW = 278
  ctx.fillStyle = '#111'; ctx.font = 'bold 24px Arial'; ctx.fillText("CARTE D'ETUDIANT", pad, 45)
  ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.fillText(annee, pad + leftColW / 2, 80); ctx.textAlign = 'left'

  // Photo ou initiales
  const photoX = pad, photoY = 100, photoW = 206, photoH = H - barH - 110
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1.5; ctx.strokeRect(photoX, photoY, photoW, photoH)
  // Charger la photo si disponible
  let photoLoaded = false
  try {
    const { data: etdDetail } = await api.get(`/etudiants/${etd.id}`)
    if (etdDetail.photo_path?.startsWith('data:')) {
      const img = new Image()
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = etdDetail.photo_path })
      ctx.drawImage(img, photoX + 1, photoY + 1, photoW - 2, photoH - 2)
      photoLoaded = true
    }
  } catch {}
  if (!photoLoaded) {
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(photoX + 1, photoY + 1, photoW - 2, photoH - 2)
    ctx.fillStyle = '#999'; ctx.font = 'bold 60px Arial'; ctx.textAlign = 'center'
    ctx.fillText(`${(etd.prenom || 'X')[0]}${(etd.nom || 'X')[0]}`.toUpperCase(), photoX + photoW / 2, photoY + photoH / 2 + 22)
    ctx.textAlign = 'left'
  }

  // Bande verticale
  const stripeX = leftColW + pad + 4, stripeW = 44, sh = 15
  ctx.save(); ctx.beginPath(); ctx.rect(stripeX, 0, stripeW, H - barH); ctx.clip()
  for (let y = -(stripeW * 2); y < H + stripeW * 2; y += sh * 2) {
    ctx.fillStyle = '#E30613'; ctx.beginPath()
    ctx.moveTo(stripeX, y + stripeW); ctx.lineTo(stripeX + stripeW, y)
    ctx.lineTo(stripeX + stripeW, y + sh); ctx.lineTo(stripeX, y + stripeW + sh); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#111'; ctx.beginPath()
    ctx.moveTo(stripeX, y + stripeW + sh); ctx.lineTo(stripeX + stripeW, y + sh)
    ctx.lineTo(stripeX + stripeW, y + sh * 2); ctx.lineTo(stripeX, y + stripeW + sh * 2); ctx.closePath(); ctx.fill()
  }
  ctx.restore()

  // Colonne droite
  const rightX = stripeX + stripeW + 14
  ctx.fillStyle = '#111'; ctx.font = 'bold 34px Arial'; ctx.fillText("UP'TECH", rightX, 58)
  ctx.fillStyle = '#E30613'; ctx.fillRect(rightX, 68, 200, 4)

  let iy = 110
  const fields = [
    { label: 'Prénom (s) : ', value: etd.prenom },
    { label: 'Nom : ', value: (etd.nom || '').toUpperCase() },
    { label: 'Formation : ', value: formation },
    { label: 'Type : ', value: 'Formation Individuelle' },
    { label: 'Matricule : ', value: etd.numero_etudiant || `FI-${fi.id}` },
  ]
  fields.forEach(f => {
    ctx.font = 'bold 18px Arial'; ctx.fillStyle = '#555'
    const lw = ctx.measureText(f.label).width
    ctx.fillText(f.label, rightX, iy)
    ctx.fillStyle = '#111'; ctx.font = '18px Arial'
    ctx.fillText(f.value || '—', rightX + lw, iy)
    iy += 28
  })

  // QR code
  try {
    const qrUrl = `${window.location.origin}/etudiants/${etd.id}`
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 200, margin: 1 })
    const qrImg = new Image()
    await new Promise<void>((res) => { qrImg.onload = () => res(); qrImg.src = qrDataUrl })
    const qrSize = 100
    ctx.drawImage(qrImg, W - qrSize - pad, H - barH - qrSize - 10, qrSize, qrSize)
  } catch {}
}

function printCarteFI() {
  const canvas = cardCanvas.value
  if (!canvas) return
  const dataUrl = canvas.toDataURL('image/png')
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<html><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;"><img src="${dataUrl}" style="max-width:100%;"/></body></html>`)
  w.document.close()
  w.onload = () => { w.focus(); w.print() }
}

function downloadCarteFI() {
  const canvas = cardCanvas.value
  if (!canvas) return
  const link = document.createElement('a')
  link.download = `carte_${cardFI.value?.etudiant?.nom}_FI.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

// ── Certificat de scolarité FI ────────────────────────────────────────────────
function printCertificatFI(fi: FI) {
  const etd = fi.etudiant
  const prenom = etd?.prenom ?? ''
  const nom = etd?.nom ?? ''
  const annee = fi.annee_academique?.libelle ?? '—'
  const formation = fi.type_formation?.nom ?? 'Formation Individuelle'
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const refNum = `UPTECH/${new Date().getFullYear()}/${String(etd?.id ?? Math.floor(Math.random()*9000+1000)).padStart(4,'0')}`
  const dateJour = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
  const dots = '◦ '.repeat(80)
  const modulesStr = fi.modules.map(m => m.matiere_nom).join(', ')

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<title>Certificat — ${prenom} ${nom}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff;padding:6mm 15mm}
@page{size:A4 portrait;margin:0}@media print{body{padding:6mm 15mm}}
.hdr{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:4px}
.hdr img{width:113px;height:113px;object-fit:contain;display:block;margin-bottom:-18px}
.hdr-info{text-align:center;line-height:1.4}
.hdr-info .tagline{font-size:10px;font-weight:700;color:#111;margin-bottom:1px}
.hdr-info .meta{font-size:9px;color:#333;line-height:1.4;margin-bottom:1px}
.hdr-info .agree{font-size:8.5px;color:#333;font-weight:700;text-decoration:underline}
.dots{font-size:8px;color:#E30613;letter-spacing:1px;overflow:hidden;white-space:nowrap;margin:8px 0 14px;opacity:.7}
.ref-row{display:flex;justify-content:space-between;font-size:9.5px;color:#555;margin-bottom:28px}
.cert-title{text-align:center;margin-bottom:32px}
.cert-title h2{font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:3px;border-bottom:3px solid #E30613;display:inline-block;padding-bottom:6px}
.cert-title p{font-size:10px;color:#888;margin-top:6px;letter-spacing:1px;text-transform:uppercase}
.cert-body{font-size:12px;line-height:2;color:#111;text-align:justify;margin:0 10mm 28px}
.cert-body .highlight{font-weight:700;font-size:13px}
.cert-body .underline{text-decoration:underline;font-weight:600}
.cert-card{border:1px solid #ccc;border-left:4px solid #6366f1;padding:12px 16px;margin:0 10mm 28px;background:#fafafa}
.cert-card table{width:100%;border-collapse:collapse}
.cert-card td{padding:4px 8px;font-size:11px;vertical-align:middle}
.cert-card td:first-child{font-weight:700;color:#555;width:38%;white-space:nowrap}
.cert-usage{font-size:10px;color:#555;font-style:italic;text-align:center;margin:0 10mm 32px;padding:8px;border:1px dashed #ccc}
.cert-sign{display:flex;justify-content:flex-end;margin:0 10mm}
.cert-sign-box{text-align:center;min-width:200px}
.cert-sign-box .sign-place{font-size:10px;color:#555;margin-bottom:4px}
.cert-sign-box .sign-zone{height:60px;border-bottom:1px solid #bbb;margin:8px 0 4px}
.cert-sign-box .sign-name{font-size:10px;font-weight:700}
.cert-sign-box .sign-title{font-size:9px;color:#888}
.footer-bar{margin-top:20px;border-top:2px solid #E30613;padding-top:6px;font-size:9px;text-align:center;color:#333}
</style></head><body>
<div class="hdr"><img src="${logoUrl}" alt="UP'TECH"/>
<div class="hdr-info">
<div class="tagline">Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</div>
<div class="meta">NINEA 006118310 _ BP 50281 RP DAKAR</div>
<div class="agree">Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT</div>
</div></div>
<div class="dots">${dots}</div>
<div class="ref-row"><span>Réf. : <strong>${refNum}</strong></span><span>Dakar, le <strong>${dateJour}</strong></span></div>
<div class="cert-title"><h2>Certificat d'Inscription</h2><p>Année académique ${annee}</p></div>
<div class="cert-body">
Le Directeur Général de l'Institut Supérieur de Formation UP'TECH certifie que :<br><br>
<span class="highlight">${prenom.toUpperCase()} ${nom.toUpperCase()}</span>,
<br><br>est régulièrement inscrit(e) dans notre établissement pour l'année académique <span class="underline">${annee}</span>,
en <span class="underline">Formation Individuelle</span> dans le programme ci-dessous :
</div>
<div class="cert-card"><table>
<tr><td>Numéro étudiant</td><td>${etd?.numero_etudiant || `FI-${fi.id}`}</td></tr>
<tr><td>Formation</td><td>${formation}</td></tr>
<tr><td>Type</td><td>Formation Individuelle</td></tr>
<tr><td>Modules</td><td>${modulesStr || '—'}</td></tr>
<tr><td>Période</td><td>${fmtDate(fi.date_debut)} — ${fmtDate(fi.date_fin)}</td></tr>
<tr><td>Statut</td><td>${fi.statut === 'en_cours' ? 'En cours' : fi.statut === 'solde' ? 'Soldé' : fi.statut}</td></tr>
</table></div>
<div class="cert-usage">Ce certificat est délivré à l'intéressé(e) pour servir et valoir ce que de droit.</div>
<div class="cert-sign"><div class="cert-sign-box">
<div class="sign-place">Dakar, le ${dateJour}</div>
<div class="sign-zone"></div>
<div class="sign-name">Le Directeur Général</div>
<div class="sign-title">UP'TECH Formation</div>
</div></div>
<div class="footer-bar">UP'TECH Formation — Amitié 1, Villa n°3031, Dakar, Sénégal | +221 77 841 50 44 / 77 618 45 52 | uptechformation.com</div>
</body></html>`

  openPrintWindow(html)
}

// Naviguer vers le profil complet
function goToProfile(fi: FI) {
  showDetail.value = false
  router.push(`/etudiants/${fi.etudiant?.id}`)
}

onMounted(load)
</script>

<template>
  <div class="fi-page">
    <UcPageHeader title="Formations individuelles" subtitle="Gestion des formations à la carte">
      <template #actions>
        <button v-if="canWrite" @click="openNew" class="fi-btn fi-btn--primary">+ Nouvelle formation</button>
      </template>
    </UcPageHeader>

    <!-- Filtres -->
    <div class="fi-filters">
      <input v-model="search" type="text" placeholder="Rechercher par nom, matière..." class="fi-search" />
      <select v-model="filterStatut" class="fi-select">
        <option value="">Tous les statuts</option>
        <option value="en_cours">En cours</option>
        <option value="solde">Soldé</option>
        <option value="termine">Terminé</option>
        <option value="annule">Annulé</option>
      </select>
      <span class="fi-count">{{ filtered.length }} formation(s)</span>
    </div>

    <!-- Liste -->
    <div v-if="loading" class="fi-empty">Chargement...</div>
    <div v-else-if="filtered.length === 0" class="fi-empty">Aucune formation individuelle</div>
    <div v-else class="fi-grid">
      <div v-for="fi in filtered" :key="fi.id" class="fi-card" @click="openDetail(fi)">
        <div class="fi-card-header">
          <div>
            <div class="fi-card-name">{{ fi.etudiant?.prenom }} {{ fi.etudiant?.nom }}</div>
            <div class="fi-card-phone">{{ fi.etudiant?.telephone }}</div>
            <div v-if="(fi as any).entreprise" class="fi-card-entreprise">🏢 {{ (fi as any).entreprise }}</div>
          </div>
          <span class="fi-badge" :style="{ background: statutColor(fi.statut) + '20', color: statutColor(fi.statut) }">
            {{ statutLabel(fi.statut) }}
          </span>
        </div>

        <div class="fi-card-body">
          <div class="fi-card-cost">{{ fmtMoney(fi.cout_total) }}</div>
          <div class="fi-card-modules">
            <span v-for="m in fi.modules" :key="m.id" class="fi-module-chip">{{ m.matiere_nom }}</span>
          </div>
          <div class="fi-card-hours">
            {{ fi.modules.reduce((s: number, m: FIModule) => s + m.volume_horaire, 0) }}h total
            · {{ fi.modules.reduce((s: number, m: FIModule) => s + m.heures_effectuees, 0) }}h effectuées
          </div>
        </div>

        <div class="fi-card-footer">
          <div class="fi-paiement-bar">
            <div
              class="fi-paiement-progress"
              :style="{ width: (fi.paiements.reduce((s: number, p: FIPaiement) => s + parseFloat(String(p.montant_paye)), 0) / fi.cout_total * 100) + '%' }"
            />
          </div>
          <div class="fi-paiement-label">
            {{ fmtMoney(fi.paiements.reduce((s: number, p: FIPaiement) => s + parseFloat(String(p.montant_paye)), 0)) }}
            / {{ fmtMoney(fi.cout_total) }}
          </div>
        </div>

        <div v-if="canWrite" class="fi-card-actions" @click.stop>
          <button @click="openEdit(fi)" class="fi-action-btn">Modifier</button>
          <button @click="deleteFI(fi)" class="fi-action-btn fi-action-btn--del">Supprimer</button>
        </div>
      </div>
    </div>

    <!-- Modal Création / Modification -->
    <Teleport to="body">
      <div v-if="showModal" class="fi-overlay" @click.self="showModal = false">
        <div class="fi-modal fi-modal--large">
          <div class="fi-modal-header">
            <h2>{{ editingFI ? 'Modifier la formation' : 'Nouvelle formation individuelle' }}</h2>
            <button @click="showModal = false" class="fi-modal-close">&times;</button>
          </div>
          <div class="fi-modal-body">
            <UcDraftBanner v-if="!editingFI" :show="fiDraftBanner && fiDraft.hasDraft.value" :age-label="fiDraft.draftAgeLabel()"
              @restore="restoreFiDraft" @discard="discardFiDraft" />
            <!-- Toggle groupe -->
            <div v-if="!editingFI" class="fi-group-toggle">
              <label class="fi-toggle-label">
                <input type="checkbox" v-model="isGroupMode" />
                <span>Formation de groupe / Entreprise</span>
              </label>
            </div>

            <!-- Entreprise (mode groupe) -->
            <UcFormGroup v-if="isGroupMode && !editingFI" label="Entreprise">
              <input v-model="groupEntreprise" class="fi-input" placeholder="Nom de l'entreprise" />
            </UcFormGroup>

            <!-- Tarification groupe -->
            <UcFormGroup v-if="isGroupMode && !editingFI" label="Mode de tarification">
              <div style="display:flex;gap:8px;">
                <label class="fi-radio-card" :class="{ 'fi-radio-card--active': groupCoutMode === 'par_personne' }" @click="groupCoutMode = 'par_personne'">
                  <strong>Par personne</strong>
                  <small>Chaque participant paie le coût indiqué</small>
                </label>
                <label class="fi-radio-card" :class="{ 'fi-radio-card--active': groupCoutMode === 'total_groupe' }" @click="groupCoutMode = 'total_groupe'">
                  <strong>Total groupe</strong>
                  <small>Le coût est divisé entre les participants</small>
                </label>
              </div>
              <div v-if="groupCoutMode === 'total_groupe' && groupTotalParticipants > 0" style="font-size:12px;color:#3b82f6;margin-top:6px;font-weight:600;">
                = {{ groupCoutParPersonne.toLocaleString('fr-FR') }} FCFA / personne ({{ groupTotalParticipants }} participants)
              </div>
            </UcFormGroup>

            <!-- Participants groupe -->
            <div v-if="isGroupMode && !editingFI" class="fi-participants-section">
              <div class="fi-participants-header">
                <strong>Participants ({{ groupTotalParticipants }})</strong>
              </div>

              <!-- Nouveaux participants -->
              <div class="fi-participants-block">
                <div class="fi-participants-block-title">Ajouter des participants</div>
                <div v-for="(p, i) in groupNewParticipants" :key="'new-'+i" class="fi-participant-row">
                  <input v-model="p.prenom" placeholder="Prénom" class="fi-input fi-input--sm" />
                  <input v-model="p.nom" placeholder="Nom" class="fi-input fi-input--sm" />
                  <input v-model="p.telephone" placeholder="Téléphone" class="fi-input fi-input--sm" />
                  <input v-model="p.email" placeholder="Email" class="fi-input fi-input--sm" />
                  <button @click="groupNewParticipants.splice(i, 1)" class="fi-btn-icon" title="Retirer">&times;</button>
                </div>
                <button @click="groupNewParticipants.push({ prenom: '', nom: '', telephone: '', email: '' })" class="fi-btn fi-btn--outline" style="margin-top:6px;font-size:13px;">
                  + Ajouter un participant
                </button>
              </div>

              <!-- Étudiants existants -->
              <div class="fi-participants-block" style="margin-top:10px;">
                <div class="fi-participants-block-title">Ou sélectionner des étudiants existants</div>
                <input v-model="groupSearchExisting" placeholder="Rechercher..." class="fi-input fi-input--sm" style="margin-bottom:6px;" />
                <div class="fi-multi-select">
                  <div v-for="e in filteredExistingEtudiants" :key="e.id" class="fi-multi-option"
                    :class="{ 'fi-multi-option--selected': groupEtudiantIds.includes(e.id) }"
                    @click="groupEtudiantIds.includes(e.id) ? groupEtudiantIds.splice(groupEtudiantIds.indexOf(e.id), 1) : groupEtudiantIds.push(e.id)">
                    <span class="fi-multi-check">{{ groupEtudiantIds.includes(e.id) ? '✓' : '' }}</span>
                    <span>{{ e.prenom }} {{ e.nom }}</span>
                  </div>
                </div>
                <div v-if="groupEtudiantIds.length" class="fi-multi-count">{{ groupEtudiantIds.length }} existant(s) sélectionné(s)</div>
              </div>
            </div>

            <!-- Étudiant unique (mode individuel) -->
            <div v-if="!isGroupMode && !editingFI" class="fi-group-toggle" style="margin-bottom:8px;">
              <label class="fi-toggle-label">
                <input type="checkbox" v-model="createNewEtudiant" />
                <span>Nouvel auditeur (créer un nouveau)</span>
              </label>
            </div>
            <UcFormGroup v-if="!isGroupMode && !createNewEtudiant" label="Étudiant" required>
              <select v-model="form.etudiant_id" class="fi-input" :disabled="!!editingFI">
                <option :value="null">-- Sélectionner --</option>
                <option v-for="e in etudiants" :key="e.id" :value="e.id">{{ e.prenom }} {{ e.nom }}</option>
              </select>
            </UcFormGroup>
            <div v-if="!isGroupMode && createNewEtudiant && !editingFI" class="fi-participants-block">
              <div class="fi-participants-block-title">Nouvel auditeur</div>
              <div class="fi-row-2" style="margin-bottom:6px;">
                <input v-model="newEtudiant.prenom" placeholder="Prénom *" class="fi-input" />
                <input v-model="newEtudiant.nom" placeholder="Nom *" class="fi-input" />
              </div>
              <div class="fi-row-2">
                <input v-model="newEtudiant.telephone" placeholder="Téléphone" class="fi-input" />
                <input v-model="newEtudiant.email" placeholder="Email (pour accès compte)" class="fi-input" />
              </div>
              <div style="font-size:11px;color:#64748b;margin-top:4px;">Si un email est fourni, un compte de connexion sera créé automatiquement (mot de passe : Uptech@2026)</div>
            </div>

            <!-- Année académique -->
            <UcFormGroup label="Année académique">
              <select v-model="form.annee_academique_id" class="fi-input">
                <option :value="null">-- Optionnel --</option>
                <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
              </select>
            </UcFormGroup>

            <!-- Coût & pourcentages -->
            <div class="fi-row-3">
              <UcFormGroup label="Coût total (FCFA)" required>
                <input v-model.number="form.cout_total" type="number" min="0" class="fi-input" />
              </UcFormGroup>
              <UcFormGroup label="% Inscription">
                <input v-model.number="form.pct_inscription" type="number" min="0" max="100" class="fi-input" />
              </UcFormGroup>
              <UcFormGroup label="% Formateur">
                <input v-model.number="form.pct_formateur" type="number" min="0" max="100" class="fi-input" />
              </UcFormGroup>
            </div>

            <!-- Aperçu paiement -->
            <div v-if="form.cout_total > 0" class="fi-preview-box">
              <div><strong>Inscription :</strong> {{ fmtMoney(montantInscriptionPreview) }} ({{ form.pct_inscription }}%)</div>
              <div><strong>Solde :</strong> {{ fmtMoney(montantSoldePreview) }} ({{ 100 - form.pct_inscription }}%)</div>
              <div><strong>Rémunération formateurs :</strong> {{ fmtMoney(Math.round(form.cout_total * form.pct_formateur / 100)) }} ({{ form.pct_formateur }}%)</div>
            </div>

            <!-- Dates -->
            <div class="fi-row-2">
              <UcFormGroup label="Date début">
                <input v-model="form.date_debut" type="date" class="fi-input" />
              </UcFormGroup>
              <UcFormGroup label="Date fin">
                <div style="padding:8px 0;font-size:12px;color:#64748b;font-style:italic;">
                  Calculée automatiquement quand tous les modules sont terminés
                </div>
              </UcFormGroup>
            </div>

            <!-- Modules -->
            <div class="fi-modules-section">
              <div class="fi-modules-header">
                <h3>Modules à la carte</h3>
                <span class="fi-hours-total">{{ totalHeuresModules }}h total</span>
                <button @click="addModule" type="button" class="fi-btn fi-btn--small">+ Module</button>
              </div>
              <div v-for="(mod, i) in form.modules" :key="i" class="fi-module-row">
                <select v-model="mod.matiere_id" class="fi-input fi-input--flex">
                  <option :value="null">-- Matière --</option>
                  <option v-for="m in matieres" :key="m.id" :value="m.id">{{ m.nom }}</option>
                </select>
                <input v-model.number="mod.volume_horaire" type="number" min="0" placeholder="Heures" class="fi-input fi-input--hours" />
                <select v-model="mod.enseignant_id" class="fi-input fi-input--flex">
                  <option :value="null">-- Formateur --</option>
                  <option v-for="e in enseignants" :key="e.id" :value="e.id">{{ e.prenom }} {{ e.nom }}</option>
                </select>
                <button @click="removeModule(i)" class="fi-remove-btn" :disabled="form.modules.length <= 1">&times;</button>
              </div>
            </div>
          </div>
          <div class="fi-modal-footer">
            <button @click="showModal = false" class="fi-btn fi-btn--cancel">Annuler</button>
            <button @click="save" :disabled="saving" class="fi-btn fi-btn--primary">
              {{ saving ? 'Enregistrement...' : editingFI ? 'Modifier' : 'Créer la formation' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Modal Détail -->
    <Teleport to="body">
      <div v-if="showDetail && selectedFI" class="fi-overlay" @click.self="showDetail = false">
        <div class="fi-modal fi-modal--large">
          <div class="fi-modal-header">
            <h2>{{ selectedFI.etudiant?.prenom }} {{ selectedFI.etudiant?.nom }}</h2>
            <span class="fi-badge" :style="{ background: statutColor(selectedFI.statut) + '20', color: statutColor(selectedFI.statut), marginLeft: '12px' }">
              {{ statutLabel(selectedFI.statut) }}
            </span>
            <div style="margin-left:auto;display:flex;gap:6px;align-items:center;">
              <button @click="generateCarteFI(selectedFI)" :disabled="!fiInscriptionPayee(selectedFI)"
                class="fi-btn fi-btn--small" :style="fiInscriptionPayee(selectedFI) ? 'background:#eef2ff;color:#4f46e5;' : 'background:#f3f4f6;color:#9ca3af;cursor:not-allowed;'"
                :title="fiInscriptionPayee(selectedFI) ? 'Générer la carte étudiant' : 'Inscription FI doit être payée'">
                🪪 Carte
              </button>
              <button @click="printFicheEtudiant(selectedFI)" class="fi-btn fi-btn--small" style="background:#f1f5f9;color:#475569;">
                🖨 Fiche
              </button>
              <button @click="printCertificatFI(selectedFI)" :disabled="!fiInscriptionPayee(selectedFI)"
                class="fi-btn fi-btn--small" :style="fiInscriptionPayee(selectedFI) ? 'background:#ecfdf5;color:#065f46;' : 'background:#f3f4f6;color:#9ca3af;cursor:not-allowed;'"
                :title="fiInscriptionPayee(selectedFI) ? 'Certificat de scolarité' : 'Inscription FI doit être payée'">
                📜 Certificat
              </button>
              <button @click="goToProfile(selectedFI)" class="fi-btn fi-btn--small" style="background:#fef3c7;color:#92400e;">
                👤 Profil
              </button>
            </div>
            <button @click="showDetail = false" class="fi-modal-close">&times;</button>
          </div>
          <div class="fi-modal-body">
            <!-- Résumé -->
            <div class="fi-detail-summary">
              <div class="fi-detail-item"><span>Coût total</span><strong>{{ fmtMoney(selectedFI.cout_total) }}</strong></div>
              <div class="fi-detail-item"><span>Inscription ({{ selectedFI.pct_inscription }}%)</span><strong>{{ fmtMoney(Math.round(selectedFI.cout_total * selectedFI.pct_inscription / 100)) }}</strong></div>
              <div class="fi-detail-item"><span>Part formateurs ({{ selectedFI.pct_formateur }}%)</span><strong>{{ fmtMoney(Math.round(selectedFI.cout_total * selectedFI.pct_formateur / 100)) }}</strong></div>
            </div>

            <!-- Modules -->
            <h3 style="margin:16px 0 8px;font-size:14px;font-weight:600;">Modules</h3>
            <table class="fi-table">
              <thead>
                <tr>
                  <th>Matière</th>
                  <th>Formateur</th>
                  <th style="text-align:center">Volume</th>
                  <th style="text-align:center">Effectué</th>
                  <th style="text-align:center">Progression</th>
                  <th v-if="canWrite" style="text-align:right">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in selectedFI.modules" :key="m.id">
                  <td class="fi-td-bold">{{ m.matiere_nom }}</td>
                  <td>{{ m.enseignant_nom || '—' }}</td>
                  <td style="text-align:center">{{ m.volume_horaire }}h</td>
                  <td style="text-align:center">
                    <input
                      v-if="canWrite"
                      type="number" min="0" :max="m.volume_horaire"
                      :value="m.heures_effectuees"
                      @change="updateHeures(m, parseInt(($event.target as HTMLInputElement).value) || 0)"
                      class="fi-heures-input"
                    />
                    <span v-else>{{ m.heures_effectuees }}h</span>
                  </td>
                  <td style="text-align:center">
                    <div class="fi-mini-bar">
                      <div class="fi-mini-progress" :style="{
                        width: (m.volume_horaire > 0 ? Math.min(m.heures_effectuees / m.volume_horaire * 100, 100) : 0) + '%',
                        background: m.heures_effectuees >= m.volume_horaire ? '#22c55e' : '#3b82f6'
                      }" />
                    </div>
                    <span v-if="m.heures_effectuees >= m.volume_horaire" style="font-size:10px;color:#22c55e;font-weight:600;">Terminé</span>
                  </td>
                  <td v-if="canWrite" style="text-align:right">
                    <button
                      v-if="m.heures_effectuees < m.volume_horaire && m.enseignant_id"
                      @click="openPlanifier(m)"
                      class="fi-btn fi-btn--small"
                      style="background:#3b82f6;color:#fff;"
                    >📅 Planifier</button>
                    <span v-else-if="!m.enseignant_id" style="font-size:10px;color:#94a3b8;">Pas de formateur</span>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Paiements -->
            <h3 style="margin:16px 0 8px;font-size:14px;font-weight:600;">Paiements</h3>
            <table class="fi-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th style="text-align:right">Montant</th>
                  <th style="text-align:right">Payé</th>
                  <th style="text-align:center">Statut</th>
                  <th v-if="canPay" style="text-align:right">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in selectedFI.paiements" :key="p.id">
                  <td class="fi-td-bold">{{ p.type === 'inscription' ? 'Inscription' : 'Solde' }}</td>
                  <td style="text-align:right">{{ fmtMoney(p.montant) }}</td>
                  <td style="text-align:right">{{ fmtMoney(p.montant_paye) }}</td>
                  <td style="text-align:center">
                    <span class="fi-badge-sm" :style="{ background: paiementStatutColor(p.statut) + '20', color: paiementStatutColor(p.statut) }">
                      {{ paiementStatutLabel(p.statut) }}
                    </span>
                  </td>
                  <td v-if="canPay" style="text-align:right;white-space:nowrap;">
                    <button
                      v-if="p.statut !== 'paye'"
                      @click="openPay(p)"
                      class="fi-btn fi-btn--small fi-btn--pay"
                    >Payer</button>
                    <button
                      v-if="p.montant_paye > 0"
                      @click="printRecuFI(selectedFI!, p)"
                      class="fi-btn fi-btn--small"
                      style="background:#f1f5f9;color:#475569;margin-left:4px;"
                    >🖨 Reçu</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Modal Paiement -->
    <Teleport to="body">
      <div v-if="showPayModal && payingEcheance" class="fi-overlay" @click.self="showPayModal = false">
        <div class="fi-modal" style="max-width:400px">
          <div class="fi-modal-header">
            <h2>Enregistrer un paiement</h2>
            <button @click="showPayModal = false" class="fi-modal-close">&times;</button>
          </div>
          <div class="fi-modal-body">
            <p style="margin-bottom:12px;color:#666;">
              {{ payingEcheance.type === 'inscription' ? 'Frais d\'inscription' : 'Solde' }}
              — Reste à payer : <strong>{{ fmtMoney(parseFloat(String(payingEcheance.montant)) - parseFloat(String(payingEcheance.montant_paye))) }}</strong>
            </p>
            <UcFormGroup label="Montant à encaisser (FCFA)" required>
              <input v-model.number="payAmount" type="number" min="1" class="fi-input" />
            </UcFormGroup>
          </div>
          <div class="fi-modal-footer">
            <button @click="showPayModal = false" class="fi-btn fi-btn--cancel">Annuler</button>
            <button @click="confirmPay" :disabled="payingLoading || payAmount <= 0" class="fi-btn fi-btn--primary">
              {{ payingLoading ? 'Encaissement...' : 'Confirmer' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Modal Planification -->
    <Teleport to="body">
      <div v-if="showPlanModal && planModule" class="fi-overlay" @click.self="showPlanModal = false">
        <div class="fi-modal" style="max-width:520px">
          <div class="fi-modal-header">
            <h2>📅 Planifier les séances</h2>
            <button @click="showPlanModal = false" class="fi-modal-close">&times;</button>
          </div>
          <div class="fi-modal-body">
            <!-- Résultat -->
            <template v-if="planResult">
              <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
                <div style="font-weight:700;color:#065f46;font-size:15px;margin-bottom:4px;">{{ planResult.seances_creees ?? planResult.total_crees }} séance(s) créée(s)</div>
                <div v-if="planResult.total_exclues" style="font-size:12px;color:#92400e;">{{ planResult.total_exclues }} date(s) exclue(s) :</div>
                <ul v-if="planResult.exclues?.length" style="margin:6px 0 0 16px;font-size:12px;color:#78716c;">
                  <li v-for="(ex, i) in planResult.exclues" :key="i">{{ ex.date }} — {{ ex.raison }}</li>
                </ul>
              </div>
              <button @click="showPlanModal = false" class="fi-btn fi-btn--primary" style="width:100%;">Fermer</button>
            </template>

            <!-- Formulaire -->
            <template v-else>
              <!-- Info module -->
              <div class="fi-plan-info">
                <div><strong>{{ planModule.matiere_nom }}</strong></div>
                <div>Formateur : {{ planModule.enseignant_nom }}</div>
                <div style="margin-top:4px;">
                  Volume : <strong>{{ planModule.volume_horaire }}h</strong>
                  · Effectué : {{ planModule.heures_effectuees }}h
                  · <span style="color:#0369a1;font-weight:600;">Restant : {{ planModule.volume_horaire - planModule.heures_effectuees }}h</span>
                </div>
                <!-- Barre de progression -->
                <div style="height:6px;background:#e0f2fe;border-radius:4px;overflow:hidden;margin-top:6px;">
                  <div :style="{ width: (planModule.volume_horaire > 0 ? Math.min(planModule.heures_effectuees / planModule.volume_horaire * 100, 100) : 0) + '%', height:'100%', background: planModule.heures_effectuees >= planModule.volume_horaire ? '#22c55e' : '#0284c7', borderRadius:'4px' }"></div>
                </div>
              </div>

              <!-- Option groupe -->
              <div v-if="(selectedFI as any)?.groupe_fi" class="fi-group-toggle" style="margin-bottom:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;">
                <label class="fi-toggle-label">
                  <input type="checkbox" v-model="planForGroupe" />
                  <span style="font-weight:600;color:#1d4ed8;">Planifier pour tout le groupe ({{ formations.filter(f => (f as any).groupe_fi === (selectedFI as any)?.groupe_fi).length }} étudiants)</span>
                </label>
                <div v-if="(selectedFI as any)?.entreprise" style="font-size:12px;color:#64748b;margin-top:2px;">🏢 {{ (selectedFI as any).entreprise }}</div>
              </div>

              <!-- Disponibilités du prof -->
              <div v-if="planDispos.length > 0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:10px;">
                <div style="font-size:12px;font-weight:600;color:#166534;margin-bottom:6px;">Disponibilités du formateur</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                  <span v-for="d in planDispos" :key="d.jour + d.heure_debut"
                    style="font-size:11px;background:#dcfce7;color:#166534;padding:3px 8px;border-radius:4px;">
                    {{ joursSemaine.find(j => j.value === d.jour)?.label ?? d.jour }} {{ d.heure_debut.toString().slice(0,5) }}–{{ d.heure_fin.toString().slice(0,5) }}
                  </span>
                </div>
              </div>
              <div v-else-if="planModule.enseignant_id && !loadingDispos" style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:11px;color:#92400e;">
                Aucune disponibilité déclarée — toutes les dates seront acceptées.
              </div>

              <!-- Jours de répétition -->
              <UcFormGroup label="Jours de répétition" required>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                  <button v-for="j in joursSemaine" :key="j.value"
                    type="button"
                    @click="togglePlanJour(j.value)"
                    :style="{
                      padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                      border: planForm.jours.includes(j.value) ? '2px solid #1d4ed8' : '1.5px solid #cbd5e1',
                      background: planForm.jours.includes(j.value) ? '#dbeafe' : '#fff',
                      color: planForm.jours.includes(j.value) ? '#1d4ed8' : '#64748b',
                    }"
                  >{{ j.label }}</button>
                </div>
                <p v-if="planForm.jours.length > 1" style="font-size:11px;color:#64748b;margin-top:4px;">
                  {{ planForm.jours.length }} jours/semaine — le module sera couvert plus rapidement.
                </p>
              </UcFormGroup>

              <!-- Mode -->
              <UcFormGroup label="Mode">
                <select v-model="planForm.mode" class="fi-input">
                  <option value="presentiel">Présentiel</option>
                  <option value="en_ligne">En ligne</option>
                  <option value="hybride">Hybride</option>
                </select>
              </UcFormGroup>

              <!-- Horaires -->
              <div class="fi-row-2">
                <UcFormGroup label="Heure début" required>
                  <input v-model="planForm.heure_debut" type="time" class="fi-input" />
                </UcFormGroup>
                <UcFormGroup label="Heure fin" required>
                  <input v-model="planForm.heure_fin" type="time" class="fi-input" />
                </UcFormGroup>
              </div>

              <!-- Date début -->
              <UcFormGroup label="À partir du" required>
                <input v-model="planForm.date_debut" type="date" class="fi-input" />
              </UcFormGroup>

              <!-- Salle -->
              <UcFormGroup label="Salle">
                <input v-model="planForm.salle" type="text" class="fi-input" placeholder="Ex: Salle A, Bureau 3…" />
              </UcFormGroup>

              <!-- Aperçu -->
              <div v-if="previewNbSeances > 0" class="fi-plan-preview">
                <strong>{{ previewNbSeances }} séance(s)</strong> de {{ planSeanceDuree }}h seront créées
                chaque <strong>{{ planForm.jours.map(j => joursSemaine.find(x => x.value === j)?.label).join(', ') }}</strong>
                de <strong>{{ planForm.heure_debut }}</strong> à <strong>{{ planForm.heure_fin }}</strong>
                <div style="font-size:11px;color:#64748b;margin-top:4px;">
                  <template v-if="planSeancesParSemaine > 1">{{ planSeancesParSemaine }}x/semaine · </template>
                  ~{{ planEstimSemaines }} semaine(s) pour couvrir {{ planModule.volume_horaire - planModule.heures_effectuees }}h restantes
                  <br/>Les séances s'arrêtent automatiquement quand les heures sont épuisées.
                </div>
                <div v-if="planSeances.length > 0" style="margin-top:6px;font-size:11px;color:#92400e;">
                  ⚠ {{ planSeances.length }} séance(s) déjà planifiée(s) pour ce module.
                </div>
              </div>
            </template>
          </div>
          <div v-if="!planResult" class="fi-modal-footer">
            <button @click="showPlanModal = false" class="fi-btn fi-btn--cancel">Annuler</button>
            <button @click="submitPlan" :disabled="planLoading || previewNbSeances <= 0" class="fi-btn fi-btn--primary" style="background:#3b82f6;">
              {{ planLoading ? 'Planification...' : `Créer ${previewNbSeances} séance(s)` }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Modal carte étudiant FI -->
    <UcModal v-model="showCardModal" title="Carte d'étudiant" @close="showCardModal = false">
      <div style="display:flex;justify-content:center;padding:10px 0;">
        <canvas ref="cardCanvas" style="max-width:100%;border:1px solid #e5e7eb;border-radius:8px;"></canvas>
      </div>
      <template #footer>
        <button @click="printCarteFI" class="fi-btn fi-btn--small" style="background:#f1f5f9;color:#475569;">🖨 Imprimer</button>
        <button @click="downloadCarteFI" class="fi-btn fi-btn--small" style="background:#eef2ff;color:#4f46e5;">⬇ Télécharger</button>
      </template>
    </UcModal>
  </div>
</template>

<style scoped>
.fi-page { padding: 0 0 40px; }

/* Filtres */
.fi-filters { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.fi-search { flex: 1; min-width: 200px; padding: 8px 14px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; }
.fi-select { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: #fff; }
.fi-count { font-size: 12px; color: #94a3b8; }

/* Grille cartes */
.fi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
.fi-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  padding: 16px; cursor: pointer; transition: box-shadow .2s, border-color .2s;
}
.fi-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.08); border-color: #cbd5e1; }
.fi-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.fi-card-name { font-weight: 700; font-size: 15px; color: #1e293b; }
.fi-card-phone { font-size: 12px; color: #94a3b8; margin-top: 2px; }
.fi-card-entreprise { font-size: 11px; color: #1d4ed8; background: #eff6ff; display: inline-block; padding: 1px 8px; border-radius: 4px; margin-top: 3px; }
.fi-group-toggle { margin-bottom: 12px; }
.fi-toggle-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; color: #334155; }
.fi-toggle-label input[type="checkbox"] { width: 18px; height: 18px; accent-color: #3b82f6; }
.fi-multi-select { max-height: 200px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px; }
.fi-multi-option { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: background .15s; }
.fi-multi-option:hover { background: #f1f5f9; }
.fi-multi-option--selected { background: #eff6ff; color: #1d4ed8; font-weight: 600; }
.fi-multi-check { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border: 2px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 700; }
.fi-multi-option--selected .fi-multi-check { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.fi-multi-count { font-size: 12px; color: #3b82f6; font-weight: 600; margin-top: 6px; }
.fi-card-body { margin-bottom: 12px; }
.fi-card-cost { font-size: 20px; font-weight: 800; color: #e30613; margin-bottom: 8px; }
.fi-card-modules { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.fi-module-chip {
  background: #f1f5f9; color: #475569; font-size: 11px; padding: 3px 8px;
  border-radius: 20px; font-weight: 500;
}
.fi-card-hours { font-size: 12px; color: #64748b; }
.fi-card-footer { margin-bottom: 8px; }
.fi-paiement-bar { height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; margin-bottom: 4px; }
.fi-paiement-progress { height: 100%; background: #22c55e; border-radius: 3px; transition: width .3s; }
.fi-paiement-label { font-size: 11px; color: #64748b; }
.fi-card-actions { display: flex; gap: 8px; justify-content: flex-end; }
.fi-action-btn {
  font-size: 12px; padding: 4px 10px; border: 1px solid #e2e8f0; border-radius: 6px;
  background: #fff; color: #475569; cursor: pointer;
}
.fi-action-btn:hover { background: #f8fafc; }
.fi-action-btn--del { color: #ef4444; border-color: #fecaca; }
.fi-action-btn--del:hover { background: #fef2f2; }

/* Badge */
.fi-badge {
  font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px;
}
.fi-badge-sm {
  font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 12px;
}

/* Modal */
.fi-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex;
  align-items: center; justify-content: center; z-index: 9999; padding: 20px;
}
.fi-modal {
  background: #fff; border-radius: 16px; width: 100%; max-width: 560px;
  max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.15);
}
.fi-modal--large { max-width: 720px; }
.fi-modal-header {
  display: flex; align-items: center; padding: 18px 24px; border-bottom: 1px solid #f1f5f9;
}
.fi-modal-header h2 { font-size: 16px; font-weight: 700; color: #1e293b; }
.fi-modal-close { margin-left: auto; background: none; border: none; font-size: 22px; cursor: pointer; color: #94a3b8; }
.fi-modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
.fi-modal-footer {
  display: flex; justify-content: flex-end; gap: 10px; padding: 14px 24px;
  border-top: 1px solid #f1f5f9;
}

/* Form */
.fi-input {
  width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 13px; background: #fff;
}
.fi-input:disabled { opacity: .5; cursor: not-allowed; }
.fi-input--flex { flex: 1; }
.fi-input--hours { width: 80px; flex: none; }
.fi-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fi-row-3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; }

/* Preview box */
.fi-preview-box {
  background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px;
  padding: 12px 16px; margin: 12px 0; font-size: 13px; color: #166534;
  display: flex; flex-direction: column; gap: 4px;
}

/* Modules section */
.fi-modules-section { margin-top: 16px; }
.fi-modules-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}
.fi-modules-header h3 { font-size: 14px; font-weight: 600; color: #1e293b; margin: 0; }
.fi-hours-total { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 10px; }
.fi-module-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.fi-remove-btn {
  width: 28px; height: 28px; border: 1px solid #fecaca; border-radius: 6px;
  background: #fff; color: #ef4444; font-size: 16px; cursor: pointer; flex-shrink: 0;
}
.fi-remove-btn:hover { background: #fef2f2; }
.fi-remove-btn:disabled { opacity: .3; cursor: not-allowed; }

/* Buttons */
.fi-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.fi-btn--primary { background: #e30613; color: #fff; }
.fi-btn--primary:hover { background: #c00511; }
.fi-btn--primary:disabled { opacity: .5; cursor: not-allowed; }
.fi-btn--cancel { background: #f1f5f9; color: #475569; }
.fi-btn--small { padding: 4px 10px; font-size: 11px; }
.fi-btn--pay { background: #22c55e; color: #fff; }
.fi-btn--pay:hover { background: #16a34a; }

/* Detail */
.fi-detail-summary {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;
}
.fi-detail-item {
  background: #f8fafc; border-radius: 10px; padding: 12px; text-align: center;
}
.fi-detail-item span { display: block; font-size: 11px; color: #94a3b8; margin-bottom: 4px; }
.fi-detail-item strong { font-size: 15px; color: #1e293b; }

/* Table */
.fi-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.fi-table th { padding: 8px 10px; text-align: left; font-size: 11px; color: #94a3b8; text-transform: uppercase; border-bottom: 1px solid #f1f5f9; }
.fi-table td { padding: 10px; border-bottom: 1px solid #f8fafc; }
.fi-td-bold { font-weight: 600; color: #1e293b; }

/* Mini progress bar */
.fi-mini-bar { width: 60px; height: 5px; background: #f1f5f9; border-radius: 3px; overflow: hidden; display: inline-block; }
.fi-mini-progress { height: 100%; background: #3b82f6; border-radius: 3px; }

/* Input heures */
.fi-heures-input {
  width: 55px; padding: 4px 6px; border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 12px; text-align: center; background: #f8fafc;
}
.fi-heures-input:focus { border-color: #3b82f6; outline: none; background: #fff; }

/* Plan modal */
.fi-plan-info {
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 12px; margin-bottom: 14px; font-size: 13px; color: #475569;
  display: flex; flex-direction: column; gap: 3px;
}
.fi-plan-preview {
  background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;
  padding: 10px 14px; margin-top: 12px; font-size: 13px; color: #1e40af;
}

.fi-empty { text-align: center; padding: 40px; color: #94a3b8; font-size: 14px; }

/* Radio card (tarification) */
.fi-radio-card {
  flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 12px 14px;
  border: 2px solid #e2e8f0; border-radius: 10px; cursor: pointer; transition: all .15s;
  background: #fff;
}
.fi-radio-card strong { font-size: 13px; color: #334155; }
.fi-radio-card small { font-size: 11px; color: #94a3b8; }
.fi-radio-card--active { border-color: #3b82f6; background: #eff6ff; }
.fi-radio-card--active strong { color: #1d4ed8; }

/* Participants section */
.fi-participants-section { margin-top: 8px; }
.fi-participants-header { font-size: 14px; color: #1e293b; margin-bottom: 8px; }
.fi-participants-block { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; }
.fi-participants-block-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .3px; margin-bottom: 8px; }
.fi-participant-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.fi-input--sm { padding: 6px 10px; font-size: 12px; }
.fi-btn-icon {
  width: 28px; height: 28px; border: 1px solid #fecaca; border-radius: 6px;
  background: #fff; color: #ef4444; font-size: 16px; cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.fi-btn-icon:hover { background: #fef2f2; }
.fi-btn--outline { background: #fff; border: 1px dashed #cbd5e1; color: #475569; border-radius: 8px; padding: 6px 14px; cursor: pointer; }
.fi-btn--outline:hover { border-color: #3b82f6; color: #3b82f6; }
</style>
