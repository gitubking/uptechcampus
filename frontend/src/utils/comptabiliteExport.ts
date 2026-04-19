// Export "Suivi comptabilité UP'TECH" — conforme au modèle ANAQ-Sup.
//
// Produit un classeur Excel (.xlsx) avec 13 feuilles :
//   • Janvier … Décembre : livre chronologique des recettes + registre des dépenses
//   • RECAPITULATIF : synthèse mensuelle avec formules inter-feuilles
//
// Sources de données (toutes filtrées sur l'année sélectionnée) :
//   • Recettes = paiements étudiants (statut 'confirme') + autres_recettes (statut 'validee')
//   • Dépenses = depenses (statut 'validee')

import ExcelJS from 'exceljs'
import { Chart, registerables, type ChartConfiguration } from 'chart.js'
import api from '@/services/api'

Chart.register(...registerables)

// ─── Types minimalistes pour les données API ─────────────────────────────────

interface PaiementApi {
  id: number
  numero_recu: string | null
  type_paiement: string | null
  montant: number | string
  mode_paiement: string | null
  statut: string
  reference: string | null
  confirmed_at: string | null
  created_at: string
  etudiant?: { id: number; nom: string | null; prenom: string | null } | null
}

interface AutreRecetteApi {
  id: number
  date_recette: string
  libelle: string
  client: string | null
  nature: string | null
  montant: number | string
  mode_encaissement: string
  reference_piece: string | null
  statut: string
}

interface DepenseApi {
  id: number
  libelle: string
  categorie: string | null
  montant: number | string
  mode_paiement: string | null
  beneficiaire: string | null
  reference_facture: string | null
  date_depense: string
  statut: string
}

interface RecetteRow {
  date: Date
  ref: string
  client: string
  nature: string
  montant: number
  mode: string
}

interface DepenseRow {
  date: Date
  ref: string
  fournisseur: string
  nature: string
  montant: number
  mode: string
}

interface ExonerationApi {
  id: number
  etudiant_nom: string
  matricule: string | null
  filiere_nom: string | null
  annee_libelle: string | null
  motif: string
  portee: string
  mois_concerne: string | null
  mode_calcul: 'pourcentage' | 'montant_fixe'
  valeur: number | string
  montant_applique: number | string
  libelle: string | null
  statut: string
  date_effet: string | null
  validee_at: string | null
}

interface ExonerationRow {
  date: Date
  etudiant: string
  matricule: string
  filiere: string
  annee: string
  motif: string
  portee: string
  mois: string
  mode: string
  valeur: number
  montant: number
  libelle: string
}

// ─── Libellés humains ────────────────────────────────────────────────────────

const TYPE_PAIEMENT_LABELS: Record<string, string> = {
  frais_inscription: "Frais d'inscription",
  mensualite:        'Mensualité',
  tenue:             'Tenue',
  rattrapage:        'Rattrapage',
  autre:             'Autre',
}

const CATEGORIE_DEPENSE_LABELS: Record<string, string> = {
  loyer_charges: 'Loyer & Charges',
  salaires:      'Salaires',
  prestation:    'Prestation de service',
  materiel:      'Matériel & Équipement',
  fournitures:   'Fournitures & Consommables',
  internet_tel:  'Internet & Téléphone',
  entretien:     'Entretien & Maintenance',
  communication: 'Communication & Marketing',
  pedagogique:   'Dépenses pédagogiques',
  autre:         'Autre',
}

const MODE_LABELS: Record<string, string> = {
  especes:      'Espèces',
  virement:     'Virement',
  cheque:       'Chèque',
  wave:         'Wave',
  orange_money: 'Orange Money',
}

const EXO_MOTIF_LABELS: Record<string, string> = {
  bourse_merite:    'Bourse de mérite',
  bourse_sociale:   'Bourse sociale',
  convention:       'Convention / Partenariat',
  enfant_personnel: 'Enfant du personnel',
  decision_dg:      'Décision DG',
  autre:            'Autre',
}
const EXO_PORTEE_LABELS: Record<string, string> = {
  totale:                'Totalité',
  inscription:           'Inscription',
  tenue:                 'Tenue',
  mensualites_toutes:    'Toutes mensualités',
  mensualite_specifique: 'Mensualité spécifique',
}

// ─── Palette / formats (reproduction fidèle du modèle ANAQ) ──────────────────

const COLOR_BANDEAU  = 'FF938953' // gold/khaki — ANNEE/MOIS
const COLOR_RECETTE  = 'FFC6EFCE' // vert clair — bandeau "Livre chronologique"
const COLOR_RECETTE_FONT = 'FF375623'
const COLOR_DEPENSE  = 'FFFBD4B4' // saumon — bandeau "Registre des achats"
const COLOR_DEPENSE_FONT = 'FFE36C09'
const COLOR_SOLDE    = 'FFFFFF00' // jaune — ligne solde initial
const COLOR_TOTAL    = 'FFD9D9D9' // gris clair — ligne TOTAL
const COLOR_RECAP_HD = 'FFC4BD97' // beige — en-têtes récap

// Format comptable FCFA : même logique que € du modèle mais en francs CFA
const FMT_FCFA = '_-* #,##0 "F CFA"_-;-* #,##0 "F CFA"_-;_-* "-"?? "F CFA"_-;_-@_-'
const FMT_DATE = 'd/m/yyyy'

const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]
const MOIS_MAJ = [
  'JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN',
  'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s\u00a0]/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function studentName(e: { nom: string | null; prenom: string | null } | null | undefined): string {
  if (!e) return ''
  return [e.prenom, e.nom].filter(Boolean).join(' ').trim()
}

function typePaiementLabel(code: string | null): string {
  return (code && TYPE_PAIEMENT_LABELS[code]) || 'Frais de scolarité'
}
function categorieDepenseLabel(code: string | null): string {
  return (code && CATEGORIE_DEPENSE_LABELS[code]) || (code || 'Autre')
}
function modeLabel(code: string | null): string {
  return (code && MODE_LABELS[code]) || (code || '—')
}

function pad5(id: number): string { return String(id).padStart(5, '0') }
function shortDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

// ─── Chargement des données ──────────────────────────────────────────────────

async function loadData(annee: number) {
  const date_from = `${annee}-01-01`
  const date_to   = `${annee}-12-31`

  const [paiementsRes, autresRes, depensesRes] = await Promise.all([
    api.get('/paiements',       { params: { statut: 'confirme', date_from, date_to } }),
    api.get('/autres-recettes', { params: { statut: 'validee',  date_from, date_to } }),
    api.get('/depenses',        { params: { statut: 'validee',  date_from, date_to } }),
  ])

  const paiements: PaiementApi[]     = (paiementsRes.data?.data ?? paiementsRes.data) ?? []
  const autres:    AutreRecetteApi[] = (autresRes.data?.data    ?? autresRes.data)    ?? []
  const depenses:  DepenseApi[]      = (depensesRes.data?.data  ?? depensesRes.data)  ?? []

  // Transformation en lignes prêtes à écrire
  const recettes: RecetteRow[] = []
  for (const p of paiements) {
    const d = parseISO(p.confirmed_at) || parseISO(p.created_at)
    if (!d || d.getFullYear() !== annee) continue
    recettes.push({
      date:    d,
      ref:     p.numero_recu || `REC-${pad5(p.id)}-${shortDate(d)}`,
      client:  studentName(p.etudiant),
      nature:  typePaiementLabel(p.type_paiement),
      montant: num(p.montant),
      mode:    modeLabel(p.mode_paiement),
    })
  }
  for (const r of autres) {
    const d = parseISO(r.date_recette)
    if (!d || d.getFullYear() !== annee) continue
    recettes.push({
      date:    d,
      ref:     r.reference_piece || `AR-${pad5(r.id)}-${shortDate(d)}`,
      client:  r.client || '',
      nature:  r.nature || r.libelle,
      montant: num(r.montant),
      mode:    modeLabel(r.mode_encaissement),
    })
  }

  const dep: DepenseRow[] = []
  for (const x of depenses) {
    const d = parseISO(x.date_depense)
    if (!d || d.getFullYear() !== annee) continue
    dep.push({
      date:        d,
      ref:         x.reference_facture || `DEP-${pad5(x.id)}-${shortDate(d)}`,
      fournisseur: x.beneficiaire || x.libelle,
      nature:      categorieDepenseLabel(x.categorie),
      montant:     num(x.montant),
      mode:        modeLabel(x.mode_paiement),
    })
  }

  // Tri chronologique + regroupement par mois (0-11)
  const byMonthR: RecetteRow[][] = Array.from({ length: 12 }, () => [])
  const byMonthD: DepenseRow[][] = Array.from({ length: 12 }, () => [])
  for (const r of recettes) byMonthR[r.date.getMonth()]!.push(r)
  for (const d of dep)      byMonthD[d.date.getMonth()]!.push(d)
  for (let i = 0; i < 12; i++) {
    byMonthR[i]!.sort((a, b) => a.date.getTime() - b.date.getTime())
    byMonthD[i]!.sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  return { byMonthR, byMonthD }
}

// ─── Styles réutilisables ────────────────────────────────────────────────────

function fillSolid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb }, bgColor: { argb } }
}

const THIN_BORDER: ExcelJS.Borders = {
  top:    { style: 'thin', color: { argb: 'FF7F7F7F' } },
  bottom: { style: 'thin', color: { argb: 'FF7F7F7F' } },
  left:   { style: 'thin', color: { argb: 'FF7F7F7F' } },
  right:  { style: 'thin', color: { argb: 'FF7F7F7F' } },
  diagonal: { up: false, down: false, style: undefined, color: { argb: 'FF000000' } },
}

function applyBorders(ws: ExcelJS.Worksheet, range: string) {
  const [start, end] = range.split(':')
  const m1 = /^([A-Z]+)(\d+)$/.exec(start!)!
  const m2 = /^([A-Z]+)(\d+)$/.exec(end!)!
  const colFrom = colLetterToNum(m1[1]!)
  const colTo   = colLetterToNum(m2[1]!)
  const rowFrom = Number(m1[2])
  const rowTo   = Number(m2[2])
  for (let r = rowFrom; r <= rowTo; r++) {
    for (let c = colFrom; c <= colTo; c++) {
      ws.getCell(r, c).border = THIN_BORDER
    }
  }
}

function colLetterToNum(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

// ─── Construction d'une feuille mensuelle ────────────────────────────────────

interface MonthSheetMeta {
  totalRecettesCell: string // ex: "E40"
  totalDepensesCell: string // ex: "L40"
  soldeMoisCell: string     // ex: "E42"
}

function buildMonthSheet(
  ws: ExcelJS.Worksheet,
  annee: number,
  moisIdx: number, // 0-11
  recettes: RecetteRow[],
  depenses: DepenseRow[],
  soldeInitial: number | string, // nombre OU formule Excel (ex: "Janvier!E42")
  soldeInitialLabel: string,      // ex: "SOLDE DÉCEMBRE 2025"
): MonthSheetMeta {
  // Largeurs de colonnes (reprises fidèlement du modèle)
  ws.columns = [
    { width: 11.5 }, // A Date
    { width: 16 },   // B Réf
    { width: 23 },   // C Client
    { width: 24 },   // D Nature
    { width: 14.5 }, // E Montant
    { width: 31 },   // F Mode
    { width: 3 },    // G gap
    { width: 11.5 }, // H Date
    { width: 16 },   // I Réf
    { width: 25 },   // J Fournisseur
    { width: 22.5 }, // K Nature
    { width: 13 },   // L Montant
    { width: 26.5 }, // M Mode
  ]

  // — Bandeau ANNEE / MOIS —
  const bandFont: Partial<ExcelJS.Font> = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getCell('C1').value = 'ANNEE :'
  ws.getCell('C1').fill  = fillSolid(COLOR_BANDEAU)
  ws.getCell('C1').font  = bandFont
  ws.getCell('C1').alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getCell('D1').value = annee
  ws.getCell('D1').fill  = fillSolid(COLOR_BANDEAU)
  ws.getCell('D1').font  = bandFont
  ws.getCell('D1').alignment = { horizontal: 'right', vertical: 'middle' }

  ws.getCell('C3').value = 'MOIS :'
  ws.getCell('C3').fill  = fillSolid(COLOR_BANDEAU)
  ws.getCell('C3').font  = bandFont
  ws.getCell('C3').alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getCell('D3').value = MOIS_MAJ[moisIdx]
  ws.getCell('D3').fill  = fillSolid(COLOR_BANDEAU)
  ws.getCell('D3').font  = bandFont
  ws.getCell('D3').alignment = { horizontal: 'right', vertical: 'middle' }

  ws.getRow(1).height = 24
  ws.getRow(3).height = 24

  // — Bandeaux de section (ligne 5) —
  ws.mergeCells('A5:F5')
  ws.getCell('A5').value = 'Livre chronologique des recettes'
  ws.getCell('A5').fill  = fillSolid(COLOR_RECETTE)
  ws.getCell('A5').font  = { name: 'Calibri', size: 14, bold: true, color: { argb: COLOR_RECETTE_FONT } }
  ws.getCell('A5').alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }

  ws.mergeCells('H5:M5')
  ws.getCell('H5').value = 'Registre des achats et autres dépenses'
  ws.getCell('H5').fill  = fillSolid(COLOR_DEPENSE)
  ws.getCell('H5').font  = { name: 'Calibri', size: 14, bold: true, color: { argb: COLOR_DEPENSE_FONT } }
  ws.getCell('H5').alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  ws.getRow(5).height = 22

  // — En-têtes de colonnes (ligne 7) —
  const headers = [
    { c: 'A', v: 'Date' },
    { c: 'B', v: 'Réf. de la pièce' },
    { c: 'C', v: 'Client' },
    { c: 'D', v: 'Nature' },
    { c: 'E', v: 'Montant' },
    { c: 'F', v: "Mode d'encaissement" },
    { c: 'H', v: 'Date' },
    { c: 'I', v: 'Réf. de la pièce' },
    { c: 'J', v: 'Fournisseur, désignation' },
    { c: 'K', v: 'Nature' },
    { c: 'L', v: 'Montant' },
    { c: 'M', v: 'Mode de paiement' },
  ]
  for (const h of headers) {
    const cell = ws.getCell(`${h.c}7`)
    cell.value = h.v
    cell.font = { name: 'Calibri', size: 12, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  }
  ws.getRow(7).height = 28

  // — Ligne 8 : SOLDE INITIAL (jaune, côté recettes uniquement) —
  const soldeRow = 8
  ws.getCell(`A${soldeRow}`).value = new Date(annee, moisIdx, 1)
  ws.getCell(`A${soldeRow}`).numFmt = FMT_DATE
  ws.getCell(`D${soldeRow}`).value = soldeInitialLabel
  if (typeof soldeInitial === 'number') {
    ws.getCell(`E${soldeRow}`).value = soldeInitial
  } else {
    ws.getCell(`E${soldeRow}`).value = { formula: soldeInitial } as ExcelJS.CellFormulaValue
  }
  ws.getCell(`E${soldeRow}`).numFmt = FMT_FCFA
  ws.getCell(`F${soldeRow}`).value = 'SOLDE BANCAIRE'
  // Jaune sur le bloc recettes entier
  for (const col of ['A','B','C','D','E','F']) {
    const c = ws.getCell(`${col}${soldeRow}`)
    c.fill = fillSolid(COLOR_SOLDE)
    c.font = { name: 'Calibri', size: 11, bold: true }
    c.alignment = { horizontal: col === 'E' ? 'right' : 'left', vertical: 'middle' }
    c.border = THIN_BORDER
  }

  // — Lignes de données (à partir de la ligne 9) —
  const START = 9
  const nbRows = Math.max(recettes.length, depenses.length, 20) // au moins 20 lignes vides pour saisie manuelle
  for (let i = 0; i < nbRows; i++) {
    const row = START + i
    const r = recettes[i]
    const d = depenses[i]

    if (r) {
      ws.getCell(`A${row}`).value   = r.date
      ws.getCell(`A${row}`).numFmt  = FMT_DATE
      ws.getCell(`B${row}`).value   = r.ref
      ws.getCell(`C${row}`).value   = r.client
      ws.getCell(`D${row}`).value   = r.nature
      ws.getCell(`E${row}`).value   = r.montant
      ws.getCell(`E${row}`).numFmt  = FMT_FCFA
      ws.getCell(`F${row}`).value   = r.mode
    }
    if (d) {
      ws.getCell(`H${row}`).value   = d.date
      ws.getCell(`H${row}`).numFmt  = FMT_DATE
      ws.getCell(`I${row}`).value   = d.ref
      ws.getCell(`J${row}`).value   = d.fournisseur
      ws.getCell(`K${row}`).value   = d.nature
      ws.getCell(`L${row}`).value   = d.montant
      ws.getCell(`L${row}`).numFmt  = FMT_FCFA
      ws.getCell(`M${row}`).value   = d.mode
    }
    // Alignements & bordures
    for (const col of ['A','B','C','D','E','F']) {
      const c = ws.getCell(`${col}${row}`)
      c.font = c.font || { name: 'Calibri', size: 11 }
      c.alignment = { horizontal: col === 'E' ? 'right' : 'left', vertical: 'middle', wrapText: true }
      c.border = THIN_BORDER
      if (col === 'E' && !c.numFmt) c.numFmt = FMT_FCFA
    }
    for (const col of ['H','I','J','K','L','M']) {
      const c = ws.getCell(`${col}${row}`)
      c.font = c.font || { name: 'Calibri', size: 11 }
      c.alignment = { horizontal: col === 'L' ? 'right' : 'left', vertical: 'middle', wrapText: true }
      c.border = THIN_BORDER
      if (col === 'L' && !c.numFmt) c.numFmt = FMT_FCFA
    }
  }

  // — Ligne TOTAL —
  const totalRow = START + nbRows + 1
  ws.getCell(`D${totalRow}`).value = 'TOTAL DU MOIS'
  ws.getCell(`D${totalRow}`).font  = { name: 'Calibri', size: 12, bold: true }
  ws.getCell(`D${totalRow}`).alignment = { horizontal: 'right', vertical: 'middle' }
  ws.getCell(`D${totalRow}`).fill  = fillSolid(COLOR_TOTAL)

  ws.getCell(`E${totalRow}`).value  = { formula: `SUM(E${soldeRow}:E${totalRow - 1})` } as ExcelJS.CellFormulaValue
  ws.getCell(`E${totalRow}`).numFmt = FMT_FCFA
  ws.getCell(`E${totalRow}`).font   = { name: 'Calibri', size: 12, bold: true }
  ws.getCell(`E${totalRow}`).fill   = fillSolid(COLOR_TOTAL)
  ws.getCell(`E${totalRow}`).border = THIN_BORDER

  ws.getCell(`K${totalRow}`).value = 'TOTAL DU MOIS'
  ws.getCell(`K${totalRow}`).font  = { name: 'Calibri', size: 12, bold: true }
  ws.getCell(`K${totalRow}`).alignment = { horizontal: 'right', vertical: 'middle' }
  ws.getCell(`K${totalRow}`).fill  = fillSolid(COLOR_TOTAL)

  ws.getCell(`L${totalRow}`).value  = { formula: `SUM(L${START}:L${totalRow - 1})` } as ExcelJS.CellFormulaValue
  ws.getCell(`L${totalRow}`).numFmt = FMT_FCFA
  ws.getCell(`L${totalRow}`).font   = { name: 'Calibri', size: 12, bold: true }
  ws.getCell(`L${totalRow}`).fill   = fillSolid(COLOR_TOTAL)
  ws.getCell(`L${totalRow}`).border = THIN_BORDER

  // — Ligne SOLDE DU MOIS —
  const soldeMoisRow = totalRow + 2
  ws.getCell(`D${soldeMoisRow}`).value = 'SOLDE DU MOIS'
  ws.getCell(`D${soldeMoisRow}`).font  = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF375623' } }
  ws.getCell(`D${soldeMoisRow}`).alignment = { horizontal: 'right', vertical: 'middle' }

  ws.getCell(`E${soldeMoisRow}`).value  = { formula: `E${totalRow}-L${totalRow}` } as ExcelJS.CellFormulaValue
  ws.getCell(`E${soldeMoisRow}`).numFmt = FMT_FCFA
  ws.getCell(`E${soldeMoisRow}`).font   = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF375623' } }
  ws.getCell(`E${soldeMoisRow}`).fill   = fillSolid('FFE2EFDA')
  ws.getCell(`E${soldeMoisRow}`).border = THIN_BORDER

  // Figer les en-têtes
  ws.views = [{ state: 'frozen', ySplit: 7 }]

  // Mise en page impression
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9, // A4
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  }
  ws.headerFooter = {
    oddHeader: `&L&"Calibri,Bold"&14UP'TECH CAMPUS — Suivi comptabilité ${annee}&R&"Calibri,Italic"${MOIS_FR[moisIdx]}`,
    oddFooter: '&LNINEA 0124 6987 3C 2 — Arrêté 2025/MESRI&CPage &P / &N&R&D',
  }

  return {
    totalRecettesCell: `E${totalRow}`,
    totalDepensesCell: `L${totalRow}`,
    soldeMoisCell:     `E${soldeMoisRow}`,
  }
}

// ─── Rendu de graphiques Chart.js vers PNG (pour incrustation Excel) ────────

async function renderChartToPng(
  config: ChartConfiguration,
  width = 900,
  height = 420,
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height
  // Hors-flux, mais attaché pour que Chart.js puisse mesurer
  canvas.style.position = 'fixed'
  canvas.style.left = '-10000px'
  canvas.style.top  = '0'
  document.body.appendChild(canvas)
  try {
    const chart = new Chart(canvas, config)
    // Chart.js v4 : le rendu est synchrone lorsque animation est désactivée
    chart.update('none')
    const dataUrl = canvas.toDataURL('image/png')
    chart.destroy()
    return dataUrl
  } finally {
    document.body.removeChild(canvas)
  }
}

function chartFont() {
  return { family: 'Calibri, Arial, sans-serif' }
}

// ─── Construction de la feuille RECAPITULATIF ────────────────────────────────

async function buildRecapSheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  annee: number,
  meta: MonthSheetMeta[],
  monthlyData: { recettes: number; depenses: number }[],
  soldeInitial: number,
) {
  ws.columns = [
    { width: 16 }, // A MOIS
    { width: 18 }, // B Recettes
    { width: 18 }, // C Dépenses
    { width: 18 }, // D Solde mois
    { width: 18 }, // E Trésorerie
  ]

  // Titre
  ws.mergeCells('A1:E1')
  const title = ws.getCell('A1')
  title.value = `Récapitulatif annuel ${annee}`
  title.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } }
  title.fill = fillSolid(COLOR_BANDEAU)
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 28

  // En-têtes
  const hdrs = ['MOIS', 'Recettes', 'Dépenses', 'Solde mois', 'Trésorerie']
  hdrs.forEach((h, i) => {
    const cell = ws.getCell(3, i + 1)
    cell.value = h
    cell.font = { name: 'Calibri', size: 12, bold: true }
    cell.fill = fillSolid(COLOR_RECAP_HD)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = THIN_BORDER
  })
  ws.getRow(3).height = 22

  // Lignes mensuelles
  for (let m = 0; m < 12; m++) {
    const row = 4 + m
    const sheetName = MOIS_FR[m]
    const mm = meta[m]!
    ws.getCell(row, 1).value = MOIS_MAJ[m]
    ws.getCell(row, 1).font = { name: 'Calibri', size: 11, bold: true }
    ws.getCell(row, 2).value = { formula: `'${sheetName}'!${mm.totalRecettesCell}` } as ExcelJS.CellFormulaValue
    ws.getCell(row, 3).value = { formula: `'${sheetName}'!${mm.totalDepensesCell}` } as ExcelJS.CellFormulaValue
    ws.getCell(row, 4).value = { formula: `B${row}-C${row}` } as ExcelJS.CellFormulaValue
    if (m === 0) {
      ws.getCell(row, 5).value = { formula: `D${row}` } as ExcelJS.CellFormulaValue
    } else {
      ws.getCell(row, 5).value = { formula: `E${row - 1}+D${row}` } as ExcelJS.CellFormulaValue
    }
    for (let c = 2; c <= 5; c++) {
      ws.getCell(row, c).numFmt = FMT_FCFA
      ws.getCell(row, c).font = { name: 'Calibri', size: 11 }
    }
    for (let c = 1; c <= 5; c++) {
      ws.getCell(row, c).border = THIN_BORDER
      if (c === 1) ws.getCell(row, c).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
      else ws.getCell(row, c).alignment = { horizontal: 'right', vertical: 'middle' }
    }
  }

  // Ligne TOTAUX
  const totRow = 17
  ws.getCell(`A${totRow}`).value = 'TOTAUX'
  ws.getCell(`A${totRow}`).font  = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getCell(`A${totRow}`).fill  = fillSolid(COLOR_BANDEAU)
  ws.getCell(`A${totRow}`).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 }
  ws.getCell(`B${totRow}`).value = { formula: `SUM(B4:B15)` } as ExcelJS.CellFormulaValue
  ws.getCell(`C${totRow}`).value = { formula: `SUM(C4:C15)` } as ExcelJS.CellFormulaValue
  ws.getCell(`D${totRow}`).value = { formula: `B${totRow}-C${totRow}` } as ExcelJS.CellFormulaValue
  for (let c = 1; c <= 5; c++) {
    const cell = ws.getCell(totRow, c)
    if (c > 1) {
      cell.fill = fillSolid(COLOR_BANDEAU)
      cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.numFmt = FMT_FCFA
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    }
    cell.border = THIN_BORDER
  }

  // Ligne SOLDE ANNEE
  const soldeRow = 18
  ws.mergeCells(`A${soldeRow}:C${soldeRow}`)
  ws.getCell(`A${soldeRow}`).value = 'SOLDE ANNÉE'
  ws.getCell(`A${soldeRow}`).font  = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF375623' } }
  ws.getCell(`A${soldeRow}`).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 }
  ws.getCell(`D${soldeRow}`).value = { formula: `D${totRow}` } as ExcelJS.CellFormulaValue
  ws.getCell(`D${soldeRow}`).numFmt = FMT_FCFA
  ws.getCell(`D${soldeRow}`).font  = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF375623' } }
  ws.getCell(`D${soldeRow}`).fill  = fillSolid('FFE2EFDA')
  ws.getCell(`D${soldeRow}`).alignment = { horizontal: 'right', vertical: 'middle' }
  applyBorders(ws, `A${soldeRow}:E${soldeRow}`)

  // ─── Indicateurs clés (KPI) ────────────────────────────────────────────────
  const totalRecettes = monthlyData.reduce((s, m) => s + m.recettes, 0)
  const totalDepenses = monthlyData.reduce((s, m) => s + m.depenses, 0)
  const tresorerieFin = soldeInitial + totalRecettes - totalDepenses

  // Solde cumulé mois par mois (pour graphique trésorerie)
  const treso: number[] = []
  let cum = soldeInitial
  for (const m of monthlyData) {
    cum += m.recettes - m.depenses
    treso.push(cum)
  }
  const moisAvecActivite = monthlyData.filter(m => m.recettes > 0 || m.depenses > 0).length
  const moyenneMensuelleRec = moisAvecActivite ? totalRecettes / moisAvecActivite : 0
  const moyenneMensuelleDep = moisAvecActivite ? totalDepenses / moisAvecActivite : 0
  const bestMois = monthlyData.reduce((best, m, i) =>
    (m.recettes - m.depenses) > (best.sold ?? -Infinity) ? { idx: i, sold: m.recettes - m.depenses } : best,
    { idx: -1, sold: -Infinity as number })

  const kpiRow = 20
  ws.mergeCells(`A${kpiRow}:E${kpiRow}`)
  ws.getCell(`A${kpiRow}`).value = 'INDICATEURS CLÉS'
  ws.getCell(`A${kpiRow}`).font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getCell(`A${kpiRow}`).fill = fillSolid(COLOR_BANDEAU)
  ws.getCell(`A${kpiRow}`).alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(kpiRow).height = 24

  const kpis: Array<[string, string | number, boolean]> = [
    ['Solde d\'ouverture (01/01)',               soldeInitial,          false],
    ['Total recettes encaissées',                totalRecettes,         false],
    ['Total dépenses engagées',                  totalDepenses,         false],
    ['Solde net (recettes − dépenses)',          totalRecettes - totalDepenses, true],
    ['Trésorerie au 31/12',                      tresorerieFin,         true],
    ['Recettes moyennes / mois actif',           moyenneMensuelleRec,   false],
    ['Dépenses moyennes / mois actif',           moyenneMensuelleDep,   false],
    ['Mois le plus bénéficiaire',                bestMois.idx >= 0 ? `${MOIS_MAJ[bestMois.idx]} (${new Intl.NumberFormat('fr-FR').format(Math.round(bestMois.sold)).replace(/\u202F/g, ' ')} F CFA)` : '—', false],
  ]
  kpis.forEach((kpi, i) => {
    const r = kpiRow + 1 + i
    ws.mergeCells(`A${r}:C${r}`)
    ws.getCell(`A${r}`).value = kpi[0]
    ws.getCell(`A${r}`).font = { name: 'Calibri', size: 11, bold: false }
    ws.getCell(`A${r}`).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    ws.mergeCells(`D${r}:E${r}`)
    const vcell = ws.getCell(`D${r}`)
    vcell.value = kpi[1]
    if (typeof kpi[1] === 'number') vcell.numFmt = FMT_FCFA
    vcell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: kpi[2] ? 'FF375623' : 'FF1E293B' } }
    vcell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 }
    if (kpi[2]) vcell.fill = fillSolid('FFE2EFDA')
    applyBorders(ws, `A${r}:E${r}`)
  })

  const afterKpi = kpiRow + 1 + kpis.length

  // ─── Graphiques (PNG intégrés) ─────────────────────────────────────────────
  const labels = MOIS_FR
  const COLORS = {
    recettes: '#10B981',
    depenses: '#E30613',
    treso:    '#1D4ED8',
    grid:     '#E5E7EB',
  }

  // 1. Graphique de trésorerie — ligne
  const chartTreso = await renderChartToPng({
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Trésorerie cumulée',
        data: treso,
        borderColor: COLORS.treso,
        backgroundColor: 'rgba(29,78,216,0.15)',
        fill: true,
        tension: 0.25,
        pointRadius: 4,
        pointBackgroundColor: COLORS.treso,
        borderWidth: 2.5,
      }],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title:  { display: true, text: `Évolution de la trésorerie ${annee}`, font: { ...chartFont(), size: 16, weight: 'bold' } as any, color: '#111' },
        legend: { display: true, position: 'bottom', labels: { font: chartFont() as any } },
      },
      scales: {
        x: { grid: { color: COLORS.grid }, ticks: { font: chartFont() as any } },
        y: { grid: { color: COLORS.grid }, ticks: { font: chartFont() as any, callback: (v: any) => new Intl.NumberFormat('fr-FR').format(Number(v)) + ' F' } },
      },
    },
  })

  // 2. Graphique recettes vs dépenses — barres
  const chartBars = await renderChartToPng({
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Recettes',
          data: monthlyData.map(m => m.recettes),
          backgroundColor: COLORS.recettes,
          borderRadius: 4,
        },
        {
          label: 'Dépenses',
          data: monthlyData.map(m => m.depenses),
          backgroundColor: COLORS.depenses,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title:  { display: true, text: `Recettes et dépenses par mois — ${annee}`, font: { ...chartFont(), size: 16, weight: 'bold' } as any, color: '#111' },
        legend: { display: true, position: 'bottom', labels: { font: chartFont() as any } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: chartFont() as any } },
        y: { grid: { color: COLORS.grid }, beginAtZero: true, ticks: { font: chartFont() as any, callback: (v: any) => new Intl.NumberFormat('fr-FR').format(Number(v)) + ' F' } },
      },
    },
  })

  // Incrustation des images
  const imgId1 = wb.addImage({ base64: chartTreso, extension: 'png' })
  const imgId2 = wb.addImage({ base64: chartBars,  extension: 'png' })

  const chartStartRow = afterKpi + 2 // ligne 0-based pour ExcelJS.addImage
  // Étiquette "Graphique de trésorerie"
  ws.mergeCells(`A${afterKpi + 1}:E${afterKpi + 1}`)
  const lbl1 = ws.getCell(`A${afterKpi + 1}`)
  lbl1.value = 'Graphique de trésorerie'
  lbl1.font  = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF1D4ED8' } }
  lbl1.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }

  // Graphique 1 occupe approximativement 5 colonnes × 20 lignes
  ws.addImage(imgId1, {
    tl: { col: 0, row: chartStartRow },
    ext: { width: 900, height: 420 },
  } as any)

  const chart2Label = chartStartRow + 22 // 20 lignes + marge
  ws.mergeCells(`A${chart2Label}:E${chart2Label}`)
  const lbl2 = ws.getCell(`A${chart2Label}`)
  lbl2.value = 'Recettes et dépenses par mois'
  lbl2.font  = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFE30613' } }
  lbl2.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }

  ws.addImage(imgId2, {
    tl: { col: 0, row: chart2Label + 1 },
    ext: { width: 900, height: 420 },
  } as any)

  ws.views = [{ state: 'frozen', ySplit: 3 }]
  ws.pageSetup = {
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
  }
  ws.headerFooter = {
    oddHeader: `&L&"Calibri,Bold"&14UP'TECH CAMPUS — Récapitulatif ${annee}&R&"Calibri,Italic"Document comptable`,
    oddFooter: '&LNINEA 0124 6987 3C 2 — Arrêté 2025/MESRI&CPage &P / &N&R&D',
  }
}

// ─── Exonérations : chargement + feuille dédiée ──────────────────────────────

async function loadExonerations(annee: number): Promise<ExonerationRow[]> {
  try {
    const { data } = await api.get('/exonerations', { params: { statut: 'validee' } })
    const list: ExonerationApi[] = data?.data ?? data ?? []
    const rows: ExonerationRow[] = []
    for (const e of list) {
      // Date de référence = date_effet sinon validee_at
      const d = parseISO(e.date_effet) || parseISO(e.validee_at)
      if (!d || d.getFullYear() !== annee) continue
      rows.push({
        date:      d,
        etudiant:  e.etudiant_nom || '',
        matricule: e.matricule || '',
        filiere:   e.filiere_nom || '',
        annee:     e.annee_libelle || '',
        motif:     EXO_MOTIF_LABELS[e.motif] ?? e.motif,
        portee:    EXO_PORTEE_LABELS[e.portee] ?? e.portee,
        mois:      e.mois_concerne
          ? new Date(e.mois_concerne).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
          : '',
        mode:      e.mode_calcul === 'pourcentage' ? `${num(e.valeur)} %` : 'Montant fixe',
        valeur:    num(e.valeur),
        montant:   num(e.montant_applique),
        libelle:   e.libelle || '',
      })
    }
    rows.sort((a, b) => a.date.getTime() - b.date.getTime())
    return rows
  } catch { return [] }
}

function buildExonerationsSheet(ws: ExcelJS.Worksheet, annee: number, rows: ExonerationRow[]): void {
  ws.columns = [
    { width: 11.5 }, // A Date
    { width: 24 },   // B Étudiant
    { width: 13 },   // C Matricule
    { width: 22 },   // D Filière
    { width: 13 },   // E Année
    { width: 18 },   // F Motif
    { width: 20 },   // G Portée
    { width: 18 },   // H Mois concerné
    { width: 14 },   // I Mode / Valeur
    { width: 16 },   // J Montant appliqué
    { width: 28 },   // K Libellé
  ]

  // Bandeau ANNEE
  ws.mergeCells('A1:K1')
  const head = ws.getCell('A1')
  head.value = `EXONÉRATIONS ${annee}`
  head.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  head.alignment = { horizontal: 'center', vertical: 'middle' }
  head.fill = fillSolid(COLOR_BANDEAU)
  ws.getRow(1).height = 22

  // Bandeau couleur sous-titre
  ws.mergeCells('A2:K2')
  const sub = ws.getCell('A2')
  sub.value = "Bourses, remises et décisions DG — exonérations validées de l'année"
  sub.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF375623' } }
  sub.alignment = { horizontal: 'center', vertical: 'middle' }
  sub.fill = fillSolid(COLOR_RECETTE)
  ws.getRow(2).height = 18

  // En-têtes
  const HEADERS = ['Date', 'Étudiant', 'Matricule', 'Filière', 'Année académique', 'Motif', 'Portée', 'Mois concerné', 'Mode / Valeur', 'Montant appliqué', 'Libellé']
  const headerRow = ws.getRow(4)
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.fill = fillSolid(COLOR_RECAP_HD)
  })
  headerRow.height = 26
  applyBorders(ws, 'A4:K4')

  // Lignes
  const startRow = 5
  let r = startRow
  for (const row of rows) {
    ws.getCell(r, 1).value = row.date
    ws.getCell(r, 1).numFmt = FMT_DATE
    ws.getCell(r, 2).value = row.etudiant
    ws.getCell(r, 3).value = row.matricule
    ws.getCell(r, 4).value = row.filiere
    ws.getCell(r, 5).value = row.annee
    ws.getCell(r, 6).value = row.motif
    ws.getCell(r, 7).value = row.portee
    ws.getCell(r, 8).value = row.mois
    ws.getCell(r, 9).value = row.mode
    ws.getCell(r, 10).value = row.montant
    ws.getCell(r, 10).numFmt = FMT_FCFA
    ws.getCell(r, 11).value = row.libelle
    r++
  }

  const dataEndRow = Math.max(startRow, r - 1)

  // Total
  const totalRow = dataEndRow + 1
  ws.getCell(totalRow, 1).value = 'TOTAL EXONÉRATIONS ' + annee
  ws.mergeCells(totalRow, 1, totalRow, 9)
  ws.getCell(totalRow, 1).alignment = { horizontal: 'right', vertical: 'middle' }
  ws.getCell(totalRow, 1).font = { name: 'Calibri', size: 11, bold: true }
  if (rows.length > 0) {
    ws.getCell(totalRow, 10).value = { formula: `SUM(J${startRow}:J${dataEndRow})` }
  } else {
    ws.getCell(totalRow, 10).value = 0
  }
  ws.getCell(totalRow, 10).numFmt = FMT_FCFA
  ws.getCell(totalRow, 10).font = { name: 'Calibri', size: 11, bold: true }
  for (let c = 1; c <= 11; c++) {
    ws.getCell(totalRow, c).fill = fillSolid(COLOR_TOTAL)
  }
  applyBorders(ws, `A4:K${totalRow}`)

  // Synthèse par motif
  const synthStart = totalRow + 3
  ws.getCell(synthStart, 1).value = 'SYNTHÈSE PAR MOTIF'
  ws.mergeCells(synthStart, 1, synthStart, 3)
  ws.getCell(synthStart, 1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getCell(synthStart, 1).alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getCell(synthStart, 1).fill = fillSolid(COLOR_BANDEAU)

  const synthHeaderRow = synthStart + 1
  ws.getCell(synthHeaderRow, 1).value = 'Motif'
  ws.getCell(synthHeaderRow, 2).value = 'Nombre'
  ws.getCell(synthHeaderRow, 3).value = 'Total'
  for (let c = 1; c <= 3; c++) {
    ws.getCell(synthHeaderRow, c).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getCell(synthHeaderRow, c).fill = fillSolid(COLOR_RECAP_HD)
    ws.getCell(synthHeaderRow, c).alignment = { horizontal: 'center' }
  }

  const byMotif: Record<string, { count: number; total: number }> = {}
  for (const row of rows) {
    const acc = byMotif[row.motif] ?? { count: 0, total: 0 }
    acc.count++
    acc.total += row.montant
    byMotif[row.motif] = acc
  }
  let sr = synthHeaderRow + 1
  const motifKeys = Object.keys(byMotif).sort((a, b) => (byMotif[b]!.total - byMotif[a]!.total))
  for (const k of motifKeys) {
    const v = byMotif[k]!
    ws.getCell(sr, 1).value = k
    ws.getCell(sr, 2).value = v.count
    ws.getCell(sr, 2).alignment = { horizontal: 'center' }
    ws.getCell(sr, 3).value = v.total
    ws.getCell(sr, 3).numFmt = FMT_FCFA
    sr++
  }
  // Total synthèse
  if (motifKeys.length > 0) {
    ws.getCell(sr, 1).value = 'TOTAL'
    ws.getCell(sr, 1).font = { bold: true }
    ws.getCell(sr, 2).value = { formula: `SUM(B${synthHeaderRow + 1}:B${sr - 1})` }
    ws.getCell(sr, 2).font = { bold: true }
    ws.getCell(sr, 2).alignment = { horizontal: 'center' }
    ws.getCell(sr, 3).value = { formula: `SUM(C${synthHeaderRow + 1}:C${sr - 1})` }
    ws.getCell(sr, 3).numFmt = FMT_FCFA
    ws.getCell(sr, 3).font = { bold: true }
    for (let c = 1; c <= 3; c++) ws.getCell(sr, c).fill = fillSolid(COLOR_TOTAL)
    applyBorders(ws, `A${synthHeaderRow}:C${sr}`)
  } else {
    ws.getCell(sr, 1).value = 'Aucune exonération validée cette année'
    ws.getCell(sr, 1).font = { italic: true, color: { argb: 'FF888888' } }
    ws.mergeCells(sr, 1, sr, 3)
  }
}

// ─── Point d'entrée public ───────────────────────────────────────────────────

export async function exportSuiviComptabilite(annee: number, soldeInitialJanvier = 0): Promise<void> {
  const { byMonthR, byMonthD } = await loadData(annee)

  const wb = new ExcelJS.Workbook()
  wb.creator = "UP'TECH Campus"
  wb.lastModifiedBy = "UP'TECH Campus"
  wb.created = new Date()
  wb.modified = new Date()
  wb.title = `Suivi comptabilité ${annee}`
  wb.company = "UPTECH — Institut de Formation"

  const meta: MonthSheetMeta[] = []

  // 12 feuilles mensuelles
  for (let m = 0; m < 12; m++) {
    const ws = wb.addWorksheet(MOIS_FR[m]!, {
      properties: { tabColor: { argb: m === 0 ? 'FF938953' : undefined } } as any,
    })
    const soldeInitial = m === 0
      ? soldeInitialJanvier
      : `'${MOIS_FR[m - 1]}'!${meta[m - 1]!.soldeMoisCell}`
    const soldeLabel = m === 0
      ? `SOLDE ${annee - 1}`
      : `SOLDE ${MOIS_MAJ[m - 1]} ${annee}`
    const mm = buildMonthSheet(
      ws,
      annee,
      m,
      byMonthR[m] ?? [],
      byMonthD[m] ?? [],
      soldeInitial,
      soldeLabel,
    )
    meta.push(mm)
  }

  // Agrégats mensuels (pour KPI + graphiques)
  const monthlyData = Array.from({ length: 12 }, (_, m) => ({
    recettes: (byMonthR[m] ?? []).reduce((s, r) => s + r.montant, 0),
    depenses: (byMonthD[m] ?? []).reduce((s, d) => s + d.montant, 0),
  }))

  // Feuille récapitulative (avec KPI + graphiques)
  const wsRecap = wb.addWorksheet('RECAPITULATIF')
  await buildRecapSheet(wb, wsRecap, annee, meta, monthlyData, soldeInitialJanvier)

  // Feuille Exonérations (bourses / remises / décisions DG)
  const exoRows = await loadExonerations(annee)
  const wsExo = wb.addWorksheet('Exonérations', {
    properties: { tabColor: { argb: 'FF10B981' } } as any,
  })
  buildExonerationsSheet(wsExo, annee, exoRows)

  // Téléchargement côté navigateur
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `suivi_comptabilite_UPTECH_${annee}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
