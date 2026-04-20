<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { UcModal, UcFormGroup, UcFormGrid, UcPageHeader } from '@/components/ui'
import * as XLSX from 'xlsx'
import { openPrintWindow, uptechHeaderHTML, uptechFooterHTML, uptechPrintCSS } from '@/utils/uptechPrint'

const auth = useAuthStore()
const toast = useToast()
const router = useRouter()
const canValidate = computed(() => ['dg', 'resp_fin'].includes(auth.user?.role ?? ''))

function goDepenses() { router.push('/depenses') }
function goJournalDepenses() {
  sessionStorage.setItem('depenses_tab', 'journal')
  router.push('/depenses')
}

interface Vacation {
  id: number
  enseignant_id: number
  enseignant_nom: string
  enseignant_prenom: string
  enseignant_email: string
  enseignant_telephone: string
  type_contrat: string
  grade: string
  specialite: string
  annee_academique_id: number | null
  annee_libelle: string | null
  mois: string
  nb_heures: number
  tarif_horaire: number
  montant: number
  statut: 'en_attente' | 'validee' | 'payee'
  valide_par_nom: string | null
  valide_par_prenom: string | null
  valide_at: string | null
  paye_par_nom: string | null
  paye_at: string | null
  reference_paiement: string | null
  note: string | null
  type_formation_id: number | null
  type_formation_libelle: string | null
  type_formation_libelle_resolved?: string | null
}

interface VacationGroupe {
  enseignant_id: number
  enseignant_nom: string
  enseignant_prenom: string
  specialite: string
  grade: string
  type_contrat: string
  mois: string
  lignes: Vacation[]
  total_heures: number
  total_montant: number
  tout_en_attente: boolean
  tout_valide: boolean
  tout_paye: boolean
}

interface Resume {
  total: string
  total_heures: string
  total_montant: string
  montant_en_attente: string
  montant_valide: string
  montant_paye: string
  nb_en_attente: string
  nb_valide: string
  nb_paye: string
}

const loading = ref(false)
const loadError = ref('')
const vacations = ref<Vacation[]>([])
const resume = ref<Resume | null>(null)
const annees = ref<{ id: number; libelle: string; actif?: boolean }[]>([])
const enseignants = ref<{ id: number; nom: string; prenom: string; tarif_horaire: number }[]>([])

const moisSelectionne = ref('')   // vide = pas de filtre mois par défaut → tout afficher
const filterAnnee = ref<number | null>(null)
const filterStatut = ref('')
const search = ref('')

// Modals
const showGenererModal = ref(false)
const genererMois = ref(new Date().toISOString().slice(0, 7))
const genererAnnee = ref<number | null>(null)
const genererLoading = ref(false)
const genererResult = ref<{ created: number; updated: number; total: number; message: string } | null>(null)

const showManuelModal = ref(false)
const manuelForm = ref({ enseignant_id: null as number | null, mois: new Date().toISOString().slice(0, 7), nb_heures: '', tarif_horaire: '', note: '' })
const manuelLoading = ref(false)

const showEditModal = ref(false)
const editForm = ref<{ id: number; nb_heures: string; tarif_horaire: string; note: string } | null>(null)
const editLoading = ref(false)

const showPayerModal = ref(false)
const payerTarget = ref<Vacation | null>(null)
const payerRef = ref('')
const payerLoading = ref(false)

// Correction tarif (DG uniquement)
const showTarifModal = ref(false)
const tarifTarget = ref<Vacation | null>(null)
const tarifForm = ref('')
const tarifLoading = ref(false)

const actionLoading = ref<number | null>(null)

const statutColors: Record<string, { bg: string; text: string; dot: string }> = {
  en_attente: { bg: '#fffbeb', text: '#92400e', dot: '#f59e0b' },
  validee:    { bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' },
  payee:      { bg: '#f0fdf4', text: '#166534', dot: '#16a34a' },
}

const statutLabels: Record<string, string> = {
  en_attente: 'En attente',
  validee: 'Validée',
  payee: 'Payée',
}

function formatFCFA(n: number | string) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(Number(n) || 0)) + ' FCFA'
}
function fmtPDF(n: number | string) {
  return formatFCFA(n)
}

function formatMois(m: string) {
  if (!m) return ''
  return new Date(m + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

const vacationsFiltrees = computed(() => {
  let list = vacations.value
  if (filterStatut.value) list = list.filter(v => v.statut === filterStatut.value)
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter(v =>
      v.enseignant_nom.toLowerCase().includes(q) ||
      v.enseignant_prenom.toLowerCase().includes(q) ||
      (v.specialite || '').toLowerCase().includes(q)
    )
  }
  return list
})

// Grouper les lignes par enseignant+mois pour affichage en tableau hiérarchique
const vacationsGroupees = computed((): VacationGroupe[] => {
  const map = new Map<string, VacationGroupe>()
  for (const v of vacationsFiltrees.value) {
    const key = `${v.enseignant_id}_${v.mois}`
    if (!map.has(key)) {
      map.set(key, {
        enseignant_id: v.enseignant_id,
        enseignant_nom: v.enseignant_nom,
        enseignant_prenom: v.enseignant_prenom,
        specialite: v.specialite,
        grade: v.grade,
        type_contrat: v.type_contrat,
        mois: v.mois,
        lignes: [],
        total_heures: 0,
        total_montant: 0,
        tout_en_attente: true,
        tout_valide: false,
        tout_paye: false,
      })
    }
    const g = map.get(key)!
    g.lignes.push(v)
    g.total_heures += Number(v.nb_heures)
    g.total_montant += Number(v.montant)
  }
  // Recalculer les drapeaux de statut
  for (const g of map.values()) {
    g.tout_en_attente = g.lignes.every(l => l.statut === 'en_attente')
    g.tout_valide     = g.lignes.every(l => l.statut === 'validee' || l.statut === 'payee')
    g.tout_paye       = g.lignes.every(l => l.statut === 'payee')
  }
  return [...map.values()]
})

const resumeFiltre = computed(() => {
  const list = vacationsFiltrees.value
  const ensDistincts = new Set(list.map(v => `${v.enseignant_id}_${v.mois}`)).size
  return {
    total: ensDistincts,          // nb d'enseignants (groupes)
    nb_lignes: list.length,
    total_heures: list.reduce((s, v) => s + Number(v.nb_heures), 0),
    total_montant: list.reduce((s, v) => s + Number(v.montant), 0),
    montant_en_attente: list.filter(v => v.statut === 'en_attente').reduce((s, v) => s + Number(v.montant), 0),
    montant_valide: list.filter(v => v.statut === 'validee').reduce((s, v) => s + Number(v.montant), 0),
    montant_paye: list.filter(v => v.statut === 'payee').reduce((s, v) => s + Number(v.montant), 0),
    nb_en_attente: list.filter(v => v.statut === 'en_attente').length,
    nb_valide: list.filter(v => v.statut === 'validee').length,
    nb_paye: list.filter(v => v.statut === 'payee').length,
  }
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [vRes, aRes, eRes] = await Promise.all([
      api.get('/vacations', { params: {
        mois: moisSelectionne.value || undefined,
        annee_academique_id: filterAnnee.value || undefined,
      }}),
      api.get('/annees-academiques'),
      api.get('/enseignants?all=1'),
    ])
    vacations.value = Array.isArray(vRes.data) ? vRes.data : []
    annees.value = aRes.data

    // Pré-sélectionner l'année académique active dans les modals (si pas encore sélectionnée)
    const anneeActive = (aRes.data as any[]).find((a: any) => a.actif)
    if (anneeActive) {
      if (!genererAnnee.value) genererAnnee.value = anneeActive.id
      // Ne pas écraser filterAnnee si déjà choisi
      if (filterAnnee.value === null) filterAnnee.value = anneeActive.id
    }

    enseignants.value = (eRes.data.data ?? eRes.data).map((e: any) => ({
      id: e.id, nom: e.nom, prenom: e.prenom, tarif_horaire: e.tarif_horaire || 0
    }))
  } catch (err: any) {
    loadError.value = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Erreur de chargement'
    vacations.value = []
  } finally {
    loading.value = false
  }
}

async function genererVacations() {
  genererLoading.value = true
  genererResult.value = null
  try {
    const { data } = await api.post('/vacations/generer', {
      mois: genererMois.value,
      annee_academique_id: genererAnnee.value || undefined,
    })
    genererResult.value = data
    await load()
    // Avertir si des enseignants ont tarif = 0 après génération
    const sansT = vacations.value.filter(v => v.mois === genererMois.value && Number(v.tarif_horaire) === 0)
    if (sansT.length > 0) {
      genererResult.value = {
        ...data,
        message: (data.message || '') + ` ⚠️ ${sansT.length} enseignant(s) sans tarif configuré — cliquez sur "⚠️ Tarif non défini" pour corriger.`
      }
    }
  } catch (err: any) {
    const msg = err?.response?.data?.error || err?.response?.data?.message || 'Erreur lors de la génération'
    genererResult.value = { created: 0, updated: 0, total: 0, message: msg }
  } finally {
    genererLoading.value = false
  }
}

async function saveManuel() {
  if (!manuelForm.value.enseignant_id || !manuelForm.value.mois) return
  manuelLoading.value = true
  try {
    const ens = enseignants.value.find(e => e.id === manuelForm.value.enseignant_id)
    await api.post('/vacations', {
      enseignant_id: manuelForm.value.enseignant_id,
      mois: manuelForm.value.mois,
      nb_heures: parseFloat(manuelForm.value.nb_heures) || 0,
      tarif_horaire: parseFloat(manuelForm.value.tarif_horaire) || ens?.tarif_horaire || 0,
      note: manuelForm.value.note || undefined,
      annee_academique_id: filterAnnee.value || undefined,
    })
    showManuelModal.value = false
    manuelForm.value = { enseignant_id: null, mois: new Date().toISOString().slice(0, 7), nb_heures: '', tarif_horaire: '', note: '' }
    await load()
  } catch (err: any) {
    toast.apiError(err, 'Erreur')
  } finally {
    manuelLoading.value = false
  }
}

function openEdit(v: Vacation) {
  editForm.value = { id: v.id, nb_heures: String(v.nb_heures), tarif_horaire: String(v.tarif_horaire), note: v.note || '' }
  showEditModal.value = true
}

async function saveEdit() {
  if (!editForm.value) return
  editLoading.value = true
  try {
    await api.put(`/vacations/${editForm.value.id}`, {
      nb_heures: parseFloat(editForm.value.nb_heures),
      tarif_horaire: parseFloat(editForm.value.tarif_horaire),
      note: editForm.value.note || undefined,
    })
    showEditModal.value = false
    await load()
  } catch (err: any) {
    toast.apiError(err, 'Erreur')
  } finally {
    editLoading.value = false
  }
}

async function valider(v: Vacation) {
  if (!confirm(`Valider la vacation de ${v.enseignant_prenom} ${v.enseignant_nom} — ${formatFCFA(v.montant)} ?`)) return
  actionLoading.value = v.id
  try {
    await api.post(`/vacations/${v.id}/valider`, {})
    await load()
  } catch (err: any) {
    toast.apiError(err, 'Erreur')
  } finally {
    actionLoading.value = null
  }
}

function openPayer(v: Vacation) {
  payerTarget.value = v
  payerRef.value = ''
  showPayerModal.value = true
}

async function confirmerPaiement() {
  if (!payerTarget.value) return
  payerLoading.value = true
  try {
    await api.post(`/vacations/${payerTarget.value.id}/payer`, { reference_paiement: payerRef.value || undefined })
    showPayerModal.value = false
    await load()
  } catch (err: any) {
    toast.apiError(err, 'Erreur')
  } finally {
    payerLoading.value = false
  }
}

// Valider toutes les lignes en_attente d'un groupe enseignant
async function validerGroupe(g: VacationGroupe) {
  const lignesAttendu = g.lignes.filter(l => l.statut === 'en_attente')
  if (!lignesAttendu.length) return
  const total = formatFCFA(g.total_montant)
  if (!confirm(`Valider toutes les vacations de ${g.enseignant_prenom} ${g.enseignant_nom} (${total}) ?`)) return
  for (const l of lignesAttendu) {
    try { await api.post(`/vacations/${l.id}/valider`, {}) } catch { /* continue */ }
  }
  await load()
}

// Ouvrir la modale de paiement pour tout le groupe (référence commune)
const showPayerGroupeModal = ref(false)
const payerGroupeTarget = ref<VacationGroupe | null>(null)
const payerGroupeRef = ref('')
const payerGroupeLoading = ref(false)

function openPayerGroupe(g: VacationGroupe) {
  payerGroupeTarget.value = g
  payerGroupeRef.value = ''
  showPayerGroupeModal.value = true
}

async function confirmerPaiementGroupe() {
  if (!payerGroupeTarget.value) return
  payerGroupeLoading.value = true
  const lignesValidees = payerGroupeTarget.value.lignes.filter(l => l.statut === 'validee')
  try {
    for (const l of lignesValidees) {
      await api.post(`/vacations/${l.id}/payer`, { reference_paiement: payerGroupeRef.value || undefined })
    }
    showPayerGroupeModal.value = false
    await load()
  } catch (err: any) {
    toast.apiError(err, 'Erreur')
  } finally {
    payerGroupeLoading.value = false
  }
}

async function supprimer(v: Vacation) {
  if (!confirm(`Supprimer la vacation de ${v.enseignant_prenom} ${v.enseignant_nom} ?`)) return
  actionLoading.value = v.id
  try {
    await api.delete(`/vacations/${v.id}`)
    await load()
  } catch (err: any) {
    toast.apiError(err, 'Erreur')
  } finally {
    actionLoading.value = null
  }
}

function openTarif(v: Vacation) {
  tarifTarget.value = v
  tarifForm.value = String(v.tarif_horaire || '')
  showTarifModal.value = true
}

async function corrigerTarif() {
  if (!tarifTarget.value) return
  tarifLoading.value = true
  try {
    await api.patch(`/vacations/${tarifTarget.value.id}/tarif`, { tarif_horaire: parseFloat(tarifForm.value) })
    showTarifModal.value = false
    await load()
  } catch (err: any) {
    toast.apiError(err, 'Erreur')
  } finally {
    tarifLoading.value = false
  }
}

function onEnseignantChange() {
  const ens = enseignants.value.find(e => e.id === manuelForm.value.enseignant_id)
  if (ens && !manuelForm.value.tarif_horaire) {
    manuelForm.value.tarif_horaire = String(ens.tarif_horaire || '')
  }
}

function exportExcel() {
  const list = vacationsFiltrees.value
  const moisLabel = moisSelectionne.value ? formatMois(moisSelectionne.value) : 'Tous les mois'
  const rows = list.map(v => ({
    'Enseignant': `${v.enseignant_prenom} ${v.enseignant_nom}`,
    'Spécialité': v.specialite || '',
    'Grade': v.grade || '',
    'Type contrat': v.type_contrat || '',
    'Mois': formatMois(v.mois),
    'Heures': Number(v.nb_heures),
    'Tarif/h (FCFA)': Number(v.tarif_horaire),
    'Montant (FCFA)': Number(v.montant),
    'Statut': statutLabels[v.statut] || v.statut,
    'Validé par': v.valide_par_nom ? `${v.valide_par_prenom} ${v.valide_par_nom}` : '',
    'Validé le': v.valide_at ? new Date(v.valide_at).toLocaleDateString('fr-FR') : '',
    'Payé le': v.paye_at ? new Date(v.paye_at).toLocaleDateString('fr-FR') : '',
    'Référence': v.reference_paiement || '',
    'Note': v.note || '',
  }))

  const r = resumeFiltre.value
  const summary = [
    [`Bordereau Vacations — ${moisSelectionne.value ? formatMois(moisSelectionne.value) : 'Tous les mois'}`],
    [],
    ['Total enseignants', r.total],
    ['Total heures', r.total_heures],
    ['Total montant (FCFA)', r.total_montant],
    ['En attente (FCFA)', r.montant_en_attente],
    ['Validé (FCFA)', r.montant_valide],
    ['Payé (FCFA)', r.montant_paye],
  ]

  const wb = XLSX.utils.book_new()
  const wsSummary = XLSX.utils.aoa_to_sheet(summary)
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Résumé')
  XLSX.utils.book_append_sheet(wb, ws, 'Détail vacations')
  XLSX.writeFile(wb, `vacations_${moisSelectionne.value || 'tous'}.xlsx`)
}

// Sécurise les chaînes utilisateur injectées dans le HTML imprimable.
function escapeHtml(s: string | null | undefined): string {
  return (s ?? '').toString().replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}

// Formate un montant en FCFA sans caractère U+202F (espace fine insécable) qui
// casse le rendu dans certaines polices. Utilise un espace normal à la place.
function fmtMontantHTML(n: number | string): string {
  const num = Math.round(Number(n) || 0)
  return num.toLocaleString('fr-FR').replace(/\u202F|\u00A0/g, ' ') + ' FCFA'
}

// ── Bordereau global du mois (HTML/print avec en-tête UPTECH partagé) ────────
function exportPDF() {
  const list = vacationsFiltrees.value
  const r = resumeFiltre.value
  const emitDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const moisLbl = moisSelectionne.value ? formatMois(moisSelectionne.value) : 'Tous les mois'

  const rowsHtml = list.map((v, idx) => {
    const statut = v.statut
    const rowClass = statut === 'payee' ? 'row-payee' : statut === 'validee' ? 'row-validee' : ''
    const specialite = [v.specialite, v.grade].filter(Boolean).join(' · ') || '—'
    return `
      <tr class="${rowClass}">
        <td style="text-align:center">${idx + 1}</td>
        <td>${escapeHtml(`${v.enseignant_prenom} ${v.enseignant_nom}`)}</td>
        <td>${escapeHtml(specialite)}</td>
        <td style="text-align:center">${Number(v.nb_heures).toFixed(1)}h</td>
        <td style="text-align:right">${fmtMontantHTML(v.tarif_horaire)}</td>
        <td style="text-align:right;font-weight:700">${fmtMontantHTML(v.montant)}</td>
        <td style="text-align:center"><span class="statut-chip statut-${statut}">${escapeHtml(statutLabels[statut] || statut)}</span></td>
        <td>${escapeHtml(v.reference_paiement || '—')}</td>
        <td></td>
      </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <title>Bordereau vacations — ${escapeHtml(moisLbl)}</title>
  <style>
    ${uptechPrintCSS()}
    @page{size:A4 landscape;margin:8mm}
    .abs-sub{display:flex;justify-content:space-between;align-items:center;padding:4px 16px;background:#fafafa;border-bottom:1px solid #eee;font-size:9px;color:#666}
    .abs-sub .left{font-weight:600;color:#E30613;text-transform:uppercase;letter-spacing:1px}
    .vac-title{text-align:center;padding:6px 16px;font-size:13px;font-weight:900;letter-spacing:1px;color:#111;text-transform:uppercase}
    .kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;padding:0 16px 8px}
    .kpi{background:#f8fafc;border:1px solid #e5e7eb;border-radius:4px;padding:6px 8px;text-align:center}
    .kpi .k-lbl{font-size:7px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:2px}
    .kpi .k-val{font-size:11px;font-weight:800;color:#111}
    .kpi.paye .k-val{color:#16a34a}
    .kpi.valide .k-val{color:#2563eb}
    .kpi.attente .k-val{color:#d97706}
    .kpi.total{background:#fef2f2;border-color:#fecaca}
    .kpi.total .k-val{color:#dc2626}
    .vac-table{width:calc(100% - 32px);margin:4px 16px 10px;border-collapse:collapse;font-size:9px}
    .vac-table thead th{background:#1e293b;color:#fff;font-weight:700;padding:6px 5px;font-size:8px;border:1px solid #0f172a;text-align:left}
    .vac-table tbody td{padding:5px 6px;border:1px solid #e5e7eb;vertical-align:top;line-height:1.4}
    .vac-table tbody tr.row-payee td{background:#f0fdf4}
    .vac-table tbody tr.row-validee td{background:#eff6ff}
    .vac-table tbody tr{page-break-inside:avoid}
    .vac-table tfoot td{padding:6px;background:#f3f4f6;font-weight:800;font-size:9px;border:1px solid #e5e7eb}
    .statut-chip{display:inline-block;padding:2px 6px;border-radius:999px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px}
    .statut-en_attente{background:#fef3c7;color:#92400e}
    .statut-validee{background:#dbeafe;color:#1e40af}
    .statut-payee{background:#dcfce7;color:#166534}
    .vac-sig{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:14px 16px 8px;margin-top:4px;border-top:1px dashed #ddd}
    .vac-sig-box{text-align:center}
    .vac-sig-box .s-title{font-size:9px;font-weight:700;color:#111;text-transform:uppercase;letter-spacing:0.5px}
    .vac-sig-box .s-line{border-bottom:1px solid #cbd5e1;height:30px;margin:6px 8px 0}
    .vac-sig-box .s-hint{font-size:7px;color:#94a3b8;margin-top:2px;text-transform:uppercase;letter-spacing:0.3px}
  </style></head>
  <body>
    ${uptechHeaderHTML()}
    <div class="abs-sub">
      <span class="left">Direction financière — Vacations</span>
      <span>Édité le ${emitDate}</span>
    </div>
    <div class="vac-title">Bordereau de paiement des vacations — ${escapeHtml(moisLbl)}</div>
    <div class="kpis">
      <div class="kpi"><div class="k-lbl">Nb enseignants</div><div class="k-val">${r.total}</div></div>
      <div class="kpi"><div class="k-lbl">Total heures</div><div class="k-val">${r.total_heures.toFixed(1)}h</div></div>
      <div class="kpi paye"><div class="k-lbl">Montant payé</div><div class="k-val">${fmtMontantHTML(r.montant_paye)}</div></div>
      <div class="kpi valide"><div class="k-lbl">Montant validé</div><div class="k-val">${fmtMontantHTML(r.montant_valide)}</div></div>
      <div class="kpi attente"><div class="k-lbl">En attente</div><div class="k-val">${fmtMontantHTML(r.montant_en_attente)}</div></div>
      <div class="kpi total"><div class="k-lbl">Total général</div><div class="k-val">${fmtMontantHTML(r.total_montant)}</div></div>
    </div>
    <table class="vac-table">
      <thead><tr>
        <th style="width:30px;text-align:center">N°</th>
        <th>Enseignant</th>
        <th>Spécialité / Grade</th>
        <th style="width:55px;text-align:center">Heures</th>
        <th style="width:95px;text-align:right">Taux/h</th>
        <th style="width:110px;text-align:right">Montant</th>
        <th style="width:80px;text-align:center">Statut</th>
        <th style="width:110px">Réf. paiement</th>
        <th style="width:110px">Signature</th>
      </tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="9" style="text-align:center;padding:20px;color:#888;font-style:italic">Aucune vacation à imprimer</td></tr>'}</tbody>
      <tfoot><tr>
        <td></td>
        <td colspan="2">TOTAL (${list.length} enseignant${list.length > 1 ? 's' : ''})</td>
        <td style="text-align:center">${r.total_heures.toFixed(1)}h</td>
        <td></td>
        <td style="text-align:right;color:#dc2626;font-weight:900;font-size:10px">${fmtMontantHTML(r.total_montant)}</td>
        <td colspan="3"></td>
      </tr></tfoot>
    </table>
    <div class="vac-sig">
      <div class="vac-sig-box"><div class="s-title">Établi par</div><div class="s-line"></div><div class="s-hint">Nom &amp; signature</div></div>
      <div class="vac-sig-box"><div class="s-title">Vérifié par (DAF)</div><div class="s-line"></div><div class="s-hint">Nom &amp; signature</div></div>
      <div class="vac-sig-box"><div class="s-title">Approuvé par (DG)</div><div class="s-line"></div><div class="s-hint">Nom &amp; signature</div></div>
    </div>
    ${uptechFooterHTML(`Bordereau vacations · ${escapeHtml(moisLbl)}`)}
  </body></html>`

  openPrintWindow(html)
}

// ── Fiche individuelle de paiement (HTML/print) ──────────────────────────────
function fichePaiement(v: Vacation) {
  const emitDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const moisLabel = formatMois(v.mois).toUpperCase()
  const details = [v.specialite, v.grade, v.type_contrat].filter(Boolean).join(' · ')
  const isPaid = v.statut === 'payee'

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <title>Fiche paiement — ${escapeHtml(`${v.enseignant_prenom} ${v.enseignant_nom}`)}</title>
  <style>
    ${uptechPrintCSS()}
    .abs-sub{display:flex;justify-content:space-between;align-items:center;padding:4px 16px;background:#fafafa;border-bottom:1px solid #eee;font-size:9px;color:#666}
    .abs-sub .left{font-weight:600;color:#E30613;text-transform:uppercase;letter-spacing:1px}
    .benef{margin:10px 16px;padding:12px 14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
    .benef-lbl{font-size:7px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;font-weight:700}
    .benef-name{font-size:16px;font-weight:900;color:#0f172a;margin-top:2px}
    .benef-details{font-size:9px;color:#64748b;margin-top:2px}
    .benef-right{text-align:right;font-size:9px;color:#0f172a}
    .benef-right strong{font-size:10px}
    .detail-table{width:calc(100% - 32px);margin:8px 16px;border-collapse:collapse;font-size:10px}
    .detail-table th{background:#1e293b;color:#fff;padding:6px 10px;text-align:left;font-weight:700;font-size:9px}
    .detail-table td{padding:7px 10px;border:1px solid #e5e7eb}
    .detail-table td.label{background:#f9fafb;font-weight:700;color:#111}
    .detail-table td.val{text-align:right;font-weight:600}
    .montant-net{margin:10px 16px;padding:14px 18px;background:#1e293b;color:#fff;border-radius:6px;display:flex;justify-content:space-between;align-items:center}
    .montant-net .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px}
    .montant-net .val{font-size:18px;font-weight:900}
    .payee-box{margin:8px 16px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:9px;color:#166534}
    .payee-box .p-title{font-weight:800;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
    .fp-sig{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:18px 16px 4px;margin-top:16px;border-top:1px dashed #ddd}
    .fp-sig-box{text-align:center}
    .fp-sig-box .s-title{font-size:10px;font-weight:700;color:#111;margin-bottom:4px}
    .fp-sig-box .s-sub{font-size:8px;font-style:italic;color:#64748b;margin-bottom:10px;line-height:1.5}
    .fp-sig-box .s-line{border-bottom:1px solid #cbd5e1;height:36px;margin:0 16px}
  </style></head>
  <body>
    ${uptechHeaderHTML()}
    <div class="abs-sub">
      <span class="left">Direction financière — Fiche de paiement (vacation)</span>
      <span>Émis le ${emitDate} · Réf. #${v.id}</span>
    </div>
    <div class="doc-title">Fiche de paiement — Vacation</div>
    <div class="benef">
      <div>
        <div class="benef-lbl">Bénéficiaire</div>
        <div class="benef-name">${escapeHtml(`${v.enseignant_prenom} ${v.enseignant_nom}`)}</div>
        ${details ? `<div class="benef-details">${escapeHtml(details)}</div>` : ''}
      </div>
      <div class="benef-right">
        <div class="benef-lbl">Période</div>
        <strong>${escapeHtml(moisLabel)}</strong>
      </div>
    </div>
    <table class="detail-table">
      <thead><tr><th style="width:55%">Détail</th><th style="text-align:right">Valeur</th></tr></thead>
      <tbody>
        <tr><td class="label">Mois de vacation</td><td class="val">${escapeHtml(moisLabel)}</td></tr>
        <tr><td class="label">Nombre d'heures effectuées</td><td class="val">${Number(v.nb_heures).toFixed(1)} heures</td></tr>
        <tr><td class="label">Taux horaire</td><td class="val">${fmtMontantHTML(v.tarif_horaire)} / heure</td></tr>
        <tr><td class="label">Montant brut</td><td class="val">${fmtMontantHTML(v.montant)}</td></tr>
      </tbody>
    </table>
    <div class="montant-net">
      <span class="lbl">Montant net à payer</span>
      <span class="val">${fmtMontantHTML(v.montant)}</span>
    </div>
    ${isPaid ? `
      <div class="payee-box">
        <div class="p-title">✓ Paiement effectué</div>
        ${v.paye_at ? `Date de paiement : <strong>${new Date(v.paye_at).toLocaleDateString('fr-FR')}</strong>` : ''}
        ${v.reference_paiement ? ` &nbsp;·&nbsp; Référence : <strong>${escapeHtml(v.reference_paiement)}</strong>` : ''}
      </div>` : ''}
    <div class="fp-sig">
      <div class="fp-sig-box">
        <div class="s-title">Signature de l'enseignant</div>
        <div class="s-sub">Je soussigné(e) ${escapeHtml(`${v.enseignant_prenom} ${v.enseignant_nom}`)},<br>certifie avoir reçu la somme ci-dessus.</div>
        <div class="s-line"></div>
      </div>
      <div class="fp-sig-box">
        <div class="s-title">Cachet et signature DG</div>
        <div class="s-sub">Approuvé et ordonnancé<br>par la Direction Générale</div>
        <div class="s-line"></div>
      </div>
    </div>
    ${uptechFooterHTML(`Fiche paiement #${v.id} · ${escapeHtml(moisLabel)}`)}
  </body></html>`

  openPrintWindow(html)
}

onMounted(load)
</script>

<template>
  <div class="uc-content">
    <!-- En-tête -->
    <UcPageHeader title="Vacations enseignants" subtitle="Suivi et paiement des heures de cours">
      <template #actions>
        <button @click="goDepenses" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:6px;background:#E30613;color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;">💸 Dépenses</button>
        <button @click="goJournalDepenses" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:6px;background:#1e293b;color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;">📒 Journal dépenses</button>
        <button @click="showManuelModal = true" class="uc-btn-outline">+ Saisie manuelle</button>
        <button @click="showGenererModal = true" class="uc-btn-dark">⚡ Générer depuis séances</button>
        <button @click="exportExcel" class="uc-btn-primary" style="background:#16a34a;">Excel</button>
        <button @click="exportPDF" class="uc-btn-dark">PDF</button>
      </template>
    </UcPageHeader>

    <!-- Filtres -->
    <div class="uc-filters-bar">
      <UcFormGroup label="Mois">
        <input type="month" v-model="moisSelectionne" @change="load" class="uc-input" />
      </UcFormGroup>
      <UcFormGroup label="Année académique">
        <select v-model="filterAnnee" @change="load" class="uc-input" style="min-width:160px;">
          <option :value="null">Toutes</option>
          <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
        </select>
      </UcFormGroup>
      <UcFormGroup label="Statut">
        <select v-model="filterStatut" class="uc-input" style="min-width:130px;">
          <option value="">Tous</option>
          <option value="en_attente">En attente</option>
          <option value="validee">Validée</option>
          <option value="payee">Payée</option>
        </select>
      </UcFormGroup>
      <UcFormGroup label="Recherche" style="flex:1;min-width:180px;">
        <input v-model="search" placeholder="Nom, spécialité…" class="uc-input" />
      </UcFormGroup>
    </div>

    <!-- KPIs -->
    <div class="uc-kpi-grid" style="margin-bottom:20px;">
      <div class="uc-kpi-card">
        <div class="uc-kpi-label">Enseignants</div>
        <div class="uc-kpi-value">{{ resumeFiltre.total }}</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:2px;">{{ resumeFiltre.nb_lignes }} ligne(s)</div>
      </div>
      <div class="uc-kpi-card">
        <div class="uc-kpi-label">Total heures</div>
        <div class="uc-kpi-value">{{ resumeFiltre.total_heures.toFixed(1) }}h</div>
      </div>
      <div class="uc-kpi-card" style="background:#fffbeb;border-color:#fde68a;">
        <div class="uc-kpi-label" style="color:#92400e;">En attente</div>
        <div class="uc-kpi-value" style="font-size:15px;color:#f59e0b;">{{ formatFCFA(resumeFiltre.montant_en_attente) }}</div>
        <div style="font-size:10px;color:#92400e;margin-top:2px;">{{ resumeFiltre.nb_en_attente }} vacation(s)</div>
      </div>
      <div class="uc-kpi-card" style="background:#eff6ff;border-color:#bfdbfe;">
        <div class="uc-kpi-label" style="color:#1d4ed8;">Validé</div>
        <div class="uc-kpi-value" style="font-size:15px;color:#3b82f6;">{{ formatFCFA(resumeFiltre.montant_valide) }}</div>
        <div style="font-size:10px;color:#1d4ed8;margin-top:2px;">{{ resumeFiltre.nb_valide }} vacation(s)</div>
      </div>
      <div class="uc-kpi-card" style="background:#f0fdf4;border-color:#bbf7d0;">
        <div class="uc-kpi-label" style="color:#166534;">Payé</div>
        <div class="uc-kpi-value" style="font-size:15px;color:#16a34a;">{{ formatFCFA(resumeFiltre.montant_paye) }}</div>
        <div style="font-size:10px;color:#166534;margin-top:2px;">{{ resumeFiltre.nb_paye }} vacation(s)</div>
      </div>
      <div class="uc-kpi-card" style="border-color:#1e293b;">
        <div class="uc-kpi-label">Total</div>
        <div class="uc-kpi-value" style="font-size:15px;">{{ formatFCFA(resumeFiltre.total_montant) }}</div>
      </div>
    </div>

    <!-- Chargement / erreur / vide -->
    <div v-if="loading" class="uc-empty">Chargement…</div>
    <div v-else-if="loadError" class="uc-alert uc-alert-danger" style="margin-bottom:16px;">
      ⚠️ Erreur : {{ loadError }}
      <button @click="load" style="margin-left:12px;padding:4px 10px;border-radius:5px;border:1px solid #E30613;background:#fff;color:#E30613;cursor:pointer;font-size:12px;">Réessayer</button>
    </div>
    <div v-else-if="vacationsGroupees.length === 0" class="uc-empty">
      Aucune vacation trouvée{{ moisSelectionne ? ` pour ${formatMois(moisSelectionne)}` : '' }}.<br>
      <span style="font-size:12px;">Utilisez "Générer depuis séances" pour créer automatiquement les vacations du mois, ou changez le filtre mois.</span>
    </div>

    <!-- Tableau groupé par enseignant -->
    <div v-else class="uc-table-wrap">
      <table class="uc-table vac-table">
        <thead>
          <tr>
            <th>Enseignant / Type de formation</th>
            <th>Mois</th>
            <th style="text-align:center;">Heures</th>
            <th style="text-align:right;">Tarif/h</th>
            <th style="text-align:right;">Montant</th>
            <th style="text-align:center;">Statut</th>
            <th style="text-align:center;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="g in vacationsGroupees" :key="`g_${g.enseignant_id}_${g.mois}`">
            <!-- ── Ligne enseignant (en-tête de groupe) ── -->
            <tr class="vac-row-group">
              <td>
                <div style="font-weight:700;color:#1e293b;font-size:13px;">
                  {{ g.enseignant_prenom }} {{ g.enseignant_nom }}
                </div>
                <div style="font-size:10px;color:#94a3b8;">
                  {{ g.specialite || g.type_contrat || '—' }}
                  <span v-if="g.grade"> · {{ g.grade }}</span>
                </div>
              </td>
              <td style="font-weight:600;color:#334155;">{{ formatMois(g.mois) }}</td>
              <td style="text-align:center;font-weight:700;">{{ g.total_heures.toFixed(1) }}h</td>
              <td style="text-align:right;color:#94a3b8;font-size:11px;">{{ g.lignes.length }} type(s)</td>
              <td style="text-align:right;font-weight:800;color:#1e293b;">{{ formatFCFA(g.total_montant) }}</td>
              <td style="text-align:center;">
                <span v-if="g.tout_paye" class="vac-badge vac-badge--paye">● Tout payé</span>
                <span v-else-if="g.tout_valide" class="vac-badge vac-badge--valide">● Tout validé</span>
                <span v-else-if="g.tout_en_attente" class="vac-badge vac-badge--attente">● En attente</span>
                <span v-else class="vac-badge vac-badge--mixte">⚡ Partiel</span>
              </td>
              <td style="text-align:center;">
                <div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap;">
                  <!-- Valider tout le groupe -->
                  <button v-if="g.tout_en_attente && canValidate" @click="validerGroupe(g)"
                    class="uc-btn-xs" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">
                    ✓ Valider tout
                  </button>
                  <!-- Payer tout le groupe -->
                  <button v-if="g.tout_valide && !g.tout_paye && canValidate" @click="openPayerGroupe(g)"
                    class="uc-btn-xs" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;">
                    💳 Payer tout
                  </button>
                </div>
              </td>
            </tr>

            <!-- ── Lignes détail par type de formation ── -->
            <tr v-for="v in g.lignes" :key="v.id" class="vac-row-detail">
              <td style="padding-left:28px;">
                <span class="vac-type-pill">
                  {{ v.type_formation_libelle_resolved || v.type_formation_libelle || '—' }}
                </span>
                <span v-if="v.note" style="font-size:10px;color:#94a3b8;margin-left:6px;">{{ v.note }}</span>
              </td>
              <td></td>
              <td style="text-align:center;color:#475569;">{{ Number(v.nb_heures).toFixed(1) }}h</td>
              <td style="text-align:right;">
                <span v-if="Number(v.tarif_horaire) === 0"
                  @click="openTarif(v)" title="Tarif non configuré — cliquer pour corriger"
                  style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;">
                  ⚠️ Tarif non défini
                </span>
                <span v-else style="color:#475569;font-size:12px;">{{ formatFCFA(v.tarif_horaire) }}/h</span>
              </td>
              <td style="text-align:right;font-weight:600;color:#374151;">{{ formatFCFA(v.montant) }}</td>
              <td style="text-align:center;">
                <span :style="{
                  display:'inline-flex',alignItems:'center',gap:'5px',
                  padding:'2px 8px',borderRadius:'20px',fontSize:'10px',fontWeight:'700',
                  background: statutColors[v.statut]?.bg,
                  color: statutColors[v.statut]?.text,
                }">
                  <span :style="{ width:'6px',height:'6px',borderRadius:'50%',background:statutColors[v.statut]?.dot,display:'inline-block' }"></span>
                  {{ statutLabels[v.statut] }}
                </span>
                <div v-if="v.valide_at" style="font-size:10px;color:#94a3b8;margin-top:2px;">
                  {{ new Date(v.valide_at).toLocaleDateString('fr-FR') }}
                </div>
                <div v-if="v.reference_paiement" style="font-size:10px;color:#16a34a;margin-top:1px;">
                  Réf: {{ v.reference_paiement }}
                </div>
              </td>
              <td style="text-align:center;">
                <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">
                  <button v-if="v.statut === 'en_attente' && canValidate" @click="openEdit(v)" class="uc-btn-xs">✏️</button>
                  <button v-if="v.statut === 'en_attente' && canValidate" @click="valider(v)"
                    :disabled="actionLoading === v.id" class="uc-btn-xs" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">
                    ✓
                  </button>
                  <button v-if="v.statut === 'validee' && canValidate" @click="openPayer(v)"
                    class="uc-btn-xs" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;">
                    💳
                  </button>
                  <button v-if="v.statut === 'en_attente' && canValidate" @click="supprimer(v)"
                    :disabled="actionLoading === v.id" class="uc-btn-xs" style="background:#fef2f2;color:#dc2626;border-color:#fecaca;">
                    🗑️
                  </button>
                  <button v-if="(v.statut === 'validee' || v.statut === 'payee')" @click="fichePaiement(v)"
                    class="uc-btn-xs" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;">
                    🧾
                  </button>
                  <button v-if="auth.user?.role === 'dg' && (!v.tarif_horaire || Number(v.tarif_horaire) === 0)" @click="openTarif(v)"
                    class="uc-btn-xs" style="background:#fef3c7;color:#92400e;border-color:#fde68a;">
                    ⚠️
                  </button>
                  <button v-else-if="auth.user?.role === 'dg' && v.statut !== 'en_attente'" @click="openTarif(v)"
                    class="uc-btn-xs" style="background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe;">
                    🔧
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Modal paiement groupe -->
    <UcModal v-model="showPayerGroupeModal" title="Confirmer le paiement" width="420px">
      <div v-if="payerGroupeTarget" style="font-size:13px;color:#374151;line-height:1.6;">
        Payer toutes les vacations de
        <strong>{{ payerGroupeTarget.enseignant_prenom }} {{ payerGroupeTarget.enseignant_nom }}</strong>
        pour {{ formatMois(payerGroupeTarget.mois) }} ?<br>
        <strong style="font-size:16px;color:#1e293b;">Total : {{ formatFCFA(payerGroupeTarget.total_montant) }}</strong>
        <div style="margin-top:6px;font-size:11px;color:#64748b;">
          {{ payerGroupeTarget.lignes.filter(l=>l.statut==='validee').length }} ligne(s) validée(s) à payer
        </div>
      </div>
      <UcFormGroup label="Référence de paiement" style="margin-top:14px;">
        <input v-model="payerGroupeRef" class="uc-input" placeholder="N° chèque, virement…" />
      </UcFormGroup>
      <template #footer>
        <button @click="showPayerGroupeModal = false" class="uc-btn-outline">Annuler</button>
        <button @click="confirmerPaiementGroupe" :disabled="payerGroupeLoading" class="uc-btn-primary" style="background:#16a34a;">
          {{ payerGroupeLoading ? 'Traitement…' : '💳 Confirmer le paiement' }}
        </button>
      </template>
    </UcModal>

    <!-- Modal Générer -->
    <UcModal v-model="showGenererModal" title="Générer les vacations"
      subtitle="Calcule automatiquement les heures depuis les séances effectuées" width="460px"
      @close="genererResult = null">
      <UcFormGrid :cols="2">
        <UcFormGroup label="Mois">
          <input type="month" v-model="genererMois" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Année académique">
          <select v-model="genererAnnee" class="uc-input">
            <option :value="null">— Aucune —</option>
            <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
          </select>
        </UcFormGroup>
      </UcFormGrid>
      <div v-if="genererResult" class="uc-alert" :class="genererResult.total > 0 ? 'uc-alert-success' : 'uc-alert-error'" style="margin-top:14px;">
        {{ genererResult.message }}
      </div>
      <template #footer>
        <button @click="showGenererModal = false; genererResult = null" class="uc-btn-outline">Fermer</button>
        <button @click="genererVacations" :disabled="genererLoading" class="uc-btn-dark">
          {{ genererLoading ? 'Génération…' : '⚡ Générer' }}
        </button>
      </template>
    </UcModal>

    <!-- Modal Saisie manuelle -->
    <UcModal v-model="showManuelModal" title="Saisie manuelle d'une vacation" width="480px">
      <UcFormGrid :cols="1">
        <UcFormGroup label="Enseignant" :required="true">
          <select v-model="manuelForm.enseignant_id" @change="onEnseignantChange" class="uc-input">
            <option :value="null">— Sélectionner —</option>
            <option v-for="e in enseignants" :key="e.id" :value="e.id">{{ e.prenom }} {{ e.nom }}</option>
          </select>
        </UcFormGroup>
      </UcFormGrid>
      <UcFormGrid :cols="2" style="margin-top:12px;">
        <UcFormGroup label="Mois" :required="true">
          <input type="month" v-model="manuelForm.mois" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Nb heures" :required="true">
          <input type="number" v-model="manuelForm.nb_heures" min="0" step="0.5" placeholder="Ex: 24" class="uc-input" />
        </UcFormGroup>
      </UcFormGrid>
      <UcFormGrid :cols="1" style="margin-top:12px;">
        <UcFormGroup label="Tarif horaire (FCFA)" :required="true">
          <input type="number" v-model="manuelForm.tarif_horaire" min="0" placeholder="Ex: 5000" class="uc-input" />
          <div v-if="manuelForm.nb_heures && manuelForm.tarif_horaire" style="font-size:11px;color:#1e293b;font-weight:700;margin-top:4px;">
            Montant estimé : {{ formatFCFA(parseFloat(manuelForm.nb_heures || '0') * parseFloat(manuelForm.tarif_horaire || '0')) }}
          </div>
        </UcFormGroup>
        <UcFormGroup label="Note (optionnel)">
          <textarea v-model="manuelForm.note" rows="2" class="uc-input" style="resize:vertical;font-family:inherit;"></textarea>
        </UcFormGroup>
      </UcFormGrid>
      <template #footer>
        <button @click="showManuelModal = false" class="uc-btn-outline">Annuler</button>
        <button @click="saveManuel" :disabled="manuelLoading || !manuelForm.enseignant_id" class="uc-btn-dark">
          {{ manuelLoading ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
      </template>
    </UcModal>

    <!-- Modal Modifier -->
    <UcModal v-if="editForm" v-model="showEditModal" title="Modifier la vacation" width="400px">
      <UcFormGrid :cols="2">
        <UcFormGroup label="Nb heures">
          <input type="number" v-model="editForm.nb_heures" min="0" step="0.5" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Tarif/h (FCFA)">
          <input type="number" v-model="editForm.tarif_horaire" min="0" class="uc-input" />
        </UcFormGroup>
      </UcFormGrid>
      <div style="font-size:12px;font-weight:700;color:#1e293b;margin:10px 0;">
        Montant : {{ formatFCFA(parseFloat(editForm.nb_heures || '0') * parseFloat(editForm.tarif_horaire || '0')) }}
      </div>
      <UcFormGroup label="Note">
        <textarea v-model="editForm.note" rows="2" class="uc-input" style="resize:vertical;font-family:inherit;"></textarea>
      </UcFormGroup>
      <template #footer>
        <button @click="showEditModal = false" class="uc-btn-outline">Annuler</button>
        <button @click="saveEdit" :disabled="editLoading" class="uc-btn-dark">
          {{ editLoading ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
      </template>
    </UcModal>

    <!-- Modal Correction Tarif (DG) -->
    <UcModal v-if="tarifTarget" v-model="showTarifModal" title="Corriger le taux horaire" subtitle="Réservé au DG — tous statuts" width="400px">
      <p style="font-size:13px;color:#64748b;margin:0 0 16px;">
        <strong>{{ tarifTarget.enseignant_prenom }} {{ tarifTarget.enseignant_nom }}</strong>
        — {{ formatMois(tarifTarget.mois) }}<br>
        Heures : <strong>{{ Number(tarifTarget.nb_heures).toFixed(1) }}h</strong> &nbsp;|&nbsp;
        Tarif actuel : <strong :style="Number(tarifTarget.tarif_horaire) === 0 ? 'color:#dc2626' : ''">
          {{ Number(tarifTarget.tarif_horaire) === 0 ? '⚠️ non défini' : formatFCFA(tarifTarget.tarif_horaire) }}
        </strong>
      </p>
      <UcFormGroup label="Nouveau taux horaire (FCFA)" :required="true">
        <input type="number" v-model="tarifForm" min="1" placeholder="Ex: 5000" class="uc-input" />
        <div v-if="tarifForm && Number(tarifForm) > 0" style="font-size:12px;font-weight:700;color:#1e293b;margin-top:6px;">
          Nouveau montant : {{ formatFCFA(Number(tarifTarget.nb_heures) * Number(tarifForm)) }}
        </div>
      </UcFormGroup>
      <template #footer>
        <button @click="showTarifModal = false" class="uc-btn-outline">Annuler</button>
        <button @click="corrigerTarif" :disabled="tarifLoading || !tarifForm || Number(tarifForm) <= 0" class="uc-btn-primary" style="background:#7c3aed;">
          {{ tarifLoading ? 'Enregistrement…' : '🔧 Corriger' }}
        </button>
      </template>
    </UcModal>

    <!-- Modal Payer -->
    <UcModal v-if="payerTarget" v-model="showPayerModal" title="Confirmer le paiement" width="420px">
      <p style="font-size:13px;color:#64748b;margin:0 0 18px;">
        {{ payerTarget.enseignant_prenom }} {{ payerTarget.enseignant_nom }} —
        {{ formatMois(payerTarget.mois) }} —
        <strong style="color:#1e293b;">{{ formatFCFA(payerTarget.montant) }}</strong>
      </p>
      <UcFormGroup label="Référence de paiement (optionnel)">
        <input v-model="payerRef" placeholder="Numéro de virement, chèque…" class="uc-input" />
      </UcFormGroup>
      <template #footer>
        <button @click="showPayerModal = false" class="uc-btn-outline">Annuler</button>
        <button @click="confirmerPaiement" :disabled="payerLoading" class="uc-btn-primary" style="background:#16a34a;">
          {{ payerLoading ? 'Confirmation…' : '💳 Confirmer le paiement' }}
        </button>
      </template>
    </UcModal>
  </div>
</template>

<style scoped>
/* ── Tableau groupé vacations ── */
.vac-table tbody tr.vac-row-group {
  background: #f8fafc;
  border-top: 2px solid #e2e8f0;
}
.vac-table tbody tr.vac-row-group td {
  padding: 10px 12px;
}
.vac-table tbody tr.vac-row-detail {
  background: #fff;
}
.vac-table tbody tr.vac-row-detail td {
  padding: 7px 12px;
  font-size: 12px;
  border-bottom: 1px solid #f1f5f9;
}
.vac-table tbody tr.vac-row-detail:last-of-type td {
  border-bottom: 2px solid #e2e8f0;
}

/* Pilule type de formation */
.vac-type-pill {
  display: inline-block;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
}

/* Badges statut groupe */
.vac-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 20px;
}
.vac-badge--attente { background: #fffbeb; color: #92400e; }
.vac-badge--valide  { background: #eff6ff; color: #1d4ed8; }
.vac-badge--paye    { background: #f0fdf4; color: #166534; }
.vac-badge--mixte   { background: #f5f3ff; color: #6d28d9; }
</style>
