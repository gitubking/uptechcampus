<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { UcModal, UcFormGroup, UcFormGrid, UcPageHeader } from '@/components/ui'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

const auth = useAuthStore()
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
      api.get('/enseignants'),
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
    alert(err?.response?.data?.error || 'Erreur')
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
    alert(err?.response?.data?.error || 'Erreur')
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
    alert(err?.response?.data?.error || 'Erreur')
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
    alert(err?.response?.data?.error || 'Erreur')
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
    alert(err?.response?.data?.error || 'Erreur')
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
    alert(err?.response?.data?.error || 'Erreur')
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
    alert(err?.response?.data?.error || 'Erreur')
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

// ── Chargement logo en base64 ─────────────────────────────────────────────────
let logoCache: string | null = null
async function getLogoBase64(): Promise<string | null> {
  if (logoCache) return logoCache
  try {
    const resp = await fetch('/logo-normal.png')
    const blob = await resp.blob()
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => { logoCache = reader.result as string; resolve(logoCache) }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

function addPDFHeader(doc: jsPDF, logo: string | null, pageW: number, subtitle: string, dateGen: string) {
  // Bandeau fond foncé
  doc.setFillColor(30, 41, 59)
  doc.rect(0, 0, pageW, 30, 'F')

  if (logo) {
    // Logo : ratio 339×107 → hauteur 16mm → largeur ~50mm
    doc.addImage(logo, 'PNG', 12, 7, 50, 16)
  } else {
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(255)
    doc.text("UP'TECH", 14, 16)
  }

  // Dénomination officielle + sous-titre à droite
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(200, 210, 230)
  doc.text('Institut Supérieur de Formation aux Nouveaux Métiers', pageW - 14, 10, { align: 'right' })
  doc.text("de l'Informatique et de la Communication", pageW - 14, 15, { align: 'right' })
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255)
  doc.text(subtitle, pageW - 14, 23, { align: 'right' })
}

// ── Bordereau global du mois ──────────────────────────────────────────────────
async function exportPDF() {
  const list = vacationsFiltrees.value
  const r = resumeFiltre.value
  const logo = await getLogoBase64()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const now = new Date()
  const dateGen = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  // ── En-tête ──
  addPDFHeader(doc, logo, pageW, 'BORDEREAU DE PAIEMENT DES VACATIONS', dateGen)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(200, 210, 230)
  doc.text(`Mois : ${(moisSelectionne.value ? formatMois(moisSelectionne.value) : 'Tous les mois').toUpperCase()}   |   Édité le ${dateGen}`, 65, 23)

  // ── KPIs ──
  const kpis: { label: string; val: string; color?: [number,number,number] }[] = [
    { label: 'Nb enseignants', val: String(r.total) },
    { label: 'Total heures', val: `${r.total_heures.toFixed(1)}h` },
    { label: 'Montant payé', val: fmtPDF(r.montant_paye), color: [22, 163, 74] as [number,number,number] },
    { label: 'Montant validé', val: fmtPDF(r.montant_valide), color: [59, 130, 246] as [number,number,number] },
    { label: 'En attente', val: fmtPDF(r.montant_en_attente), color: [245, 158, 11] as [number,number,number] },
    { label: 'TOTAL GÉNÉRAL', val: fmtPDF(r.total_montant), color: [220, 38, 38] as [number,number,number] },
  ]
  const kpiW = (pageW - 28) / kpis.length
  kpis.forEach((k, i) => {
    const x = 14 + i * kpiW
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(x, 34, kpiW - 2, 16, 2, 2, 'F')
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(100)
    doc.text(k.label, x + (kpiW - 2) / 2, 39, { align: 'center' })
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold')
    doc.setTextColor(...(k.color ?? ([30, 41, 59] as [number,number,number])))
    doc.text(k.val, x + (kpiW - 2) / 2, 46, { align: 'center' })
  })

  // ── Tableau ──
  let n = 1
  autoTable(doc, {
    startY: 54,
    head: [['N°', 'Enseignant', 'Spécialité / Grade', 'Heures', 'Taux/h (FCFA)', 'Montant (FCFA)', 'Statut', 'Réf. paiement', 'Signature']],
    body: list.map(v => [
      String(n++),
      `${v.enseignant_prenom} ${v.enseignant_nom}`,
      [v.specialite, v.grade].filter(Boolean).join(' · ') || '—',
      `${Number(v.nb_heures).toFixed(1)}h`,
      fmtPDF(v.tarif_horaire),
      fmtPDF(v.montant),
      statutLabels[v.statut] || v.statut,
      v.reference_paiement || '—',
      '',
    ]),
    foot: [[
      '', `TOTAL (${list.length} enseignant(s))`, '',
      `${r.total_heures.toFixed(1)}h`, '', fmtPDF(r.total_montant), '', '', '',
    ]],
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2.5, font: 'helvetica', textColor: [30, 41, 59] },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [240, 240, 240], textColor: [30, 41, 59], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 38 },
      2: { cellWidth: 30 },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 20, halign: 'center' },
      7: { cellWidth: 24 },
      8: { cellWidth: 28 },
    },
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const statut = list[data.row.index]?.statut
        if (statut === 'payee') data.cell.styles.fillColor = [240, 253, 244]
        else if (statut === 'validee') data.cell.styles.fillColor = [239, 246, 255]
      }
    },
    margin: { left: 14, right: 14 },
  })

  // ── Zone de signatures ──
  const finalY = Math.min((doc as any).lastAutoTable.finalY + 12, pageH - 30)
  const sigW = (pageW - 28) / 3
  const sigs = ['Établi par', 'Vérifié par (DAF)', 'Approuvé par (DG)']
  sigs.forEach((label, i) => {
    const x = 14 + i * sigW
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
    doc.text(label, x + sigW / 2, finalY, { align: 'center' })
    doc.setDrawColor(180); doc.line(x + 5, finalY + 14, x + sigW - 5, finalY + 14)
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(160)
    doc.text('Nom & Signature', x + sigW / 2, finalY + 19, { align: 'center' })
  })

  // ── Pied de page ──
  doc.setFontSize(6); doc.setFont('helvetica', 'italic'); doc.setTextColor(160)
  doc.text(`UP'TECH Campus — Bordereau généré automatiquement le ${dateGen}`, 14, pageH - 5)
  doc.text(`Page 1`, pageW - 14, pageH - 5, { align: 'right' })

  doc.save(`Bordereau_Vacations_${moisSelectionne.value}.pdf`)
}

// ── Fiche individuelle de paiement ────────────────────────────────────────────
async function fichePaiement(v: Vacation) {
  const logo = await getLogoBase64()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const now = new Date()
  const dateGen = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const moisLabel = formatMois(v.mois).toUpperCase()

  // ── En-tête ──
  addPDFHeader(doc, logo, pageW, 'FICHE DE PAIEMENT — VACATION', dateGen)

  // ── Bloc identité enseignant ──
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(14, 38, pageW - 28, 36, 3, 3, 'F')
  doc.setDrawColor(220); doc.roundedRect(14, 38, pageW - 28, 36, 3, 3, 'S')

  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
  doc.text('BÉNÉFICIAIRE', 20, 45)
  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text(`${v.enseignant_prenom} ${v.enseignant_nom}`, 20, 54)
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(100)
  const details = [v.specialite, v.grade, v.type_contrat].filter(Boolean).join('  ·  ')
  if (details) doc.text(details, 20, 61)
  doc.setFontSize(8); doc.setTextColor(30, 41, 59)
  doc.text(`Réf. vacation : #${v.id}`, pageW - 20, 45, { align: 'right' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text(`Période : ${moisLabel}`, pageW - 20, 54, { align: 'right' })

  // ── Tableau de détail ──
  autoTable(doc, {
    startY: 82,
    head: [['Détail', 'Valeur']],
    body: [
      ['Mois de vacation', moisLabel],
      ['Nombre d\'heures effectuées', `${Number(v.nb_heures).toFixed(1)} heures`],
      ['Taux horaire', `${fmtPDF(v.tarif_horaire)} / heure`],
      ['Montant brut', fmtPDF(v.montant)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4, font: 'helvetica', textColor: [30, 41, 59] },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 100, fontStyle: 'bold' },
      1: { cellWidth: 80, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  })

  // ── Montant total encadré ──
  const afterTable = (doc as any).lastAutoTable.finalY + 8
  doc.setFillColor(30, 41, 59)
  doc.roundedRect(14, afterTable, pageW - 28, 18, 3, 3, 'F')
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(255)
  doc.text('MONTANT NET À PAYER', 20, afterTable + 11)
  doc.setFontSize(13)
  doc.text(fmtPDF(v.montant), pageW - 20, afterTable + 11, { align: 'right' })

  // ── Infos paiement si payée ──
  if (v.statut === 'payee') {
    const yPay = afterTable + 26
    doc.setFillColor(240, 253, 244)
    doc.roundedRect(14, yPay, pageW - 28, 22, 3, 3, 'F')
    doc.setDrawColor(187, 247, 208); doc.roundedRect(14, yPay, pageW - 28, 22, 3, 3, 'S')
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(22, 101, 52)
    doc.text('✓ PAIEMENT EFFECTUÉ', 20, yPay + 8)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(30, 41, 59)
    if (v.paye_at) doc.text(`Date de paiement : ${new Date(v.paye_at).toLocaleDateString('fr-FR')}`, 20, yPay + 15)
    if (v.reference_paiement) doc.text(`Référence : ${v.reference_paiement}`, pageW - 20, yPay + 15, { align: 'right' })
  }

  // ── Signatures ──
  const ySig = pageH - 55
  doc.setDrawColor(220); doc.line(14, ySig - 2, pageW - 14, ySig - 2)
  const sigW2 = (pageW - 28) / 2
  const sigs2 = [
    { label: "Signature de l'enseignant", sub: `Je soussigné(e) ${v.enseignant_prenom} ${v.enseignant_nom},\ncertifie avoir reçu la somme ci-dessus.` },
    { label: 'Cachet et signature DG', sub: "Approuvé et ordonnancé\npar la Direction Générale" },
  ]
  sigs2.forEach((s, i) => {
    const x = 14 + i * sigW2
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
    doc.text(s.label, x + sigW2 / 2, ySig + 6, { align: 'center' })
    doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(120)
    doc.text(s.sub, x + sigW2 / 2, ySig + 12, { align: 'center' })
    doc.setDrawColor(180); doc.line(x + 10, ySig + 28, x + sigW2 - 10, ySig + 28)
  })

  // ── Pied de page ──
  doc.setFontSize(6); doc.setFont('helvetica', 'italic'); doc.setTextColor(160)
  doc.text(`UP'TECH Campus — Document officiel généré le ${dateGen}`, pageW / 2, pageH - 6, { align: 'center' })

  doc.save(`Fiche_Paiement_${v.enseignant_prenom}_${v.enseignant_nom}_${v.mois}.pdf`)
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
