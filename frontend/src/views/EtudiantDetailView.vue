<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const canWrite = computed(() => ['dg', 'secretariat'].includes(auth.user?.role ?? ''))

// --- Données ---
const etudiant = ref<any>(null)
const loading = ref(true)
const activeTab = ref<'infos' | 'inscriptions' | 'documents'>('infos')

async function fetchEtudiant() {
  loading.value = true
  try {
    const { data } = await api.get(`/etudiants/${route.params.id}`)
    etudiant.value = data
  } finally {
    loading.value = false
  }
}

onMounted(fetchEtudiant)

// --- Statuts ---
const statutLabel: Record<string, string> = {
  inscrit_actif: 'Actif', pre_inscrit: 'Pré-inscrit', en_examen: 'En examen',
  diplome: 'Diplômé', abandonne: 'Abandonné',
}
const statutClass: Record<string, string> = {
  inscrit_actif: 'bg-green-100 text-green-700',
  pre_inscrit: 'bg-amber-100 text-amber-700',
  en_examen: 'bg-blue-100 text-blue-700',
  diplome: 'bg-purple-100 text-purple-700',
  abandonne: 'bg-red-100 text-red-700',
}

// --- Upload photo ---
const photoInput = ref<HTMLInputElement | null>(null)
const photoLoading = ref(false)

async function uploadPhoto(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  photoLoading.value = true
  try {
    // Compresser l'image client-side via Canvas (max 300x300, JPEG 80%)
    const dataUrl = await compressImage(file, 300, 0.8)
    const { data } = await api.post(`/etudiants/${etudiant.value.id}/photo`, { photo_base64: dataUrl })
    etudiant.value.photo_path = data.photo_path
  } catch (err: any) {
    alert(err?.response?.data?.message || 'Erreur upload photo')
  } finally {
    photoLoading.value = false
    if (photoInput.value) photoInput.value.value = ''
  }
}

function compressImage(file: File, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1)
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = reject
      img.src = ev.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// --- Carte étudiant ---
const showCard = ref(false)
const cardCanvas = ref<HTMLCanvasElement | null>(null)
const cardGenerated = ref(false)

// Logo UPTECH exact (PNG embarqué en base64)
const UPTECH_LOGO = 'data:image/png;base64,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'

async function generateCard() {
  showCard.value = true
  cardGenerated.value = false
  await new Promise(r => setTimeout(r, 80))
  const canvas = cardCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!

  // Landscape — 85.60 × 53.98 mm @ 300 DPI
  const W = 856, H = 540          // coordonnées logiques (inchangées)
  const PW = 1010, PH = 638       // pixels physiques 300 DPI
  canvas.width = PW
  canvas.height = PH
  ctx.scale(PW / W, PH / H)       // tout le dessin utilise toujours 856×540

  const annee = etudiant.value.inscriptions?.[0]?.annee_academique?.libelle ?? '2025-2026'
  const filiere = etudiant.value.inscriptions?.[0]?.classe?.filiere?.nom ?? ''
  const niveauAcad = etudiant.value.inscriptions?.[0]?.classe?.nom ?? filiere

  // ── 1. Fond blanc ────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // ── 2. Barre noire EN BAS + texte blanc ──────────────────────────────
  const barH = 50
  ctx.fillStyle = '#111111'
  ctx.fillRect(0, H - barH, W, barH)
  ctx.fillStyle = '#ffffff'
  ctx.font = '11px Arial'
  ctx.textAlign = 'center'
  ctx.fillText("Institut supérieur de formation aux nouveaux métiers de l'Informatique et de la Communication", W / 2, H - barH + 30)
  ctx.textAlign = 'left'

  // ── 3. Colonne GAUCHE : titre + photo ────────────────────────────────
  const mainH = H - barH
  const pad = 18
  const leftColW = 278  // largeur de la colonne gauche

  // "CARTE D'ETUDIANT" — gras noir
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 30px Arial'
  ctx.fillText("CARTE D'ETUDIANT", pad, 45)

  // Année — gras noir (même style)
  ctx.font = 'bold 28px Arial'
  ctx.fillText(annee, pad, 83)

  // Photo
  const photoX = pad, photoY = 100, photoW = 206, photoH = mainH - 110
  ctx.strokeStyle = '#444444'
  ctx.lineWidth = 1.5
  ctx.strokeRect(photoX, photoY, photoW, photoH)
  if (etudiant.value.photo_path?.startsWith('data:')) {
    await drawImage(ctx, etudiant.value.photo_path, photoX + 1, photoY + 1, photoW - 2, photoH - 2)
  } else {
    ctx.fillStyle = '#e0e0e0'
    ctx.fillRect(photoX + 1, photoY + 1, photoW - 2, photoH - 2)
    ctx.fillStyle = '#999'
    ctx.font = 'bold 60px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(`${etudiant.value.prenom[0]}${etudiant.value.nom[0]}`.toUpperCase(), photoX + photoW / 2, photoY + photoH / 2 + 22)
    ctx.textAlign = 'left'
  }

  // ── 4. Bande VERTICALE diagonale (séparateur colonnes) ───────────────
  const stripeX = leftColW + pad + 4
  const stripeW = 44
  const sh = 15  // épaisseur de chaque bande

  ctx.save()
  ctx.beginPath()
  ctx.rect(stripeX, 0, stripeW, mainH)
  ctx.clip()
  for (let y = -(stripeW * 2); y < mainH + stripeW * 2; y += sh * 2) {
    // Bande rouge (haut-droite → bas-gauche)
    ctx.fillStyle = '#E30613'
    ctx.beginPath()
    ctx.moveTo(stripeX, y + stripeW)
    ctx.lineTo(stripeX + stripeW, y)
    ctx.lineTo(stripeX + stripeW, y + sh)
    ctx.lineTo(stripeX, y + stripeW + sh)
    ctx.closePath(); ctx.fill()
    // Bande noire
    ctx.fillStyle = '#111111'
    ctx.beginPath()
    ctx.moveTo(stripeX, y + stripeW + sh)
    ctx.lineTo(stripeX + stripeW, y + sh)
    ctx.lineTo(stripeX + stripeW, y + sh * 2)
    ctx.lineTo(stripeX, y + stripeW + sh * 2)
    ctx.closePath(); ctx.fill()
  }
  ctx.restore()

  // ── 5. Colonne DROITE : logo + infos étudiant + coordonnées ──────────
  const rightX = stripeX + stripeW + 14

  // Logo UPTECH — image réelle si disponible, sinon version dessinée
  const logoH = 62
  const logoLoaded = await loadLogoImage(ctx, rightX, pad, logoH)
  if (!logoLoaded) {
    // Fallback : logo dessiné + texte
    const logoSize = 58
    drawUptechLogo(ctx, rightX, pad, logoSize)
    ctx.fillStyle = '#111111'
    ctx.font = 'bold 34px Arial'
    const uptechW2 = ctx.measureText("UP'TECH").width
    ctx.fillText("UP'TECH", rightX + logoSize + 10, pad + logoSize * 0.68)
    ctx.fillStyle = '#E30613'
    ctx.fillRect(rightX, pad + logoSize + 6, logoSize + 12 + uptechW2, 4)
  }

  // Infos étudiant (démarrent sous le logo, quelle que soit la méthode)
  let iy = pad + logoH + 18
  const ilh = 23
  const ifields = [
    { label: 'Prénom (s) : ', value: etudiant.value.prenom },
    { label: 'Nom : ', value: etudiant.value.nom.toUpperCase() },
    { label: 'Niveau académique : ', value: niveauAcad || '—' },
    { label: 'Matricule : ', value: etudiant.value.numero_etudiant },
  ]
  ifields.forEach((f) => {
    ctx.font = '13px Arial'
    ctx.fillStyle = '#111111'
    const lw2 = ctx.measureText(f.label).width
    ctx.fillText(f.label, rightX, iy)
    ctx.font = '13px Arial'
    ctx.fillText(f.value, rightX + lw2, iy)
    iy += ilh
  })

  // Séparateur horizontal
  const sepY = iy + 6
  ctx.strokeStyle = '#bbbbbb'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(rightX, sepY)
  ctx.lineTo(W - pad, sepY)
  ctx.stroke()

  // Coordonnées (icône ◦ / ✉ / ◦)
  const cY = sepY + 18
  const contacts = [
    { icon: '◦', text: ' Sicap Amitié 1, Villa N° 3031' },
    { icon: '◦', text: ' 33 821 34 25 / 77 841 50 44' },
    { icon: '✉', text: ' uptechformation@gmail.com' },
    { icon: '◦', text: ' www.uptechformation.com' },
  ]
  contacts.forEach((c, i) => {
    ctx.font = '12px Arial'
    ctx.fillStyle = '#333333'
    ctx.fillText(c.icon + c.text, rightX, cY + i * 22)
  })

  // ── 6. Bordure arrondie ──────────────────────────────────────────────
  ctx.strokeStyle = '#cccccc'
  ctx.lineWidth = 2
  roundRect(ctx, 1, 1, W - 2, H - 2, 18)
  ctx.stroke()

  cardGenerated.value = true
}

// Charge le logo UPTECH depuis la constante base64 embarquée
function loadLogoImage(ctx: CanvasRenderingContext2D, x: number, y: number, height: number): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const ratio = height / img.height
      const w = img.width * ratio
      ctx.drawImage(img, x, y, w, height)
      resolve(true)
    }
    img.onerror = () => resolve(false)
    img.src = UPTECH_LOGO
  })
}

// Logo UPTECH : carré arrondi rouge + cercle divisé en 4 quadrants (TL=rouge, TR=noir, BR=rouge, BL=noir+arc blanc)
function drawUptechLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const lw = Math.round(size * 0.075)
  const r = (size - lw * 2) / 2 - 2
  const cx = x + size / 2
  const cy = y + size / 2
  const rr = Math.round(size * 0.18) // rayon des coins arrondis

  // Carré rouge arrondi (bordure)
  ctx.strokeStyle = '#E30613'
  ctx.lineWidth = lw
  const half = lw / 2
  ctx.beginPath()
  ctx.moveTo(x + rr, y + half)
  ctx.lineTo(x + size - rr, y + half)
  ctx.quadraticCurveTo(x + size - half, y + half, x + size - half, y + rr)
  ctx.lineTo(x + size - half, y + size - rr)
  ctx.quadraticCurveTo(x + size - half, y + size - half, x + size - rr, y + size - half)
  ctx.lineTo(x + rr, y + size - half)
  ctx.quadraticCurveTo(x + half, y + size - half, x + half, y + size - rr)
  ctx.lineTo(x + half, y + rr)
  ctx.quadraticCurveTo(x + half, y + half, x + rr, y + half)
  ctx.closePath()
  ctx.stroke()

  // Quadrant TL : ROUGE (180° → 270°)
  ctx.fillStyle = '#E30613'
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, r, Math.PI, -Math.PI / 2, false)
  ctx.closePath(); ctx.fill()

  // Quadrant TR : NOIR (270° → 0°)
  ctx.fillStyle = '#111111'
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, r, -Math.PI / 2, 0, false)
  ctx.closePath(); ctx.fill()

  // Quadrant BR : ROUGE (0° → 90°)
  ctx.fillStyle = '#E30613'
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, r, 0, Math.PI / 2, false)
  ctx.closePath(); ctx.fill()

  // Quadrant BL : NOIR (90° → 180°)
  ctx.fillStyle = '#111111'
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, r, Math.PI / 2, Math.PI, false)
  ctx.closePath(); ctx.fill()

  // Arc blanc dans le quadrant BL (évidement intérieur)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, r * 0.52, Math.PI / 2, Math.PI, false)
  ctx.closePath(); ctx.fill()

  // Croix blanche (séparateurs) — clippée au cercle
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = size * 0.04
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke()
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawImage(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number): Promise<void> {
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

function downloadCard() {
  const canvas = cardCanvas.value
  if (!canvas) return
  const link = document.createElement('a')
  link.download = `carte-${etudiant.value.numero_etudiant}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

function printCard() {
  const canvas = cardCanvas.value
  if (!canvas) return
  const dataUrl = canvas.toDataURL('image/png')
  const win = window.open('', '_blank')!
  win.document.write(`
    <html><head><title>Carte étudiant</title>
    <style>
      body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f5f5; }
      img { max-width: 640px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
      @media print { body { background: white; } img { box-shadow: none; } }
    </style></head>
    <body><img src="${dataUrl}" /></body></html>
  `)
  win.document.close()
  win.onload = () => { win.print() }
}

// --- Upload document ---
const docInput = ref<HTMLInputElement | null>(null)
const docType = ref('cni')
const docLoading = ref(false)
const docTypes = [
  { value: 'cni', label: 'CNI' },
  { value: 'passeport', label: 'Passeport' },
  { value: 'photo', label: 'Photo' },
  { value: 'diplome', label: 'Diplôme' },
  { value: 'bulletin_naissance', label: 'Bulletin de naissance' },
  { value: 'contrat_signe', label: 'Contrat signé' },
  { value: 'autre', label: 'Autre' },
]

async function uploadDocument(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  docLoading.value = true
  try {
    const fd = new FormData()
    fd.append('etudiant_id', String(etudiant.value.id))
    fd.append('type_document', docType.value)
    fd.append('fichier', file)
    const { data } = await api.post('/documents', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    etudiant.value.documents.push(data)
  } finally {
    docLoading.value = false
    if (docInput.value) docInput.value.value = ''
  }
}

async function deleteDocument(docId: number) {
  if (!confirm('Supprimer ce document ?')) return
  await api.delete(`/documents/${docId}`)
  etudiant.value.documents = etudiant.value.documents.filter((d: any) => d.id !== docId)
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR')
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
</script>

<template>
  <div class="p-6 lg:p-8 max-w-5xl">

    <!-- Retour -->
    <button @click="router.push('/etudiants')"
      class="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-5 transition">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Retour à la liste
    </button>

    <!-- Chargement -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <svg class="animate-spin w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>

    <template v-else-if="etudiant">

      <!-- Profil header -->
      <div class="bg-white rounded-xl border border-gray-200 p-6 mb-5 flex items-start gap-6">
        <!-- Avatar / Photo -->
        <div class="relative flex-shrink-0">
          <div class="w-20 h-20 rounded-xl overflow-hidden bg-red-100 flex items-center justify-center">
            <img v-if="etudiant.photo_path"
              :src="etudiant.photo_path"
              class="w-full h-full object-cover" />
            <span v-else class="text-2xl font-bold text-red-700 uppercase">
              {{ etudiant.prenom[0] }}{{ etudiant.nom[0] }}
            </span>
          </div>
          <button v-if="canWrite" @click="photoInput?.click()"
            :disabled="photoLoading"
            title="Changer la photo"
            class="absolute -bottom-1.5 -right-1.5 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 transition">
            <svg v-if="!photoLoading" class="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <svg v-else class="w-3 h-3 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </button>
          <input ref="photoInput" type="file" accept="image/*" class="hidden" @change="uploadPhoto" />
        </div>

        <!-- Infos principales -->
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 class="text-xl font-bold text-gray-900">{{ etudiant.prenom }} {{ etudiant.nom }}</h1>
              <p class="text-sm text-gray-500 font-mono mt-0.5">{{ etudiant.numero_etudiant }}</p>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span
                v-if="etudiant.inscriptions?.[0]"
                class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0"
                :class="statutClass[etudiant.inscriptions[0].statut] ?? 'bg-gray-100 text-gray-600'"
              >
                {{ statutLabel[etudiant.inscriptions[0].statut] ?? etudiant.inscriptions[0].statut }}
              </span>
              <!-- Bouton Carte étudiant -->
              <button @click="generateCard"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2" />
                </svg>
                Carte étudiant
              </button>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {{ etudiant.email }}
            </span>
            <span v-if="etudiant.telephone" class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {{ etudiant.telephone }}
            </span>
            <span v-if="etudiant.inscriptions?.[0]?.classe?.filiere" class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
              {{ etudiant.inscriptions[0].classe.filiere.nom }}
            </span>
          </div>
        </div>
      </div>

      <!-- Onglets -->
      <div class="flex border-b border-gray-200 mb-5">
        <button v-for="tab in [
          { key: 'infos', label: 'Informations' },
          { key: 'inscriptions', label: `Inscriptions (${etudiant.inscriptions?.length ?? 0})` },
          { key: 'documents', label: `Documents (${etudiant.documents?.length ?? 0})` },
        ]" :key="tab.key"
          @click="activeTab = tab.key as any"
          class="px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition"
          :class="activeTab === tab.key
            ? 'border-red-600 text-red-600'
            : 'border-transparent text-gray-500 hover:text-gray-700'"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Onglet : Informations -->
      <div v-if="activeTab === 'infos'" class="bg-white rounded-xl border border-gray-200 p-6">
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div v-for="field in [
            { label: 'Nom complet', value: `${etudiant.prenom} ${etudiant.nom}` },
            { label: 'N° étudiant', value: etudiant.numero_etudiant },
            { label: 'Email', value: etudiant.email },
            { label: 'Téléphone', value: etudiant.telephone },
            { label: 'Date de naissance', value: formatDate(etudiant.date_naissance) },
            { label: 'Lieu de naissance', value: etudiant.lieu_naissance },
            { label: 'Adresse', value: etudiant.adresse },
            { label: 'N° CNI', value: etudiant.cni_numero },
          ]" :key="field.label">
            <div>
              <dt class="text-xs font-medium text-gray-500 mb-1">{{ field.label }}</dt>
              <dd class="text-sm text-gray-900">{{ field.value || '—' }}</dd>
            </div>
          </div>
        </dl>
      </div>

      <!-- Onglet : Inscriptions -->
      <div v-else-if="activeTab === 'inscriptions'">
        <div v-if="!etudiant.inscriptions?.length" class="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          Aucune inscription enregistrée
        </div>
        <div v-else class="space-y-3">
          <div v-for="insc in etudiant.inscriptions" :key="insc.id"
            class="bg-white rounded-xl border border-gray-200 p-5">
            <div class="flex items-start justify-between">
              <div>
                <p class="font-medium text-gray-900">{{ insc.classe?.filiere?.nom ?? '—' }}</p>
                <p class="text-sm text-gray-500 mt-0.5">
                  {{ insc.classe?.nom }} — {{ insc.annee_academique?.libelle }}
                </p>
                <p v-if="insc.parcours" class="text-sm text-gray-500">
                  Parcours : {{ insc.parcours.nom }}
                </p>
              </div>
              <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                :class="statutClass[insc.statut] ?? 'bg-gray-100 text-gray-600'">
                {{ statutLabel[insc.statut] ?? insc.statut }}
              </span>
            </div>
            <div class="mt-3 flex gap-4 text-xs text-gray-500">
              <span>Date : {{ formatDate(insc.created_at) }}</span>
              <span v-if="insc.mensualite">Mensualité : {{ Number(insc.mensualite).toLocaleString('fr-FR') }} FCFA</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Onglet : Documents -->
      <div v-else-if="activeTab === 'documents'">
        <div v-if="canWrite" class="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 class="text-sm font-medium text-gray-700 mb-3">Ajouter un document</h3>
          <div class="flex items-center gap-3">
            <select v-model="docType"
              class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
              <option v-for="dt in docTypes" :key="dt.value" :value="dt.value">{{ dt.label }}</option>
            </select>
            <button @click="docInput?.click()" :disabled="docLoading"
              class="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50">
              <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {{ docLoading ? 'Envoi…' : 'Choisir un fichier' }}
            </button>
            <input ref="docInput" type="file" class="hidden" @change="uploadDocument" />
          </div>
        </div>
        <div v-if="!etudiant.documents?.length" class="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          Aucun document enregistré
        </div>
        <div v-else class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50">
                <th class="text-left px-5 py-3 font-medium text-gray-500">Document</th>
                <th class="text-left px-5 py-3 font-medium text-gray-500">Type</th>
                <th class="text-left px-5 py-3 font-medium text-gray-500">Taille</th>
                <th class="text-left px-5 py-3 font-medium text-gray-500">Date</th>
                <th class="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="doc in etudiant.documents" :key="doc.id" class="border-b border-gray-100 last:border-0">
                <td class="px-5 py-3">
                  <span class="text-gray-700 flex items-center gap-2">
                    <svg class="w-4 h-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    {{ doc.nom_fichier }}
                  </span>
                </td>
                <td class="px-5 py-3 text-gray-600 capitalize">{{ doc.type_document?.replace('_', ' ') }}</td>
                <td class="px-5 py-3 text-gray-500">{{ formatFileSize(doc.taille_fichier) }}</td>
                <td class="px-5 py-3 text-gray-500">{{ formatDate(doc.created_at) }}</td>
                <td class="px-5 py-3">
                  <button v-if="canWrite" @click="deleteDocument(doc.id)"
                    class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>
  </div>

  <!-- Modal Carte étudiant -->
  <Teleport to="body">
    <div v-if="showCard" class="card-overlay" @click.self="showCard = false">
      <div class="card-modal">
        <div class="card-modal-header">
          <div>
            <h2 class="card-modal-title">Carte d'étudiant</h2>
            <p class="card-modal-sub">Aperçu — 85.6 × 54 mm (format carte bancaire)</p>
          </div>
          <button @click="showCard = false" class="card-close">✕</button>
        </div>
        <div class="card-modal-body">
          <canvas ref="cardCanvas" class="card-canvas" />
          <p v-if="!cardGenerated" class="card-loading">Génération en cours…</p>
        </div>
        <div v-if="cardGenerated" class="card-modal-footer">
          <button @click="printCard" class="uc-btn-outline">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Imprimer
          </button>
          <button @click="downloadCard" class="uc-btn-primary">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Télécharger PNG
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.card-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.card-modal {
  background: #fff; border-radius: 10px; width: 100%; max-width: 700px;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.card-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px; border-bottom: 1px solid #f0f0f0;
}
.card-modal-title { font-size: 15px; font-weight: 700; color: #111; margin: 0; }
.card-modal-sub { font-size: 11px; color: #aaa; margin: 3px 0 0; }
.card-close { background: none; border: none; cursor: pointer; color: #aaa; font-size: 20px; line-height: 1; }
.card-modal-body { padding: 20px 22px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.card-canvas { width: 100%; max-width: 640px; height: auto; border-radius: 4px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
.card-loading { font-size: 13px; color: #aaa; }
.card-modal-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 14px 22px; border-top: 1px solid #f0f0f0; background: #fafafa;
}
</style>
