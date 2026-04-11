<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const auth = useAuthStore()

// ── Types ────────────────────────────────────────────────────────────
interface AnneeAcademique { id: number; libelle: string; actif: boolean }
interface Infrastructure { id: number; designation: string; categorie: string; nombre: number; etat: string; ordre: number }
interface Materiel { id: number; designation: string; nombre: number; etat: string; ordre: number }

// ── État général ─────────────────────────────────────────────────────
const annees = ref<AnneeAcademique[]>([])
const selectedAnneeId = ref<number | null>(null)
const selectedType = ref<'rentree' | 'fin_annee'>('rentree')
const loading = ref(false)
const generating = ref(false)
const error = ref('')

// ── Données chargées ─────────────────────────────────────────────────
const reportData = ref<any>(null)

// ── Infrastructures ──────────────────────────────────────────────────
const infrastructures = ref<Infrastructure[]>([])
const loadingInfra = ref(false)
const infraForm = ref({ designation: '', categorie: 'Pédagogie', nombre: 1, etat: 'Bon/Fonctionnel', ordre: 0 })
const editingInfraId = ref<number | null>(null)
const showInfraForm = ref(false)
const savingInfra = ref(false)
const deletingInfraId = ref<number | null>(null)

// ── Matériels ────────────────────────────────────────────────────────
const materiels = ref<Materiel[]>([])
const loadingMat = ref(false)
const matForm = ref({ designation: '', nombre: 1, etat: 'Bon/Fonctionnel', ordre: 0 })
const editingMatId = ref<number | null>(null)
const showMatForm = ref(false)
const savingMat = ref(false)
const deletingMatId = ref<number | null>(null)

// ── Options ──────────────────────────────────────────────────────────
const categories = ['Pédagogie', 'Administration', 'Sanitaire', 'Restauration', 'Sport', 'Hébergement', 'Autre']
const etats = ['Bon/Fonctionnel', 'Moyen', 'Mauvais/HS']
const isDG = computed(() => auth.user?.role === 'dg')

// ── Chargement initial ───────────────────────────────────────────────
onMounted(async () => {
  const [{ data: anneesData }] = await Promise.all([
    api.get('/annees-academiques'),
    loadInfrastructures(),
    loadMateriels(),
  ])
  annees.value = anneesData
  const active = anneesData.find((a: AnneeAcademique) => a.actif)
  if (active) selectedAnneeId.value = active.id
})

async function loadInfrastructures() {
  loadingInfra.value = true
  try {
    const { data } = await api.get('/infrastructures')
    infrastructures.value = data
  } finally {
    loadingInfra.value = false
  }
}

async function loadMateriels() {
  loadingMat.value = true
  try {
    const { data } = await api.get('/materiels')
    materiels.value = data
  } finally {
    loadingMat.value = false
  }
}

// ── CRUD Infrastructures ─────────────────────────────────────────────
function openInfraCreate() {
  editingInfraId.value = null
  infraForm.value = { designation: '', categorie: 'Pédagogie', nombre: 1, etat: 'Bon/Fonctionnel', ordre: 0 }
  showInfraForm.value = true
}
function openInfraEdit(item: Infrastructure) {
  editingInfraId.value = item.id
  infraForm.value = { designation: item.designation, categorie: item.categorie, nombre: item.nombre, etat: item.etat, ordre: item.ordre }
  showInfraForm.value = true
}
async function saveInfra() {
  if (!infraForm.value.designation.trim()) return
  savingInfra.value = true
  try {
    if (editingInfraId.value) {
      await api.put(`/infrastructures/${editingInfraId.value}`, infraForm.value)
    } else {
      await api.post('/infrastructures', infraForm.value)
    }
    showInfraForm.value = false
    await loadInfrastructures()
  } finally {
    savingInfra.value = false
  }
}
async function deleteInfra(id: number) {
  if (!confirm('Supprimer cette infrastructure ?')) return
  deletingInfraId.value = id
  try {
    await api.delete(`/infrastructures/${id}`)
    await loadInfrastructures()
  } finally {
    deletingInfraId.value = null
  }
}

// ── CRUD Matériels ───────────────────────────────────────────────────
function openMatCreate() {
  editingMatId.value = null
  matForm.value = { designation: '', nombre: 1, etat: 'Bon/Fonctionnel', ordre: 0 }
  showMatForm.value = true
}
function openMatEdit(item: Materiel) {
  editingMatId.value = item.id
  matForm.value = { designation: item.designation, nombre: item.nombre, etat: item.etat, ordre: item.ordre }
  showMatForm.value = true
}
async function saveMat() {
  if (!matForm.value.designation.trim()) return
  savingMat.value = true
  try {
    if (editingMatId.value) {
      await api.put(`/materiels/${editingMatId.value}`, matForm.value)
    } else {
      await api.post('/materiels', matForm.value)
    }
    showMatForm.value = false
    await loadMateriels()
  } finally {
    savingMat.value = false
  }
}
async function deleteMat(id: number) {
  if (!confirm('Supprimer ce matériel ?')) return
  deletingMatId.value = id
  try {
    await api.delete(`/materiels/${id}`)
    await loadMateriels()
  } finally {
    deletingMatId.value = null
  }
}

// ── Groupement infrastructures par catégorie ─────────────────────────
const infraByCategorie = computed(() => {
  const map: Record<string, Infrastructure[]> = {}
  for (const item of infrastructures.value) {
    if (!map[item.categorie]) map[item.categorie] = []
    ;(map[item.categorie] as Infrastructure[]).push(item)
  }
  return map
})

// ── Génération PDF ───────────────────────────────────────────────────
async function generatePDF() {
  if (!selectedAnneeId.value) return
  generating.value = true
  error.value = ''
  try {
    const { data } = await api.get('/rapports-ministere', {
      params: { type: selectedType.value, annee_id: selectedAnneeId.value },
    })
    reportData.value = data
    buildPDF(data)
  } catch (e: any) {
    error.value = e?.response?.data?.error ?? 'Erreur lors de la génération'
  } finally {
    generating.value = false
  }
}

function buildPDF(d: any) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const MARGIN = 20
  const CW = W - MARGIN * 2
  const RED = '#E30613'
  const BLACK = '#111111'
  const GRAY = '#555555'
  const LGRAY = '#888888'
  const BGLIGHT = '#f8f8f8'

  const anneeLabel = d.annee?.libelle ?? ''
  const nomEtab = d.params?.nom_etablissement ?? 'Établissement'
  const agrement = d.params?.agrement ?? ''
  const dg = d.params?.directeur_general ?? ''
  const ministere = d.params?.ministere_tutelle ?? ''
  const adresse = d.params?.adresse ?? ''
  const telephone = d.params?.telephone ?? ''

  const isRentree = selectedType.value === 'rentree'
  const titreRapport = isRentree
    ? `RAPPORT DE RENTRÉE ${anneeLabel}`
    : `RAPPORT DE FIN D'ANNÉE ${anneeLabel}`
  const destinataire = isRentree
    ? 'DGES / DESP'
    : 'DGES / DESP'

  let y = MARGIN

  // ── Helper ──
  function sectionTitle(title: string) {
    y += 6
    doc.setFillColor(RED)
    doc.rect(MARGIN, y, CW, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor('#ffffff')
    doc.text(title, MARGIN + 4, y + 4.8)
    doc.setTextColor(BLACK)
    y += 10
  }

  function checkPage(needed = 40) {
    if (y + needed > 270) {
      doc.addPage()
      y = MARGIN
    }
  }

  // ════════════════════════════════════════════════════════════
  // PAGE DE GARDE
  // ════════════════════════════════════════════════════════════

  // En-tête République du Sénégal
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(BLACK)
  doc.text('RÉPUBLIQUE DU SÉNÉGAL', W / 2, y, { align: 'center' })
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(GRAY)
  doc.text('Un Peuple – Un But – Une Foi', W / 2, y, { align: 'center' })
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(BLACK)
  doc.text(ministere || 'Ministère de tutelle', W / 2, y, { align: 'center' })
  y += 10

  // Ligne séparatrice rouge
  doc.setDrawColor(RED)
  doc.setLineWidth(0.8)
  doc.line(MARGIN, y, W - MARGIN, y)
  y += 8

  // Nom établissement
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(BLACK)
  doc.text(nomEtab.toUpperCase(), W / 2, y, { align: 'center' })
  y += 6
  if (agrement) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(LGRAY)
    doc.text(`Agrément N° ${agrement}`, W / 2, y, { align: 'center' })
    y += 5
  }
  if (adresse) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(LGRAY)
    doc.text(adresse, W / 2, y, { align: 'center' })
    y += 4
  }
  if (telephone) {
    doc.text(`Tél : ${telephone}`, W / 2, y, { align: 'center' })
    y += 4
  }
  y += 8

  // Ligne rouge
  doc.setDrawColor(RED)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, W - MARGIN, y)
  y += 14

  // Titre principal
  doc.setFillColor(RED)
  doc.rect(MARGIN, y, CW, 16, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor('#ffffff')
  doc.text(titreRapport, W / 2, y + 7, { align: 'center' })
  doc.setFontSize(9)
  doc.text(`Année académique ${anneeLabel}`, W / 2, y + 12.5, { align: 'center' })
  doc.setTextColor(BLACK)
  y += 24

  // Destinataire
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(GRAY)
  doc.text(`Destinataire : ${destinataire}`, MARGIN, y)
  y += 10

  // DG
  if (dg) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(BLACK)
    doc.text(`Directeur Général : ${dg}`, MARGIN, y)
    y += 6
  }

  // Date
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(LGRAY)
  doc.text(`Dakar, le ${today}`, W - MARGIN, y, { align: 'right' })
  y += 16

  doc.setDrawColor('#dddddd')
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, W - MARGIN, y)
  y += 10

  // ════════════════════════════════════════════════════════════
  // RAPPORT DE RENTRÉE
  // ════════════════════════════════════════════════════════════
  if (isRentree) {

    // I. PRÉSENTATION DE L'ÉTABLISSEMENT
    sectionTitle('I. PRÉSENTATION DE L\'ÉTABLISSEMENT')
    const presentationRows = [
      ['Nom de l\'établissement', nomEtab],
      ['Agrément', agrement || '-'],
      ['Directeur Général', dg || '-'],
      ['Adresse', adresse || '-'],
      ['Téléphone', telephone || '-'],
      ['Ministère de tutelle', ministere || '-'],
    ]
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [],
      body: presentationRows,
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60, fillColor: '#f5f5f5' },
        1: { cellWidth: CW - 60 },
      },
      theme: 'plain',
    })
    y = (doc as any).lastAutoTable.finalY + 8

    // II. EFFECTIFS PAR FILIÈRE / CLASSE
    checkPage(50)
    sectionTitle('II. EFFECTIFS DES ÉTUDIANTS PAR FILIÈRE')
    const etudiants: any[] = d.etudiants ?? []

    // Grouper par filière
    const parFiliere: Record<string, { classe: string; etudiants: any[] }[]> = {}
    for (const e of etudiants) {
      const f = e.filiere_nom ?? 'Sans filière'
      if (!parFiliere[f]) parFiliere[f] = []
      let classRow = parFiliere[f].find(r => r.classe === e.classe_nom)
      if (!classRow) { classRow = { classe: e.classe_nom, etudiants: [] }; parFiliere[f].push(classRow) }
      classRow.etudiants.push(e)
    }

    const effectifsRows: any[] = []
    let totalGeneral = 0
    for (const [filiere, classes] of Object.entries(parFiliere)) {
      let totalFiliere = 0
      for (const { classe, etudiants: es } of classes) {
        const h = es.filter((e: any) => e.sexe === 'M' || !e.sexe).length
        const f = es.filter((e: any) => e.sexe === 'F').length
        effectifsRows.push([filiere, classe, h, f, es.length])
        totalFiliere += es.length
      }
      totalGeneral += totalFiliere
    }
    effectifsRows.push([{ content: 'TOTAL GÉNÉRAL', colSpan: 4, styles: { fontStyle: 'bold', fillColor: '#f0f0f0' } }, { content: totalGeneral, styles: { fontStyle: 'bold', fillColor: '#f0f0f0' } }])

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Filière', 'Classe', 'H', 'F', 'Total']],
      body: effectifsRows,
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      headStyles: { fillColor: BLACK, textColor: '#ffffff', fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 50 },
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 15, halign: 'center' },
        4: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
      },
      theme: 'striped',
    })
    y = (doc as any).lastAutoTable.finalY + 8

    // III. DROITS DE SCOLARITÉ
    if (d.fraisMap && Object.keys(d.fraisMap).length > 0) {
      checkPage(50)
      sectionTitle('III. DROITS DE SCOLARITÉ ET MODALITÉS DE PAIEMENT')
      const fraisRows = Object.entries(d.fraisMap).map(([filiere, frais]: [string, any]) => [
        filiere,
        frais.inscription ? `${Number(frais.inscription).toLocaleString('fr-FR')} FCFA` : '-',
        frais.mensualite ? `${Number(frais.mensualite).toLocaleString('fr-FR')} FCFA` : '-',
        frais.total ? `${Number(frais.total).toLocaleString('fr-FR')} FCFA` : '-',
      ])
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Filière', 'Inscription', 'Mensualité', 'Total annuel']],
        body: fraisRows,
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { fillColor: BLACK, textColor: '#ffffff', fontStyle: 'bold' },
        theme: 'striped',
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    // IV. MAQUETTE PÉDAGOGIQUE
    if (d.ues && d.ues.length > 0) {
      checkPage(50)
      sectionTitle('IV. MAQUETTE PÉDAGOGIQUE (UNITÉS D\'ENSEIGNEMENT)')
      const ueRows = d.ues.map((u: any) => [
        u.filiere_nom ?? '-',
        u.code ?? '-',
        u.nom ?? '-',
        u.cm ?? 0,
        u.td ?? 0,
        u.tp ?? 0,
        u.tpe ?? 0,
        u.vht ?? 0,
        u.credits ?? 0,
      ])
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Filière', 'Code', 'Intitulé UE', 'CM', 'TD', 'TP', 'TPE', 'VHT', 'Crédits']],
        body: ueRows,
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: BLACK, textColor: '#ffffff', fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 18 },
          2: { cellWidth: 50 },
          3: { cellWidth: 10, halign: 'center' },
          4: { cellWidth: 10, halign: 'center' },
          5: { cellWidth: 10, halign: 'center' },
          6: { cellWidth: 10, halign: 'center' },
          7: { cellWidth: 12, halign: 'center' },
          8: { cellWidth: 12, halign: 'center' },
        },
        theme: 'striped',
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    // V. RESSOURCES HUMAINES — FORMATEURS
    if (d.formateurs && d.formateurs.length > 0) {
      checkPage(50)
      sectionTitle('V. RESSOURCES HUMAINES — CORPS ENSEIGNANT')
      const formateurRows = d.formateurs.map((f: any) => [
        `${f.prenom ?? ''} ${f.nom ?? ''}`.trim(),
        f.specialite ?? '-',
        f.diplome ?? '-',
        f.type_contrat ?? '-',
      ])
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Nom & Prénoms', 'Spécialité', 'Diplôme', 'Statut']],
        body: formateurRows,
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { fillColor: BLACK, textColor: '#ffffff', fontStyle: 'bold' },
        theme: 'striped',
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    // VI. PERSONNEL ADMINISTRATIF & TECHNIQUE
    if (d.pats && d.pats.length > 0) {
      checkPage(50)
      sectionTitle('VI. PERSONNEL ADMINISTRATIF ET TECHNIQUE (PAT)')
      const patRows = d.pats.map((p: any) => [
        `${p.prenom ?? ''} ${p.nom ?? ''}`.trim(),
        p.fonction ?? p.poste ?? '-',
        p.grade ?? '-',
        p.diplome ?? '-',
      ])
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Nom & Prénoms', 'Fonction', 'Grade', 'Diplôme']],
        body: patRows,
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { fillColor: BLACK, textColor: '#ffffff', fontStyle: 'bold' },
        theme: 'striped',
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    // VII. INFRASTRUCTURES
    if (infrastructures.value.length > 0) {
      checkPage(50)
      sectionTitle('VII. INFRASTRUCTURES ET ÉQUIPEMENTS')
      const infraRows = infrastructures.value.map(i => [
        i.categorie,
        i.designation,
        i.nombre,
        i.etat,
      ])
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Catégorie', 'Désignation', 'Nombre', 'État']],
        body: infraRows,
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { fillColor: BLACK, textColor: '#ffffff', fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 80 },
          2: { cellWidth: 18, halign: 'center' },
          3: { cellWidth: 37 },
        },
        theme: 'striped',
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    // VIII. MATÉRIELS PÉDAGOGIQUES
    if (materiels.value.length > 0) {
      checkPage(50)
      sectionTitle('VIII. MATÉRIELS PÉDAGOGIQUES')
      const matRows = materiels.value.map(m => [m.designation, m.nombre, m.etat])
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Désignation', 'Nombre', 'État']],
        body: matRows,
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { fillColor: BLACK, textColor: '#ffffff', fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 110 },
          1: { cellWidth: 20, halign: 'center' },
          2: { cellWidth: 40 },
        },
        theme: 'striped',
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

  }

  // ════════════════════════════════════════════════════════════
  // RAPPORT DE FIN D'ANNÉE
  // ════════════════════════════════════════════════════════════
  else {

    // I. RÉSULTATS PAR CLASSE / SESSION
    sectionTitle('I. RÉSULTATS ACADÉMIQUES PAR CLASSE ET PAR SESSION')
    const resultats: any[] = d.resultats ?? []
    const parClasse: Record<string, any[]> = {}
    for (const r of resultats) {
      const k = `${r.filiere_nom ?? ''} – ${r.classe_nom ?? ''}`
      if (!parClasse[k]) parClasse[k] = []
      parClasse[k].push(r)
    }

    for (const [classeLabel, lignes] of Object.entries(parClasse)) {
      checkPage(50)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(BLACK)
      doc.text(classeLabel, MARGIN, y)
      y += 4

      const rows = lignes.map((r: any) => [
        `${r.prenom ?? ''} ${r.nom ?? ''}`.trim(),
        r.session ?? '-',
        r.decision ?? '-',
        r.moyenne != null ? Number(r.moyenne).toFixed(2) : '-',
      ])
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Étudiant', 'Session', 'Décision', 'Moy.']],
        body: rows,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: BLACK, textColor: '#ffffff', fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 75 },
          1: { cellWidth: 28 },
          2: { cellWidth: 40 },
          3: { cellWidth: 20, halign: 'center' },
        },
        theme: 'striped',
        didParseCell(data) {
          const val = String(data.cell.raw ?? '')
          if (data.column.index === 2) {
            if (val === 'Admis' || val === 'Admis(e)') data.cell.styles.textColor = '#16a34a'
            else if (val === 'Ajourné' || val === 'Ajourné(e)') data.cell.styles.textColor = '#dc2626'
            else if (val.includes('Rattrapage')) data.cell.styles.textColor = '#d97706'
          }
        },
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    // II. ACTIVITÉS PÉDAGOGIQUES
    if (d.statsSeances) {
      checkPage(50)
      sectionTitle('II. BILAN DES ACTIVITÉS PÉDAGOGIQUES')
      const stats = d.statsSeances
      const seanceRows = [
        ['Séances programmées', stats.total ?? 0],
        ['Séances effectuées', stats.effectuees ?? 0],
        ['Séances annulées/reportées', (stats.total ?? 0) - (stats.effectuees ?? 0)],
        ['Taux de réalisation', `${stats.total > 0 ? Math.round((stats.effectuees / stats.total) * 100) : 0} %`],
      ]
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [],
        body: seanceRows,
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 80, fillColor: '#f5f5f5' },
          1: { cellWidth: 40 },
        },
        theme: 'plain',
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    // III. MODES D'ENSEIGNEMENT
    if (d.modes && d.modes.length > 0) {
      checkPage(40)
      sectionTitle('III. MODES D\'ENSEIGNEMENT UTILISÉS')
      const modeRows = d.modes.map((m: any) => [m.mode ?? '-', m.nb_seances ?? 0])
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Mode d\'enseignement', 'Nombre de séances']],
        body: modeRows,
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { fillColor: BLACK, textColor: '#ffffff', fontStyle: 'bold' },
        theme: 'striped',
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }
  }

  // ── Pied de page sur chaque page ──────────────────────────────────
  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(LGRAY)
    doc.text(`${nomEtab} — ${titreRapport}`, MARGIN, 292)
    doc.text(`Page ${i} / ${totalPages}`, W - MARGIN, 292, { align: 'right' })
    doc.setDrawColor('#dddddd')
    doc.setLineWidth(0.3)
    doc.line(MARGIN, 289, W - MARGIN, 289)
  }

  const filename = isRentree
    ? `rapport-rentree-${anneeLabel.replace(/\//g, '-')}.pdf`
    : `rapport-fin-annee-${anneeLabel.replace(/\//g, '-')}.pdf`
  doc.save(filename)
}
</script>

<template>
  <div class="rm-page">

    <!-- ═══════════════════════════════════ HEADER ══════════════════ -->
    <div class="rm-header">
      <div>
        <h1 class="rm-title">Rapports Ministère</h1>
        <p class="rm-subtitle">Génération des rapports officiels (MESRI / Formation Professionnelle)</p>
      </div>
    </div>

    <!-- ═══════════════════════════════════ SÉLECTEUR ═══════════════ -->
    <div class="rm-card rm-selector">
      <div class="rm-selector-grid">
        <div class="rm-field">
          <label class="rm-label">Type de rapport</label>
          <select v-model="selectedType" class="rm-select">
            <option value="rentree">Rapport de rentrée</option>
            <option value="fin_annee">Rapport de fin d'année</option>
          </select>
        </div>
        <div class="rm-field">
          <label class="rm-label">Année académique</label>
          <select v-model="selectedAnneeId" class="rm-select">
            <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
          </select>
        </div>
        <div class="rm-field rm-field--action">
          <button
            class="uc-btn uc-btn-primary rm-gen-btn"
            :disabled="generating || !selectedAnneeId"
            @click="generatePDF"
          >
            <svg v-if="generating" class="rm-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            {{ generating ? 'Génération...' : 'Générer le PDF' }}
          </button>
        </div>
      </div>
      <div v-if="error" class="uc-alert uc-alert-error" style="margin-top:10px;">{{ error }}</div>
    </div>

    <!-- ═══════════════════════════════════ NOTE ════════════════════ -->
    <div class="rm-card rm-info-card">
      <svg width="16" height="16" fill="none" stroke="#3b82f6" viewBox="0 0 24 24" style="flex-shrink:0;margin-top:1px;">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <p class="rm-info-text">
        Les informations de l'établissement (agrément, directeur, ministère de tutelle) se configurent dans
        <router-link to="/parametres" class="rm-link">Paramètres → Établissement</router-link>.
        Les données pédagogiques (étudiants, UE, formateurs) sont extraites automatiquement pour l'année sélectionnée.
      </p>
    </div>

    <div class="rm-two-col">

      <!-- ═══════════════════════════════ INFRASTRUCTURES ════════════ -->
      <div class="rm-card">
        <div class="rm-card-head">
          <h2 class="rm-card-title">Infrastructures & Équipements</h2>
          <button v-if="isDG" class="uc-btn uc-btn-primary rm-add-btn" @click="openInfraCreate">+ Ajouter</button>
        </div>

        <!-- Formulaire inline -->
        <div v-if="showInfraForm" class="rm-inline-form">
          <div class="rm-inline-form-grid">
            <div class="rm-field rm-field--full">
              <label class="rm-label">Désignation *</label>
              <input v-model="infraForm.designation" class="rm-input" placeholder="Ex: Salle informatique" />
            </div>
            <div class="rm-field">
              <label class="rm-label">Catégorie</label>
              <select v-model="infraForm.categorie" class="rm-select">
                <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
            <div class="rm-field">
              <label class="rm-label">Nombre</label>
              <input v-model.number="infraForm.nombre" type="number" min="1" class="rm-input" />
            </div>
            <div class="rm-field">
              <label class="rm-label">État</label>
              <select v-model="infraForm.etat" class="rm-select">
                <option v-for="e in etats" :key="e" :value="e">{{ e }}</option>
              </select>
            </div>
            <div class="rm-field">
              <label class="rm-label">Ordre</label>
              <input v-model.number="infraForm.ordre" type="number" min="0" class="rm-input" />
            </div>
          </div>
          <div class="rm-inline-form-actions">
            <button class="uc-btn uc-btn-outline" @click="showInfraForm = false">Annuler</button>
            <button class="uc-btn uc-btn-primary" :disabled="savingInfra" @click="saveInfra">
              {{ savingInfra ? 'Enregistrement...' : (editingInfraId ? 'Modifier' : 'Ajouter') }}
            </button>
          </div>
        </div>

        <div v-if="loadingInfra" class="rm-loading">Chargement...</div>
        <div v-else-if="infrastructures.length === 0" class="rm-empty">
          Aucune infrastructure enregistrée. Ajoutez les salles, équipements, etc.
        </div>
        <div v-else>
          <div v-for="(items, cat) in infraByCategorie" :key="cat" class="rm-cat-group">
            <div class="rm-cat-label">{{ cat }}</div>
            <div v-for="item in items" :key="item.id" class="rm-list-item">
              <span class="rm-item-name">{{ item.designation }}</span>
              <span class="rm-item-meta">× {{ item.nombre }}</span>
              <span class="rm-item-etat" :class="`rm-etat--${item.etat === 'Bon/Fonctionnel' ? 'bon' : item.etat === 'Moyen' ? 'moyen' : 'mauvais'}`">
                {{ item.etat }}
              </span>
              <div v-if="isDG" class="rm-item-actions">
                <button class="rm-icon-btn" title="Modifier" @click="openInfraEdit(item)">
                  <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                </button>
                <button class="rm-icon-btn rm-icon-btn--danger" title="Supprimer"
                  :disabled="deletingInfraId === item.id" @click="deleteInfra(item.id)">
                  <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════ MATÉRIELS ═══════════════════ -->
      <div class="rm-card">
        <div class="rm-card-head">
          <h2 class="rm-card-title">Matériels Pédagogiques</h2>
          <button v-if="isDG" class="uc-btn uc-btn-primary rm-add-btn" @click="openMatCreate">+ Ajouter</button>
        </div>

        <!-- Formulaire inline -->
        <div v-if="showMatForm" class="rm-inline-form">
          <div class="rm-inline-form-grid">
            <div class="rm-field rm-field--full">
              <label class="rm-label">Désignation *</label>
              <input v-model="matForm.designation" class="rm-input" placeholder="Ex: Ordinateurs portables" />
            </div>
            <div class="rm-field">
              <label class="rm-label">Nombre</label>
              <input v-model.number="matForm.nombre" type="number" min="1" class="rm-input" />
            </div>
            <div class="rm-field">
              <label class="rm-label">État</label>
              <select v-model="matForm.etat" class="rm-select">
                <option v-for="e in etats" :key="e" :value="e">{{ e }}</option>
              </select>
            </div>
            <div class="rm-field">
              <label class="rm-label">Ordre</label>
              <input v-model.number="matForm.ordre" type="number" min="0" class="rm-input" />
            </div>
          </div>
          <div class="rm-inline-form-actions">
            <button class="uc-btn uc-btn-outline" @click="showMatForm = false">Annuler</button>
            <button class="uc-btn uc-btn-primary" :disabled="savingMat" @click="saveMat">
              {{ savingMat ? 'Enregistrement...' : (editingMatId ? 'Modifier' : 'Ajouter') }}
            </button>
          </div>
        </div>

        <div v-if="loadingMat" class="rm-loading">Chargement...</div>
        <div v-else-if="materiels.length === 0" class="rm-empty">
          Aucun matériel enregistré. Ajoutez les équipements pédagogiques.
        </div>
        <div v-else>
          <div v-for="item in materiels" :key="item.id" class="rm-list-item">
            <span class="rm-item-name">{{ item.designation }}</span>
            <span class="rm-item-meta">× {{ item.nombre }}</span>
            <span class="rm-item-etat" :class="`rm-etat--${item.etat === 'Bon/Fonctionnel' ? 'bon' : item.etat === 'Moyen' ? 'moyen' : 'mauvais'}`">
              {{ item.etat }}
            </span>
            <div v-if="isDG" class="rm-item-actions">
              <button class="rm-icon-btn" title="Modifier" @click="openMatEdit(item)">
                <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                </svg>
              </button>
              <button class="rm-icon-btn rm-icon-btn--danger" title="Supprimer"
                :disabled="deletingMatId === item.id" @click="deleteMat(item.id)">
                <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

    </div><!-- /rm-two-col -->

  </div>
</template>

<style scoped>
.rm-page { padding: 24px; max-width: 1200px; margin: 0 auto; }

.rm-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; gap: 12px; }
.rm-title { font-size: 18px; font-weight: 700; color: #111; margin: 0; }
.rm-subtitle { font-size: 12px; color: #aaa; margin: 4px 0 0; }

.rm-card {
  background: #fff;
  border: 1px solid var(--border, #f0f0f0);
  border-radius: 8px;
  padding: 18px 20px;
  margin-bottom: 16px;
}

.rm-selector { margin-bottom: 12px; }
.rm-selector-grid { display: grid; grid-template-columns: 1fr 1fr auto; gap: 16px; align-items: flex-end; }
@media (max-width: 640px) { .rm-selector-grid { grid-template-columns: 1fr; } }

.rm-field { display: flex; flex-direction: column; gap: 5px; }
.rm-field--action { justify-content: flex-end; }
.rm-field--full { grid-column: 1 / -1; }
.rm-label { font-size: 11.5px; font-weight: 600; color: #555; }
.rm-select, .rm-input {
  height: 36px; border: 1px solid #e5e7eb; border-radius: 6px;
  padding: 0 10px; font-size: 13px; color: #111; background: #fff;
  outline: none;
}
.rm-select:focus, .rm-input:focus { border-color: var(--red, #E30613); }

.rm-gen-btn { height: 36px; gap: 7px; white-space: nowrap; }
.rm-spin { animation: rm-spin 0.8s linear infinite; }
@keyframes rm-spin { to { transform: rotate(360deg); } }

.rm-info-card { display: flex; gap: 10px; align-items: flex-start; background: #eff6ff; border-color: #bfdbfe; }
.rm-info-text { font-size: 12px; color: #374151; line-height: 1.6; margin: 0; }
.rm-link { color: var(--red, #E30613); text-decoration: none; font-weight: 600; }
.rm-link:hover { text-decoration: underline; }

.rm-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .rm-two-col { grid-template-columns: 1fr; } }

.rm-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.rm-card-title { font-size: 13px; font-weight: 700; color: #111; margin: 0; }
.rm-add-btn { height: 30px; font-size: 12px; padding: 0 12px; }

.rm-loading { text-align: center; padding: 20px; font-size: 13px; color: #aaa; }
.rm-empty { text-align: center; padding: 20px; font-size: 12.5px; color: #aaa; font-style: italic; }

.rm-cat-group { margin-bottom: 6px; }
.rm-cat-label { font-size: 10px; font-weight: 700; color: #aaa; text-transform: uppercase; letter-spacing: 0.06em; margin: 8px 0 4px; }

.rm-list-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 6px;
  background: #fafafa; border: 1px solid #f0f0f0;
  margin-bottom: 5px;
}
.rm-item-name { font-size: 13px; color: #111; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rm-item-meta { font-size: 12px; color: #888; white-space: nowrap; }
.rm-item-etat {
  font-size: 10.5px; font-weight: 600; padding: 2px 8px;
  border-radius: 99px; white-space: nowrap;
}
.rm-etat--bon { background: #dcfce7; color: #16a34a; }
.rm-etat--moyen { background: #fef9c3; color: #b45309; }
.rm-etat--mauvais { background: #fee2e2; color: #dc2626; }
.rm-item-actions { display: flex; gap: 4px; flex-shrink: 0; }
.rm-icon-btn {
  width: 26px; height: 26px; border: 1px solid #e5e7eb; border-radius: 5px;
  background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: #555; transition: background 0.15s, color 0.15s;
}
.rm-icon-btn:hover { background: #f3f4f6; color: #111; }
.rm-icon-btn--danger:hover { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }
.rm-icon-btn:disabled { opacity: 0.4; cursor: default; }

.rm-inline-form {
  background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 14px 16px; margin-bottom: 14px;
}
.rm-inline-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 500px) { .rm-inline-form-grid { grid-template-columns: 1fr; } }
.rm-inline-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
