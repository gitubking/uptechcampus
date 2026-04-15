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
const canDelete = computed(() => auth.user?.role === 'dg')

// ── Suppression étudiant ──────────────────────────────────────────────
const deleteTargetEtudiant = ref<Etudiant | null>(null)
const deleteStep = ref<1 | 2>(1)
const deletePreview = ref<any>(null)
const deletePreviewLoading = ref(false)
const confirmDeleteName = ref('')
const deletingEtudiant = ref(false)

async function openDeleteEtudiant(etudiant: Etudiant) {
  deleteTargetEtudiant.value = etudiant
  deleteStep.value = 1
  deletePreview.value = null
  confirmDeleteName.value = ''
  deletingEtudiant.value = false
  // Charger le bilan immédiatement
  deletePreviewLoading.value = true
  try {
    const { data } = await api.get(`/etudiants/${etudiant.id}/deletion-preview`)
    deletePreview.value = data
  } catch {
    deletePreview.value = null
  } finally {
    deletePreviewLoading.value = false
  }
}

async function confirmDeleteEtudiant() {
  if (!deleteTargetEtudiant.value) return
  deletingEtudiant.value = true
  try {
    await api.delete(`/etudiants/${deleteTargetEtudiant.value.id}`)
    deleteTargetEtudiant.value = null
    await fetchEtudiants()
  } catch (err: any) {
    alert(err?.response?.data?.message || 'Erreur lors de la suppression')
  } finally {
    deletingEtudiant.value = false
  }
}

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
  date_naissance: string | null
  lieu_naissance: string | null
  adresse: string | null
  cni_numero: string | null
  nom_parent: string | null
  telephone_parent: string | null
  inscription_active: InscriptionActive | null
}

interface Pagination {
  data: Etudiant[]
  current_page: number
  last_page: number
  total: number
}

interface TypeFormation { id: number; nom: string; code: string; est_individuel?: boolean }
interface Filiere {
  id: number; nom: string; code: string
  type_formation_id: number | null
  frais_inscription: number; mensualite: number; duree_mois: number | null
}
interface NiveauEntree { id: number; nom: string; code: string; est_superieur_bac: boolean; actif: boolean }
interface NiveauBourse { id: number; nom: string; pourcentage: number; applique_inscription: boolean; actif: boolean }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }

// ── Risque d'abandon ─────────────────────────────────────────────────
interface RisqueRow {
  etudiant_id: number
  risque_global: 'red' | 'yellow' | 'green'
  risque_presence: 'red' | 'yellow' | 'green'
  taux_presence: number | null
  presences_count: number
  total_seances: number
  risque_paiement: 'red' | 'yellow' | 'green'
  jours_retard: number | null
  risque_dossier: 'red' | 'yellow' | 'green'
  docs_recu: number
  total_docs: number
}
const risques = ref<Record<number, RisqueRow>>({})
const risqueFiltre = ref<'' | 'red' | 'yellow' | 'green'>('')

async function loadRisques() {
  try {
    const { data } = await api.get('/etudiants/risques')
    const map: Record<number, RisqueRow> = {}
    for (const r of data) map[r.etudiant_id] = r
    risques.value = map
  } catch { /* silencieux */ }
}

const risqueCounts = computed(() => {
  const vals = Object.values(risques.value)
  return {
    red: vals.filter(r => r.risque_global === 'red').length,
    yellow: vals.filter(r => r.risque_global === 'yellow').length,
    green: vals.filter(r => r.risque_global === 'green').length,
  }
})

const etudiantsFiltres = computed(() => {
  if (!risqueFiltre.value) return pagination.value.data
  return pagination.value.data.filter(e => {
    const r = risques.value[(e as any).id]
    return r?.risque_global === risqueFiltre.value
  })
})

// ── Liste étudiants ──────────────────────────────────────────────────
const pagination = ref<Pagination>({ data: [], current_page: 1, last_page: 1, total: 0 })
const loading = ref(false)
const search = ref('')
const page = ref(1)
// ── Filtres tableau ──────────────────────────────────────────────────
const filterTypeId    = ref<number | ''>('')
const filterFiliereId = ref<number | ''>('')
const filterClasseId  = ref<number | ''>('')
const filterAnneeId   = ref<number | ''>('')

async function fetchEtudiants() {
  loading.value = true
  try {
    const { data } = await api.get('/etudiants', {
      params: {
        search: search.value || undefined,
        page: page.value,
        type_formation_id: filterTypeId.value || undefined,
        filiere_id: filterFiliereId.value || undefined,
        classe_id: filterClasseId.value || undefined,
        annee_academique_id: filterAnneeId.value || undefined,
      },
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
watch([filterTypeId, filterFiliereId, filterClasseId, filterAnneeId], () => { page.value = 1; fetchEtudiants() })

// ── Statuts ───────────────────────────────────────────────────────────
const statutLabel: Record<string, string> = {
  inscrit_actif: 'Actif', pre_inscrit: 'Pré-inscrit', en_examen: 'En examen',
  diplome: 'Diplômé', abandonne: 'Abandonné', suspendu: 'Suspendu',
}
const motifAbandonLabels: Record<string, string> = {
  raisons_financieres: 'Raisons financières',
  raisons_personnelles: 'Raisons personnelles',
  reorientation: 'Réorientation',
  demenagement: 'Déménagement',
  sante: 'Problème de santé',
  emploi: 'Reprise d\'emploi',
  exclusion: 'Exclusion disciplinaire',
  autre: 'Autre',
}
function motifAbandonLabel(motif: string) { return motifAbandonLabels[motif] ?? motif }
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
const allClasses = ref<{ id: number; nom: string; filiere?: { id: number; type_formation_id: number | null } | null }[]>([])
const refsLoaded = ref(false)

const filteredFilieresList = computed(() =>
  filterTypeId.value
    ? filieres.value.filter(f => f.type_formation_id === filterTypeId.value)
    : filieres.value
)
const filteredClassesList = computed(() => {
  let list = allClasses.value
  if (filterFiliereId.value) list = list.filter(c => c.filiere?.id === filterFiliereId.value)
  else if (filterTypeId.value) list = list.filter(c => c.filiere?.type_formation_id === filterTypeId.value)
  return list
})
function onFilterTypeChange() { filterFiliereId.value = ''; filterClasseId.value = '' }
function onFilterFiliereChange() { filterClasseId.value = '' }

async function loadRefs() {
  if (refsLoaded.value) return
  const [f, ne, nb, a, t, cl, matRes, ensRes] = await Promise.all([
    api.get('/filieres'),
    api.get('/niveaux-entree'),
    api.get('/niveaux-bourse'),
    api.get('/annees-academiques'),
    api.get('/types-formation'),
    api.get('/classes'),
    api.get('/matieres'),
    api.get('/enseignants'),
  ])
  filieres.value = f.data
  niveauxEntree.value = (ne.data ?? []).filter((n: NiveauEntree) => n.actif)
  niveauxBourse.value = (nb.data ?? []).filter((b: NiveauBourse) => b.actif)
  annees.value = a.data
  typesFormation.value = t.data
  allClasses.value = cl.data
  fiMatieres.value = matRes.data
  fiEnseignants.value = ensRes.data?.data ?? ensRes.data
  refsLoaded.value = true
}

// ── Tirage de cartes étudiants ────────────────────────────────────────
const showCartes = ref(false)
const carteFiliereId = ref<number | ''>('')
const carteClasseId = ref<number | ''>('')
const carteSearch = ref('')
const cartesLoading = ref(false)
const cartesEtudiants = ref<Etudiant[]>([])
const cartesSelected = ref<Set<number>>(new Set())
const cartesPrinting = ref(false)
const cartesPrintProgress = ref(0)

const carteFilteredFilieres = computed(() => filieres.value)
const carteFilteredClasses = computed(() => {
  if (!carteFiliereId.value) return allClasses.value
  return allClasses.value.filter(c => c.filiere?.id === carteFiliereId.value)
})

function onCarteFiliereChange() { carteClasseId.value = '' }

async function openCartes() {
  showCartes.value = true
  carteFiliereId.value = ''
  carteClasseId.value = ''
  carteSearch.value = ''
  cartesSelected.value = new Set()
  await fetchCartesEtudiants()
}

async function fetchCartesEtudiants() {
  cartesLoading.value = true
  try {
    const params: any = { per_page: 200 }
    if (carteSearch.value) params.search = carteSearch.value
    if (carteFiliereId.value) params.filiere_id = carteFiliereId.value
    if (carteClasseId.value) params.classe_id = carteClasseId.value
    const { data } = await api.get('/etudiants', { params })
    // Ne garder que les étudiants actifs avec une classe affectée
    cartesEtudiants.value = data.data.filter((e: Etudiant) =>
      e.inscription_active?.statut === 'inscrit_actif' && e.inscription_active?.classe?.id
    )
  } finally {
    cartesLoading.value = false
  }
}

let carteSearchTimer: ReturnType<typeof setTimeout>
watch([carteSearch], () => {
  clearTimeout(carteSearchTimer)
  carteSearchTimer = setTimeout(fetchCartesEtudiants, 350)
})
watch([carteFiliereId, carteClasseId], fetchCartesEtudiants)

const cartesATirer = computed(() => {
  if (cartesSelected.value.size === 0) return cartesEtudiants.value
  return cartesEtudiants.value.filter(e => cartesSelected.value.has(e.id))
})

function toggleCarteSelect(id: number) {
  const s = new Set(cartesSelected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  cartesSelected.value = s
}

function selectAllCartes() {
  if (cartesSelected.value.size === cartesEtudiants.value.length) {
    cartesSelected.value = new Set()
  } else {
    cartesSelected.value = new Set(cartesEtudiants.value.map(e => e.id))
  }
}

// ── Logo UPTECH (même base64 que EtudiantDetailView) ──
const UPTECH_LOGO = 'data:image/png;base64,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'

// Fonctions de dessin carte (identiques à EtudiantDetailView)
function cardDrawImage(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number): Promise<void> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const ratio = Math.max(w / img.width, h / img.height)
      const sw = img.width * ratio, sh = img.height * ratio
      ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh)
      resolve()
    }
    img.onerror = () => resolve()
    img.src = src
  })
}

function cardLoadLogo(ctx: CanvasRenderingContext2D, x: number, y: number, height: number): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const ratio = height / img.height
      ctx.drawImage(img, x, y, img.width * ratio, height)
      resolve(true)
    }
    img.onerror = () => resolve(false)
    img.src = UPTECH_LOGO
  })
}

function cardDrawUptechLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const lw = Math.round(size * 0.075)
  const r = (size - lw * 2) / 2 - 2
  const cx = x + size / 2, cy = y + size / 2
  const rr = Math.round(size * 0.18)
  ctx.strokeStyle = '#E30613'; ctx.lineWidth = lw
  const half = lw / 2
  ctx.beginPath()
  ctx.moveTo(x + rr, y + half); ctx.lineTo(x + size - rr, y + half)
  ctx.quadraticCurveTo(x + size - half, y + half, x + size - half, y + rr)
  ctx.lineTo(x + size - half, y + size - rr)
  ctx.quadraticCurveTo(x + size - half, y + size - half, x + size - rr, y + size - half)
  ctx.lineTo(x + rr, y + size - half)
  ctx.quadraticCurveTo(x + half, y + size - half, x + half, y + size - rr)
  ctx.lineTo(x + half, y + rr)
  ctx.quadraticCurveTo(x + half, y + half, x + rr, y + half)
  ctx.closePath(); ctx.stroke()
  // Quadrants
  ctx.fillStyle = '#E30613'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, Math.PI, -Math.PI / 2, false); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#111111'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, -Math.PI / 2, 0, false); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#E30613'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, 0, Math.PI / 2, false); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#111111'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, Math.PI / 2, Math.PI, false); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r * 0.52, Math.PI / 2, Math.PI, false); ctx.closePath(); ctx.fill()
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = size * 0.04
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke()
  ctx.restore()
}

function cardRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}

async function generateOneCard(etudiantDetail: any): Promise<string> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const W = 856, H = 540, PW = 1010, PH = 638
  canvas.width = PW; canvas.height = PH
  ctx.scale(PW / W, PH / H)

  const insc0 = etudiantDetail.inscriptions?.[0]
  const filiere = insc0?.filiere?.nom ?? insc0?.classe?.filiere?.nom ?? ''
  const classe = insc0?.classe
  const classeNom = classe?.nom ?? '—'
  const classeNiveau = classe?.niveau ?? 1
  const hasNiveau0 = !!((insc0?.filiere as any)?.type_has_niveau ?? (insc0?.classe?.filiere as any)?.type_has_niveau ?? false)

  // 1. Fond blanc
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)

  // 2. Barre noire en bas
  const barH = 55
  ctx.fillStyle = '#111111'; ctx.fillRect(0, H - barH, W, barH)
  ctx.fillStyle = '#ffffff'
  const barText = "Institut supérieur de formation aux nouveaux métiers de l'Informatique et de la Communication"
  let barFontSize = 22
  ctx.font = `${barFontSize}px Arial`
  while (ctx.measureText(barText).width > W - 24 && barFontSize > 10) { barFontSize--; ctx.font = `${barFontSize}px Arial` }
  ctx.textAlign = 'center'
  ctx.fillText(barText, W / 2, H - barH + Math.round(barH / 2) + barFontSize / 3)
  ctx.textAlign = 'left'

  // 3. Colonne gauche
  const mainH = H - barH, pad = 18, leftColW = 278
  ctx.fillStyle = '#111111'; ctx.font = 'bold 24px Arial'
  ctx.fillText("CARTE D'ETUDIANT", pad, 45)

  const annee = insc0?.annee_academique?.libelle ?? ''
  ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'
  ctx.fillText(annee, pad + leftColW / 2, 80); ctx.textAlign = 'left'

  const leftCenterX = pad + leftColW / 2
  ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(leftCenterX - 80, 92); ctx.lineTo(leftCenterX + 80, 92); ctx.stroke()

  // Photo
  const photoX = pad, photoY = 100, photoW = 206, photoH = mainH - 110
  ctx.strokeStyle = '#444444'; ctx.lineWidth = 1.5; ctx.strokeRect(photoX, photoY, photoW, photoH)
  if (etudiantDetail.photo_path?.startsWith('data:')) {
    await cardDrawImage(ctx, etudiantDetail.photo_path, photoX + 1, photoY + 1, photoW - 2, photoH - 2)
  } else {
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(photoX + 1, photoY + 1, photoW - 2, photoH - 2)
    ctx.fillStyle = '#999'; ctx.font = 'bold 60px Arial'; ctx.textAlign = 'center'
    ctx.fillText(`${etudiantDetail.prenom[0]}${etudiantDetail.nom[0]}`.toUpperCase(), photoX + photoW / 2, photoY + photoH / 2 + 22)
    ctx.textAlign = 'left'
  }

  // 4. Bande verticale diagonale
  const stripeX = leftColW + pad + 4, stripeW = 44, sh = 15
  ctx.save(); ctx.beginPath(); ctx.rect(stripeX, 0, stripeW, mainH); ctx.clip()
  for (let y = -(stripeW * 2); y < mainH + stripeW * 2; y += sh * 2) {
    ctx.fillStyle = '#E30613'; ctx.beginPath()
    ctx.moveTo(stripeX, y + stripeW); ctx.lineTo(stripeX + stripeW, y); ctx.lineTo(stripeX + stripeW, y + sh); ctx.lineTo(stripeX, y + stripeW + sh)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#111111'; ctx.beginPath()
    ctx.moveTo(stripeX, y + stripeW + sh); ctx.lineTo(stripeX + stripeW, y + sh); ctx.lineTo(stripeX + stripeW, y + sh * 2); ctx.lineTo(stripeX, y + stripeW + sh * 2)
    ctx.closePath(); ctx.fill()
  }
  ctx.restore()

  // 5. Colonne droite
  const rightX = stripeX + stripeW + 14
  const logoH = 84
  const logoLoaded = await cardLoadLogo(ctx, rightX, pad, logoH)
  if (!logoLoaded) {
    const logoSize = 78
    cardDrawUptechLogo(ctx, rightX, pad, logoSize)
    ctx.fillStyle = '#111111'; ctx.font = 'bold 34px Arial'
    const uptechW2 = ctx.measureText("UP'TECH").width
    ctx.fillText("UP'TECH", rightX + logoSize + 10, pad + logoSize * 0.68)
    ctx.fillStyle = '#E30613'; ctx.fillRect(rightX, pad + logoSize + 6, logoSize + 12 + uptechW2, 4)
  }

  // Infos étudiant
  let iy = pad + logoH + 32
  const ifields = [
    { label: 'Prénom (s) : ', value: etudiantDetail.prenom },
    { label: 'Nom : ', value: etudiantDetail.nom.toUpperCase() },
    { label: 'Filière : ', value: filiere || '—' },
    ...(hasNiveau0 ? [{ label: "Niveau d'études : ", value: classeNiveau === 1 ? '1ère Année' : `${classeNiveau}ème Année` }] : []),
    { label: 'Classe : ', value: classeNom },
    { label: 'Matricule : ', value: etudiantDetail.numero_etudiant },
  ]
  ifields.forEach((f) => {
    ctx.font = 'bold 18px Arial'; ctx.fillStyle = '#111111'
    const lw2 = ctx.measureText(f.label).width
    ctx.fillText(f.label, rightX, iy)
    ctx.font = '18px Arial'; ctx.fillText(f.value, rightX + lw2, iy)
    iy += 26
  })

  // Coordonnées
  const contacts = [
    { icon: '◦', text: ' Sicap Amitié 1, Villa N° 3031' },
    { icon: '◦', text: ' 33 821 34 25 / 77 841 50 44' },
    { icon: '✉', text: ' uptechformation@gmail.com' },
    { icon: '◦', text: ' www.uptechformation.com' },
  ]
  const cY = mainH - (contacts.length * 26) - 10
  contacts.forEach((c, i) => {
    ctx.font = '18px Arial'; ctx.fillStyle = '#333333'
    ctx.fillText(c.icon + c.text, rightX, cY + i * 26)
  })

  // Séparateur
  ctx.strokeStyle = '#bbbbbb'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(rightX, cY - 24); ctx.lineTo(W - pad, cY - 24); ctx.stroke()

  // QR Code
  try {
    const QRCode = (await import('qrcode')).default
    const verifyUrl = `${window.location.origin}/verify/${etudiantDetail.numero_etudiant}`
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 120, margin: 1, color: { dark: '#111111', light: '#ffffff' } })
    const qrSize = 102, qrX = W - pad - qrSize - 6, qrY = cY - 4
    await cardDrawImage(ctx, qrDataUrl, qrX, qrY, qrSize, qrSize)
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.strokeRect(qrX, qrY, qrSize, qrSize)
    ctx.fillStyle = '#999999'; ctx.font = '11px Arial'; ctx.textAlign = 'center'
    ctx.fillText('Scanner pour vérifier', qrX + qrSize / 2, qrY + qrSize + 14); ctx.textAlign = 'left'
  } catch { /* QR optionnel */ }

  // Bordure arrondie
  ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 2
  cardRoundRect(ctx, 1, 1, W - 2, H - 2, 18); ctx.stroke()

  return canvas.toDataURL('image/png')
}

async function imprimerCartes() {
  const list = cartesATirer.value
  if (!list.length) return
  cartesPrinting.value = true
  cartesPrintProgress.value = 0

  const images: string[] = []
  for (let i = 0; i < list.length; i++) {
    cartesPrintProgress.value = i + 1
    try {
      const { data: detail } = await api.get(`/etudiants/${list[i]!.id}`)
      const dataUrl = await generateOneCard(detail)
      images.push(dataUrl)
    } catch { /* skip si erreur */ }
  }

  cartesPrinting.value = false

  const printWin = window.open('', '_blank')
  if (!printWin) return
  const imgsHtml = images.map(src => `<img src="${src}" class="card-img" />`).join('')
  printWin.document.write(`<!DOCTYPE html><html><head><title>Cartes Étudiants</title><style>
    @page { margin: 8mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #f5f5f5; }
    .cards { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; padding: 10px; }
    .card-img { width: 85.6mm; height: auto; page-break-inside: avoid; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
    @media print {
      body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .card-img { box-shadow: none; }
    }
  </style></head><body><div class="cards">${imgsHtml}</div><script>window.onload=function(){window.print()}<\/script></body></html>`)
  printWin.document.close()
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
  mois_debut: '',
})

// ── Formation individuelle (à la carte) ──────────────────────────────
const isSelectedTypeIndividuel = computed(() => {
  if (!selectedType.value) return false
  return typesFormation.value.find(t => t.id === selectedType.value)?.est_individuel ?? false
})
const fiForm = ref({
  cout_total: 0,
  pct_inscription: 50,
  pct_formateur: 50,
  date_debut: '',
  date_fin: '',
  modules: [{ matiere_id: null as number | null, volume_horaire: 0, enseignant_id: null as number | null }] as { matiere_id: number | null; volume_horaire: number; enseignant_id: number | null }[]
})
const fiMontantInscription = computed(() => Math.round(fiForm.value.cout_total * fiForm.value.pct_inscription / 100))
const fiMontantSolde = computed(() => fiForm.value.cout_total - fiMontantInscription.value)
const fiTotalHeures = computed(() => fiForm.value.modules.reduce((s, m) => s + (m.volume_horaire || 0), 0))
function fiAddModule() { fiForm.value.modules.push({ matiere_id: null, volume_horaire: 0, enseignant_id: null }) }
function fiRemoveModule(i: number) { if (fiForm.value.modules.length > 1) fiForm.value.modules.splice(i, 1) }
const fiEnseignants = ref<{ id: number; nom: string; prenom: string }[]>([])
const fiMatieres = ref<{ id: number; nom: string }[]>([])

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
  mensualite: 0,
  frais_inscription: 0,
  mois_debut: '',
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
    frais_tenue: 0, statut: 'inscrit_actif', mois_debut: '',
  }
  fiForm.value = {
    cout_total: 0, pct_inscription: 50, pct_formateur: 50,
    date_debut: new Date().toISOString().slice(0, 10), date_fin: '',
    modules: [{ matiere_id: null, volume_horaire: 0, enseignant_id: null }]
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
    telephone: etudiant.telephone ?? '',
    date_naissance: etudiant.date_naissance ? etudiant.date_naissance.substring(0, 10) : '',
    lieu_naissance: etudiant.lieu_naissance ?? '',
    adresse: etudiant.adresse ?? '',
    cni_numero: etudiant.cni_numero ?? '',
    nom_parent: etudiant.nom_parent ?? '',
    telephone_parent: etudiant.telephone_parent ?? '',
  }
  showPanel.value = true
}

async function openGererInscription(etudiant: Etudiant) {
  panelMode.value = 'gerer-inscription'
  panelError.value = ''
  currentEtudiant.value = etudiant
  currentInscription.value = null
  showPanel.value = true
  await loadRefs()
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

    // 2. Créer l'inscription (classique ou individuelle)
    let inscription: any
    if (isSelectedTypeIndividuel.value) {
      // Formation individuelle → créer via /formations-individuelles
      const { data: fi } = await api.post('/formations-individuelles', {
        etudiant_id: etudiant.id,
        type_formation_id: selectedType.value,
        annee_academique_id: inscriptionForm.value.annee_academique_id,
        cout_total: fiForm.value.cout_total,
        pct_inscription: fiForm.value.pct_inscription,
        pct_formateur: fiForm.value.pct_formateur,
        date_debut: fiForm.value.date_debut || undefined,
        date_fin: fiForm.value.date_fin || undefined,
        modules: fiForm.value.modules.filter(m => m.matiere_id),
      })
      inscription = {
        ...fi,
        type: 'individuelle',
        filiere: { nom: 'Formation individuelle' },
        frais_inscription: fiMontantInscription.value,
        mensualite: 0,
        frais_tenue: 0,
        statut: inscriptionForm.value.statut,
      }
    } else {
      // Inscription classique
      const { data } = await api.post('/inscriptions', {
        etudiant_id: etudiant.id,
        filiere_id: inscriptionForm.value.filiere_id,
        niveau_entree_id: inscriptionForm.value.niveau_entree_id,
        niveau_bourse_id: inscriptionForm.value.niveau_bourse_id || null,
        annee_academique_id: inscriptionForm.value.annee_academique_id,
        frais_inscription: fraisInscriptionPrevu.value ?? 0,
        mensualite: mensualitePrevu.value ?? 0,
        frais_tenue: inscriptionForm.value.frais_tenue || 0,
        statut: inscriptionForm.value.statut,
        mois_debut: inscriptionForm.value.mois_debut || undefined,
      })
      inscription = data
    }

    // 3. Stocker les données pour la fiche + passer à l'étape succès
    lastCreatedData.value = {
      etudiant: { ...studentForm.value, ...etudiant },
      insc: {
        ...inscription,
        filiere: isSelectedTypeIndividuel.value
          ? { nom: 'Formation individuelle' }
          : (selectedFiliereObj.value ? { nom: selectedFiliereObj.value.nom } : inscription?.filiere),
        niveau_entree: niveauxEntree.value.find(n => n.id === inscriptionForm.value.niveau_entree_id) ?? inscription?.niveau_entree,
        niveau_bourse: niveauxBourse.value.find(b => b.id === inscriptionForm.value.niveau_bourse_id) ?? null,
        frais_inscription: isSelectedTypeIndividuel.value ? fiMontantInscription.value : (fraisInscriptionPrevu.value ?? inscription?.frais_inscription),
        mensualite: isSelectedTypeIndividuel.value ? 0 : (mensualitePrevu.value ?? inscription?.mensualite),
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

// ── Abandon workflow ─────────────────────────────────────────────────────
const showAbandonForm = ref(false)
const abandonForm = ref({
  date_abandon: new Date().toISOString().substring(0, 10),
  motif_abandon: '',
})

async function changerStatut(statut: string) {
  if (!currentInscription.value) return
  // Si abandon → afficher le formulaire de motif
  if (statut === 'abandonne') {
    showAbandonForm.value = true
    return
  }
  updatingStatut.value = true
  try {
    await api.put(`/inscriptions/${currentInscription.value.id}/statut`, { statut })
    currentInscription.value.statut = statut
    showAbandonForm.value = false
    fetchEtudiants()
  } catch (err: any) {
    panelError.value = err.response?.data?.message ?? 'Erreur lors du changement de statut.'
  } finally {
    updatingStatut.value = false
  }
}

async function confirmerAbandon() {
  if (!currentInscription.value) return
  if (!confirm('Confirmer l\'abandon de cet étudiant ? Son inscription sera marquée comme abandonnée.')) return
  updatingStatut.value = true
  try {
    await api.put(`/inscriptions/${currentInscription.value.id}/statut`, {
      statut: 'abandonne',
      date_abandon: abandonForm.value.date_abandon,
      motif_abandon: abandonForm.value.motif_abandon || null,
    })
    currentInscription.value.statut = 'abandonne'
    showAbandonForm.value = false
    panelError.value = '' // clear error
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
  const insc = currentInscription.value as any
  // Trouver le type de formation depuis la filière
  const filiereId = insc.filiere?.id ?? insc.filiere_id ?? null
  const f = filieres.value.find(f => f.id === filiereId)
  inscriptionEditType.value = f?.type_formation_id ?? null
  inscriptionEditForm.value = {
    filiere_id: filiereId,
    niveau_entree_id: insc.niveau_entree?.id ?? insc.niveau_entree_id ?? null,
    niveau_bourse_id: insc.niveau_bourse?.id ?? insc.niveau_bourse_id ?? null,
    annee_academique_id: insc.annee_academique?.id ?? insc.annee_academique_id ?? null,
    frais_tenue: insc.frais_tenue ?? 0,
    mensualite: Number(f?.mensualite ?? insc.mensualite ?? 0),
    frais_inscription: Number(f?.frais_inscription ?? insc.frais_inscription ?? 0),
    mois_debut: insc.mois_debut ? insc.mois_debut.substring(0, 7) : '',
  }
  editingInscription.value = true
}

async function submitEditInscription() {
  if (!currentInscription.value) return
  savingInscription.value = true
  panelError.value = ''
  try {
    const cur = currentInscription.value as any
    const editFiliere = filieres.value.find(f => f.id === inscriptionEditForm.value.filiere_id)
    const editBourse = niveauxBourse.value.find(b => b.id === inscriptionEditForm.value.niveau_bourse_id)
    // On stocke les montants tels que saisis par l'utilisateur (tarifs de base).
    // La réduction bourse est appliquée uniquement par genererEcheances côté serveur.
    const newMensualite = Number(inscriptionEditForm.value.mensualite)
    const newFraisInsc = Number(inscriptionEditForm.value.frais_inscription)
    const { data } = await api.put(`/inscriptions/${cur.id}`, {
      ...inscriptionEditForm.value,
      mois_debut: inscriptionEditForm.value.mois_debut || undefined,
      statut: cur.statut,
      frais_inscription: newFraisInsc,
      mensualite: newMensualite,
      classe_id: cur.classe?.id ?? cur.classe_id ?? null,
      parcours_id: cur.parcours?.id ?? cur.parcours_id ?? null,
    })
    // Update local state from form objects (PUT returns raw row without joins)
    const editAnnee = annees.value.find(a => a.id === inscriptionEditForm.value.annee_academique_id)
    const editNiveau = niveauxEntree.value.find(n => n.id === inscriptionEditForm.value.niveau_entree_id)
    currentInscription.value = {
      ...currentInscription.value,
      filiere: editFiliere ? { id: editFiliere.id, nom: editFiliere.nom, code: editFiliere.code } : null,
      niveau_entree: editNiveau ? { id: editNiveau.id, nom: editNiveau.nom } : null,
      niveau_bourse: editBourse ? { id: editBourse.id, nom: editBourse.nom, pourcentage: editBourse.pourcentage } : null,
      annee_academique: editAnnee ? { id: editAnnee.id, libelle: editAnnee.libelle } : (currentInscription.value as any).annee_academique,
      frais_inscription: newFraisInsc,
      mensualite: newMensualite,
      frais_tenue: inscriptionEditForm.value.frais_tenue,
    } as any
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

// ── Vue mode (table / cartes) ─────────────────────────────────────────
const viewMode = ref<'table' | 'card'>('table')

// ── Stats rapides ─────────────────────────────────────────────────────
const quickStats = computed(() => {
  const all = pagination.value.data
  return {
    actifs:      all.filter(e => e.inscription_active?.statut === 'inscrit_actif').length,
    preInscrits: all.filter(e => e.inscription_active?.statut === 'pre_inscrit').length,
    enExamen:    all.filter(e => e.inscription_active?.statut === 'en_examen').length,
    nonInscrits: all.filter(e => !e.inscription_active).length,
  }
})

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
  { key: 'type_formation', label: 'Type de formation' },
  { key: 'filiere', label: 'Filière / Parcours' },
  { key: 'niveau_entree', label: 'Niveau d\'entrée' },
  { key: 'classe', label: 'Classe' },
  { key: 'statut', label: 'Statut' },
  { key: 'actions', label: 'Actions' },
]

function getTypeFormation(filiereId: number | null | undefined): string {
  if (!filiereId) return '—'
  const fil = filieres.value.find(f => f.id === filiereId)
  if (!fil?.type_formation_id) return '—'
  return typesFormation.value.find(t => t.id === fil.type_formation_id)?.nom ?? '—'
}

onMounted(() => {
  fetchEtudiants()
  loadRefs()
  loadRisques()
})
</script>

<template>
  <div class="uc-content">

    <!-- ══ HERO ══ -->
    <div class="et-hero">
      <div class="et-hero-glow"></div>
      <div class="et-hero-content">
        <div class="et-hero-left">
          <div class="et-hero-icon">🎓</div>
          <div>
            <h1 class="et-hero-title">Étudiants</h1>
            <p class="et-hero-sub">{{ loading ? '…' : `${pagination.total} étudiant${pagination.total !== 1 ? 's' : ''} enregistrés` }}</p>
          </div>
        </div>
        <div class="et-hero-kpis">
          <div class="et-hkpi et-hkpi--green" @click="risqueFiltre='';filterTypeId='';filterFiliereId='';filterClasseId=''">
            <div class="et-hkpi-val">{{ loading ? '…' : quickStats.actifs }}</div>
            <div class="et-hkpi-lbl">Actifs</div>
          </div>
          <div class="et-hkpi et-hkpi--blue">
            <div class="et-hkpi-val">{{ loading ? '…' : quickStats.preInscrits }}</div>
            <div class="et-hkpi-lbl">Pré-inscrits</div>
          </div>
          <div class="et-hkpi et-hkpi--yellow">
            <div class="et-hkpi-val">{{ loading ? '…' : quickStats.enExamen }}</div>
            <div class="et-hkpi-lbl">En examen</div>
          </div>
          <div class="et-hkpi et-hkpi--red" @click="risqueFiltre='red'">
            <div class="et-hkpi-val">{{ risqueCounts.red }}</div>
            <div class="et-hkpi-lbl">À risque</div>
          </div>
        </div>
        <div class="et-hero-actions">
          <button @click="openCartes" class="et-action-btn et-action-btn--ghost">
            🪪 Cartes étudiants
          </button>
          <button @click="$router.push('/dossiers-etudiants')" class="et-action-btn et-action-btn--ghost">
            📋 Dossiers
          </button>
          <a href="/formations-individuelles" class="et-action-btn et-action-btn--ghost" style="text-decoration:none;">
            🎓 Formations individuelles
          </a>
          <button v-if="canWrite" @click="openInscrire" class="et-action-btn et-action-btn--primary">
            + Nouvel étudiant
          </button>
        </div>
      </div>
    </div>

    <!-- ══ TOOLBAR ══ -->
    <div class="et-toolbar">
      <div class="et-toolbar-search">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#bbb;flex-shrink:0;">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input v-model="search" type="text" placeholder="Rechercher par nom, prénom ou N°…" class="et-search-input" />
        <button v-if="search" @click="search=''" class="et-search-clear">✕</button>
      </div>
      <div class="et-toolbar-filters">
        <select v-model="filterAnneeId" class="et-select" style="font-weight:600;color:#E30613;">
          <option value="">Toutes les années</option>
          <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}{{ a.actif ? ' ✓' : '' }}</option>
        </select>
        <select v-model="filterTypeId" @change="onFilterTypeChange" class="et-select">
          <option value="">Tous les types</option>
          <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }}</option>
        </select>
        <select v-model="filterFiliereId" @change="onFilterFiliereChange" class="et-select">
          <option value="">Toutes les filières</option>
          <option v-for="f in filteredFilieresList" :key="f.id" :value="f.id">{{ f.nom }}</option>
        </select>
        <select v-model="filterClasseId" class="et-select">
          <option value="">Toutes les classes</option>
          <option v-for="c in filteredClassesList" :key="c.id" :value="c.id">{{ c.nom }}</option>
        </select>
        <button v-if="filterAnneeId || filterTypeId || filterFiliereId || filterClasseId"
          @click="filterAnneeId=''; filterTypeId=''; filterFiliereId=''; filterClasseId=''"
          class="et-btn-clear">✕ Effacer</button>
      </div>
      <div class="et-toolbar-right">
        <!-- Filtres risque -->
        <div class="et-rq-pills">
          <button @click="risqueFiltre = ''" :class="['rq-btn', risqueFiltre === '' && 'rq-btn--active']">Tous</button>
          <button @click="risqueFiltre = 'red'" :class="['rq-btn','rq-btn--red', risqueFiltre === 'red' && 'rq-btn--active']">
            🔴 <span v-if="risqueCounts.red" class="rq-count">{{ risqueCounts.red }}</span>
          </button>
          <button @click="risqueFiltre = 'yellow'" :class="['rq-btn','rq-btn--yellow', risqueFiltre === 'yellow' && 'rq-btn--active']">
            🟡 <span v-if="risqueCounts.yellow" class="rq-count">{{ risqueCounts.yellow }}</span>
          </button>
          <button @click="risqueFiltre = 'green'" :class="['rq-btn','rq-btn--green', risqueFiltre === 'green' && 'rq-btn--active']">
            🟢 <span v-if="risqueCounts.green" class="rq-count">{{ risqueCounts.green }}</span>
          </button>
        </div>
        <!-- Toggle vue -->
        <div class="et-view-toggle">
          <button :class="['et-view-btn', viewMode==='table' && 'et-view-btn--active']" @click="viewMode='table'" title="Vue tableau">
            ☰
          </button>
          <button :class="['et-view-btn', viewMode==='card' && 'et-view-btn--active']" @click="viewMode='card'" title="Vue cartes">
            ⊞
          </button>
        </div>
      </div>
    </div>

    <!-- Bannière alerte risque élevé -->
    <div v-if="risqueCounts.red > 0 && !risqueFiltre" class="rq-banner">
      ⚠️ <strong>{{ risqueCounts.red }} étudiant{{ risqueCounts.red > 1 ? 's' : '' }}</strong>
      en situation de risque élevé —
      <button @click="risqueFiltre = 'red'" class="rq-banner-link">Voir</button>
    </div>

    <!-- ══ VUE CARTES ══ -->
    <div v-if="viewMode === 'card'" class="et-cards-grid">
      <div v-if="loading" class="et-cards-loading">Chargement…</div>
      <div v-else-if="!etudiantsFiltres.length" class="et-cards-empty">
        <span style="font-size:36px;">📭</span>
        <p>Aucun étudiant trouvé</p>
      </div>
      <template v-else>
        <div v-for="etudiant in etudiantsFiltres" :key="(etudiant as any).id"
          class="et-card"
          @click="router.push(`/etudiants/${(etudiant as any).id}`)">
          <!-- Risk ring -->
          <div class="et-card-top">
            <div class="et-card-avatar"
              :style="{ background: (etudiant as any).photo_path ? 'transparent' : avatarColor((etudiant as any).prenom, (etudiant as any).nom) }"
              :class="{
                'et-card-av--red':    risques[(etudiant as any).id]?.risque_global === 'red',
                'et-card-av--yellow': risques[(etudiant as any).id]?.risque_global === 'yellow',
              }">
              <img v-if="(etudiant as any).photo_path" :src="(etudiant as any).photo_path"
                style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />
              <template v-else>{{ ((etudiant as any).prenom[0] ?? '') + ((etudiant as any).nom[0] ?? '') }}</template>
              <span v-if="risques[(etudiant as any).id]"
                class="rq-dot"
                :class="`rq-dot--${risques[(etudiant as any).id]?.risque_global}`"></span>
            </div>
            <div class="et-card-info">
              <div class="et-card-name">{{ (etudiant as any).prenom }} {{ (etudiant as any).nom }}</div>
              <div class="et-card-num">{{ (etudiant as any).numero_etudiant }}</div>
              <div class="et-card-email">{{ (etudiant as any).email }}</div>
            </div>
          </div>
          <div class="et-card-body">
            <div v-if="(etudiant as any).inscription_active?.filiere" class="et-card-filiere">
              📚 {{ (etudiant as any).inscription_active.filiere.nom }}
            </div>
            <div class="et-card-meta">
              <span v-if="(etudiant as any).inscription_active?.classe">🏫 {{ (etudiant as any).inscription_active.classe.nom }}</span>
              <span v-if="(etudiant as any).inscription_active?.niveau_entree"
                class="niveau-badge"
                :class="(etudiant as any).inscription_active.niveau_entree.est_superieur_bac ? 'niveau-badge--lmd' : 'niveau-badge--classic'">
                {{ (etudiant as any).inscription_active.niveau_entree.nom }}
                <span class="niveau-badge-sys">{{ (etudiant as any).inscription_active.niveau_entree.est_superieur_bac ? 'LMD' : 'Coef.' }}</span>
              </span>
            </div>
          </div>
          <div class="et-card-footer">
            <span v-if="(etudiant as any).inscription_active" class="uc-badge" :class="statutBadgeClass((etudiant as any).inscription_active.statut)">
              <span class="badge-dot" :class="statutDotClass((etudiant as any).inscription_active.statut)"></span>
              {{ statutLabel[(etudiant as any).inscription_active.statut] ?? (etudiant as any).inscription_active.statut }}
            </span>
            <span v-else class="uc-badge uc-badge-gray">Non inscrit</span>
            <div class="et-card-actions" @click.stop>
              <button v-if="canWrite" @click.stop="openEditEtudiant(etudiant as any)" class="row-btn" title="Modifier">✏️</button>
              <button v-if="canWrite && (etudiant as any).inscription_active" @click.stop="openGererInscription(etudiant as any)" class="row-btn" title="Inscription">📋</button>
              <button v-if="canWrite && (etudiant as any).formation_individuelle_active" @click.stop="$router.push('/formations-individuelles')" class="row-btn" title="Formation individuelle" style="color:#3b82f6;">🎓</button>
              <button v-if="canDelete" @click.stop="openDeleteEtudiant(etudiant as any)" class="row-btn row-btn--danger" title="Supprimer">🗑</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ══ VUE TABLEAU ══ -->
    <UcTable v-if="viewMode === 'table'" :cols="tableCols" :data="etudiantsFiltres" empty-text="Aucun étudiant trouvé">
      <template #row="{ item: etudiant }">
        <td class="td-num">{{ (etudiant as any).numero_etudiant }}</td>
        <td>
          <div class="student-name" style="cursor:pointer;" @click="router.push(`/etudiants/${(etudiant as any).id}`)">
            <div class="s-avatar-wrap">
              <div class="s-avatar"
                :style="{ background: (etudiant as any).photo_path ? 'transparent' : avatarColor((etudiant as any).prenom, (etudiant as any).nom) }"
                :class="{
                  'rq-ring--red':    risques[(etudiant as any).id]?.risque_global === 'red',
                  'rq-ring--yellow': risques[(etudiant as any).id]?.risque_global === 'yellow',
                }">
                <img v-if="(etudiant as any).photo_path" :src="(etudiant as any).photo_path"
                  style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />
                <template v-else>{{ ((etudiant as any).prenom[0] ?? '') + ((etudiant as any).nom[0] ?? '') }}</template>
              </div>
              <!-- Dot risque -->
              <span v-if="risques[(etudiant as any).id]"
                class="rq-dot"
                :class="`rq-dot--${risques[(etudiant as any).id]?.risque_global}`"
                :title="risques[(etudiant as any).id]?.risque_global === 'red' ? 'Risque élevé d\'abandon' : risques[(etudiant as any).id]?.risque_global === 'yellow' ? 'À surveiller' : 'Situation OK'"
              ></span>
            </div>
            <div class="s-name">
              <strong>{{ (etudiant as any).prenom }} {{ (etudiant as any).nom }}</strong>
              <span>{{ (etudiant as any).email }}</span>
            </div>
          </div>
        </td>
        <td @click="router.push(`/etudiants/${(etudiant as any).id}`)">
          <span style="font-size:12.5px;color:#374151;font-weight:500;">
            {{ getTypeFormation((etudiant as any).inscription_active?.filiere?.id) }}
          </span>
        </td>
        <td @click="router.push(`/etudiants/${(etudiant as any).id}`)">
          <span v-if="(etudiant as any).inscription_active?.filiere">
            {{ (etudiant as any).inscription_active.filiere.nom }}<br>
            <span style="font-size:10.5px;color:#aaa;">{{ (etudiant as any).inscription_active.filiere.code }}</span>
          </span>
          <span v-else style="color:#aaa;">—</span>
        </td>
        <td @click="router.push(`/etudiants/${(etudiant as any).id}`)">
          <span v-if="(etudiant as any).inscription_active?.niveau_entree"
            class="niveau-badge"
            :class="(etudiant as any).inscription_active.niveau_entree.est_superieur_bac ? 'niveau-badge--lmd' : 'niveau-badge--classic'">
            {{ (etudiant as any).inscription_active.niveau_entree.nom }}
            <span class="niveau-badge-sys">{{ (etudiant as any).inscription_active.niveau_entree.est_superieur_bac ? 'LMD' : 'Coef.' }}</span>
          </span>
          <span v-else style="color:#aaa;font-size:12px;">—</span>
        </td>
        <td @click="router.push(`/etudiants/${(etudiant as any).id}`)">
          <span v-if="(etudiant as any).inscription_active?.classe" style="font-size:13px;font-weight:600;color:#374151;">
            {{ (etudiant as any).inscription_active.classe.nom }}
          </span>
          <span v-else style="color:#aaa;font-size:12px;">—</span>
        </td>
        <td @click="router.push(`/etudiants/${(etudiant as any).id}`)">
          <span v-if="(etudiant as any).inscription_active" class="uc-badge" :class="statutBadgeClass((etudiant as any).inscription_active.statut)">
            <span class="badge-dot" :class="statutDotClass((etudiant as any).inscription_active.statut)"></span>
            {{ statutLabel[(etudiant as any).inscription_active.statut] ?? (etudiant as any).inscription_active.statut }}
          </span>
          <span v-else-if="(etudiant as any).formation_individuelle_active" class="uc-badge" style="background:#eff6ff;color:#1e40af;">
            🎓 Indiv. — {{ (etudiant as any).formation_individuelle_active.statut }}
          </span>
          <span v-else class="uc-badge uc-badge-gray">Non inscrit</span>
        </td>
        <td style="min-width: 260px;">
          <div class="row-actions">
            <button v-if="canWrite" @click="openEditEtudiant(etudiant as any)" class="row-btn" title="Modifier">✏️ Modifier</button>
            <button v-if="canWrite && (etudiant as any).inscription_active" @click="openGererInscription(etudiant as any)" class="row-btn" title="Gérer inscription">📋 Inscription</button>
            <button v-if="canWrite && (etudiant as any).formation_individuelle_active" @click="$router.push('/formations-individuelles')" class="row-btn" title="Formation individuelle" style="color:#3b82f6;">🎓 Formation indiv.</button>
            <button v-if="canDelete" @click="openDeleteEtudiant(etudiant as any)" class="row-btn row-btn--danger" title="Supprimer définitivement">🗑 Supprimer</button>
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
                <!-- ═══ MODE CLASSIQUE (filière) ═══ -->
                <template v-if="!isSelectedTypeIndividuel">
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
                    <div class="form-group">
                      <label>Mois de début des paiements</label>
                      <input v-model="inscriptionForm.mois_debut" type="month" />
                    </div>
                  </div>
                  <!-- Bourse info -->
                  <div v-if="selectedBourse && selectedFiliereObj" class="bourse-info">
                    <span>Mensualité après bourse : <strong>{{ formatAmount(mensualitePrevu) }}</strong></span>
                    <span v-if="selectedBourse.applique_inscription"> — Frais insc. après bourse : <strong>{{ formatAmount(fraisInscriptionPrevu) }}</strong></span>
                  </div>
                </template>

                <!-- ═══ MODE INDIVIDUEL (à la carte) ═══ -->
                <template v-else>
                  <div class="fi-indiv-banner">
                    <strong>Formation individuelle</strong> — Modules à la carte, paiement 50/50
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label>Coût total de la formation (FCFA) <span class="req">*</span></label>
                      <input v-model.number="fiForm.cout_total" type="number" min="0" placeholder="Ex: 500000" />
                    </div>
                    <div class="form-group">
                      <label>Niveau d'entrée</label>
                      <select v-model="inscriptionForm.niveau_entree_id">
                        <option :value="null">— Sélectionner —</option>
                        <option v-for="n in niveauxEntree" :key="n.id" :value="n.id">{{ n.nom }}</option>
                      </select>
                    </div>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label>% Inscription (versement initial)</label>
                      <input v-model.number="fiForm.pct_inscription" type="number" min="0" max="100" />
                    </div>
                    <div class="form-group">
                      <label>% Rémunération formateurs</label>
                      <input v-model.number="fiForm.pct_formateur" type="number" min="0" max="100" />
                    </div>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label>Date début</label>
                      <input v-model="fiForm.date_debut" type="date" />
                    </div>
                    <div class="form-group">
                      <label>Date fin</label>
                      <div style="padding:8px 0;font-size:12px;color:#64748b;font-style:italic;">
                        Calculée automatiquement quand tous les modules sont terminés
                      </div>
                    </div>
                  </div>

                  <!-- Aperçu paiement -->
                  <div v-if="fiForm.cout_total > 0" class="fi-indiv-preview">
                    <div><strong>Inscription :</strong> {{ new Intl.NumberFormat('fr-FR').format(fiMontantInscription) }} FCFA ({{ fiForm.pct_inscription }}%)</div>
                    <div><strong>Solde :</strong> {{ new Intl.NumberFormat('fr-FR').format(fiMontantSolde) }} FCFA</div>
                    <div><strong>Part formateurs :</strong> {{ new Intl.NumberFormat('fr-FR').format(Math.round(fiForm.cout_total * fiForm.pct_formateur / 100)) }} FCFA</div>
                  </div>

                  <!-- Modules à la carte -->
                  <div class="fi-indiv-modules">
                    <div class="fi-indiv-modules-head">
                      <strong>Modules à la carte</strong>
                      <span style="font-size:12px;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:10px;">{{ fiTotalHeures }}h total</span>
                      <button type="button" @click="fiAddModule" class="fi-indiv-add-btn">+ Module</button>
                    </div>
                    <div v-for="(mod, i) in fiForm.modules" :key="i" class="fi-indiv-module-row">
                      <select v-model="mod.matiere_id" style="flex:2;">
                        <option :value="null">— Matière —</option>
                        <option v-for="m in fiMatieres" :key="m.id" :value="m.id">{{ m.nom }}</option>
                      </select>
                      <input v-model.number="mod.volume_horaire" type="number" min="0" placeholder="Heures" style="width:80px;flex:none;" />
                      <select v-model="mod.enseignant_id" style="flex:2;">
                        <option :value="null">— Formateur —</option>
                        <option v-for="e in fiEnseignants" :key="e.id" :value="e.id">{{ e.prenom }} {{ e.nom }}</option>
                      </select>
                      <button type="button" @click="fiRemoveModule(i)" :disabled="fiForm.modules.length <= 1" class="fi-indiv-remove-btn">&times;</button>
                    </div>
                  </div>
                </template>

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
                <div style="text-align:center;padding:28px 0 10px;">
                  <div style="font-size:52px;line-height:1;">✅</div>
                  <h3 style="margin:14px 0 8px;font-size:16px;font-weight:700;color:#111;">Inscription créée avec succès !</h3>
                  <p style="color:#888;font-size:12px;margin-bottom:20px;">
                    <strong>{{ lastCreatedData?.etudiant.prenom }} {{ lastCreatedData?.etudiant.nom }}</strong>
                    a été inscrit(e).
                  </p>
                </div>

                <!-- Étapes de disponibilité des documents -->
                <div style="text-align:left;background:#f8f9fa;border-radius:10px;padding:16px 18px;margin-bottom:18px;">
                  <p style="font-size:12px;font-weight:700;color:#333;margin-bottom:12px;">Prochaines étapes</p>

                  <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
                    <span style="font-size:18px;line-height:1;">🎓</span>
                    <div>
                      <p style="font-size:12px;font-weight:600;color:#111;margin:0 0 2px;">1. Affecter à une classe</p>
                      <p style="font-size:11px;color:#888;margin:0;">La <strong>carte étudiant</strong> sera disponible après affectation.</p>
                    </div>
                  </div>

                  <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
                    <span style="font-size:18px;line-height:1;">💳</span>
                    <div>
                      <p style="font-size:12px;font-weight:600;color:#111;margin:0 0 2px;">2. Payer les frais d'inscription</p>
                      <p style="font-size:11px;color:#888;margin:0;">La <strong>fiche d'inscription</strong> sera disponible après ce paiement.</p>
                    </div>
                  </div>

                  <div style="display:flex;align-items:flex-start;gap:10px;">
                    <span style="font-size:18px;line-height:1;">📄</span>
                    <div>
                      <p style="font-size:12px;font-weight:600;color:#111;margin:0 0 2px;">3. Payer la 1ère mensualité</p>
                      <p style="font-size:11px;color:#888;margin:0;">Le <strong>certificat d'inscription</strong> sera disponible après ce paiement.</p>
                    </div>
                  </div>
                </div>

                <button
                  @click="router.push('/classes')"
                  class="uc-btn-primary"
                  style="padding:11px 24px;font-size:13px;display:inline-flex;align-items:center;gap:8px;width:100%;justify-content:center;">
                  🎓 Affecter à une classe
                </button>
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
                        <label>Mensualité de base (FCFA) <span class="req">*</span></label>
                        <input v-model.number="inscriptionEditForm.mensualite" type="number" min="0" step="500" placeholder="Ex: 50000" />
                        <span style="font-size:10px;color:#888;display:block;margin-top:3px;">La bourse sera appliquée lors de la génération des échéances</span>
                      </div>
                    </div>
                    <div class="form-row full">
                      <div class="form-group">
                        <label>Frais d'inscription (FCFA)</label>
                        <input v-model.number="inscriptionEditForm.frais_inscription" type="number" min="0" step="500" placeholder="Ex: 100000" />
                      </div>
                    </div>
                    <div class="form-row full">
                      <div class="form-group">
                        <label>Frais de tenue (FCFA)</label>
                        <input v-model.number="inscriptionEditForm.frais_tenue" type="number" min="0" placeholder="0" />
                      </div>
                    </div>
                    <div class="form-row full">
                      <div class="form-group">
                        <label>Mois de début des paiements</label>
                        <input v-model="inscriptionEditForm.mois_debut" type="month" />
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
                    <div v-else-if="['inscrit_actif', 'suspendu', 'abandonne'].includes(currentInscription.statut)">
                      <div class="form-group">
                        <label>Changer le statut</label>
                        <select :value="currentInscription.statut" :disabled="updatingStatut"
                          @change="changerStatut(($event.target as HTMLSelectElement).value)">
                          <option value="inscrit_actif">Actif</option>
                          <option value="suspendu">Suspendu</option>
                          <option value="abandonne">Abandonné</option>
                          <option value="diplome">Diplômé</option>
                        </select>
                      </div>

                      <!-- Formulaire abandon avec date + motif -->
                      <div v-if="showAbandonForm" style="margin-top:12px;padding:14px;background:#fff0f0;border:1px solid #fecaca;border-radius:8px;">
                        <p style="font-size:11px;font-weight:700;color:#E30613;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">
                          🚫 Déclarer un abandon
                        </p>
                        <div class="form-group" style="margin-bottom:10px;">
                          <label style="font-size:11px;font-weight:600;color:#555;">Date d'abandon</label>
                          <input v-model="abandonForm.date_abandon" type="date" style="width:100%;padding:8px;border:1px solid #e5e5e5;border-radius:6px;font-size:12px;" />
                        </div>
                        <div class="form-group" style="margin-bottom:10px;">
                          <label style="font-size:11px;font-weight:600;color:#555;">Motif de l'abandon <span style="color:#aaa;font-weight:400;">(facultatif)</span></label>
                          <select v-model="abandonForm.motif_abandon" style="width:100%;padding:8px;border:1px solid #e5e5e5;border-radius:6px;font-size:12px;">
                            <option value="">— Sélectionner un motif —</option>
                            <option value="raisons_financieres">Raisons financières</option>
                            <option value="raisons_personnelles">Raisons personnelles</option>
                            <option value="reorientation">Réorientation</option>
                            <option value="demenagement">Déménagement</option>
                            <option value="sante">Problème de santé</option>
                            <option value="emploi">Reprise d'emploi</option>
                            <option value="exclusion">Exclusion disciplinaire</option>
                            <option value="autre">Autre</option>
                          </select>
                        </div>
                        <div style="display:flex;gap:8px;">
                          <button @click="showAbandonForm = false" class="btn-ghost" style="flex:1;padding:8px;font-size:12px;">Annuler</button>
                          <button @click="confirmerAbandon" :disabled="updatingStatut"
                            style="flex:1;padding:8px;font-size:12px;background:#E30613;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;"
                            :style="{ opacity: updatingStatut ? '0.5' : '1' }">
                            {{ updatingStatut ? 'En cours…' : 'Confirmer l\'abandon' }}
                          </button>
                        </div>
                      </div>

                      <!-- Info si déjà abandonné -->
                      <div v-if="currentInscription.statut === 'abandonne' && (currentInscription as any).date_abandon"
                        style="margin-top:10px;padding:10px;background:#fff5f5;border-radius:6px;font-size:11px;color:#b91c1c;">
                        <strong>Abandon le :</strong> {{ new Date((currentInscription as any).date_abandon).toLocaleDateString('fr-FR') }}
                        <span v-if="(currentInscription as any).motif_abandon" style="display:block;margin-top:4px;">
                          <strong>Motif :</strong> {{ motifAbandonLabel((currentInscription as any).motif_abandon) }}
                        </span>
                      </div>
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
                <button @click="submitInscrire" :disabled="panelLoading || (!isSelectedTypeIndividuel && (!inscriptionForm.filiere_id || !inscriptionForm.niveau_entree_id)) || (isSelectedTypeIndividuel && (!fiForm.cout_total || fiForm.modules.every(m => !m.matiere_id)))"
                  class="uc-btn-primary"
                  :style="{ opacity: (panelLoading || (!isSelectedTypeIndividuel && (!inscriptionForm.filiere_id || !inscriptionForm.niveau_entree_id)) || (isSelectedTypeIndividuel && (!fiForm.cout_total || fiForm.modules.every(m => !m.matiere_id)))) ? '0.55' : '1' }">
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

    <!-- ═══════════════════════════════════════════════════════════
         MODAL TIRAGE CARTES ÉTUDIANTS
         ═══════════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showCartes" class="carte-overlay" @click.self="showCartes = false">
          <div class="carte-modal">
            <!-- Header -->
            <div class="carte-modal-header">
              <div>
                <h2 class="carte-modal-title">🪪 Tirage de cartes étudiants</h2>
                <p class="carte-modal-sub">Sélectionnez les étudiants et imprimez leurs cartes</p>
              </div>
              <button @click="showCartes = false" class="carte-close">✕</button>
            </div>

            <!-- Filtres -->
            <div class="carte-filters">
              <div class="carte-filter-row">
                <div class="carte-search">
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#bbb;flex-shrink:0;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                  <input v-model="carteSearch" type="text" placeholder="Rechercher par nom…" class="carte-search-input" />
                </div>
                <select v-model="carteFiliereId" @change="onCarteFiliereChange" class="carte-select">
                  <option value="">Toutes les filières</option>
                  <option v-for="f in carteFilteredFilieres" :key="f.id" :value="f.id">{{ f.nom }}</option>
                </select>
                <select v-model="carteClasseId" class="carte-select">
                  <option value="">Toutes les classes</option>
                  <option v-for="c in carteFilteredClasses" :key="c.id" :value="c.id">{{ c.nom }}</option>
                </select>
              </div>
            </div>

            <!-- Liste étudiants -->
            <div class="carte-body">
              <div v-if="cartesLoading" class="carte-loading">Chargement…</div>
              <div v-else-if="!cartesEtudiants.length" class="carte-empty">
                <span style="font-size:32px;">📭</span>
                <p>Aucun étudiant actif trouvé</p>
              </div>
              <template v-else>
                <div class="carte-select-all">
                  <label class="carte-checkbox-label">
                    <input type="checkbox" :checked="cartesSelected.size === cartesEtudiants.length && cartesEtudiants.length > 0" @change="selectAllCartes" />
                    <span>{{ cartesSelected.size === cartesEtudiants.length ? 'Tout désélectionner' : 'Tout sélectionner' }}</span>
                  </label>
                  <span class="carte-count">{{ cartesEtudiants.length }} étudiant{{ cartesEtudiants.length > 1 ? 's' : '' }}</span>
                </div>
                <div class="carte-list">
                  <div v-for="e in cartesEtudiants" :key="e.id"
                    class="carte-item"
                    :class="{ 'carte-item--selected': cartesSelected.has(e.id) }"
                    @click="toggleCarteSelect(e.id)">
                    <input type="checkbox" :checked="cartesSelected.has(e.id)" @click.stop="toggleCarteSelect(e.id)" />
                    <div class="carte-item-avatar" :style="{ background: avatarColor(e.prenom, e.nom) }">
                      {{ (e.prenom[0] ?? '') + (e.nom[0] ?? '') }}
                    </div>
                    <div class="carte-item-info">
                      <div class="carte-item-name">{{ e.prenom }} {{ e.nom }}</div>
                      <div class="carte-item-details">
                        {{ e.numero_etudiant }}
                        <span v-if="e.inscription_active?.filiere"> · {{ e.inscription_active.filiere.nom }}</span>
                        <span v-if="e.inscription_active?.classe"> · {{ e.inscription_active.classe.nom }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <!-- Footer -->
            <div class="carte-footer">
              <span class="carte-footer-info">
                {{ cartesSelected.size > 0 ? `${cartesSelected.size} sélectionné${cartesSelected.size > 1 ? 's' : ''}` : `${cartesEtudiants.length} carte${cartesEtudiants.length > 1 ? 's' : ''} à imprimer` }}
              </span>
              <button @click="imprimerCartes" :disabled="!cartesEtudiants.length" class="carte-btn-print">
                🖨️ Imprimer {{ cartesSelected.size > 0 ? cartesSelected.size : cartesEtudiants.length }} carte{{ (cartesSelected.size > 0 ? cartesSelected.size : cartesEtudiants.length) > 1 ? 's' : '' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══════════════════════════════════════════════════════════
         MODAL SUPPRESSION PROGRESSIVE
         ═══════════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="deleteTargetEtudiant" class="del-overlay" @click.self="deleteTargetEtudiant = null">
        <div class="del-modal">

          <!-- En-tête -->
          <div class="del-header">
            <div class="del-steps">
              <span class="del-step" :class="{ 'del-step--active': deleteStep === 1, 'del-step--done': deleteStep > 1 }">
                {{ deleteStep > 1 ? '✓' : '1' }} Bilan
              </span>
              <span class="del-step-sep">→</span>
              <span class="del-step" :class="{ 'del-step--active': deleteStep === 2 }">2 Confirmation</span>
            </div>
            <button @click="deleteTargetEtudiant = null" class="del-close">✕</button>
          </div>

          <!-- ── Étape 1 : Bilan de l'impact ── -->
          <template v-if="deleteStep === 1">
            <div class="del-icon">⚠️</div>
            <h2 class="del-title">Données qui seront supprimées</h2>
            <p class="del-subtitle">
              Étudiant : <strong>{{ deleteTargetEtudiant.prenom }} {{ deleteTargetEtudiant.nom }}</strong>
            </p>

            <!-- Chargement -->
            <div v-if="deletePreviewLoading" class="del-loading">Chargement du bilan…</div>

            <!-- Arbre des niveaux -->
            <div v-else-if="deletePreview" class="del-tree">
              <div class="del-tree-root">
                <span class="del-tree-icon">👤</span>
                <span class="del-tree-label">Étudiant + photo</span>
              </div>
              <div v-for="niveau in deletePreview.niveaux" :key="niveau.label" class="del-tree-level">
                <div class="del-tree-node" :class="{ 'del-tree-node--zero': niveau.count === 0 }">
                  <span class="del-tree-bullet">├─</span>
                  <span class="del-tree-count" :class="niveau.count > 0 ? 'del-count--warn' : 'del-count--zero'">
                    {{ niveau.count }}
                  </span>
                  <span class="del-tree-text">{{ niveau.detail }}</span>
                </div>
                <div v-for="enfant in niveau.enfants" :key="enfant.label"
                  class="del-tree-node del-tree-node--child" :class="{ 'del-tree-node--zero': enfant.count === 0 }">
                  <span class="del-tree-bullet del-tree-bullet--child">│&nbsp;&nbsp;└─</span>
                  <span class="del-tree-count" :class="enfant.count > 0 ? 'del-count--warn' : 'del-count--zero'">
                    {{ enfant.count }}
                  </span>
                  <span class="del-tree-text">{{ enfant.detail }}</span>
                </div>
              </div>
            </div>

            <div class="del-actions">
              <button @click="deleteTargetEtudiant = null" class="del-btn-cancel">Annuler</button>
              <button @click="deleteStep = 2; confirmDeleteName = ''" class="del-btn-next">
                Continuer →
              </button>
            </div>
          </template>

          <!-- ── Étape 2 : Confirmation finale ── -->
          <template v-if="deleteStep === 2">
            <div class="del-icon">🗑️</div>
            <h2 class="del-title">Confirmation finale</h2>
            <p class="del-warning">
              Vous allez supprimer définitivement <strong>{{ deleteTargetEtudiant.prenom.trim() }} {{ deleteTargetEtudiant.nom.trim() }}</strong> et toutes ses données associées.<br/>
              Cette action est <strong>irréversible</strong>.
            </p>
            <div class="del-actions">
              <button @click="deleteStep = 1" class="del-btn-cancel">← Retour</button>
              <button
                @click="confirmDeleteEtudiant"
                :disabled="deletingEtudiant"
                class="del-btn-confirm"
              >
                {{ deletingEtudiant ? 'Suppression…' : 'Oui, supprimer définitivement' }}
              </button>
            </div>
          </template>

        </div>
      </div>
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

/* ── Formation individuelle (mode à la carte) ── */
.fi-indiv-banner {
  background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;
  padding: 10px 14px; margin-bottom: 14px; font-size: 13px; color: #1e40af;
}
.fi-indiv-preview {
  background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;
  padding: 10px 14px; margin: 10px 0; font-size: 12px; color: #166534;
  display: flex; flex-direction: column; gap: 3px;
}
.fi-indiv-modules { margin-top: 14px; }
.fi-indiv-modules-head {
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
}
.fi-indiv-modules-head strong { font-size: 13px; }
.fi-indiv-add-btn {
  padding: 3px 10px; font-size: 11px; font-weight: 600; border: 1px solid #e2e8f0;
  border-radius: 6px; background: #fff; color: #3b82f6; cursor: pointer;
}
.fi-indiv-add-btn:hover { background: #eff6ff; }
.fi-indiv-module-row {
  display: flex; gap: 6px; align-items: center; margin-bottom: 6px;
}
.fi-indiv-module-row select, .fi-indiv-module-row input {
  padding: 7px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px;
}
.fi-indiv-remove-btn {
  width: 26px; height: 26px; border: 1px solid #fecaca; border-radius: 6px;
  background: #fff; color: #ef4444; font-size: 15px; cursor: pointer; flex-shrink: 0;
}
.fi-indiv-remove-btn:hover { background: #fef2f2; }
.fi-indiv-remove-btn:disabled { opacity: .3; cursor: not-allowed; }

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

/* Filter selects */
.uc-filter-select {
  height: 38px;
  padding: 0 10px;
  border: 1.5px solid #e5e5e5;
  border-radius: 8px;
  font-size: 12.5px;
  color: #374151;
  background: #fff;
  cursor: pointer;
  min-width: 140px;
  max-width: 200px;
  transition: border-color 0.2s;
}
.uc-filter-select:focus { border-color: #E30613; outline: none; }

/* Student avatar */
.student-name { display: flex; align-items: center; gap: 9px; }
.s-avatar-wrap { position: relative; flex-shrink: 0; }
.s-avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  color: #fff; flex-shrink: 0;
  text-transform: uppercase;
  transition: box-shadow 0.15s;
}
.rq-ring--red    { box-shadow: 0 0 0 2px #fca5a5; }
.rq-ring--yellow { box-shadow: 0 0 0 2px #fde68a; }
.rq-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 8px; height: 8px; border-radius: 50%;
  border: 1.5px solid #fff;
}
.rq-dot--red    { background: #ef4444; }
.rq-dot--yellow { background: #f59e0b; }
.rq-dot--green  { background: #22c55e; }
.s-name strong { display: block; font-size: 12.5px; font-weight: 600; color: #111; }
.s-name span { font-size: 10.5px; color: #aaa; }

/* Filtres risque */
.rq-btn {
  padding: 5px 10px; border-radius: 20px; border: 1.5px solid #e5e7eb;
  background: #fff; font-size: 11.5px; font-weight: 600; color: #666;
  cursor: pointer; display: flex; align-items: center; gap: 4px;
  transition: all 0.12s; white-space: nowrap;
}
.rq-btn:hover { border-color: #9ca3af; }
.rq-btn--active { background: #111; color: #fff; border-color: #111; }
.rq-btn--red.rq-btn--active    { background: #fef2f2; border-color: #fca5a5; color: #b91c1c; }
.rq-btn--yellow.rq-btn--active { background: #fffbeb; border-color: #fde68a; color: #92400e; }
.rq-btn--green.rq-btn--active  { background: #f0fdf4; border-color: #86efac; color: #15803d; }
.rq-count {
  background: #e5e7eb; border-radius: 10px; padding: 1px 6px;
  font-size: 10px; font-weight: 700; color: #374151;
}
.rq-btn--red.rq-btn--active    .rq-count { background: #fecaca; color: #b91c1c; }
.rq-btn--yellow.rq-btn--active .rq-count { background: #fde68a; color: #92400e; }
.rq-btn--green.rq-btn--active  .rq-count { background: #bbf7d0; color: #15803d; }
/* Bannière d'alerte */
.rq-banner {
  background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px;
  padding: 9px 14px; margin-bottom: 12px; font-size: 12.5px; color: #b91c1c;
}
.rq-banner-link {
  background: none; border: none; color: #b91c1c; font-weight: 700;
  text-decoration: underline; cursor: pointer; padding: 0; font-size: 12.5px;
}

/* Row actions */
.row-actions { display: flex; gap: 6px; flex-wrap: nowrap; align-items: center; }
/* Toujours visible, pas besoin de hover */
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
  white-space: nowrap;
  flex-shrink: 0;
}
.row-btn:hover { border-color: #E30613; color: #E30613; }
.row-btn--danger { border-color: #fecaca; color: #E30613; }
.row-btn--danger:hover { background: #E30613; color: #fff; border-color: #E30613; }

/* Modal suppression progressive */
.del-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.del-modal {
  background: #fff; border-radius: 12px; padding: 0;
  max-width: 480px; width: 100%;
  box-shadow: 0 24px 64px rgba(0,0,0,0.25);
  overflow: hidden;
}
.del-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; border-bottom: 1px solid #f0f0f0; background: #fafafa;
}
.del-steps { display: flex; align-items: center; gap: 8px; }
.del-step {
  font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px;
  border: 1.5px solid #e5e5e5; color: #aaa; background: #fff;
}
.del-step--active { border-color: #E30613; color: #E30613; background: #fff5f5; }
.del-step--done { border-color: #22c55e; color: #16a34a; background: #f0fdf4; }
.del-step-sep { font-size: 11px; color: #ccc; }
.del-close { background: none; border: none; cursor: pointer; color: #aaa; font-size: 18px; line-height: 1; padding: 2px 6px; }
.del-close:hover { color: #555; }

/* Corps du modal */
.del-modal > template + * , .del-modal > div { padding: 24px 24px 20px; text-align: center; }
.del-icon { font-size: 32px; margin-bottom: 10px; padding-top: 24px; }
.del-title { font-size: 16px; font-weight: 800; color: #111; margin: 0 0 6px; padding: 0 24px; }
.del-subtitle { font-size: 12.5px; color: #666; margin-bottom: 16px; padding: 0 24px; }
.del-loading { font-size: 12.5px; color: #aaa; padding: 16px 24px; text-align: center; }

/* Arbre des niveaux */
.del-tree {
  margin: 0 24px 16px; text-align: left;
  background: #fafafa; border: 1px solid #f0f0f0; border-radius: 8px;
  padding: 12px 14px; font-family: monospace; font-size: 12px;
}
.del-tree-root {
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 700; color: #111; margin-bottom: 6px;
  font-family: 'Poppins', sans-serif;
}
.del-tree-icon { font-size: 14px; }
.del-tree-level { margin-bottom: 2px; }
.del-tree-node {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 0; font-family: 'Poppins', sans-serif;
}
.del-tree-node--child { padding-left: 4px; }
.del-tree-node--zero { opacity: 0.45; }
.del-tree-bullet { color: #aaa; font-family: monospace; font-size: 11px; flex-shrink: 0; }
.del-tree-bullet--child { font-size: 10px; }
.del-tree-count {
  min-width: 22px; text-align: center; font-size: 11px; font-weight: 800;
  border-radius: 4px; padding: 1px 5px; flex-shrink: 0;
}
.del-count--warn { background: #fee2e2; color: #E30613; }
.del-count--zero { background: #f3f4f6; color: #9ca3af; }
.del-tree-text { font-size: 12px; color: #444; }

.del-warning {
  font-size: 12.5px; color: #555; line-height: 1.6; margin: 0 24px 16px;
  background: #fff5f5; border: 1px solid #fecaca; border-radius: 8px; padding: 12px;
  text-align: left;
}
.del-confirm-label { font-size: 12.5px; color: #666; margin-bottom: 8px; text-align: left; padding: 0 24px; }
.del-input {
  width: calc(100% - 48px); margin: 0 24px 16px; display: block;
  border: 1.5px solid #e5e5e5; border-radius: 6px;
  padding: 9px 12px; font-size: 13px; font-family: 'Poppins', sans-serif;
  outline: none; transition: border-color 0.15s; box-sizing: border-box;
}
.del-input:focus { border-color: #E30613; }
.del-actions {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 14px 24px; border-top: 1px solid #f0f0f0; background: #fafafa;
}
.del-btn-cancel {
  border: 1px solid #e5e5e5; background: #fff; border-radius: 6px;
  padding: 8px 16px; font-size: 12.5px; font-weight: 600; color: #555;
  cursor: pointer; font-family: 'Poppins', sans-serif;
}
.del-btn-cancel:hover { background: #f5f5f5; }
.del-btn-next {
  background: #111; color: #fff; border: none; border-radius: 6px;
  padding: 8px 16px; font-size: 12.5px; font-weight: 700; cursor: pointer;
  font-family: 'Poppins', sans-serif;
}
.del-btn-next:hover { background: #333; }
.del-btn-confirm {
  background: #E30613; color: #fff; border: none; border-radius: 6px;
  padding: 8px 16px; font-size: 12.5px; font-weight: 700; cursor: pointer;
  font-family: 'Poppins', sans-serif; transition: background 0.15s;
}
.del-btn-confirm:hover:not(:disabled) { background: #c00510; }
.del-btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; }

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

/* ── Tableau : scroll horizontal à toutes les tailles ── */
:deep(.uc-table-wrap) { overflow-x: auto; -webkit-overflow-scrolling: touch; }
:deep(.uc-table) {
  min-width: 860px;
  table-layout: fixed;
  width: 100%;
}
/* Largeurs fixes des colonnes pour éviter le débordement */
:deep(.uc-table thead th:nth-child(1)) { width: 110px; } /* N° étudiant */
:deep(.uc-table thead th:nth-child(2)) { width: 200px; } /* Étudiant */
:deep(.uc-table thead th:nth-child(3)) { width: 120px; } /* Type formation */
:deep(.uc-table thead th:nth-child(4)) { width: 160px; } /* Filière */
:deep(.uc-table thead th:nth-child(5)) { width: 110px; } /* Niveau */
:deep(.uc-table thead th:nth-child(6)) { width: 80px;  } /* Classe */
:deep(.uc-table thead th:nth-child(7)) { width: 120px; } /* Statut */
:deep(.uc-table thead th:nth-child(8)) { width: 160px; } /* Actions */
/* Tronquer le contenu long dans les cellules */
:deep(.uc-table td) { overflow: hidden; }

.td-num { font-size: 11px; font-weight: 600; color: #888; font-family: monospace; white-space: nowrap; }
.niveau-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600;
  background: #f1f5f9; color: #475569;
  border-radius: 6px; padding: 3px 8px;
  white-space: nowrap;
}
.niveau-badge--lmd {
  background: #eff6ff; color: #1d4ed8;
  border: 1px solid #bfdbfe;
}
.niveau-badge--classic {
  background: #fff7ed; color: #c2410c;
  border: 1px solid #fed7aa;
}
.niveau-badge-sys {
  font-size: 9px; font-weight: 700; letter-spacing: .5px;
  opacity: .65; text-transform: uppercase;
}

/* ═══════════════════════════════════════════════════════
   RESPONSIVE — MOBILE
   ═══════════════════════════════════════════════════════ */
@media (max-width: 768px) {
  /* Row actions : toujours visibles sur mobile (pas de hover) */
  .row-actions { opacity: 1; }

  /* Tableau : actions toujours visibles sur touch */
  :deep(.uc-table) { min-width: 700px; }

  /* Masquer colonne N° sur mobile pour gagner de la place */
  .td-num { display: none; }
  .uc-table thead th:first-child { display: none; }

  /* Pagination */
  .uc-pagination { flex-direction: column; gap: 8px; text-align: center; }
  .uc-pagination-btns { justify-content: center; }

  /* Boutons risque : plus compacts */
  .rq-btn { font-size: 11px; padding: 5px 8px; }

  /* Filtres : pleine largeur dans le flex-wrap */
  .uc-filter-select { min-width: 0; flex: 1; }
  .uc-search-input { font-size: 13px; }
}

@media (max-width: 580px) {
  /* Formulaire : 1 colonne */
  .form-row { grid-template-columns: 1fr !important; }

  /* Étapes du modal : réduire */
  .insc-steps { gap: 4px; }
  .insc-step { font-size: 10px; gap: 3px; }
  .insc-step-num { width: 17px; height: 17px; font-size: 9px; }
  .insc-step-arrow { display: none; } /* Cacher les flèches entre étapes */

  /* Footer modal : boutons pleine largeur */
  .insc-modal-footer { flex-direction: column; }
  .insc-modal-footer > button { width: 100%; justify-content: center; }

  /* Modal suppression */
  .del-actions { flex-direction: column; }
  .del-actions > button { width: 100%; }
  .del-title, .del-subtitle, .del-confirm-label { padding: 0 16px; }
  .del-tree { margin: 0 16px 16px; }
  .del-warning { margin: 0 16px 16px; }
  .del-input { width: calc(100% - 32px); margin: 0 16px 16px; }
}

/* ══════════════════════════════════════════════════════
   HERO ÉTUDIANTS
══════════════════════════════════════════════════════ */
.et-hero {
  position: relative; overflow: hidden;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0a0a1a 100%);
  border-radius: 16px; margin-bottom: 16px; color: #fff;
}
.et-hero-glow {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 20% 50%, rgba(227,6,19,.15) 0%, transparent 60%);
  pointer-events: none;
}
.et-hero-content {
  position: relative; display: flex; align-items: center;
  gap: 20px; padding: 20px 24px; flex-wrap: wrap;
}
.et-hero-left { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 180px; }
.et-hero-icon { font-size: 36px; flex-shrink: 0; }
.et-hero-title { font-size: 22px; font-weight: 800; color: #fff; margin: 0; }
.et-hero-sub { font-size: 12px; color: rgba(255,255,255,.45); margin: 4px 0 0; }
.et-hero-kpis { display: flex; gap: 8px; flex-wrap: wrap; }
.et-hkpi {
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px; padding: 10px 16px; text-align: center; min-width: 58px;
  cursor: pointer; transition: background .15s;
}
.et-hkpi:hover { background: rgba(255,255,255,.12); }
.et-hkpi-val { font-size: 18px; font-weight: 800; color: #fff; }
.et-hkpi-lbl { font-size: 9.5px; color: rgba(255,255,255,.4); margin-top: 3px; white-space: nowrap; }
.et-hkpi--green .et-hkpi-val { color: #4ade80; }
.et-hkpi--blue  .et-hkpi-val { color: #60a5fa; }
.et-hkpi--yellow .et-hkpi-val { color: #fbbf24; }
.et-hkpi--red   .et-hkpi-val { color: #f87171; }
.et-hero-actions { display: flex; gap: 8px; flex-shrink: 0; }
.et-action-btn {
  padding: 9px 16px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  cursor: pointer; font-family: 'Poppins', sans-serif; border: none; white-space: nowrap;
}
.et-action-btn--ghost {
  background: rgba(255,255,255,.1); color: rgba(255,255,255,.8);
  border: 1px solid rgba(255,255,255,.2);
}
.et-action-btn--ghost:hover { background: rgba(255,255,255,.18); }
.et-action-btn--primary { background: #E30613; color: #fff; }
.et-action-btn--primary:hover { background: #c00510; }

/* ══════════════════════════════════════════════════════
   TOOLBAR AMÉLIORÉE
══════════════════════════════════════════════════════ */
.et-toolbar {
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap;
}
.et-toolbar-search {
  display: flex; align-items: center; gap: 8px;
  border: 1.5px solid #e5e5e5; border-radius: 8px;
  padding: 0 12px; background: #fff; flex: 1; min-width: 200px; max-width: 320px;
  transition: border-color .15s;
}
.et-toolbar-search:focus-within { border-color: #E30613; }
.et-search-input {
  border: none; outline: none; font-size: 12.5px; color: #111;
  font-family: 'Poppins', sans-serif; flex: 1; padding: 9px 0; background: none;
}
.et-search-input::placeholder { color: #ccc; }
.et-search-clear { border: none; background: none; cursor: pointer; color: #bbb; font-size: 11px; padding: 2px; }
.et-toolbar-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.et-select {
  height: 38px; padding: 0 10px; border: 1.5px solid #e5e5e5; border-radius: 8px;
  font-size: 12.5px; color: #374151; background: #fff; cursor: pointer; min-width: 130px;
  transition: border-color .15s;
}
.et-select:focus { border-color: #E30613; outline: none; }
.et-btn-clear {
  padding: 7px 12px; border: 1.5px solid #e5e5e5; border-radius: 8px;
  background: #fff; font-size: 12px; color: #888; cursor: pointer; white-space: nowrap;
  font-family: 'Poppins', sans-serif;
}
.et-btn-clear:hover { background: #f9fafb; }
.et-toolbar-right { display: flex; gap: 10px; align-items: center; margin-left: auto; }
.et-rq-pills { display: flex; gap: 5px; align-items: center; }

/* View toggle */
.et-view-toggle { display: flex; border: 1.5px solid #e5e5e5; border-radius: 8px; overflow: hidden; }
.et-view-btn {
  padding: 6px 12px; background: #fff; border: none; cursor: pointer;
  font-size: 15px; color: #9ca3af; transition: all .12s; line-height: 1;
}
.et-view-btn--active { background: #111; color: #fff; }
.et-view-btn:hover:not(.et-view-btn--active) { background: #f9fafb; }

/* ══════════════════════════════════════════════════════
   VUE CARTES
══════════════════════════════════════════════════════ */
.et-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px; margin-bottom: 16px;
}
.et-cards-loading, .et-cards-empty {
  grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center;
  gap: 10px; padding: 48px 24px; background: #fff; border-radius: 12px;
  border: 1.5px dashed #e5e7eb; color: #aaa; font-size: 13px; text-align: center;
}
.et-card {
  background: #fff; border-radius: 12px; border: 1.5px solid #f0f0f0;
  box-shadow: 0 1px 4px rgba(0,0,0,.04); overflow: hidden;
  cursor: pointer; transition: border-color .18s, box-shadow .18s, transform .14s;
  display: flex; flex-direction: column;
}
.et-card:hover {
  border-color: #fca5a5; box-shadow: 0 6px 20px rgba(227,6,19,.08);
  transform: translateY(-2px);
}
.et-card-top {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 16px 10px;
}
.et-card-avatar {
  width: 46px; height: 46px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800; color: #fff; flex-shrink: 0;
  text-transform: uppercase; position: relative;
}
.et-card-av--red    { box-shadow: 0 0 0 2.5px #fca5a5; }
.et-card-av--yellow { box-shadow: 0 0 0 2.5px #fde68a; }
.et-card-info { flex: 1; min-width: 0; }
.et-card-name { font-size: 13.5px; font-weight: 700; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.et-card-num { font-size: 10px; font-weight: 600; color: #E30613; margin: 1px 0; font-family: monospace; }
.et-card-email { font-size: 10.5px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.et-card-body { padding: 0 16px 10px; flex: 1; }
.et-card-filiere { font-size: 12px; color: #374151; font-weight: 500; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.et-card-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.et-card-meta span { font-size: 11px; color: #888; }
.et-card-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-top: 1px solid #f4f4f5; background: #fafafa;
}
.et-card-actions { display: flex; gap: 4px; }

@media (max-width: 900px) {
  .et-hero-content { flex-wrap: wrap; gap: 14px; }
  .et-hero-kpis { display: grid; grid-template-columns: repeat(4,1fr); width: 100%; }
  .et-hero-actions { width: 100%; }
  .et-action-btn { flex: 1; text-align: center; }
}
@media (max-width: 640px) {
  .et-hero-content { padding: 16px 18px; }
  .et-hero-title { font-size: 18px; }
  .et-hero-kpis { grid-template-columns: repeat(2,1fr); }
  .et-toolbar { flex-direction: column; align-items: stretch; }
  .et-toolbar-search { max-width: none; }
  .et-toolbar-right { width: 100%; justify-content: space-between; }
  .et-cards-grid { grid-template-columns: 1fr; }
}

/* ── Tirage de cartes ── */
.carte-overlay {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.45); padding: 16px;
}
.carte-modal {
  background: #fff; border-radius: 12px;
  width: 100%; max-width: 720px; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 64px rgba(0,0,0,0.22);
  overflow: hidden;
}
.carte-modal-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 24px 14px; border-bottom: 1px solid #f0f0f0; flex-shrink: 0;
}
.carte-modal-title { font-size: 16px; font-weight: 700; color: #111; margin: 0 0 4px; }
.carte-modal-sub { font-size: 12px; color: #888; margin: 0; }
.carte-close {
  width: 28px; height: 28px; border-radius: 6px; border: none;
  background: #f5f5f5; color: #888; font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.carte-close:hover { background: #eee; color: #333; }

.carte-filters { padding: 14px 24px; border-bottom: 1px solid #f5f5f5; }
.carte-filter-row {
  display: flex; gap: 10px; flex-wrap: wrap;
}
.carte-search {
  display: flex; align-items: center; gap: 8px;
  background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 6px;
  padding: 0 10px; flex: 1; min-width: 180px;
}
.carte-search-input {
  border: none; background: transparent; outline: none;
  font-size: 12.5px; padding: 8px 0; width: 100%; color: #333;
}
.carte-select {
  padding: 8px 10px; font-size: 12px; border: 1px solid #e5e7eb;
  border-radius: 6px; background: #fff; color: #333; min-width: 140px;
}

.carte-body {
  flex: 1; overflow-y: auto; padding: 0;
}
.carte-loading, .carte-empty {
  padding: 40px; text-align: center; color: #aaa; font-size: 13px;
}
.carte-empty p { margin-top: 8px; }

.carte-select-all {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 24px; background: #f8f9fa; border-bottom: 1px solid #f0f0f0;
}
.carte-checkbox-label {
  display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;
  color: #555; cursor: pointer;
}
.carte-checkbox-label input { cursor: pointer; }
.carte-count { font-size: 11px; color: #999; }

.carte-list { display: flex; flex-direction: column; }
.carte-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 24px; cursor: pointer; transition: background 0.15s;
  border-bottom: 1px solid #f8f8f8;
}
.carte-item:hover { background: #f8f9fa; }
.carte-item--selected { background: #eff6ff; }
.carte-item input { cursor: pointer; flex-shrink: 0; }
.carte-item-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 800; color: #fff; flex-shrink: 0;
  text-transform: uppercase;
}
.carte-item-info { flex: 1; min-width: 0; }
.carte-item-name { font-size: 13px; font-weight: 600; color: #111; }
.carte-item-details { font-size: 11px; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.carte-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 24px; border-top: 1px solid #f0f0f0; flex-shrink: 0;
}
.carte-footer-info { font-size: 12px; color: #888; }
.carte-btn-print {
  padding: 10px 20px; font-size: 13px; font-weight: 600;
  background: #0f172a; color: #fff; border: none; border-radius: 6px;
  cursor: pointer; transition: background 0.2s;
}
.carte-btn-print:hover { background: #1e293b; }
.carte-btn-print:disabled { opacity: 0.4; cursor: not-allowed; }

@media (max-width: 640px) {
  .carte-modal { max-height: 100vh; border-radius: 0; }
  .carte-filter-row { flex-direction: column; }
  .carte-select { min-width: 0; width: 100%; }
}
</style>
