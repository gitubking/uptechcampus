<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import QRCode from 'qrcode'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'
import UcFormGrid from '@/components/ui/UcFormGrid.vue'

const auth = useAuthStore()
const isDg = computed(() => auth.user?.role === 'dg')
const deletingPaiementId = ref<number | null>(null)

const showModal = ref(false)
const showEditModal = ref(false)
const loading = ref(false)
const saving = ref(false)
const confirmingId = ref<number | null>(null)
const showAllHistory = ref(false)

const editingPaiement = ref<Paiement | null>(null)
const editForm = ref({
  montant: 0,
  type_paiement: 'mensualite',
  mois_concerne: '',
  confirmed_at: '',
  mode_paiement: 'especes',
  reference: '',
  observation: '',
})

// Toast
const toast = ref<{ msg: string; type: 'success' | 'error' } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string, type: 'success' | 'error' = 'success') {
  toast.value = { msg, type }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 4000)
}

interface Paiement {
  id: number; numero_recu: string; inscription_id: number
  type_paiement: string; mois_concerne: string | null
  montant: number; mode_paiement: string; statut: string
  created_at: string; confirmed_at: string | null
  etudiant: { id: number; nom: string; prenom: string }
}
interface Echeance {
  id: number; inscription_id: number; mois: string
  montant: number; type_echeance: string; statut: string
  mois_paye?: string | null
  date_paiement?: string | null
  etudiant: { id: number; nom: string; prenom: string; numero_etudiant: string }
  filiere: { id: number; nom: string }
}
interface Inscription {
  id: number; statut: string
  etudiant: { id: number; nom: string; prenom: string; numero_etudiant: string }
  filiere: { id: number; nom: string; type_formation_id?: number | null; frais_inscription?: number; mensualite?: number; montant_tenue?: number; duree_mois?: number } | null
  classe: { id: number; nom: string } | null
  mensualite: number; frais_inscription: number; frais_tenue?: number
}

const paiements = ref<Paiement[]>([])
const echeances = ref<Echeance[]>([])
const inscriptions = ref<Inscription[]>([])
const typesFormation = ref<{ id: number; nom: string }[]>([])

// ── Sélection en cascade dans le modal paiement ────────────────────────────
const formTypeFormationId = ref<string>('')   // étape 1
const formFiliereId       = ref<string>('')   // étape 2
const formClasseId        = ref<string>('')   // étape 3
// inscription_id dans form.inscription_id   // étape 4

const form = ref({
  inscription_id: '' as string | number,
  type_paiement: 'mensualite',
  mois_concerne: '',
  confirmed_at: '',
  montant: 0,
  mode_paiement: 'especes',
  reference: '',
})

const modeLabel: Record<string, string> = { especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', virement: 'Virement', cheque: 'Chèque' }
const avatarColors = ['#E30613','#3b82f6','#7c3aed','#0891b2','#be185d','#f97316','#15803d']
function initials(p: string, n: string) { return (p?.[0] ?? '') + (n?.[0] ?? '') }
function avatarColor(i: number) { return avatarColors[i % avatarColors.length] }
function fmt(n: number | string) { return Number(n).toLocaleString('fr-FR') }
function fmtMois(d: string) {
  if (!d) return '—'
  try {
    // Normaliser : extraire les 10 premiers caractères (YYYY-MM-DD) peu importe le format retourné (date, timestamp, ISO)
    const ymd = d.substring(0, 10) // ex: "2026-03-02"
    const isFullDate = ymd.length === 10 && ymd[4] === '-' && ymd[7] === '-'
    if (isFullDate) {
      return new Date(ymd + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    }
    // Sinon YYYY-MM, afficher mois + année
    return new Date(d.substring(0, 7) + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  } catch { return d }
}
function fmtDate(d: string) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('fr-FR') } catch { return d }
}

const now = new Date()
const todayStr = now.toISOString().substring(0, 10)
const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`

// ── Utilitaire impression (blob URL, évite l'interception du service worker) ──
function openPrintWindow(html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (w) {
    w.addEventListener('load', () => {
      w.addEventListener('afterprint', () => { try { w.close() } catch { /* ignore */ }; URL.revokeObjectURL(url) })
      setTimeout(() => { w.print() }, 300)
    })
  } else {
    URL.revokeObjectURL(url)
  }
}

// ── Filtres stats ──────────────────────────────────────────────────────────────
const statsType     = ref('')               // '' | 'mensualite' | 'frais_inscription' | 'tenue'
const statsMois     = ref(currentMonthStr)  // YYYY-MM
const statsFiliereId = ref('')
const statsClasseId  = ref('')

const statsFilieresOptions = computed(() => {
  const seen = new Set<number>()
  return inscriptions.value
    .filter(i => i.filiere && !seen.has(Number(i.filiere.id)) && seen.add(Number(i.filiere.id)))
    .map(i => ({ id: i.filiere!.id, nom: i.filiere!.nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom))
})

const statsClassesOptions = computed(() => {
  const seen = new Set<number>()
  return inscriptions.value
    .filter(i => i.classe && !seen.has(Number(i.classe.id)) && seen.add(Number(i.classe.id)))
    .map(i => ({ id: i.classe!.id, nom: i.classe!.nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom))
})

// ── KPIs ──────────────────────────────────────────────────────────────────────
const stats = computed(() => {
  const filteredInscIds = new Set(
    inscriptions.value
      .filter(i => !statsFiliereId.value || String(i.filiere?.id) === statsFiliereId.value)
      .filter(i => !statsClasseId.value  || String(i.classe?.id)  === statsClasseId.value)
      .map(i => Number(i.id))
  )
  const confirmedPaiements = paiements.value.filter(p =>
    p.statut === 'confirme' &&
    filteredInscIds.has(Number(p.inscription_id)) &&
    (!statsType.value || p.type_paiement === statsType.value)
  )
  const encaisse_mois = confirmedPaiements.filter(p => {
    if (!p.confirmed_at) return false
    const d = new Date(p.confirmed_at)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === statsMois.value
  }).reduce((s, p) => s + Number(p.montant), 0)
  const total_encaisse = confirmedPaiements.reduce((s, p) => s + Number(p.montant), 0)
  const filteredEcheances = echeances.value.filter(e =>
    filteredInscIds.has(Number(e.inscription_id)) &&
    (!statsType.value || e.type_echeance === statsType.value)
  )
  const total_prevu = filteredEcheances.reduce((s, e) => s + Number(e.montant), 0)
  const en_retard = filteredEcheances.filter(e =>
    ['non_paye','partiellement_paye'].includes(e.statut) && e.mois.substring(0, 7) < todayStr.substring(0, 7)
  ).length
  const en_attente = paiements.value.filter(p => p.statut === 'en_attente' && filteredInscIds.has(Number(p.inscription_id))).length
  return { total_encaisse, total_prevu, reste: Math.max(0, total_prevu - total_encaisse), encaisse_mois, en_retard, en_attente }
})

// ── Fiche par étudiant ────────────────────────────────────────────────────────
const ficheEtudiants = computed(() => {
  const map: Record<number, {
    inscription_id: number, etudiant: any, filiere: any,
    frais_prevu: number, frais_paye: number, frais_total_verse: number,
    tenue_prevu: number, tenue_paye: number,
    mensualite_montant: number, nb_mois_total: number, nb_mois_payes: number,
    total_prevu: number, total_paye: number,
  }> = {}

  for (const insc of inscriptions.value) {
    if (!insc.etudiant) continue
    map[insc.id] = {
      inscription_id: insc.id, etudiant: insc.etudiant, filiere: insc.filiere,
      frais_prevu: 0, frais_paye: 0, frais_total_verse: 0,
      tenue_prevu: 0, tenue_paye: 0,
      mensualite_montant: 0,
      nb_mois_total: 0, nb_mois_payes: 0, total_prevu: 0, total_paye: 0,
    }
  }

  // Tarifs depuis les échéances (source de vérité — incluent la bourse)
  for (const e of echeances.value) {
    if (!e.inscription_id) continue
    const entry = map[e.inscription_id]
    if (!entry) continue
    entry.total_prevu += Number(e.montant)
    if (e.type_echeance === 'mensualite') {
      entry.nb_mois_total++
      if (e.statut === 'paye') entry.nb_mois_payes++
      // Prendre le montant de la 1ère échéance mensualité comme référence
      if (entry.mensualite_montant === 0) entry.mensualite_montant = Number(e.montant)
    }
    if (e.type_echeance === 'frais_inscription') {
      entry.frais_prevu = Number(e.montant)
    }
    if (e.type_echeance === 'tenue') {
      entry.tenue_prevu = Number(e.montant)
    }
  }

  // Fallback : si aucune échéance, utiliser les tarifs filière bruts
  for (const insc of inscriptions.value) {
    const entry = map[insc.id]
    if (!entry) continue
    if (entry.frais_prevu === 0) entry.frais_prevu = Number(insc.filiere?.frais_inscription) || Number(insc.frais_inscription) || 0
    if (entry.mensualite_montant === 0) entry.mensualite_montant = Number(insc.filiere?.mensualite) || Number(insc.mensualite) || 0
    if (entry.tenue_prevu === 0) entry.tenue_prevu = Number(insc.filiere?.montant_tenue) || 0
  }

  for (const p of paiements.value) {
    if (!p.inscription_id || p.statut !== 'confirme') continue
    const entry = map[p.inscription_id]
    if (!entry) continue
    entry.total_paye += Number(p.montant)
    if (p.type_paiement === 'frais_inscription') {
      entry.frais_total_verse += Number(p.montant)
      // frais_paye plafonné à frais_prevu (le surplus va vers les mensualités)
      entry.frais_paye = Math.min(entry.frais_total_verse, entry.frais_prevu)
    }
    if (p.type_paiement === 'tenue') {
      entry.tenue_paye = Math.min(entry.tenue_paye + Number(p.montant), entry.tenue_prevu)
    }
  }

  return Object.values(map).sort((a, b) =>
    (b.total_prevu - b.total_paye) - (a.total_prevu - a.total_paye)
  )
})

function getMensualites(inscriptionId: number) {
  return echeances.value
    .filter(e => e.inscription_id === inscriptionId && e.type_echeance === 'mensualite')
    .sort((a, b) => a.mois.localeCompare(b.mois))
}

// ── Modal helpers ──────────────────────────────────────────────────────────────
const activeInscriptions = computed(() =>
  inscriptions.value.filter(i => ['inscrit_actif', 'pre_inscrit', 'diplome'].includes(i.statut))
)
const selectedInscription = computed(() =>
  inscriptions.value.find(i => i.id === Number(form.value.inscription_id)) ?? null
)

// ── Cascade : Filières filtrées par type de formation sélectionné ────────────
const cascadeFilieres = computed(() => {
  const seen = new Map<string, { id: number; nom: string; type_formation_id: number | null }>()
  for (const insc of activeInscriptions.value) {
    if (!insc.filiere) continue
    if (formTypeFormationId.value && String(insc.filiere.type_formation_id) !== formTypeFormationId.value) continue
    const key = String(insc.filiere.id)
    if (!seen.has(key)) seen.set(key, { id: insc.filiere.id, nom: insc.filiere.nom, type_formation_id: insc.filiere.type_formation_id ?? null })
  }
  return Array.from(seen.values()).sort((a, b) => a.nom.localeCompare(b.nom))
})

// ── Cascade : Classes filtrées par filière sélectionnée ──────────────────────
const cascadeClasses = computed(() => {
  const seen = new Map<string, { id: number; nom: string }>()
  for (const insc of activeInscriptions.value) {
    if (!insc.classe) continue
    if (formFiliereId.value && String(insc.filiere?.id) !== formFiliereId.value) continue
    if (formTypeFormationId.value && String(insc.filiere?.type_formation_id) !== formTypeFormationId.value) continue
    const key = String(insc.classe.id)
    if (!seen.has(key)) seen.set(key, { id: insc.classe.id, nom: insc.classe.nom })
  }
  return Array.from(seen.values()).sort((a, b) => a.nom.localeCompare(b.nom))
})

// Indique si des étudiants d'une filière ont une classe ou non
const cascadeHasClasses = computed(() => cascadeClasses.value.length > 0)

// ── Cascade : Étudiants filtrés par filière + classe ────────────────────────
const cascadeEtudiants = computed(() => {
  return activeInscriptions.value.filter(insc => {
    if (!insc.etudiant) return false
    if (formTypeFormationId.value && String(insc.filiere?.type_formation_id) !== formTypeFormationId.value) return false
    if (formFiliereId.value && String(insc.filiere?.id) !== formFiliereId.value) return false
    if (formClasseId.value) {
      // Si une classe est sélectionnée, filtrer strictement par classe
      if (String(insc.classe?.id) !== formClasseId.value) return false
    } else if (cascadeHasClasses.value && formFiliereId.value) {
      // Si des classes existent pour cette filière mais qu'aucune n'est sélectionnée,
      // montrer quand même les étudiants sans classe affectée
    }
    return true
  }).sort((a, b) => `${a.etudiant.nom}${a.etudiant.prenom}`.localeCompare(`${b.etudiant.nom}${b.etudiant.prenom}`))
})

// Réinitialise les niveaux inférieurs quand un niveau parent change
function onTypeFormationChange() {
  formFiliereId.value = ''
  formClasseId.value = ''
  form.value.inscription_id = ''
  form.value.montant = 0
}
function onCascadeFiliereChange() {
  formClasseId.value = ''
  form.value.inscription_id = ''
  form.value.montant = 0
}
function onCascadeClasseChange() {
  form.value.inscription_id = ''
  form.value.montant = 0
}

// Pré-remplit les sélecteurs cascade depuis une inscription connue
function prefillCascade(inscId: number | string) {
  const insc = inscriptions.value.find(i => String(i.id) === String(inscId))
  if (!insc) return
  formTypeFormationId.value = insc.filiere?.type_formation_id ? String(insc.filiere.type_formation_id) : ''
  formFiliereId.value = insc.filiere ? String(insc.filiere.id) : ''
  formClasseId.value = insc.classe ? String(insc.classe.id) : ''
}

function resetCascade() {
  formTypeFormationId.value = ''
  formFiliereId.value = ''
  formClasseId.value = ''
}

function openModal() {
  resetCascade()
  form.value = { inscription_id: '', type_paiement: 'mensualite', mois_concerne: '', confirmed_at: '', montant: 0, mode_paiement: 'especes', reference: '' }
  showModal.value = true
}

function openModalFor(fiche: typeof ficheEtudiants.value[0]) {
  const typePrio = fiche.frais_paye < fiche.frais_prevu ? 'frais_inscription' : 'mensualite'
  const montantPrio = typePrio === 'frais_inscription'
    ? fiche.frais_prevu - fiche.frais_paye
    : fiche.mensualite_montant
  prefillCascade(fiche.inscription_id)
  form.value = {
    inscription_id: fiche.inscription_id,
    type_paiement: typePrio,
    mois_concerne: '',
    confirmed_at: '',
    montant: montantPrio,
    mode_paiement: 'especes',
    reference: '',
  }
  showModal.value = true
}

function getTarifFromInsc(insc: Inscription, type: string) {
  const frais = Number(insc.filiere?.frais_inscription) || Number(insc.frais_inscription) || 0
  const mens = Number(insc.filiere?.mensualite) || Number(insc.mensualite) || 0
  const tenue = Number(insc.filiere?.montant_tenue) || Number(insc.frais_tenue) || 0
  if (type === 'frais_inscription') return frais
  if (type === 'tenue') return tenue
  return mens
}
function onInscriptionChange() {
  const insc = selectedInscription.value
  if (insc) form.value.montant = getTarifFromInsc(insc, form.value.type_paiement)
}
function onTypeChange() {
  const insc = selectedInscription.value
  if (insc) form.value.montant = getTarifFromInsc(insc, form.value.type_paiement)
}

// ── Chargement ────────────────────────────────────────────────────────────────
const loadError = ref('')
async function load() {
  loading.value = true
  loadError.value = ''
  // Chargement indépendant : une erreur sur un endpoint ne bloque pas les autres
  const [rP, rE, rI, rT] = await Promise.allSettled([
    api.get('/paiements'), api.get('/echeances'), api.get('/inscriptions'), api.get('/types-formation'),
  ])
  if (rP.status === 'fulfilled') {
    paiements.value = rP.value.data.data ?? rP.value.data
  } else {
    console.error('Erreur paiements:', rP.reason)
    loadError.value = 'Erreur de chargement des paiements.'
  }
  if (rE.status === 'fulfilled') {
    echeances.value = rE.value.data.data ?? rE.value.data
  } else {
    console.error('Erreur échéances:', rE.reason)
    if (!loadError.value) loadError.value = 'Erreur de chargement des échéances.'
  }
  if (rI.status === 'fulfilled') {
    inscriptions.value = (rI.value.data.data ?? rI.value.data).filter((i: any) => i.etudiant)
  } else {
    console.error('Erreur inscriptions:', rI.reason)
    if (!loadError.value) loadError.value = 'Erreur de chargement des inscriptions.'
  }
  if (rT.status === 'fulfilled') {
    typesFormation.value = (rT.value.data.data ?? rT.value.data).filter((t: any) => t.actif !== false)
  }
  loading.value = false
}

async function savePaiement() {
  if (!form.value.inscription_id || !form.value.montant) return
  saving.value = true
  try {
    const res = await api.post('/paiements', {
      inscription_id: Number(form.value.inscription_id),
      type_paiement: form.value.type_paiement,
      mois_concerne: form.value.mois_concerne || null,
      confirmed_at: form.value.confirmed_at || null,
      montant: form.value.montant,
      mode_paiement: form.value.mode_paiement,
      reference: form.value.reference || null,
    })
    showModal.value = false
    await load()
    // Proposer impression du reçu
    recuToPrint.value = res.data
    showRecuPrompt.value = true
    showToast('Paiement enregistré avec succès')
  } catch (e: any) {
    showToast(e.response?.data?.message ?? 'Erreur lors de l\'enregistrement', 'error')
  } finally { saving.value = false }
}

function openEditModal(p: Paiement) {
  editingPaiement.value = p
  editForm.value = {
    montant: Number(p.montant),
    type_paiement: p.type_paiement,
    mois_concerne: p.mois_concerne ? p.mois_concerne.substring(0, 10) : '',
    confirmed_at: p.confirmed_at ? p.confirmed_at.substring(0, 10) : '',
    mode_paiement: p.mode_paiement,
    reference: '',
    observation: '',
  }
  showEditModal.value = true
}

async function saveEdit() {
  if (!editingPaiement.value) return
  saving.value = true
  try {
    await api.put(`/paiements/${editingPaiement.value.id}`, {
      montant: Number(editForm.value.montant),
      type_paiement: editForm.value.type_paiement,
      mois_concerne: editForm.value.mois_concerne || null,
      confirmed_at: editForm.value.confirmed_at || null,
      mode_paiement: editForm.value.mode_paiement,
      reference: editForm.value.reference || null,
      observation: editForm.value.observation || null,
    })
    showEditModal.value = false
    editingPaiement.value = null
    showToast('Paiement modifié — échéances recalculées')
    await load()
  } catch (e: any) {
    showToast(e.response?.data?.message ?? 'Erreur lors de la modification', 'error')
  } finally { saving.value = false }
}

async function confirmerPaiement(id: number) {
  confirmingId.value = id
  try {
    const res = await api.post(`/paiements/${id}/confirmer`, {})
    await load()
    recuToPrint.value = res.data
    showRecuPrompt.value = true
    showToast('Paiement confirmé')
  } catch (e: any) {
    showToast(e.response?.data?.message ?? 'Erreur', 'error')
  } finally { confirmingId.value = null }
}

async function deletePaiement(p: Paiement) {
  if (!confirm(`Supprimer le paiement ${p.numero_recu} de ${p.montant?.toLocaleString()} FCFA ?\nCette action est irréversible.`)) return
  deletingPaiementId.value = p.id
  try {
    await api.delete(`/paiements/${p.id}`)
    await load()
    showToast('Paiement supprimé')
  } catch (e: any) {
    showToast(e.response?.data?.message ?? 'Erreur lors de la suppression', 'error')
  } finally { deletingPaiementId.value = null }
}

// ── Tri historique ────────────────────────────────────────────────────────────
const historiqueSearch = ref('')
const sortKey = ref<'date' | 'etudiant' | 'type' | 'montant' | 'statut'>('date')
const sortDir = ref<'asc' | 'desc'>('desc')

function toggleSort(key: typeof sortKey.value) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'date' ? 'desc' : 'asc'
  }
}

function sortIcon(key: typeof sortKey.value) {
  if (sortKey.value !== key) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

const recentPaiements = computed(() => {
  const q = historiqueSearch.value.trim().toLowerCase()
  const filtered = q
    ? paiements.value.filter(p => {
        const full = `${p.etudiant?.prenom ?? ''} ${p.etudiant?.nom ?? ''}`.toLowerCase()
        return full.includes(q)
      })
    : paiements.value
  const sorted = [...filtered].sort((a, b) => {
    let va: any, vb: any
    if (sortKey.value === 'date') {
      va = new Date(a.confirmed_at ?? a.created_at).getTime()
      vb = new Date(b.confirmed_at ?? b.created_at).getTime()
    } else if (sortKey.value === 'etudiant') {
      va = `${a.etudiant?.nom ?? ''}${a.etudiant?.prenom ?? ''}`.toLowerCase()
      vb = `${b.etudiant?.nom ?? ''}${b.etudiant?.prenom ?? ''}`.toLowerCase()
    } else if (sortKey.value === 'type') {
      va = a.type_paiement
      vb = b.type_paiement
    } else if (sortKey.value === 'montant') {
      va = Number(a.montant)
      vb = Number(b.montant)
    } else if (sortKey.value === 'statut') {
      va = a.statut
      vb = b.statut
    }
    if (va < vb) return sortDir.value === 'asc' ? -1 : 1
    if (va > vb) return sortDir.value === 'asc' ? 1 : -1
    return 0
  })
  return sorted.slice(0, showAllHistory.value ? 9999 : 5)
})

// ── Reçu de paiement ──────────────────────────────────────────────────────────
const showRecuPrompt = ref(false)
const recuToPrint = ref<any>(null)

async function printRecu(p: { numero_recu: string; inscription_id: number; type_paiement: string; mois_concerne?: string | null; montant: number; mode_paiement: string; statut: string; created_at?: string; confirmed_at?: string | null; etudiant?: { prenom: string; nom: string } | null; reference?: string | null }) {
  const insc = inscriptions.value.find(i => Number(i.id) === Number(p.inscription_id))
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const prenom = p.etudiant?.prenom ?? insc?.etudiant?.prenom ?? ''
  const nom = p.etudiant?.nom ?? insc?.etudiant?.nom ?? ''
  const filiere = insc?.filiere?.nom ?? '—'
  const classe = insc?.classe?.nom ?? insc?.filiere?.nom ?? '—'
  // Déterminer le numéro de mensualité (M 3/9)
  let typeLabel = p.type_paiement === 'frais_inscription' ? "Frais d'inscription"
    : p.type_paiement === 'tenue' ? 'Tenue scolaire'
    : p.type_paiement === 'rattrapage' ? 'Rattrapage'
    : p.type_paiement
  if (p.type_paiement === 'mensualite') {
    const mensEchs = echeances.value
      .filter(e => Number(e.inscription_id) === Number(p.inscription_id) && e.type_echeance === 'mensualite')
      .sort((a, b) => a.mois.localeCompare(b.mois))
    const moisKey = p.mois_concerne?.substring(0, 7) ?? ''
    const idx = mensEchs.findIndex(e => e.mois.substring(0, 7) === moisKey)
    const total = mensEchs.length
    typeLabel = idx >= 0 ? `Mensualité ${idx + 1}/${total}` : 'Mensualité'
  }
  const dateLabel = new Date(p.confirmed_at ?? p.created_at ?? new Date()).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const moisConcerne = p.mois_concerne
  const moisLabel = moisConcerne
    ? new Date(moisConcerne.length === 7 ? moisConcerne + '-01' : moisConcerne).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : null
  const modeStr = ({ especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', virement: 'Virement', cheque: 'Chèque' } as Record<string, string>)[p.mode_paiement] ?? p.mode_paiement
  const montantStr = Number(p.montant).toLocaleString('fr-FR')

  // QR code de vérification
  const qrData = JSON.stringify({ r: p.numero_recu, m: p.montant, d: p.confirmed_at ?? p.created_at, e: `${prenom} ${nom}` })
  let qrDataUrl = ''
  try { qrDataUrl = await QRCode.toDataURL(qrData, { width: 80, margin: 1 }) } catch { /* ignore */ }

  const recuBlock = (exemplaire: string) => `
    <div class="recu-block">
      <div class="exemplaire">${exemplaire}</div>
      <div class="hdr">
        <img src="${logoUrl}" alt="Logo">
        <div class="hdr-info">
          <div class="tagline">Institut de Formation</div>
          <h1>Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</h1>
          <div class="meta">NINEA : 006118310 _ BP 50281 RP DAKAR &nbsp;|&nbsp; Sicap Amitié 1, Villa N° 3031 — Dakar &nbsp;|&nbsp; Tél : 33 821 34 25 / 77 841 50 44</div>
          <div class="agree">Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT</div>
        </div>
      </div>
      <div class="content">
        <div class="recu-title">Reçu de paiement &nbsp;<span class="recu-num">${p.numero_recu}</span></div>
        <div class="info-grid">
          <div class="info-box full"><label>Étudiant</label><span>${prenom} ${nom}</span></div>
          <div class="info-box"><label>Classe</label><span>${classe}</span></div>
          <div class="info-box"><label>Filière</label><span>${filiere}</span></div>
          <div class="info-box"><label>Objet</label><span>${typeLabel}</span></div>
          <div class="info-box"><label>Mode</label><span>${modeStr}</span></div>
          <div class="info-box"><label>Date</label><span>${dateLabel}</span></div>
          ${moisLabel ? `<div class="info-box"><label>Période</label><span>${moisLabel}</span></div>` : ''}
          ${p.reference ? `<div class="info-box full"><label>Référence</label><span style="font-family:monospace">${p.reference}</span></div>` : ''}
        </div>
        <div class="montant-qr">
          <div class="montant-box">
            <div class="lbl">Montant payé</div>
            <div class="amt">${montantStr} FCFA</div>
          </div>
          ${qrDataUrl ? `<div class="qr-box"><img src="${qrDataUrl}" alt="QR"><div class="qr-label">Vérification</div></div>` : ''}
        </div>
        <div class="sign-area">
          <div class="sign-box"><div class="sign-line"></div><label>Signature du caissier</label></div>
          <div class="sign-box"><div class="sign-line"></div><label>Cachet de l'établissement</label></div>
        </div>
        <div class="footer-bar">Amitié 1, Villa n°3031 — Dakar &nbsp;|&nbsp; +221 77 841 50 44 / 77 618 45 52 &nbsp;|&nbsp; uptechformation.com</div>
      </div>
    </div>`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reçu ${p.numero_recu}</title>
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
    .montant-qr{display:flex;align-items:center;gap:12px;margin:10px 0}
    .montant-box{border:1.5px solid #111;border-radius:6px;padding:8px 16px;text-align:center;flex:1}
    .montant-box .lbl{font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:2px}
    .montant-box .amt{font-size:20px;font-weight:900;color:#111}
    .qr-box{text-align:center;flex-shrink:0}
    .qr-box img{width:70px;height:70px}
    .qr-label{font-size:6px;color:#aaa;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}
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
    <div class="cut-line">✂ &nbsp; Découper ici</div>
    ${recuBlock('Exemplaire étudiant')}
  </body></html>`

  openPrintWindow(html)
}

// ── Détail d'une cellule mensualité ──────────────────────────────────────────
const showCellDetail = ref(false)
const cellDetail = ref<{
  mois: string; insc: Inscription
  montant_prevu: number; versements_directs: number
  surplus_applique: number; total_effectif: number; reste: number; statut: string
} | null>(null)

function getEcheanceDetail(inscriptionId: number, mois: string) {
  const insc = inscriptions.value.find(i => Number(i.id) === inscriptionId)
  if (!insc) return null
  // 1. Surplus frais_inscription
  const fiEch = echeances.value.find(e => Number(e.inscription_id) === inscriptionId && e.type_echeance === 'frais_inscription')
  const fiMontant = fiEch ? Number(fiEch.montant) : 0
  const fiPaid = paiements.value
    .filter(p => Number(p.inscription_id) === inscriptionId && p.type_paiement === 'frais_inscription' && p.statut === 'confirme')
    .reduce((s, p) => s + Number(p.montant), 0)
  let surplus = Math.max(0, fiPaid - fiMontant)
  // 2. Cascade mensualités jusqu'au mois cible
  const mensEchs = echeances.value
    .filter(e => Number(e.inscription_id) === inscriptionId && e.type_echeance === 'mensualite')
    .sort((a, b) => a.mois.localeCompare(b.mois))
  for (const ech of mensEchs) {
    const monthKey = ech.mois.substring(0, 7)
    const explicitPaid = paiements.value
      .filter(p => Number(p.inscription_id) === inscriptionId && p.type_paiement === 'mensualite' && p.statut === 'confirme' && p.mois_concerne?.substring(0, 7) === monthKey)
      .reduce((s, p) => s + Number(p.montant), 0)
    const montant = Number(ech.montant)
    const effectivePaid = explicitPaid + surplus
    if (monthKey === mois) {
      const surplusApplique = Math.min(surplus, Math.max(0, montant - explicitPaid))
      return {
        mois, insc,
        montant_prevu: montant,
        versements_directs: explicitPaid,
        surplus_applique: surplusApplique,
        total_effectif: Math.min(effectivePaid, montant),
        reste: Math.max(0, montant - effectivePaid),
        statut: ech.statut,
      }
    }
    surplus = Math.max(0, effectivePaid - montant)
  }
  return null
}

function openCellDetail(insc: Inscription, mois: string) {
  const ech = echeanceMap.value[insc.id]?.[mois]
  if (!ech) { openModalForMois(insc, mois); return }
  const amounts = effectiveAmountsMap.value[Number(insc.id)]?.[mois]
  const montant_prevu = amounts?.montant ?? Number(ech.montant)
  const total_effectif = amounts?.effectif ?? 0
  const reste = Math.max(0, montant_prevu - total_effectif)

  // Calcul du surplus entrant pour ce mois (distribution cumulative positionnelle)
  const mensEchs = echeances.value
    .filter(e => Number(e.inscription_id) === Number(insc.id) && e.type_echeance === 'mensualite')
    .sort((a, b) => a.mois.localeCompare(b.mois))
  const idxThis = mensEchs.findIndex(e => e.mois.substring(0, 7) === mois)
  const fiEch = echeances.value.find(e => Number(e.inscription_id) === Number(insc.id) && e.type_echeance === 'frais_inscription')
  const fiMontant = fiEch ? Number(fiEch.montant) : 0
  const fiPaid = paiements.value.filter(p => Number(p.inscription_id) === Number(insc.id) && p.type_paiement === 'frais_inscription' && p.statut === 'confirme').reduce((s,p) => s + Number(p.montant), 0)
  const totalMensPaid = paiements.value.filter(p => Number(p.inscription_id) === Number(insc.id) && p.type_paiement === 'mensualite' && p.statut === 'confirme').reduce((s,p) => s + Number(p.montant), 0)
  const fiSurplus = Math.max(0, fiPaid - fiMontant)
  // montant cumulé des écheances précédentes
  const prevMontants = mensEchs.slice(0, idxThis).reduce((s, e) => s + Number(e.montant), 0)
  // surplus entrant dans ce mois = ce qui reste après avoir rempli les mois précédents
  const surplusIn = Math.max(0, totalMensPaid + fiSurplus - prevMontants)
  // paiements directs affectables à ce mois = surplusIn - effectif du mois (ce qui reste)
  const surplus_applique = Math.min(surplusIn, total_effectif)
  const versements_directs = Math.max(0, total_effectif - surplus_applique)

  cellDetail.value = {
    mois, insc, montant_prevu,
    versements_directs,
    surplus_applique,
    total_effectif,
    reste,
    statut: ech.statut,
  }
  showCellDetail.value = true
}

function completerPaiement() {
  if (!cellDetail.value) return
  const { insc, mois, reste, montant_prevu } = cellDetail.value
  prefillCascade(insc.id)
  form.value = {
    inscription_id: insc.id,
    type_paiement: 'mensualite',
    mois_concerne: mois.length === 7 ? mois + '-01' : mois,
    confirmed_at: '',
    montant: reste > 0 ? reste : montant_prevu,
    mode_paiement: 'especes',
    reference: '',
  }
  showCellDetail.value = false
  showModal.value = true
}

// ── Formations individuelles (onglet FI) ─────────────────────────────────────
const fiList = ref<any[]>([])
const fiSearch = ref('')
async function loadFI() {
  try {
    const { data } = await api.get('/formations-individuelles')
    fiList.value = data
  } catch { fiList.value = [] }
}
const fiFiltered = computed(() => {
  if (!fiSearch.value) return fiList.value
  const q = fiSearch.value.toLowerCase()
  return fiList.value.filter((fi: any) => {
    const nom = `${fi.etudiant?.prenom || ''} ${fi.etudiant?.nom || ''}`.toLowerCase()
    return nom.includes(q)
  })
})
function fiTotalPaye(fi: any): number {
  return (fi.paiements || []).reduce((s: number, p: any) => s + (parseFloat(p.montant_paye) || 0), 0)
}
function fiTotalDu(fi: any): number {
  return parseFloat(fi.cout_total) || 0
}
function fiStatutBadge(p: any): { label: string; cls: string } {
  if (p.statut === 'paye') return { label: '✓ Payé', cls: 'background:#dcfce7;color:#166534;' }
  if (p.statut === 'partiel') return { label: '◐ Partiel', cls: 'background:#fef3c7;color:#92400e;' }
  return { label: '✗ Non payé', cls: 'background:#fee2e2;color:#991b1b;' }
}

// ── Grille mensualités ────────────────────────────────────────────────────────
const activeTab = ref<'fiches' | 'grille' | 'fi'>('grille')
const grilleFiliere = ref('')
const grilleClasse = ref('')
const grilleSearch = ref('')
const grilleMode = ref<'icones' | 'texte' | 'montants' | 'complet'>('complet')
const showAllGrille = ref(false)

const filteredFilieres = computed(() => {
  const seen = new Map<string, { id: number; nom: string }>()
  for (const insc of inscriptions.value) {
    if (insc.filiere) seen.set(String(insc.filiere.id), insc.filiere as { id: number; nom: string })
  }
  return Array.from(seen.values()).sort((a, b) => a.nom.localeCompare(b.nom))
})

const filteredClasses = computed(() => {
  const seen = new Map<string, { id: number; nom: string }>()
  for (const insc of inscriptions.value) {
    if (!insc.classe) continue
    if (grilleFiliere.value && String(insc.filiere?.id) !== grilleFiliere.value) continue
    seen.set(String(insc.classe.id), insc.classe)
  }
  return Array.from(seen.values()).sort((a, b) => a.nom.localeCompare(b.nom))
})

// ── Grille : affichage ordinal M1, M2, … Mn (pas par date calendaire) ────────
// grilleSlots = nombre de colonnes = max de mensualités parmi les étudiants filtrés
const grilleSlots = computed(() => {
  let max = 0
  for (const insc of grilleRows.value) {
    const n = echeances.value.filter(e =>
      String(e.inscription_id) === String(insc.id) && e.type_echeance === 'mensualite'
    ).length
    if (n > max) max = n
  }
  return max // 0 si aucune échéance générée
})

// Map par slot ordinal : inscriptionId → { 1: ech, 2: ech, … }
const echeanceOrdinalMap = computed(() => {
  const map: Record<number, Record<number, typeof echeances.value[0]>> = {}
  for (const insc of grilleRows.value) {
    const mensEchs = echeances.value
      .filter(e => String(e.inscription_id) === String(insc.id) && e.type_echeance === 'mensualite')
      .sort((a, b) => a.mois.localeCompare(b.mois))
    const inscSlots: Record<number, typeof echeances.value[0]> = {}
    mensEchs.forEach((ech, idx) => { inscSlots[idx + 1] = ech })
    map[Number(insc.id)] = inscSlots
  }
  return map
})

// Helpers par slot ordinal
function getEchBySlot(inscId: number, slot: number) {
  return echeanceOrdinalMap.value[inscId]?.[slot]
}
function cellStatutClassBySlot(inscId: number, slot: number) {
  const ech = getEchBySlot(inscId, slot)
  if (!ech) return ''
  if (ech.statut === 'paye') return 'bg-green-100 text-green-600 hover:bg-green-200'
  if (ech.statut === 'partiellement_paye') return 'bg-orange-100 text-orange-500 hover:bg-orange-200'
  if (ech.mois.substring(0, 7) < todayStr.substring(0, 7)) return 'bg-red-100 text-red-500 hover:bg-red-200'
  return 'bg-gray-100 text-gray-400 hover:bg-gray-200'
}
function cellIconBySlot(inscId: number, slot: number) {
  const ech = getEchBySlot(inscId, slot)
  if (!ech) return ''
  if (ech.statut === 'paye') return '✓'
  if (ech.statut === 'partiellement_paye') return '◑'
  if (ech.mois.substring(0, 7) < todayStr.substring(0, 7)) return '✗'
  return '·'
}
function cellLabelBySlot(inscId: number, slot: number) {
  const ech = getEchBySlot(inscId, slot)
  if (!ech) return '—'
  if (ech.statut === 'paye') return 'Payé'
  if (ech.statut === 'partiellement_paye') return 'Partiel'
  if (ech.mois.substring(0, 7) < todayStr.substring(0, 7)) return 'En retard'
  return 'À venir'
}
function getEffectiveBySlot(inscId: number, slot: number) {
  const ech = getEchBySlot(inscId, slot)
  if (!ech) return null
  return effectiveAmountsMap.value[inscId]?.[ech.mois.substring(0, 7)]
}
function tooltipBySlot(insc: Inscription, slot: number) {
  const ech = getEchBySlot(insc.id, slot)
  const moisLabel = ech ? ` (${fmtMoisCourt(ech.mois.substring(0, 7))})` : ''
  return `${insc.etudiant.prenom} ${insc.etudiant.nom} — M${slot}${moisLabel}`
}
function openCellDetailBySlot(insc: Inscription, slot: number) {
  const ech = getEchBySlot(insc.id, slot)
  if (!ech) return
  openCellDetail(insc, ech.mois.substring(0, 7))
}

// Retourne le mois de l'échéance au format court "Oct 2025"
function getMoisLabelBySlot(inscId: number, slot: number) {
  const ech = getEchBySlot(inscId, slot)
  if (!ech) return null
  try {
    return new Date(ech.mois).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
  } catch { return null }
}

// Édition inline du mois d'une écheance
const editingMoisEchId = ref<number | null>(null)
async function saveMoisEcheance(echId: number, mois: string) {
  if (!mois) return
  try {
    await api.patch(`/echeances/${echId}/mois`, { mois })
    await load()
  } catch (e) {
    console.error('Erreur mise à jour mois', e)
  } finally {
    editingMoisEchId.value = null
  }
}

// Retourne le mois concerné saisi dans le formulaire (ex: "oct. 2025")
function getMoisPayeBySlot(inscId: number, slot: number) {
  const ech = getEchBySlot(inscId, slot)
  if (!ech || (ech.statut !== 'paye' && ech.statut !== 'partiellement_paye') || !ech.mois_paye) return null
  try {
    const d = ech.mois_paye.length >= 10 ? ech.mois_paye.substring(0, 10) : ech.mois_paye + '-01'
    return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
  } catch { return null }
}

// Retourne la date réelle du règlement (confirmed_at) au format JJ/MM/AAAA
function getPaiementDateBySlot(inscId: number, slot: number) {
  const ech = getEchBySlot(inscId, slot)
  if (!ech || ech.statut === 'non_paye' || !ech.date_paiement) return null
  return new Date(ech.date_paiement).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Retourne la date de paiement confirmé pour un mois donné (format DD/MM/YYYY)
function getPaiementDateByMois(inscId: number, mois: string): string | null {
  const ech = echeanceMap.value[inscId]?.[mois]
  if (!ech || ech.statut === 'non_paye' || !ech.date_paiement) return null
  return new Date(ech.date_paiement).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Map pour les écheances frais_inscription (1 par inscription)
const inscriptionEcheanceMap = computed(() => {
  const map: Record<number, typeof echeances.value[0]> = {}
  for (const e of echeances.value) {
    if (e.type_echeance === 'frais_inscription') map[e.inscription_id] = e
  }
  return map
})

// Map pour les écheances tenue (1 par inscription)
const tenueEcheanceMap = computed(() => {
  const map: Record<number, typeof echeances.value[0]> = {}
  for (const e of echeances.value) {
    if (e.type_echeance === 'tenue') map[e.inscription_id] = e
  }
  return map
})

// Date de paiement pour frais inscription
function getPaiementDateForInsc(inscId: number): string | null {
  const ech = inscriptionEcheanceMap.value[inscId]
  if (!ech || ech.statut === 'non_paye' || !ech.date_paiement) return null
  return new Date(ech.date_paiement).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Date de paiement pour tenue
function getPaiementDateForTenue(inscId: number): string | null {
  const ech = tenueEcheanceMap.value[inscId]
  if (!ech || ech.statut === 'non_paye' || !ech.date_paiement) return null
  return new Date(ech.date_paiement).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Conservé pour le calcul des montants effectifs (keyed by YYYY-MM)
const echeanceMap = computed(() => {
  const map: Record<number, Record<string, typeof echeances.value[0]>> = {}
  for (const e of echeances.value) {
    if (e.type_echeance !== 'mensualite') continue
    if (!map[e.inscription_id]) map[e.inscription_id] = {}
    const slot = map[e.inscription_id]
    if (slot) slot[e.mois.substring(0, 7)] = e
  }
  return map
})

// Cascade amounts per cell (for montants/complet modes)
const effectiveAmountsMap = computed(() => {
  const result: Record<number, Record<string, { effectif: number; montant: number }>> = {}
  for (const insc of inscriptions.value) {
    const id = Number(insc.id)

    // Surplus frais inscription
    const fiEch = echeances.value.find(e => Number(e.inscription_id) === id && e.type_echeance === 'frais_inscription')
    const fiMontant = fiEch ? Number(fiEch.montant) : 0
    const fiPaid = paiements.value
      .filter(p => Number(p.inscription_id) === id && p.type_paiement === 'frais_inscription' && p.statut === 'confirme')
      .reduce((s, p) => s + Number(p.montant), 0)
    const fiSurplus = Math.max(0, fiPaid - fiMontant)

    // Total mensualités confirmées (matching positionnel — sans filtre mois_concerne)
    const totalMensPaid = paiements.value
      .filter(p => Number(p.inscription_id) === id && p.type_paiement === 'mensualite' && p.statut === 'confirme')
      .reduce((s, p) => s + Number(p.montant), 0)

    // Distribution cumulative positionnelle (M1 → M2 → M3 …)
    const mensEchs = echeances.value
      .filter(e => Number(e.inscription_id) === id && e.type_echeance === 'mensualite')
      .sort((a, b) => a.mois.localeCompare(b.mois))
    result[id] = {}
    let remaining = totalMensPaid + fiSurplus
    for (const ech of mensEchs) {
      const monthKey = ech.mois.substring(0, 7)
      const montant = Number(ech.montant)
      const effectif = Math.min(remaining, montant)
      result[id][monthKey] = { effectif, montant }
      remaining = Math.max(0, remaining - montant)
    }
  }
  return result
})

function cellStatutClass(inscId: number, mois: string) {
  const statut = echeanceMap.value[inscId]?.[mois]?.statut
  if (statut === 'paye') return 'bg-green-100 text-green-600 hover:bg-green-200'
  if (statut === 'partiellement_paye') return 'bg-orange-100 text-orange-500 hover:bg-orange-200'
  if (mois < todayStr.substring(0, 7)) return 'bg-red-100 text-red-500 hover:bg-red-200'
  return 'bg-gray-100 text-gray-400 hover:bg-gray-200'
}
function cellIcon(inscId: number, mois: string) {
  const statut = echeanceMap.value[inscId]?.[mois]?.statut
  if (statut === 'paye') return '✓'
  if (statut === 'partiellement_paye') return '◑'
  if (mois < todayStr.substring(0, 7)) return '✗'
  return '·'
}
function cellLabel(inscId: number, mois: string) {
  const statut = echeanceMap.value[inscId]?.[mois]?.statut
  if (statut === 'paye') return 'Payé'
  if (statut === 'partiellement_paye') return 'Partiel'
  if (mois < todayStr.substring(0, 7)) return 'En retard'
  return 'À venir'
}

const grilleHasFilter = computed(() => !!(grilleFiliere.value || grilleClasse.value || grilleSearch.value))

// IDs des étudiants inscrits en FI (à exclure de la grille classique)
const fiEtudiantIds = computed(() => new Set(fiList.value.map((fi: any) => fi.etudiant_id)))

const grilleRowsAll = computed(() => {
  return inscriptions.value.filter(insc => {
    if (!insc.etudiant) return false
    // Exclure les étudiants en formation individuelle
    if (fiEtudiantIds.value.has(insc.etudiant.id)) return false
    if (grilleFiliere.value && String(insc.filiere?.id) !== grilleFiliere.value) return false
    if (grilleClasse.value && String(insc.classe?.id) !== grilleClasse.value) return false
    if (grilleSearch.value) {
      const q = grilleSearch.value.toLowerCase()
      const full = `${insc.etudiant.prenom} ${insc.etudiant.nom}`.toLowerCase()
      if (!full.includes(q)) return false
    }
    return true
  })
})

const grilleRows = computed(() => {
  const all = grilleRowsAll.value
  // Si aucun filtre actif et pas "voir tout", limiter aux 5 derniers inscrits (par id desc = plus récents)
  if (!grilleHasFilter.value && !showAllGrille.value) {
    return [...all].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 5)
  }
  return [...all].sort((a, b) => `${a.etudiant.nom}${a.etudiant.prenom}`.localeCompare(`${b.etudiant.nom}${b.etudiant.prenom}`))
})

function fmtMoisCourt(mois: string) {
  try { return new Date(mois + '-01').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }).replace('.', '') }
  catch { return mois }
}

function getFiche(inscId: number) {
  return ficheEtudiants.value.find(f => f.inscription_id === inscId)
}

// Vérifie si une inscription a des échéances avec montant = 0 (mal générées)
function hasZeroEcheances(inscId: number) {
  const id = Number(inscId)
  return echeances.value.some(e => Number(e.inscription_id) === id && Number(e.montant) === 0)
}

// Vérifie si une inscription n'a AUCUNE échéance du tout (jamais générées)
function hasNoEcheances(inscId: number) {
  const id = Number(inscId)
  return !echeances.value.some(e => Number(e.inscription_id) === id)
}

// Vérifie si le nombre de mensualités dépasse la durée prévue
function hasTooManyEcheances(inscId: number) {
  const id = Number(inscId)
  const insc = inscriptions.value.find(i => Number(i.id) === id)
  const duree = insc?.filiere?.duree_mois ?? 12
  const nb = echeances.value.filter(e => Number(e.inscription_id) === id && e.type_echeance === 'mensualite').length
  return nb > duree
}

const regeneratingId = ref<number | null>(null)

// Modal choix mois de début
const showGenererModal = ref(false)
const genererInsc = ref<Inscription | null>(null)
const genererMoisDebut = ref('')
const genererModeAction = ref<'generer' | 'regenerer'>('generer')

function openGenererModal(insc: Inscription, mode: 'generer' | 'regenerer') {
  genererInsc.value = insc
  genererModeAction.value = mode
  // Pré-remplir avec le mois courant
  const now = new Date()
  genererMoisDebut.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  showGenererModal.value = true
}

async function confirmerGenerer() {
  const insc = genererInsc.value
  if (!insc) return
  showGenererModal.value = false
  regeneratingId.value = insc.id
  const endpoint = genererModeAction.value === 'regenerer' ? '/echeances/regenerer' : '/echeances/generer'
  try {
    await api.post(endpoint, { inscription_id: insc.id, mois_debut: genererMoisDebut.value || undefined })
    await load()
    showToast(`Échéances générées pour ${insc.etudiant.prenom} ${insc.etudiant.nom}`)
  } catch (e: any) {
    showToast(e.response?.data?.message ?? 'Erreur lors de la génération', 'error')
  } finally { regeneratingId.value = null }
}

async function regenererEcheances(insc: Inscription) {
  openGenererModal(insc, 'regenerer')
}

async function genererEcheancesManquantes(insc: Inscription) {
  openGenererModal(insc, 'generer')
}

const regenererToutLoading = ref(false)
const regenererToutProgress = ref('')
async function regenererTout() {
  if (!confirm('Régénérer les échéances de TOUS les étudiants inscrits ? Les paiements existants ne seront pas touchés.')) return
  regenererToutLoading.value = true
  regenererToutProgress.value = ''
  // On traite par lots de 40 inscriptions pour rester largement sous le timeout Vercel (60 s).
  const BATCH = 40
  let offset = 0
  let totalOk = 0, totalErr = 0, total = 0
  try {
    // Premier appel : récupère aussi le total global
    while (true) {
      const { data } = await api.post(`/echeances/regenerer-tout?offset=${offset}&limit=${BATCH}`)
      totalOk += data.ok || 0
      totalErr += data.erreurs || 0
      total = data.totalGlobal ?? data.total ?? 0
      regenererToutProgress.value = `${Math.min(offset + BATCH, total)}/${total}`
      if (!data.nextOffset) break
      offset = data.nextOffset
    }
    showToast(`Échéances régénérées : ${totalOk}/${total} réussis${totalErr ? ` (${totalErr} erreurs)` : ''}`)
    await load()
  } catch (e: any) {
    showToast(e.response?.data?.message ?? 'Erreur lors de la régénération', 'error')
  } finally {
    regenererToutLoading.value = false
    regenererToutProgress.value = ''
  }
}

const showTenueDetail = ref(false)
const tenueDetail = ref<{ insc: Inscription; montant_prevu: number; tenue_paye: number; reste: number; statut: string } | null>(null)

function openTenueDetail(insc: Inscription) {
  const fiche = getFiche(insc.id)
  if (!fiche || fiche.tenue_prevu <= 0) return
  const tenue_paye = fiche.tenue_paye
  const montant_prevu = fiche.tenue_prevu
  const reste = Math.max(0, montant_prevu - tenue_paye)
  const statut = tenue_paye >= montant_prevu ? 'paye' : tenue_paye > 0 ? 'partiellement_paye' : 'non_paye'
  tenueDetail.value = { insc, montant_prevu, tenue_paye, reste, statut }
  showTenueDetail.value = true
}

function completerTenue() {
  if (!tenueDetail.value) return
  const { insc, reste, montant_prevu } = tenueDetail.value
  prefillCascade(insc.id)
  form.value = {
    inscription_id: insc.id,
    type_paiement: 'tenue',
    mois_concerne: '',
    confirmed_at: '',
    montant: reste > 0 ? reste : montant_prevu,
    mode_paiement: 'especes',
    reference: '',
  }
  showTenueDetail.value = false
  showModal.value = true
}

function openModalForMois(insc: Inscription, mois: string) {
  prefillCascade(insc.id)
  form.value = {
    inscription_id: insc.id,
    type_paiement: 'mensualite',
    mois_concerne: mois.length === 7 ? mois + '-01' : mois,
    confirmed_at: '',
    montant: Number(insc.filiere?.mensualite) || Number(insc.mensualite) || 0,
    mode_paiement: 'especes',
    reference: '',
  }
  showModal.value = true
}

const recalculTarifsLoading = ref(false)
async function recalculerTarifs() {
  if (!confirm('Recalculer les montants de toutes les échéances selon les tarifs actuels des filières ?\n\nCette opération met à jour les montants prévus pour tous les étudiants actifs.')) return
  recalculTarifsLoading.value = true
  try {
    const r = await api.post('/echeances/recalculer-tarifs', {})
    showToast(r.data?.message ?? 'Tarifs recalculés')
    await load()
  } catch (e: any) {
    showToast(e.response?.data?.message ?? 'Erreur lors du recalcul', 'error')
  } finally { recalculTarifsLoading.value = false }
}

onMounted(() => { load(); loadFI() })

// ── Retards ────────────────────────────────────────────────────────────────────
const showRetardsModal = ref(false)
const retardsMois = ref(currentMonthStr)

const retardsData = computed(() => {
  const result: Array<{
    insc: Inscription; type: string
    montant_prevu: number; montant_paye: number; reste: number; statut: string
  }> = []
  for (const e of echeances.value) {
    if (e.mois.substring(0, 7) !== retardsMois.value) continue
    if (!['non_paye', 'partiellement_paye'].includes(e.statut)) continue
    const insc = inscriptions.value.find(i => Number(i.id) === Number(e.inscription_id))
    if (!insc) continue
    const paid = paiements.value
      .filter(p => Number(p.inscription_id) === Number(e.inscription_id) &&
        p.type_paiement === e.type_echeance && p.statut === 'confirme' &&
        (e.type_echeance !== 'mensualite' || p.mois_concerne?.substring(0, 7) === retardsMois.value))
      .reduce((s, p) => s + Number(p.montant), 0)
    const reste = Math.max(0, Number(e.montant) - paid)
    if (reste <= 0) continue
    result.push({ insc, type: e.type_echeance, montant_prevu: Number(e.montant), montant_paye: paid, reste, statut: e.statut })
  }
  return result.sort((a, b) => a.insc.etudiant.nom.localeCompare(b.insc.etudiant.nom))
})

function payerRetard(row: typeof retardsData.value[0]) {
  form.value = {
    inscription_id: row.insc.id,
    type_paiement: row.type,
    mois_concerne: row.type === 'mensualite' ? retardsMois.value : '',
    confirmed_at: '',
    montant: row.reste,
    mode_paiement: 'especes',
    reference: '',
  }
  showRetardsModal.value = false
  showModal.value = true
}

function exportRetardsExcel() {
  const moisLabel = new Date(retardsMois.value + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const total = retardsData.value.reduce((s, r) => s + r.reste, 0)

  // Header rows with institute info
  const headerRows = [
    ['Institut Supérieur de Formation aux Nouveaux Métiers de l\'Informatique et de la Communication'],
    ['NINEA : 006118310 _ BP 50281 RP DAKAR'],
    ['Agréé par l\'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT'],
    ['Sicap Amitié 1, Villa N° 3031 — Dakar, Sénégal | Tél : 33 821 34 25 / 77 841 50 44'],
    [],
    [`Retards de paiements — ${moisLabel}`],
    [`${retardsData.value.length} étudiant(s) concerné(s)`],
    [],
    ['Étudiant', 'Filière', 'Type', 'Statut', 'Déjà payé (FCFA)', 'Reste à payer (FCFA)', 'Montant prévu (FCFA)'],
  ]
  const dataRows = retardsData.value.map(r => [
    `${r.insc.etudiant.prenom} ${r.insc.etudiant.nom}`,
    r.insc.filiere?.nom ?? '—',
    r.type === 'mensualite' ? 'Mensualité' : r.type === 'tenue' ? 'Tenue' : 'Inscription',
    r.statut === 'partiellement_paye' ? 'Partiel' : 'Non payé',
    r.montant_paye,
    r.reste,
    r.montant_prevu,
  ])
  const totalRow = ['', '', '', '', 'Total à collecter', total, '']

  const ws = XLSX.utils.aoa_to_sheet([...headerRows, ...dataRows, [], totalRow])
  // Column widths
  ws['!cols'] = [{ wch: 28 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 20 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Retards')
  XLSX.writeFile(wb, `retards_paiements_${retardsMois.value}.xlsx`)
}

function exportRetardsPDF() {
  const moisLabel = new Date(retardsMois.value + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const total = retardsData.value.reduce((s, r) => s + r.reste, 0)
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const rows = retardsData.value.map(r => `
    <tr>
      <td>${r.insc.etudiant.prenom} ${r.insc.etudiant.nom}</td>
      <td>${r.insc.filiere?.nom ?? '—'}</td>
      <td>${r.type === 'mensualite' ? 'Mensualité' : r.type === 'tenue' ? 'Tenue' : 'Inscription'}</td>
      <td>${r.statut === 'partiellement_paye' ? 'Partiel' : 'Non payé'}</td>
      <td style="text-align:right">${Number(r.montant_paye).toLocaleString('fr-FR')} FCFA</td>
      <td style="text-align:right;color:#dc2626;font-weight:bold">${Number(r.reste).toLocaleString('fr-FR')} FCFA</td>
    </tr>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Retards — ${moisLabel}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;color:#111;font-size:13px}
    .hdr{display:flex;align-items:center;gap:18px;padding:18px 24px 14px;border-bottom:3px solid #E30613}
    .hdr img{width:72px;height:72px;object-fit:contain;flex-shrink:0}
    .hdr-info{flex:1}
    .hdr-info .tagline{font-size:8px;font-weight:700;color:#E30613;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px}
    .hdr-info h1{font-size:13px;font-weight:900;color:#111;line-height:1.25;margin-bottom:5px}
    .hdr-info .meta{font-size:9px;color:#555;line-height:1.6}
    .hdr-info .agree{font-size:8px;color:#777;margin-top:3px}
    .content{padding:20px 24px}
    .doc-title{font-size:15px;font-weight:800;color:#111;margin-bottom:2px}
    .doc-sub{font-size:11px;color:#666;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#f3f4f6;padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb}
    td{padding:7px 10px;border-bottom:1px solid #f3f4f6}
    tfoot td{font-weight:bold;border-top:2px solid #e5e7eb;background:#fef9f0}
    .footer-bar{background:#E30613;color:#fff;font-size:9px;text-align:center;padding:7px 24px;margin-top:24px}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head>
  <body>
    <div class="hdr">
      <img src="${logoUrl}" alt="Logo">
      <div class="hdr-info">
        <div class="tagline">Institut de Formation</div>
        <h1>Institut Supérieur de Formation aux Nouveaux<br>Métiers de l'Informatique et de la Communication</h1>
        <div class="meta">
          NINEA : 006118310 _ BP 50281 RP DAKAR<br>
          Sicap Amitié 1, Villa N° 3031 — Dakar, Sénégal<br>
          Tél : 33 821 34 25 / 77 841 50 44
        </div>
        <div class="agree">Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT</div>
      </div>
    </div>
    <div class="content">
      <div class="doc-title">Retards de paiements — ${moisLabel}</div>
      <div class="doc-sub">${retardsData.value.length} étudiant(s) concerné(s)</div>
      <table>
        <thead><tr><th>Étudiant</th><th>Filière</th><th>Type</th><th>Statut</th><th style="text-align:right">Payé</th><th style="text-align:right">Reste</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5" style="text-align:right">Total à collecter</td><td style="text-align:right;color:#dc2626">${Number(total).toLocaleString('fr-FR')} FCFA</td></tr></tfoot>
      </table>
    </div>
    <div class="footer-bar">Amitié 1, Villa n°3031 — Dakar, Sénégal &nbsp;|&nbsp; +221 77 841 50 44 / 77 618 45 52 &nbsp;|&nbsp; uptechformation.com</div>
  </body></html>`
  openPrintWindow(html)
}
</script>

<template>
  <div class="p-6 max-w-6xl">

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast"
        class="fixed top-5 right-5 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium"
        :class="toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'">
        <svg v-if="toast.type === 'error'" class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        <svg v-else class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        {{ toast.msg }}
      </div>
    </Transition>

    <!-- Bannière reçu disponible -->
    <Transition name="toast">
      <div v-if="showRecuPrompt && recuToPrint"
        class="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-5 py-3 rounded-xl shadow-xl bg-white border border-gray-200 text-sm">
        <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
          <svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        </div>
        <div>
          <p class="font-semibold text-gray-900">Reçu disponible</p>
          <p class="text-xs text-gray-400 font-mono">{{ recuToPrint.numero_recu }}</p>
        </div>
        <button @click="printRecu(recuToPrint); showRecuPrompt = false"
          class="flex items-center gap-1.5 bg-gray-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-black transition ml-2">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
          Imprimer
        </button>
        <button @click="showRecuPrompt = false" class="text-gray-400 hover:text-gray-600 ml-1 text-lg leading-none">&times;</button>
      </div>
    </Transition>

    <!-- Erreur de chargement -->
    <div v-if="loadError" class="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">
      <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <span>{{ loadError }}</span>
      <button @click="load()" class="ml-auto text-xs font-semibold underline hover:no-underline">Réessayer</button>
    </div>

    <!-- ── En-tête ── -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-gray-900">Paiements des étudiants</h1>
        <p class="text-sm text-gray-400 mt-0.5">Frais d'inscription et mensualités</p>
      </div>
      <div class="flex items-center gap-3">
        <a href="/suivi-paiements" class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition" style="background:#E30613;color:#fff;text-decoration:none;">
          📊 Suivi paiements
        </a>
        <a href="/caisse" class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition" style="background:#1e293b;color:#fff;text-decoration:none;">
          📒 Journal caisse
        </a>
        <button @click="showRetardsModal = true"
          class="flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-black transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
          Retards de paiements
          <span v-if="retardsData.length > 0" class="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 font-bold">{{ retardsData.length }}</span>
        </button>
        <button @click="openModal"
          class="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          Enregistrer un paiement
        </button>
      </div>
    </div>

    <!-- ── Filtres stats ── -->
    <div class="bg-white rounded-xl border border-gray-200 px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
      <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtrer :</span>
      <input v-model="statsMois" type="month"
        class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-red-400"/>
      <select v-model="statsType"
        class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-red-400">
        <option value="">Tous les types</option>
        <option value="frais_inscription">Inscription</option>
        <option value="mensualite">Mensualité</option>
        <option value="tenue">Tenue</option>
      </select>
      <select v-model="statsFiliereId"
        class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-red-400">
        <option value="">Toutes les filières</option>
        <option v-for="f in statsFilieresOptions" :key="f.id" :value="String(f.id)">{{ f.nom }}</option>
      </select>
      <select v-model="statsClasseId"
        class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-red-400">
        <option value="">Toutes les classes</option>
        <option v-for="cl in statsClassesOptions" :key="cl.id" :value="String(cl.id)">{{ cl.nom }}</option>
      </select>
      <button v-if="statsType || statsFiliereId || statsClasseId || statsMois !== currentMonthStr"
        @click="statsType=''; statsFiliereId=''; statsClasseId=''; statsMois=currentMonthStr"
        class="text-xs text-red-500 hover:text-red-700 underline">Réinitialiser</button>
    </div>

    <!-- ── 3 KPI simples ── -->
    <div class="grid grid-cols-3 gap-4 mb-5">
      <div class="bg-white rounded-xl border border-gray-200 p-5">
        <p class="text-xs text-gray-400 mb-1">Encaissé — {{ new Date(statsMois+'-01').toLocaleDateString('fr-FR',{month:'long',year:'numeric'}) }}</p>
        <p class="text-2xl font-bold text-green-600">{{ fmt(stats.encaisse_mois) }}</p>
        <p class="text-xs text-gray-400">FCFA</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-5">
        <p class="text-xs text-gray-400 mb-1">Total encaissé{{ statsType ? ' — '+{frais_inscription:'Inscription',mensualite:'Mensualité',tenue:'Tenue'}[statsType] : ' (cumulé)' }}</p>
        <p class="text-2xl font-bold text-gray-900">{{ fmt(stats.total_encaisse) }}</p>
        <p class="text-xs text-gray-400">FCFA</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-5">
        <p class="text-xs text-gray-400 mb-1">Reste à collecter{{ statsType ? ' — '+{frais_inscription:'Inscription',mensualite:'Mensualité',tenue:'Tenue'}[statsType] : '' }}</p>
        <p class="text-2xl font-bold text-red-600">{{ fmt(stats.reste) }}</p>
        <p class="text-xs text-gray-400">FCFA</p>
      </div>
    </div>

    <!-- ── Alertes ── -->
    <div v-if="stats.en_retard > 0 || stats.en_attente > 0" class="flex gap-3 mb-5">
      <div v-if="stats.en_retard > 0"
        class="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-4 py-2 rounded-lg">
        <span class="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
        {{ stats.en_retard }} paiement(s) en retard
      </div>
      <div v-if="stats.en_attente > 0"
        class="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold px-4 py-2 rounded-lg">
        <span class="w-2 h-2 rounded-full bg-amber-500"></span>
        {{ stats.en_attente }} paiement(s) en attente de confirmation
      </div>
    </div>

    <!-- ── Onglets ── -->
    <div class="flex items-center gap-0 border-b border-gray-200 mb-5">
      <button @click="activeTab = 'grille'"
        class="px-5 py-2.5 text-sm -mb-px transition font-medium"
        :class="activeTab === 'grille' ? 'border-b-2 border-red-600 text-red-600' : 'text-gray-500 hover:text-gray-700'">
        Grille mensualités
      </button>
      <button @click="activeTab = 'fiches'"
        class="px-5 py-2.5 text-sm -mb-px transition font-medium"
        :class="activeTab === 'fiches' ? 'border-b-2 border-red-600 text-red-600' : 'text-gray-500 hover:text-gray-700'">
        Fiches étudiants
      </button>
      <button @click="activeTab = 'fi'"
        class="px-5 py-2.5 text-sm -mb-px transition font-medium"
        :class="activeTab === 'fi' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'">
        🎓 Formations individuelles
        <span v-if="fiList.length" style="background:#eef2ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:8px;margin-left:4px;">{{ fiList.length }}</span>
      </button>
    </div>

    <!-- ── Fiches étudiants ── -->
    <div v-if="loading && activeTab === 'fiches'" class="text-center text-sm text-gray-400 py-10">Chargement…</div>

    <div v-show="activeTab === 'fiches' && !loading">
      <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Suivi par étudiant</h2>

      <div v-if="ficheEtudiants.length === 0"
        class="bg-white rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
        Aucun étudiant inscrit pour le moment.
      </div>

      <div v-for="(fiche, i) in ficheEtudiants" :key="fiche.inscription_id"
        class="bg-white rounded-xl border border-gray-200 p-5 mb-3 hover:border-gray-300 transition">

        <!-- Ligne du haut : avatar + nom + bouton -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
              :style="{ background: avatarColor(i) }">
              {{ initials(fiche.etudiant.prenom, fiche.etudiant.nom) }}
            </div>
            <div>
              <p class="font-bold text-gray-900">{{ fiche.etudiant.prenom }} {{ fiche.etudiant.nom }}</p>
              <p class="text-xs text-gray-400">{{ fiche.filiere?.nom ?? 'Filière non définie' }} · {{ fiche.etudiant.numero_etudiant }}</p>
            </div>
          </div>
          <button @click="openModalFor(fiche)"
            class="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition font-semibold flex items-center gap-1">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
            Paiement
          </button>
        </div>

        <!-- Deux blocs côte à côte -->
        <div class="grid grid-cols-2 gap-3">

          <!-- Bloc 1 : Frais d'inscription -->
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-semibold text-gray-500">Frais d'inscription</p>
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full"
                :class="fiche.frais_paye >= fiche.frais_prevu && fiche.frais_prevu > 0
                  ? 'bg-green-100 text-green-700'
                  : fiche.frais_paye > 0
                    ? 'bg-orange-100 text-orange-600'
                    : 'bg-gray-200 text-gray-500'">
                {{ fiche.frais_paye >= fiche.frais_prevu && fiche.frais_prevu > 0 ? '✓ Soldé' : fiche.frais_paye > 0 ? 'Partiel' : 'Non payé' }}
              </span>
            </div>
            <p class="text-lg font-bold text-gray-900">
              {{ fmt(fiche.frais_paye) }}
              <span class="text-sm font-normal text-gray-400"> / {{ fmt(fiche.frais_prevu) }} FCFA</span>
            </p>
            <div class="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all"
                :class="fiche.frais_paye >= fiche.frais_prevu ? 'bg-green-500' : 'bg-orange-400'"
                :style="{ width: fiche.frais_prevu > 0 ? Math.min(100, Math.round(fiche.frais_paye / fiche.frais_prevu * 100)) + '%' : '0%' }"/>
            </div>
            <p v-if="fiche.frais_paye < fiche.frais_prevu && fiche.frais_prevu > 0"
              class="text-xs text-orange-500 mt-1.5">
              Reste {{ fmt(fiche.frais_prevu - fiche.frais_paye) }} FCFA à payer
            </p>
            <p v-if="fiche.frais_total_verse > fiche.frais_prevu && fiche.frais_prevu > 0"
              class="text-xs text-blue-500 mt-1.5">
              ↗ Surplus {{ fmt(fiche.frais_total_verse - fiche.frais_prevu) }} FCFA → mensualités
            </p>
          </div>

          <!-- Bloc 2 : Mensualités -->
          <div class="bg-gray-50 rounded-lg p-4">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-semibold text-gray-500">Mensualités</p>
              <span class="text-xs font-bold text-gray-700">
                {{ fiche.nb_mois_payes }} / {{ fiche.nb_mois_total }} mois payés
              </span>
            </div>
            <p class="text-lg font-bold text-gray-900">
              {{ fmt(fiche.total_paye - fiche.frais_paye) }}
              <span class="text-sm font-normal text-gray-400"> / {{ fmt(fiche.nb_mois_total * fiche.mensualite_montant) }} FCFA</span>
            </p>
            <!-- Carrés mois : vert=payé, orange=partiel, rouge=retard, gris=à venir -->
            <div class="flex flex-wrap gap-1 mt-2">
              <div v-for="ech in getMensualites(fiche.inscription_id)" :key="ech.id"
                class="w-5 h-5 rounded-sm cursor-default"
                :title="fmtMois(ech.mois)"
                :class="ech.statut === 'paye'
                  ? 'bg-green-500'
                  : ech.statut === 'partiellement_paye'
                    ? 'bg-orange-400'
                    : ech.mois.substring(0,7) < todayStr.substring(0,7)
                      ? 'bg-red-400'
                      : 'bg-gray-200'"/>
              <div v-if="fiche.nb_mois_total === 0" class="text-xs text-gray-400 italic">
                Aucune mensualité planifiée
              </div>
            </div>
            <div v-if="fiche.nb_mois_total > 0" class="flex gap-3 mt-1.5">
              <span class="text-xs text-gray-400 flex items-center gap-1"><span class="w-2 h-2 rounded-sm bg-green-500 inline-block"></span>Payé</span>
              <span class="text-xs text-gray-400 flex items-center gap-1"><span class="w-2 h-2 rounded-sm bg-orange-400 inline-block"></span>Partiel</span>
              <span class="text-xs text-gray-400 flex items-center gap-1"><span class="w-2 h-2 rounded-sm bg-red-400 inline-block"></span>Retard</span>
              <span class="text-xs text-gray-400 flex items-center gap-1"><span class="w-2 h-2 rounded-sm bg-gray-200 inline-block"></span>À venir</span>
            </div>
          </div>
        </div>

        <!-- Solde total -->
        <div class="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
          <p class="text-xs text-gray-400">Total payé : <span class="font-semibold text-gray-700">{{ fmt(fiche.total_paye) }} FCFA</span></p>
          <p class="text-xs text-gray-400">
            Solde restant :
            <span class="font-bold ml-1"
              :class="fiche.total_prevu - fiche.total_paye > 0 ? 'text-red-600' : 'text-green-600'">
              {{ fmt(Math.max(0, fiche.total_prevu - fiche.total_paye)) }} FCFA
            </span>
          </p>
        </div>
      </div>
    </div>

    <!-- ── Formations individuelles ── -->
    <div v-show="activeTab === 'fi'">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <input v-model="fiSearch" type="text" placeholder="Rechercher un étudiant FI…"
          style="padding:8px 14px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;width:280px;" />
        <span style="font-size:12px;color:#6b7280;">{{ fiFiltered.length }} formation(s)</span>
      </div>

      <div v-if="fiFiltered.length === 0"
        style="background:white;border:1px dashed #e5e7eb;border-radius:12px;padding:40px;text-align:center;color:#9ca3af;font-size:13px;">
        Aucune formation individuelle trouvée.
      </div>

      <div v-for="fi in fiFiltered" :key="fi.id"
        style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:12px;">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div>
            <span style="font-weight:700;font-size:15px;">{{ fi.etudiant?.prenom }} {{ fi.etudiant?.nom }}</span>
            <span v-if="fi.type_formation" style="margin-left:8px;background:#eef2ff;color:#4f46e5;font-size:11px;padding:2px 8px;border-radius:8px;">
              {{ fi.type_formation.nom }}
            </span>
            <span :style="fi.statut === 'solde' ? 'background:#dcfce7;color:#166534;' : fi.statut === 'en_cours' ? 'background:#dbeafe;color:#1e40af;' : 'background:#f3f4f6;color:#6b7280;'"
              style="margin-left:6px;font-size:11px;padding:2px 8px;border-radius:8px;font-weight:600;">
              {{ fi.statut === 'solde' ? '✓ Soldé' : fi.statut === 'en_cours' ? '▶ En cours' : fi.statut }}
            </span>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700;font-size:15px;">{{ new Intl.NumberFormat('fr-FR').format(fiTotalPaye(fi)) }} / {{ new Intl.NumberFormat('fr-FR').format(fiTotalDu(fi)) }} F</div>
            <div style="font-size:11px;color:#6b7280;">
              {{ fiTotalDu(fi) > 0 ? Math.round(fiTotalPaye(fi) / fiTotalDu(fi) * 100) : 0 }}% payé
            </div>
          </div>
        </div>
        <!-- Barre progression -->
        <div style="height:6px;background:#f3f4f6;border-radius:3px;margin-bottom:12px;overflow:hidden;">
          <div :style="{ width: (fiTotalDu(fi) > 0 ? Math.min(100, Math.round(fiTotalPaye(fi) / fiTotalDu(fi) * 100)) : 0) + '%', background: fiTotalPaye(fi) >= fiTotalDu(fi) ? '#22c55e' : '#6366f1' }"
            style="height:100%;border-radius:3px;transition:width .3s;"></div>
        </div>
        <!-- Table paiements -->
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="text-align:left;padding:6px 10px;font-weight:600;color:#6b7280;">Type</th>
              <th style="text-align:right;padding:6px 10px;font-weight:600;color:#6b7280;">Montant</th>
              <th style="text-align:right;padding:6px 10px;font-weight:600;color:#6b7280;">Payé</th>
              <th style="text-align:center;padding:6px 10px;font-weight:600;color:#6b7280;">Statut</th>
              <th style="text-align:center;padding:6px 10px;font-weight:600;color:#6b7280;">Date paiement</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in fi.paiements" :key="p.id" style="border-top:1px solid #f3f4f6;">
              <td style="padding:6px 10px;font-weight:500;">{{ p.type === 'inscription' ? 'Inscription' : 'Solde' }}</td>
              <td style="padding:6px 10px;text-align:right;">{{ new Intl.NumberFormat('fr-FR').format(p.montant) }} F</td>
              <td style="padding:6px 10px;text-align:right;font-weight:600;">{{ new Intl.NumberFormat('fr-FR').format(p.montant_paye) }} F</td>
              <td style="padding:6px 10px;text-align:center;">
                <span :style="fiStatutBadge(p).cls" style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">
                  {{ fiStatutBadge(p).label }}
                </span>
              </td>
              <td style="padding:6px 10px;text-align:center;color:#6b7280;">
                {{ p.date_paiement ? new Date(p.date_paiement).toLocaleDateString('fr-FR') : '—' }}
              </td>
            </tr>
            <tr v-if="!fi.paiements?.length" style="border-top:1px solid #f3f4f6;">
              <td colspan="5" style="padding:10px;text-align:center;color:#9ca3af;">Aucun paiement défini</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Grille mensualités ── -->
    <div v-show="activeTab === 'grille'">

      <!-- Ligne 1 : filtres -->
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <input v-model="grilleSearch" type="search" placeholder="Rechercher un étudiant…"
          class="flex-1 min-w-[160px] border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
        <select v-model="grilleFiliere" @change="grilleClasse = ''"
          class="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400 bg-white">
          <option value="">Toutes les filières</option>
          <option v-for="f in filteredFilieres" :key="f.id" :value="String(f.id)">{{ f.nom }}</option>
        </select>
        <select v-model="grilleClasse"
          class="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400 bg-white">
          <option value="">Toutes les classes</option>
          <option v-for="c in filteredClasses" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
        </select>
        <button @click="recalculerTarifs" :disabled="recalculTarifsLoading"
          class="border border-amber-300 bg-amber-50 text-amber-700 text-xs px-3 py-2 rounded-lg hover:bg-amber-100 transition disabled:opacity-50 font-medium whitespace-nowrap"
          title="Recalculer les montants des échéances selon les tarifs actuels des filières">
          {{ recalculTarifsLoading ? '…' : '⟳ Tarifs' }}
        </button>
        <button @click="regenererTout" :disabled="regenererToutLoading"
          class="border border-blue-300 bg-blue-50 text-blue-700 text-xs px-3 py-2 rounded-lg hover:bg-blue-100 transition disabled:opacity-50 font-medium whitespace-nowrap"
          title="Régénérer les échéances de tous les étudiants (crée les mois manquants, supprime le surplus, ne touche pas aux payés)">
          {{ regenererToutLoading ? (regenererToutProgress ? `… ${regenererToutProgress}` : '…') : '⟳ Tout régénérer' }}
        </button>
      </div>
      <!-- Ligne 2 : mode d'affichage -->
      <div class="flex items-center gap-2 mb-4">
        <span class="text-xs text-gray-400 font-medium">Affichage :</span>
        <div class="flex items-center bg-gray-100 p-1 rounded-lg border border-gray-200">
          <button @click="grilleMode = 'icones'"
            :class="grilleMode === 'icones' ? 'bg-white shadow text-red-600 font-semibold' : 'text-gray-400 hover:text-gray-600'"
            class="px-3 py-1.5 rounded text-xs transition whitespace-nowrap"
            title="Mode icônes uniquement">⊞ Icônes</button>
          <button @click="grilleMode = 'texte'"
            :class="grilleMode === 'texte' ? 'bg-white shadow text-red-600 font-semibold' : 'text-gray-400 hover:text-gray-600'"
            class="px-3 py-1.5 rounded text-xs transition whitespace-nowrap"
            title="Mode texte (Payé / Partiel / En retard)">Aa Texte</button>
          <button @click="grilleMode = 'montants'"
            :class="grilleMode === 'montants' ? 'bg-white shadow text-red-600 font-semibold' : 'text-gray-400 hover:text-gray-600'"
            class="px-3 py-1.5 rounded text-xs transition whitespace-nowrap"
            title="Mode montants (payé / prévu)">1k Montant</button>
          <button @click="grilleMode = 'complet'"
            :class="grilleMode === 'complet' ? 'bg-white shadow text-red-600 font-semibold' : 'text-gray-400 hover:text-gray-600'"
            class="px-3 py-1.5 rounded text-xs transition whitespace-nowrap"
            title="Mode complet (icône + montant)">≡ Complet</button>
        </div>
      </div>

      <div class="flex items-center justify-between mb-3">
        <p class="text-xs text-gray-400">
          {{ grilleRows.length }}{{ !grilleHasFilter && !showAllGrille && grilleRowsAll.length > 5 ? ` / ${grilleRowsAll.length}` : '' }} étudiant(s) · {{ grilleSlots }} mensualité(s) max
        </p>
        <button v-if="grilleRowsAll.length > 5 && !grilleHasFilter" @click="showAllGrille = !showAllGrille"
          class="text-xs text-red-600 underline hover:no-underline whitespace-nowrap">
          {{ showAllGrille ? 'Réduire (5 derniers)' : `Voir tout (${grilleRowsAll.length})` }}
        </button>
      </div>

      <div v-if="loading" class="text-center text-sm text-gray-400 py-10">Chargement…</div>

      <div v-else-if="grilleSlots === 0"
        class="bg-white rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
        Aucune échéance mensualité générée. Utilisez le bouton <strong>Générer</strong> sur chaque étudiant.
      </div>

      <div v-else class="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table class="text-sm border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-200">
              <th class="sticky left-0 z-10 bg-gray-50 text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide border-r border-gray-200 min-w-[220px]">
                Étudiant / Filière
              </th>
              <th class="text-center px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide border-r border-gray-100 whitespace-nowrap">
                Insc.
              </th>
              <th class="text-center px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide border-r border-gray-100 whitespace-nowrap">
                Tenue
              </th>
              <th v-for="slot in grilleSlots" :key="slot"
                class="text-center px-1 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap"
                :class="grilleMode === 'icones' ? 'min-w-[48px]' : grilleMode === 'complet' ? 'min-w-[110px]' : 'min-w-[90px]'">
                M{{ slot }}
              </th>
              <th class="text-center px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide border-l border-gray-100 whitespace-nowrap">
                Payés
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="insc in grilleRows" :key="insc.id"
              class="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition">

              <!-- Colonne étudiant (sticky) -->
              <td class="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-100 hover:bg-gray-50">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <router-link :to="`/etudiants/${insc.etudiant.id}`"
                      class="font-semibold text-gray-800 hover:text-red-600 transition text-sm block truncate">
                      {{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}
                    </router-link>
                    <p class="text-xs text-gray-400 mt-0.5 truncate max-w-[160px]">
                      {{ insc.filiere?.nom ?? '—' }}
                      <span v-if="insc.classe" class="text-gray-300"> · </span>
                      <span v-if="insc.classe">{{ insc.classe.nom }}</span>
                    </p>
                  </div>
                  <!-- Bouton générer si aucune échéance n'existe du tout -->
                  <button v-if="hasNoEcheances(insc.id)"
                    @click="genererEcheancesManquantes(insc)"
                    :disabled="regeneratingId === insc.id"
                    title="Aucune échéance — Cliquer pour générer les mensualités"
                    class="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition disabled:opacity-40 border border-blue-300">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
                    {{ regeneratingId === insc.id ? '…' : 'Générer' }}
                  </button>
                  <!-- Bouton corriger si des échéances ont montant=0 -->
                  <button v-else-if="hasZeroEcheances(insc.id)"
                    @click="regenererEcheances(insc)"
                    :disabled="regeneratingId === insc.id"
                    title="Échéances mal générées (0 FCFA) — Cliquer pour corriger"
                    class="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 transition disabled:opacity-40 border border-amber-300">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    {{ regeneratingId === insc.id ? '…' : 'Corriger' }}
                  </button>
                  <!-- Bouton corriger si trop de mensualités (dépasse duree_mois) -->
                  <button v-else-if="hasTooManyEcheances(insc.id)"
                    @click="regenererEcheances(insc)"
                    :disabled="regeneratingId === insc.id"
                    title="Trop de mensualités générées — Cliquer pour corriger"
                    class="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 transition disabled:opacity-40 border border-orange-300">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    {{ regeneratingId === insc.id ? '…' : 'Corriger' }}
                  </button>
                </div>
              </td>

              <!-- Frais inscription -->
              <td class="text-center px-2 py-2 border-r border-gray-100">
                <template v-if="getFiche(insc.id) && (getFiche(insc.id)?.frais_prevu ?? 0) > 0">
                  <!-- Mode icônes -->
                  <span v-if="grilleMode === 'icones'"
                    class="inline-flex flex-col items-center justify-center rounded-lg text-sm font-bold px-1.5 py-1 min-w-[40px] gap-0.5 leading-none"
                    :class="(getFiche(insc.id)?.frais_paye ?? 0) >= (getFiche(insc.id)?.frais_prevu ?? 1)
                      ? 'bg-green-100 text-green-600'
                      : (getFiche(insc.id)?.frais_paye ?? 0) > 0 ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'">
                    <span>{{ (getFiche(insc.id)?.frais_paye ?? 0) >= (getFiche(insc.id)?.frais_prevu ?? 1) ? '✓' : (getFiche(insc.id)?.frais_paye ?? 0) > 0 ? '◑' : '✗' }}</span>
                    <span v-if="getPaiementDateForInsc(insc.id)" class="text-[8px] font-semibold leading-tight opacity-80">
                      {{ getPaiementDateForInsc(insc.id)!.split('/').slice(0,2).join('/') }}
                    </span>
                  </span>
                  <!-- Mode texte -->
                  <span v-else-if="grilleMode === 'texte'"
                    class="inline-flex flex-col items-center gap-0 px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
                    :class="(getFiche(insc.id)?.frais_paye ?? 0) >= (getFiche(insc.id)?.frais_prevu ?? 1)
                      ? 'bg-green-100 text-green-600'
                      : (getFiche(insc.id)?.frais_paye ?? 0) > 0 ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'">
                    <span class="flex items-center gap-1">
                      <span>{{ (getFiche(insc.id)?.frais_paye ?? 0) >= (getFiche(insc.id)?.frais_prevu ?? 1) ? '✓' : (getFiche(insc.id)?.frais_paye ?? 0) > 0 ? '◑' : '✗' }}</span>
                      <span>{{ (getFiche(insc.id)?.frais_paye ?? 0) >= (getFiche(insc.id)?.frais_prevu ?? 1) ? 'Payé' : (getFiche(insc.id)?.frais_paye ?? 0) > 0 ? 'Partiel' : 'En retard' }}</span>
                    </span>
                    <span v-if="getPaiementDateForInsc(insc.id)" class="text-[9px] font-normal opacity-70 leading-tight">
                      {{ getPaiementDateForInsc(insc.id) }}
                    </span>
                  </span>
                  <!-- Mode montants -->
                  <span v-else-if="grilleMode === 'montants'"
                    class="inline-flex flex-col items-center px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap leading-tight"
                    :class="(getFiche(insc.id)?.frais_paye ?? 0) >= (getFiche(insc.id)?.frais_prevu ?? 1)
                      ? 'bg-green-100 text-green-600'
                      : (getFiche(insc.id)?.frais_paye ?? 0) > 0 ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'">
                    <template v-if="(getFiche(insc.id)?.frais_paye ?? 0) < (getFiche(insc.id)?.frais_prevu ?? 1)">
                      <span class="block">{{ fmt(getFiche(insc.id)?.frais_paye ?? 0) }}</span>
                      <span class="block opacity-60 font-normal">/ {{ fmt(getFiche(insc.id)?.frais_prevu ?? 0) }}</span>
                    </template>
                    <span v-else>{{ fmt(getFiche(insc.id)?.frais_prevu ?? 0) }}</span>
                    <span v-if="getPaiementDateForInsc(insc.id)" class="text-[9px] font-normal opacity-70 leading-tight">
                      {{ getPaiementDateForInsc(insc.id) }}
                    </span>
                  </span>
                  <!-- Mode complet -->
                  <span v-else
                    class="inline-flex flex-col items-center px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap leading-tight"
                    :class="(getFiche(insc.id)?.frais_paye ?? 0) >= (getFiche(insc.id)?.frais_prevu ?? 1)
                      ? 'bg-green-100 text-green-600'
                      : (getFiche(insc.id)?.frais_paye ?? 0) > 0 ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'">
                    <span>{{ (getFiche(insc.id)?.frais_paye ?? 0) >= (getFiche(insc.id)?.frais_prevu ?? 1) ? '✓' : (getFiche(insc.id)?.frais_paye ?? 0) > 0 ? '◑' : '✗' }} {{ (getFiche(insc.id)?.frais_paye ?? 0) >= (getFiche(insc.id)?.frais_prevu ?? 1) ? 'Payé' : (getFiche(insc.id)?.frais_paye ?? 0) > 0 ? 'Partiel' : 'En retard' }}</span>
                    <span class="font-normal opacity-75 text-[10px]">{{ fmt(getFiche(insc.id)?.frais_paye ?? 0) }} / {{ fmt(getFiche(insc.id)?.frais_prevu ?? 0) }}</span>
                    <span v-if="getPaiementDateForInsc(insc.id)" class="text-[9px] font-normal opacity-70 leading-tight">
                      {{ getPaiementDateForInsc(insc.id) }}
                    </span>
                  </span>
                </template>
                <span v-else class="text-gray-300 text-xs">—</span>
              </td>

              <!-- Tenue -->
              <td class="text-center px-2 py-2 border-r border-gray-100">
                <template v-if="getFiche(insc.id) && (getFiche(insc.id)?.tenue_prevu ?? 0) > 0">
                  <!-- Mode icônes -->
                  <button v-if="grilleMode === 'icones'"
                    @click="openTenueDetail(insc)"
                    class="rounded-lg mx-auto flex flex-col items-center justify-center px-1.5 py-1 text-sm font-bold cursor-pointer hover:opacity-80 transition min-w-[40px] leading-none gap-0.5"
                    :class="(getFiche(insc.id)?.tenue_paye ?? 0) >= (getFiche(insc.id)?.tenue_prevu ?? 1)
                      ? 'bg-green-100 text-green-600'
                      : (getFiche(insc.id)?.tenue_paye ?? 0) > 0 ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'">
                    <span>{{ (getFiche(insc.id)?.tenue_paye ?? 0) >= (getFiche(insc.id)?.tenue_prevu ?? 1) ? '✓' : (getFiche(insc.id)?.tenue_paye ?? 0) > 0 ? '◑' : '✗' }}</span>
                    <span v-if="getPaiementDateForTenue(insc.id)" class="text-[8px] font-semibold leading-tight opacity-80">
                      {{ getPaiementDateForTenue(insc.id)!.split('/').slice(0,2).join('/') }}
                    </span>
                  </button>
                  <!-- Mode texte -->
                  <button v-else-if="grilleMode === 'texte'"
                    @click="openTenueDetail(insc)"
                    class="inline-flex flex-col items-center gap-0 px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer hover:opacity-80 transition"
                    :class="(getFiche(insc.id)?.tenue_paye ?? 0) >= (getFiche(insc.id)?.tenue_prevu ?? 1)
                      ? 'bg-green-100 text-green-600'
                      : (getFiche(insc.id)?.tenue_paye ?? 0) > 0 ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'">
                    <span class="flex items-center gap-1">
                      <span>{{ (getFiche(insc.id)?.tenue_paye ?? 0) >= (getFiche(insc.id)?.tenue_prevu ?? 1) ? '✓' : (getFiche(insc.id)?.tenue_paye ?? 0) > 0 ? '◑' : '✗' }}</span>
                      <span>{{ (getFiche(insc.id)?.tenue_paye ?? 0) >= (getFiche(insc.id)?.tenue_prevu ?? 1) ? 'Payé' : (getFiche(insc.id)?.tenue_paye ?? 0) > 0 ? 'Partiel' : 'En retard' }}</span>
                    </span>
                    <span v-if="getPaiementDateForTenue(insc.id)" class="text-[9px] font-normal opacity-70 leading-tight">
                      {{ getPaiementDateForTenue(insc.id) }}
                    </span>
                  </button>
                  <!-- Mode montants -->
                  <button v-else-if="grilleMode === 'montants'"
                    @click="openTenueDetail(insc)"
                    class="inline-flex flex-col items-center px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap leading-tight cursor-pointer hover:opacity-80 transition"
                    :class="(getFiche(insc.id)?.tenue_paye ?? 0) >= (getFiche(insc.id)?.tenue_prevu ?? 1)
                      ? 'bg-green-100 text-green-600'
                      : (getFiche(insc.id)?.tenue_paye ?? 0) > 0 ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'">
                    <template v-if="(getFiche(insc.id)?.tenue_paye ?? 0) < (getFiche(insc.id)?.tenue_prevu ?? 1)">
                      <span class="block">{{ fmt(getFiche(insc.id)?.tenue_paye ?? 0) }}</span>
                      <span class="block opacity-60 font-normal">/ {{ fmt(getFiche(insc.id)?.tenue_prevu ?? 0) }}</span>
                    </template>
                    <span v-else>{{ fmt(getFiche(insc.id)?.tenue_prevu ?? 0) }}</span>
                    <span v-if="getPaiementDateForTenue(insc.id)" class="text-[9px] font-normal opacity-70 leading-tight">
                      {{ getPaiementDateForTenue(insc.id) }}
                    </span>
                  </button>
                  <!-- Mode complet -->
                  <button v-else
                    @click="openTenueDetail(insc)"
                    class="inline-flex flex-col items-center px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap leading-tight cursor-pointer hover:opacity-80 transition"
                    :class="(getFiche(insc.id)?.tenue_paye ?? 0) >= (getFiche(insc.id)?.tenue_prevu ?? 1)
                      ? 'bg-green-100 text-green-600'
                      : (getFiche(insc.id)?.tenue_paye ?? 0) > 0 ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'">
                    <span>{{ (getFiche(insc.id)?.tenue_paye ?? 0) >= (getFiche(insc.id)?.tenue_prevu ?? 1) ? '✓' : (getFiche(insc.id)?.tenue_paye ?? 0) > 0 ? '◑' : '✗' }} {{ (getFiche(insc.id)?.tenue_paye ?? 0) >= (getFiche(insc.id)?.tenue_prevu ?? 1) ? 'Payé' : (getFiche(insc.id)?.tenue_paye ?? 0) > 0 ? 'Partiel' : 'En retard' }}</span>
                    <span class="font-normal opacity-75 text-[10px]">{{ fmt(getFiche(insc.id)?.tenue_paye ?? 0) }} / {{ fmt(getFiche(insc.id)?.tenue_prevu ?? 0) }}</span>
                    <span v-if="getPaiementDateForTenue(insc.id)" class="text-[9px] font-normal opacity-70 leading-tight">
                      {{ getPaiementDateForTenue(insc.id) }}
                    </span>
                  </button>
                </template>
                <span v-else class="text-gray-400 text-[10px] italic">Pas de tenue</span>
              </td>

              <!-- Cellule par slot ordinal (M1, M2, …) -->
              <td v-for="slot in grilleSlots" :key="slot" class="text-center px-1 py-2">
                <template v-if="getEchBySlot(insc.id, slot)">

                  <!-- Sélecteur mois inline (partagé par tous les modes) -->
                  <template v-if="editingMoisEchId === getEchBySlot(insc.id, slot)?.id">
                    <input type="month"
                      :value="getEchBySlot(insc.id, slot)?.mois?.substring(0,7)"
                      @change="saveMoisEcheance(getEchBySlot(insc.id, slot)!.id, ($event.target as HTMLInputElement).value)"
                      @blur="editingMoisEchId = null"
                      @keydown.escape="editingMoisEchId = null"
                      class="w-24 text-[10px] border border-blue-400 rounded px-1 py-0.5 outline-none bg-white text-gray-700"
                      autofocus />
                  </template>

                  <!-- Mode icônes -->
                  <button v-else-if="grilleMode === 'icones'"
                    :title="tooltipBySlot(insc, slot)"
                    @click="openCellDetailBySlot(insc, slot)"
                    class="rounded-lg mx-auto flex flex-col items-center justify-center px-1.5 py-1 text-sm font-bold transition cursor-pointer min-w-[40px] leading-none gap-0.5"
                    :class="cellStatutClassBySlot(insc.id, slot)">
                    <span v-if="getMoisLabelBySlot(insc.id, slot)"
                      class="text-[8px] font-semibold leading-tight opacity-70 capitalize underline-dashed cursor-pointer hover:opacity-100"
                      @click.stop="editingMoisEchId = getEchBySlot(insc.id, slot)?.id ?? null"
                      title="Cliquer pour changer le mois">{{ getMoisLabelBySlot(insc.id, slot) }}</span>
                    <span>{{ cellIconBySlot(insc.id, slot) }}</span>
                    <span v-if="getPaiementDateBySlot(insc.id, slot)" class="text-[8px] font-semibold leading-tight opacity-80">
                      {{ getPaiementDateBySlot(insc.id, slot)!.split('/').slice(0,2).join('/') }}
                    </span>
                  </button>

                  <!-- Mode texte -->
                  <button v-else-if="grilleMode === 'texte'"
                    :title="tooltipBySlot(insc, slot)"
                    @click="openCellDetailBySlot(insc, slot)"
                    class="px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer mx-auto flex flex-col items-center gap-0"
                    :class="cellStatutClassBySlot(insc.id, slot)">
                    <span v-if="getMoisPayeBySlot(insc.id, slot)"
                      class="text-[8px] font-bold capitalize leading-tight">{{ getMoisPayeBySlot(insc.id, slot) }}</span>
                    <span v-else-if="getMoisLabelBySlot(insc.id, slot)"
                      class="text-[8px] font-normal opacity-70 capitalize leading-tight hover:opacity-100"
                      @click.stop="editingMoisEchId = getEchBySlot(insc.id, slot)?.id ?? null"
                      title="Cliquer pour changer le mois">{{ getMoisLabelBySlot(insc.id, slot) }}</span>
                    <span class="flex items-center gap-1">
                      <span>{{ cellIconBySlot(insc.id, slot) }}</span>
                      <span>{{ cellLabelBySlot(insc.id, slot) }}</span>
                    </span>
                    <span v-if="getPaiementDateBySlot(insc.id, slot)" class="text-[9px] font-normal opacity-70 leading-tight">
                      {{ getPaiementDateBySlot(insc.id, slot) }}
                    </span>
                  </button>

                  <!-- Mode montants -->
                  <button v-else-if="grilleMode === 'montants'"
                    :title="tooltipBySlot(insc, slot)"
                    @click="openCellDetailBySlot(insc, slot)"
                    class="px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer mx-auto flex flex-col items-center leading-tight"
                    :class="cellStatutClassBySlot(insc.id, slot)">
                    <span v-if="getMoisPayeBySlot(insc.id, slot)"
                      class="text-[8px] font-bold capitalize leading-tight">{{ getMoisPayeBySlot(insc.id, slot) }}</span>
                    <span v-else-if="getMoisLabelBySlot(insc.id, slot)"
                      class="text-[8px] font-normal opacity-70 capitalize leading-tight hover:opacity-100"
                      @click.stop="editingMoisEchId = getEchBySlot(insc.id, slot)?.id ?? null"
                      title="Cliquer pour changer le mois">{{ getMoisLabelBySlot(insc.id, slot) }}</span>
                    <template v-if="getEchBySlot(insc.id, slot)?.statut === 'partiellement_paye'">
                      <span class="block">{{ fmt(getEffectiveBySlot(insc.id, slot)?.effectif ?? 0) }}</span>
                      <span class="block opacity-60 font-normal">/ {{ fmt(getEffectiveBySlot(insc.id, slot)?.montant ?? 0) }}</span>
                    </template>
                    <template v-else>
                      <span>{{ fmt(getEffectiveBySlot(insc.id, slot)?.montant ?? 0) }}</span>
                    </template>
                    <span v-if="getPaiementDateBySlot(insc.id, slot)" class="text-[9px] font-normal opacity-70 leading-tight">
                      {{ getPaiementDateBySlot(insc.id, slot) }}
                    </span>
                  </button>

                  <!-- Mode complet -->
                  <button v-else
                    :title="tooltipBySlot(insc, slot)"
                    @click="openCellDetailBySlot(insc, slot)"
                    class="px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer mx-auto flex flex-col items-center gap-0.5 leading-tight"
                    :class="cellStatutClassBySlot(insc.id, slot)">
                    <span v-if="getMoisPayeBySlot(insc.id, slot)"
                      class="text-[8px] font-bold capitalize leading-tight">{{ getMoisPayeBySlot(insc.id, slot) }}</span>
                    <span v-else-if="getMoisLabelBySlot(insc.id, slot)"
                      class="text-[8px] font-normal opacity-70 capitalize leading-tight hover:opacity-100"
                      @click.stop="editingMoisEchId = getEchBySlot(insc.id, slot)?.id ?? null"
                      title="Cliquer pour changer le mois">{{ getMoisLabelBySlot(insc.id, slot) }}</span>
                    <span>{{ cellIconBySlot(insc.id, slot) }} {{ cellLabelBySlot(insc.id, slot) }}</span>
                    <span class="font-normal opacity-75 text-[10px]">
                      {{ fmt(getEffectiveBySlot(insc.id, slot)?.effectif ?? 0) }} / {{ fmt(getEffectiveBySlot(insc.id, slot)?.montant ?? 0) }}
                    </span>
                    <span v-if="getPaiementDateBySlot(insc.id, slot)" class="text-[9px] font-normal opacity-70 leading-tight">
                      {{ getPaiementDateBySlot(insc.id, slot) }}
                    </span>
                  </button>

                </template>
                <!-- Slot vide : l'étudiant a moins de mensualités que le max de la grille -->
                <span v-else class="text-gray-200 text-xs select-none">—</span>
              </td>

              <!-- Total mois payés -->
              <td class="text-center px-3 py-2 border-l border-gray-100">
                <span class="font-bold text-gray-700">
                  {{ Object.values(echeanceMap[insc.id] ?? {}).filter(e => e.statut === 'paye').length }}
                </span>
                <span class="text-xs text-gray-400">
                  /{{ Object.keys(echeanceMap[insc.id] ?? {}).length }}
                </span>
              </td>
            </tr>

            <tr v-if="grilleRows.length === 0">
              <td :colspan="grilleSlots + 3" class="text-center py-12 text-sm text-gray-400">
                Aucun étudiant trouvé pour ces filtres.
              </td>
            </tr>
          </tbody>

          <!-- Légende -->
          <tfoot>
            <tr class="border-t border-gray-200 bg-gray-50">
              <td :colspan="grilleSlots + 3" class="px-4 py-2">
                <div class="flex items-center gap-4 text-xs text-gray-400">
                  <span class="flex items-center gap-1"><span class="w-5 h-5 rounded bg-green-100 text-green-600 inline-flex items-center justify-center font-bold text-xs">✓</span> Payé</span>
                  <span class="flex items-center gap-1"><span class="w-5 h-5 rounded bg-orange-100 text-orange-500 inline-flex items-center justify-center font-bold text-xs">◑</span> Partiel</span>
                  <span class="flex items-center gap-1"><span class="w-5 h-5 rounded bg-red-100 text-red-500 inline-flex items-center justify-center font-bold text-xs">✗</span> En retard</span>
                  <span class="flex items-center gap-1"><span class="w-5 h-5 rounded bg-gray-100 text-gray-400 inline-flex items-center justify-center font-bold text-xs">·</span> À venir</span>
                  <span class="ml-2 text-gray-300">|</span>
                  <span class="text-gray-400">Cliquer sur ✗ ou ◑ pour enregistrer un paiement</span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- ── Historique des paiements ── -->
      <div class="mt-6">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide">
            Historique des paiements
            <span class="ml-2 font-normal text-gray-400 normal-case">— {{ recentPaiements.length }}{{ historiqueSearch ? ` / ${paiements.length}` : '' }} au total</span>
          </h2>
          <button v-if="paiements.length > 5" @click="showAllHistory = !showAllHistory"
            class="text-xs text-red-600 underline hover:no-underline">
            {{ showAllHistory ? 'Réduire (5 derniers)' : `Voir tout (${paiements.length})` }}
          </button>
        </div>
        <div class="mb-3">
          <input v-model="historiqueSearch" type="search" placeholder="🔍 Rechercher un étudiant par nom…"
            class="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400 transition" />
        </div>

        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div v-if="recentPaiements.length === 0" class="py-8 text-center text-sm text-gray-400">
            Aucun paiement enregistré.
          </div>
          <table v-else class="w-full text-sm">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                <th class="text-left px-4 py-3">N° Reçu</th>
                <th class="text-left px-4 py-3 cursor-pointer select-none hover:text-gray-700 transition" @click="toggleSort('etudiant')">
                  Étudiant <span class="ml-1 opacity-60">{{ sortIcon('etudiant') }}</span>
                </th>
                <th class="text-left px-4 py-3 cursor-pointer select-none hover:text-gray-700 transition" @click="toggleSort('type')">
                  Type <span class="ml-1 opacity-60">{{ sortIcon('type') }}</span>
                </th>
                <th class="text-left px-4 py-3">Mode</th>
                <th class="text-left px-4 py-3">Mois</th>
                <th class="text-right px-4 py-3 cursor-pointer select-none hover:text-gray-700 transition" @click="toggleSort('montant')">
                  Montant <span class="ml-1 opacity-60">{{ sortIcon('montant') }}</span>
                </th>
                <th class="text-center px-4 py-3 cursor-pointer select-none hover:text-gray-700 transition" @click="toggleSort('statut')">
                  Statut <span class="ml-1 opacity-60">{{ sortIcon('statut') }}</span>
                </th>
                <th class="text-left px-4 py-3 cursor-pointer select-none hover:text-gray-700 transition" @click="toggleSort('date')">
                  Date <span class="ml-1 opacity-60">{{ sortIcon('date') }}</span>
                </th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="(p, i) in recentPaiements" :key="p.id" class="hover:bg-gray-50 transition">
                <td class="px-4 py-3 font-mono text-xs text-gray-400">{{ p.numero_recu }}</td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      :style="{ background: avatarColor(i) }">
                      {{ initials(p.etudiant?.prenom ?? '', p.etudiant?.nom ?? '') }}
                    </div>
                    <span class="font-medium text-gray-800">{{ p.etudiant?.prenom }} {{ p.etudiant?.nom }}</span>
                  </div>
                </td>
                <td class="px-4 py-3 text-xs text-gray-500 capitalize">
                  {{ p.type_paiement === 'frais_inscription' ? "Frais inscription" : p.type_paiement === 'mensualite' ? 'Mensualité' : p.type_paiement === 'tenue' ? 'Tenue' : p.type_paiement }}
                </td>
                <td class="px-4 py-3">
                  <span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                    {{ modeLabel[p.mode_paiement] ?? p.mode_paiement }}
                  </span>
                </td>
                <td class="px-4 py-3 text-xs text-gray-500">{{ p.mois_concerne ? fmtMois(p.mois_concerne) : '—' }}</td>
                <td class="px-4 py-3 text-right font-bold text-green-600">+{{ fmt(p.montant) }} FCFA</td>
                <td class="px-4 py-3 text-center">
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                    :class="p.statut === 'confirme' ? 'bg-green-50 text-green-700' : p.statut === 'en_attente' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'">
                    <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
                    {{ p.statut === 'confirme' ? 'Confirmé' : p.statut === 'en_attente' ? 'En attente' : 'Rejeté' }}
                  </span>
                </td>
                <td class="px-4 py-3 text-xs text-gray-400">{{ fmtDate(p.confirmed_at ?? p.created_at) }}</td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <button v-if="p.statut === 'en_attente'"
                      @click="confirmerPaiement(p.id)"
                      :disabled="confirmingId === p.id"
                      class="text-xs border border-green-200 text-green-600 px-3 py-1 rounded-lg hover:bg-green-50 transition disabled:opacity-40 font-semibold">
                      {{ confirmingId === p.id ? '…' : '✓ Confirmer' }}
                    </button>
                    <button v-if="p.statut === 'confirme'" @click="printRecu(p)"
                      class="text-xs border border-gray-200 text-gray-500 px-2 py-1 rounded-lg hover:bg-gray-50 transition"
                      title="Imprimer le reçu">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                    </button>
                    <button @click="openEditModal(p)"
                      class="text-xs border border-gray-200 text-gray-500 px-2 py-1 rounded-lg hover:bg-gray-50 transition"
                      title="Modifier ce paiement">
                      ✏️
                    </button>
                    <button v-if="isDg"
                      @click="deletePaiement(p)"
                      :disabled="deletingPaiementId === p.id"
                      class="text-xs border border-red-200 text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition disabled:opacity-40"
                      title="Supprimer ce paiement">
                      {{ deletingPaiementId === p.id ? '…' : '🗑️' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>

    <!-- ── Modal paiement ── -->
    <!-- Modal choix mois de début échéancier -->
    <UcModal v-model="showGenererModal" title="Choisir le mois de début" width="380px">
      <div class="space-y-4 py-2">
        <p class="text-sm text-gray-600">
          Étudiant : <strong>{{ genererInsc?.etudiant.prenom }} {{ genererInsc?.etudiant.nom }}</strong>
        </p>
        <p class="text-xs text-gray-500">
          Choisissez le mois à partir duquel démarrent les mensualités de cet étudiant.
        </p>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Mois de début</label>
          <input v-model="genererMoisDebut" type="month"
            class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400" />
        </div>
        <div class="flex gap-2 justify-end pt-2">
          <button @click="showGenererModal = false"
            class="px-4 py-2 rounded-lg text-sm border border-gray-200 text-gray-600 hover:bg-gray-50">
            Annuler
          </button>
          <button @click="confirmerGenerer" :disabled="!genererMoisDebut"
            class="px-4 py-2 rounded-lg text-sm bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-40">
            {{ genererModeAction === 'regenerer' ? 'Régénérer' : 'Générer' }}
          </button>
        </div>
      </div>
    </UcModal>

    <UcModal v-model="showModal" title="Enregistrer un paiement" width="520px">
      <div class="space-y-4">

        <!-- Cascade : Type de formation → Filière → Classe → Étudiant -->
        <div class="grid grid-cols-2 gap-3">

          <!-- Niveau 1 : Type de formation -->
          <UcFormGroup label="Type de formation">
            <select v-model="formTypeFormationId" @change="onTypeFormationChange"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400">
              <option value="">Tous les types</option>
              <option v-for="tf in typesFormation" :key="tf.id" :value="String(tf.id)">
                {{ tf.nom }}
              </option>
            </select>
          </UcFormGroup>

          <!-- Niveau 2 : Filière -->
          <UcFormGroup label="Filière">
            <select v-model="formFiliereId" @change="onCascadeFiliereChange"
              :disabled="cascadeFilieres.length === 0"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400 disabled:opacity-50">
              <option value="">{{ cascadeFilieres.length === 0 ? 'Aucune filière' : 'Toutes les filières' }}</option>
              <option v-for="f in cascadeFilieres" :key="f.id" :value="String(f.id)">
                {{ f.nom }}
              </option>
            </select>
          </UcFormGroup>

          <!-- Niveau 3 : Classe (si des classes existent) -->
          <UcFormGroup v-if="cascadeHasClasses || formClasseId" label="Classe">
            <select v-model="formClasseId" @change="onCascadeClasseChange"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400">
              <option value="">Toutes les classes</option>
              <option v-for="cl in cascadeClasses" :key="cl.id" :value="String(cl.id)">
                {{ cl.nom }}
              </option>
            </select>
          </UcFormGroup>

          <!-- Niveau 4 : Étudiant -->
          <UcFormGroup :label="`Étudiant${cascadeEtudiants.length > 0 ? ' (' + cascadeEtudiants.length + ')' : ''}`" :required="true"
            :class="(!cascadeHasClasses && !formClasseId) ? 'col-span-2' : ''">
            <select v-model="form.inscription_id" @change="onInscriptionChange"
              :disabled="!formFiliereId && cascadeEtudiants.length === 0"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400 disabled:opacity-50">
              <option value="">-- Sélectionner --</option>
              <option v-for="insc in cascadeEtudiants" :key="insc.id" :value="insc.id">
                {{ insc.etudiant?.prenom }} {{ insc.etudiant?.nom }}
              </option>
            </select>
          </UcFormGroup>

        </div>

        <!-- Tarifs de référence (filière) -->
        <div v-if="selectedInscription" class="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 flex gap-6 text-xs">
          <div>
            <p class="text-blue-400 font-medium">Frais d'inscription (filière)</p>
            <p class="font-bold text-blue-800 text-base mt-0.5">{{ fmt(selectedInscription.filiere?.frais_inscription ?? selectedInscription.frais_inscription) }} FCFA</p>
          </div>
          <div class="w-px bg-blue-200"></div>
          <div>
            <p class="text-blue-400 font-medium">Mensualité (filière)</p>
            <p class="font-bold text-blue-800 text-base mt-0.5">{{ fmt(selectedInscription.filiere?.mensualite ?? selectedInscription.mensualite) }} FCFA / mois</p>
          </div>
          <template v-if="(selectedInscription.filiere?.montant_tenue ?? selectedInscription.frais_tenue ?? 0) > 0">
            <div class="w-px bg-blue-200"></div>
            <div>
              <p class="text-blue-400 font-medium">Tenue (filière)</p>
              <p class="font-bold text-blue-800 text-base mt-0.5">{{ fmt(selectedInscription.filiere?.montant_tenue ?? selectedInscription.frais_tenue ?? 0) }} FCFA</p>
            </div>
          </template>
        </div>

        <!-- Récap tenue si type = tenue -->
        <div v-if="form.type_paiement === 'tenue' && selectedInscription && getFiche(Number(form.inscription_id))"
          class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs">
          <p class="font-semibold text-amber-800 mb-2">État de la tenue</p>
          <div class="flex gap-6">
            <div>
              <p class="text-amber-500">Montant total</p>
              <p class="font-bold text-amber-800 text-sm">{{ fmt(getFiche(Number(form.inscription_id))?.tenue_prevu ?? 0) }} FCFA</p>
            </div>
            <div class="w-px bg-amber-200"></div>
            <div>
              <p class="text-amber-500">Déjà payé</p>
              <p class="font-bold text-green-700 text-sm">{{ fmt(getFiche(Number(form.inscription_id))?.tenue_paye ?? 0) }} FCFA</p>
            </div>
            <div class="w-px bg-amber-200"></div>
            <div>
              <p class="text-amber-500">Reste à payer</p>
              <p class="font-bold text-red-600 text-sm">{{ fmt(Math.max(0, (getFiche(Number(form.inscription_id))?.tenue_prevu ?? 0) - (getFiche(Number(form.inscription_id))?.tenue_paye ?? 0))) }} FCFA</p>
            </div>
          </div>
        </div>

        <UcFormGrid :cols="2">
          <UcFormGroup label="Type de paiement" :required="true">
            <select v-model="form.type_paiement" @change="onTypeChange"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400">
              <option value="mensualite">Mensualité</option>
              <option value="frais_inscription">Frais d'inscription</option>
              <option value="tenue">Tenue</option>
              <option value="rattrapage">Rattrapage</option>
            </select>
          </UcFormGroup>
          <input type="hidden" v-model="form.mois_concerne" />
          <UcFormGroup label="Date de paiement réelle">
            <input v-model="form.confirmed_at" type="date"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGrid :cols="2">
          <UcFormGroup label="Montant versé (FCFA)" :required="true">
            <input v-model="form.montant" type="number" min="0"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
          </UcFormGroup>
          <UcFormGroup label="Mode de paiement" :required="true">
            <select v-model="form.mode_paiement"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400">
              <option value="especes">Espèces</option>
              <option value="wave">Wave</option>
              <option value="orange_money">Orange Money</option>
              <option value="virement">Virement</option>
              <option value="cheque">Chèque</option>
            </select>
          </UcFormGroup>
        </UcFormGrid>

        <!-- Avertissement montant partiel -->
        <div v-if="selectedInscription && form.montant > 0 && (
          (form.type_paiement === 'frais_inscription' && Number(form.montant) < selectedInscription.frais_inscription) ||
          (form.type_paiement === 'mensualite' && Number(form.montant) < selectedInscription.mensualite) ||
          (form.type_paiement === 'tenue' && Number(form.montant) < (selectedInscription.filiere?.montant_tenue ?? selectedInscription.frais_tenue ?? 0))
        )" class="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5 text-xs text-orange-700 flex items-start gap-2">
          <svg class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span>
            Montant inférieur au tarif prévu
            ({{ form.type_paiement === 'frais_inscription' ? fmt(selectedInscription.frais_inscription) : form.type_paiement === 'tenue' ? fmt(selectedInscription.filiere?.montant_tenue ?? selectedInscription.frais_tenue ?? 0) : fmt(selectedInscription.mensualite) }} FCFA).
            Le paiement sera enregistré comme <strong>partiel</strong>. Vous pourrez compléter en cliquant à nouveau sur la cellule Tenue.
          </span>
        </div>

        <UcFormGroup label="Référence (optionnel)">
          <input v-model="form.reference" type="text" placeholder="Ex: Ref Wave #TX2026…"
            class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
        </UcFormGroup>

        <!-- Statut de confirmation -->
        <div v-if="(form.mode_paiement === 'especes' || form.confirmed_at) && form.montant > 0"
          class="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-xs text-green-700 flex items-center gap-2">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          Paiement confirmé — l'échéancier sera mis à jour immédiatement
        </div>
        <div v-else-if="form.montant > 0"
          class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700 flex items-center gap-2">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Nécessite une confirmation manuelle (ou renseignez la date de paiement ci-dessus)
        </div>
      </div>

      <template #footer>
        <button @click="showModal = false"
          class="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          Annuler
        </button>
        <button @click="savePaiement"
          :disabled="saving || !form.inscription_id || !form.montant"
          class="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition disabled:opacity-40">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
      </template>
    </UcModal>

    <!-- ── Modal détail cellule mensualité ── -->
    <UcModal v-model="showCellDetail" :title="cellDetail ? `${cellDetail.insc.etudiant.prenom} ${cellDetail.insc.etudiant.nom} — ${fmtMois(cellDetail.mois + '-01')}` : 'Détail mensualité'" width="420px">
      <div v-if="cellDetail" class="space-y-4">

        <!-- Statut badge -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            :class="cellDetail.statut === 'paye' ? 'bg-green-100 text-green-700'
              : cellDetail.statut === 'partiellement_paye' ? 'bg-orange-100 text-orange-700'
              : 'bg-red-100 text-red-700'">
            <span class="w-2 h-2 rounded-full bg-current"></span>
            {{ cellDetail.statut === 'paye' ? 'Soldé' : cellDetail.statut === 'partiellement_paye' ? 'Partiel' : 'Non payé' }}
          </span>
          <span class="text-xs text-gray-400">{{ cellDetail.insc.filiere?.nom ?? '—' }}</span>
          <span v-if="getPaiementDateByMois(cellDetail.insc.id, cellDetail.mois)"
            class="ml-auto text-xs text-gray-500 flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Payé le {{ getPaiementDateByMois(cellDetail.insc.id, cellDetail.mois) }}
          </span>
        </div>

        <!-- Tableau de ventilation -->
        <div class="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
          <div class="px-4 py-3 flex justify-between items-center border-b border-gray-100">
            <span class="text-xs text-gray-500 font-medium">Mensualité prévue</span>
            <span class="font-bold text-gray-800">{{ fmt(cellDetail.montant_prevu) }} FCFA</span>
          </div>
          <div class="px-4 py-3 flex justify-between items-center border-b border-gray-100">
            <span class="text-xs text-gray-500 font-medium">Payé pour ce mois</span>
            <span class="font-semibold text-blue-700">{{ fmt(cellDetail.versements_directs) }} FCFA</span>
          </div>
          <div v-if="cellDetail.surplus_applique > 0" class="px-4 py-3 flex justify-between items-center border-b border-gray-100">
            <span class="text-xs text-gray-500 font-medium">Report du mois précédent</span>
            <span class="font-semibold text-purple-600">+ {{ fmt(cellDetail.surplus_applique) }} FCFA</span>
          </div>
          <div class="px-4 py-3 flex justify-between items-center border-b border-gray-100 bg-white">
            <span class="text-xs font-bold text-gray-700">Total couvert</span>
            <span class="font-bold text-gray-900">{{ fmt(cellDetail.total_effectif) }} / {{ fmt(cellDetail.montant_prevu) }} FCFA</span>
          </div>
          <div class="px-4 py-3 flex justify-between items-center" :class="cellDetail.reste > 0 ? 'bg-red-50' : 'bg-green-50'">
            <span class="text-xs font-bold" :class="cellDetail.reste > 0 ? 'text-red-600' : 'text-green-600'">
              {{ cellDetail.reste > 0 ? 'Reste à payer' : 'Soldé ✓' }}
            </span>
            <span class="font-bold text-lg" :class="cellDetail.reste > 0 ? 'text-red-600' : 'text-green-600'">
              {{ cellDetail.reste > 0 ? fmt(cellDetail.reste) + ' FCFA' : '' }}
            </span>
          </div>
        </div>

        <!-- Barre de progression -->
        <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all"
            :class="cellDetail.statut === 'paye' ? 'bg-green-500' : cellDetail.statut === 'partiellement_paye' ? 'bg-orange-400' : 'bg-red-300'"
            :style="{ width: cellDetail.montant_prevu > 0 ? `${Math.min(100, Math.round(cellDetail.total_effectif / cellDetail.montant_prevu * 100))}%` : '0%' }">
          </div>
        </div>
        <p class="text-xs text-center text-gray-400">
          {{ cellDetail.montant_prevu > 0 ? Math.min(100, Math.round(cellDetail.total_effectif / cellDetail.montant_prevu * 100)) : 0 }}% couvert
        </p>

      </div>

      <template #footer>
        <button @click="showCellDetail = false"
          class="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          Fermer
        </button>
        <button v-if="cellDetail && cellDetail.reste > 0"
          @click="completerPaiement()"
          class="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition">
          Payer {{ fmt(cellDetail.reste) }} FCFA
        </button>
      </template>
    </UcModal>

    <!-- ── Modal détail tenue ── -->
    <UcModal v-model="showTenueDetail" :title="tenueDetail ? `${tenueDetail.insc.etudiant.prenom} ${tenueDetail.insc.etudiant.nom} — Tenue` : 'Détail tenue'" width="420px">
      <div v-if="tenueDetail" class="space-y-4">
        <div class="flex items-center gap-3">
          <span class="text-xs px-3 py-1 rounded-full font-semibold"
            :class="tenueDetail.statut === 'paye' ? 'bg-green-100 text-green-700'
              : tenueDetail.statut === 'partiellement_paye' ? 'bg-orange-100 text-orange-700'
              : 'bg-red-100 text-red-600'">
            {{ tenueDetail.statut === 'paye' ? 'Soldé' : tenueDetail.statut === 'partiellement_paye' ? 'Partiel' : 'Non payé' }}
          </span>
          <span class="text-xs text-gray-400">{{ tenueDetail.insc.filiere?.nom ?? '—' }}</span>
        </div>
        <div class="rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-100">
          <div class="px-4 py-3 flex justify-between items-center">
            <span class="text-xs text-gray-500 font-medium">Tenue prévue</span>
            <span class="font-bold text-gray-800">{{ fmt(tenueDetail.montant_prevu) }} FCFA</span>
          </div>
          <div class="px-4 py-3 flex justify-between items-center">
            <span class="text-xs text-gray-500 font-medium">Déjà payé</span>
            <span class="font-semibold text-blue-700">{{ fmt(tenueDetail.tenue_paye) }} FCFA</span>
          </div>
          <div class="px-4 py-3 flex justify-between items-center" :class="tenueDetail.reste > 0 ? 'bg-red-50' : 'bg-green-50'">
            <span class="text-xs font-bold" :class="tenueDetail.reste > 0 ? 'text-red-600' : 'text-green-600'">
              {{ tenueDetail.reste > 0 ? 'Reste à payer' : 'Soldé ✓' }}
            </span>
            <span class="font-bold text-lg" :class="tenueDetail.reste > 0 ? 'text-red-600' : 'text-green-600'">
              {{ tenueDetail.reste > 0 ? fmt(tenueDetail.reste) + ' FCFA' : '' }}
            </span>
          </div>
        </div>
        <!-- Barre de progression -->
        <div class="h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all"
            :class="tenueDetail.statut === 'paye' ? 'bg-green-500' : tenueDetail.statut === 'partiellement_paye' ? 'bg-orange-400' : 'bg-red-300'"
            :style="{ width: tenueDetail.montant_prevu > 0 ? `${Math.min(100, Math.round(tenueDetail.tenue_paye / tenueDetail.montant_prevu * 100))}%` : '0%' }">
          </div>
        </div>
        <p class="text-xs text-center text-gray-400">
          {{ tenueDetail.montant_prevu > 0 ? Math.min(100, Math.round(tenueDetail.tenue_paye / tenueDetail.montant_prevu * 100)) : 0 }}% couvert
        </p>
      </div>
      <template #footer>
        <button @click="showTenueDetail = false"
          class="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          Fermer
        </button>
        <button v-if="tenueDetail && tenueDetail.reste > 0"
          @click="completerTenue()"
          class="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition">
          Payer {{ fmt(tenueDetail.reste) }} FCFA
        </button>
      </template>
    </UcModal>

    <!-- ── Modal retards ── -->
    <UcModal v-model="showRetardsModal" title="Étudiants en retard de paiement" width="700px">
      <div class="space-y-4">
        <!-- Filtre mois -->
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-500 font-medium">Mois :</span>
          <input v-model="retardsMois" type="month"
            class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-red-400"/>
          <span class="text-xs text-gray-400">{{ retardsData.length }} retard(s) trouvé(s)</span>
        </div>

        <!-- Liste vide -->
        <div v-if="retardsData.length === 0" class="text-center py-10 text-gray-400">
          <svg class="w-10 h-10 mx-auto mb-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <p class="font-semibold text-green-600">Tous les étudiants sont en règle pour ce mois</p>
        </div>

        <!-- Table retards -->
        <div v-else class="rounded-xl border border-gray-100 overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="px-4 py-2 text-left">Étudiant</th>
                <th class="px-4 py-2 text-left">Filière</th>
                <th class="px-4 py-2 text-center">Type</th>
                <th class="px-4 py-2 text-right">Payé</th>
                <th class="px-4 py-2 text-right">Reste</th>
                <th class="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="(row, i) in retardsData" :key="i" class="hover:bg-orange-50 transition">
                <td class="px-4 py-3 font-semibold text-gray-800">
                  {{ row.insc.etudiant.prenom }} {{ row.insc.etudiant.nom }}
                </td>
                <td class="px-4 py-3 text-gray-500 text-xs">{{ row.insc.filiere?.nom ?? '—' }}</td>
                <td class="px-4 py-3 text-center">
                  <span class="text-xs px-2 py-0.5 rounded-full font-semibold"
                    :class="row.type === 'mensualite' ? 'bg-blue-100 text-blue-700' : row.type === 'tenue' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'">
                    {{ row.type === 'mensualite' ? 'Mensualité' : row.type === 'tenue' ? 'Tenue' : 'Inscription' }}
                  </span>
                  <span v-if="row.statut === 'partiellement_paye'" class="ml-1 text-xs text-orange-500 font-medium">Partiel</span>
                </td>
                <td class="px-4 py-3 text-right text-blue-600 font-medium text-xs">{{ fmt(row.montant_paye) }} FCFA</td>
                <td class="px-4 py-3 text-right text-red-600 font-bold">{{ fmt(row.reste) }} FCFA</td>
                <td class="px-4 py-3 text-right">
                  <button @click="payerRetard(row)"
                    class="px-3 py-1 bg-red-600 text-white text-xs rounded-lg font-semibold hover:bg-red-700 transition">
                    Payer
                  </button>
                </td>
              </tr>
            </tbody>
            <tfoot class="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colspan="4" class="px-4 py-2 text-xs font-semibold text-gray-500 text-right">Total à collecter</td>
                <td class="px-4 py-2 text-right font-bold text-red-600">{{ fmt(retardsData.reduce((s,r) => s+r.reste, 0)) }} FCFA</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <template #footer>
        <button @click="showRetardsModal = false"
          class="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          Fermer
        </button>
        <div class="flex items-center gap-2 ml-auto">
          <button v-if="retardsData.length > 0" @click="exportRetardsExcel()"
            class="flex items-center gap-1.5 px-3 py-2 bg-green-700 text-white text-xs font-semibold rounded-lg hover:bg-green-800 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Exporter Excel
          </button>
          <button v-if="retardsData.length > 0" @click="exportRetardsPDF()"
            class="flex items-center gap-1.5 px-3 py-2 bg-red-700 text-white text-xs font-semibold rounded-lg hover:bg-red-800 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
            Exporter PDF
          </button>
        </div>
      </template>
    </UcModal>

    <!-- ── Modal édition paiement ── -->
    <UcModal v-model="showEditModal" title="Modifier le paiement" width="480px">
      <div v-if="editingPaiement" class="space-y-4">

        <!-- Info paiement -->
        <div class="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-500 flex gap-4">
          <span class="font-mono font-bold text-gray-700">{{ editingPaiement.numero_recu }}</span>
          <span>{{ editingPaiement.etudiant?.prenom }} {{ editingPaiement.etudiant?.nom }}</span>
          <span class="ml-auto" :class="editingPaiement.statut === 'confirme' ? 'text-green-600 font-semibold' : 'text-amber-600 font-semibold'">
            {{ editingPaiement.statut === 'confirme' ? 'Confirmé' : editingPaiement.statut === 'en_attente' ? 'En attente' : 'Rejeté' }}
          </span>
        </div>

        <div v-if="editingPaiement.statut === 'confirme'"
          class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700 flex items-start gap-2">
          <svg class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Ce paiement est déjà confirmé. La modification recalculera automatiquement les échéances.
        </div>

        <UcFormGrid :cols="2">
          <UcFormGroup label="Type de paiement" :required="true">
            <select v-model="editForm.type_paiement"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400">
              <option value="mensualite">Mensualité</option>
              <option value="frais_inscription">Frais d'inscription</option>
              <option value="tenue">Tenue</option>
              <option value="rattrapage">Rattrapage</option>
            </select>
          </UcFormGroup>
          <input type="hidden" v-model="editForm.mois_concerne" />
        </UcFormGrid>

        <UcFormGrid :cols="2">
          <UcFormGroup label="Date de paiement" :required="false">
            <input v-model="editForm.confirmed_at" type="date"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
            <p class="text-[10px] text-gray-400 mt-1">Date réelle du règlement (pour la comptabilité)</p>
          </UcFormGroup>
          <UcFormGroup label="Mode de paiement" :required="true">
            <select v-model="editForm.mode_paiement"
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400">
              <option value="especes">Espèces</option>
              <option value="wave">Wave</option>
              <option value="orange_money">Orange Money</option>
              <option value="virement">Virement</option>
              <option value="cheque">Chèque</option>
            </select>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGroup label="Montant (FCFA)" :required="true">
          <input v-model="editForm.montant" type="number" min="0"
            class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
        </UcFormGroup>

        <UcFormGroup label="Référence (optionnel)">
          <input v-model="editForm.reference" type="text" placeholder="Ex: Ref Wave #TX2026…"
            class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
        </UcFormGroup>

        <UcFormGroup label="Observation (optionnel)">
          <input v-model="editForm.observation" type="text" placeholder="Note interne…"
            class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
        </UcFormGroup>
      </div>

      <template #footer>
        <button @click="showEditModal = false"
          class="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          Annuler
        </button>
        <button @click="saveEdit"
          :disabled="saving || !editForm.montant"
          class="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition disabled:opacity-40">
          {{ saving ? 'Enregistrement…' : 'Sauvegarder' }}
        </button>
      </template>
    </UcModal>

  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-12px) scale(0.95); }
</style>
