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

async function generateCard() {
  showCard.value = true
  cardGenerated.value = false
  await new Promise(r => setTimeout(r, 80))
  const canvas = cardCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!

  // Landscape — 85.6 × 54 mm @ ×10
  const W = 856, H = 540
  canvas.width = W
  canvas.height = H

  const annee = etudiant.value.inscriptions?.[0]?.annee_academique?.libelle ?? '2025-2026'
  const filiere = etudiant.value.inscriptions?.[0]?.classe?.filiere?.nom ?? ''
  const niveauAcad = etudiant.value.inscriptions?.[0]?.classe?.nom ?? filiere

  // ── 1. Fond blanc ────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // ── 2. Bande noire verticale gauche ──────────────────────────────────
  const stripW = 52
  ctx.fillStyle = '#111111'
  ctx.fillRect(0, 0, stripW, H)

  ctx.save()
  ctx.translate(stripW / 2, H / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = '#ffffff'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'
  ctx.fillText("Institut supérieur de formation aux nouveaux métiers de l'Informatique et de la Communication", 0, 5)
  ctx.restore()

  // ── 3. Zone haute ────────────────────────────────────────────────────
  const contentX = stripW + 16
  const topH = 275

  // --- Photo ---
  const photoX = contentX, photoY = 20, photoW = 170, photoH = 228
  ctx.strokeStyle = '#444444'
  ctx.lineWidth = 1.5
  ctx.strokeRect(photoX, photoY, photoW, photoH)

  if (etudiant.value.photo_path?.startsWith('data:')) {
    await drawImage(ctx, etudiant.value.photo_path, photoX + 1, photoY + 1, photoW - 2, photoH - 2)
  } else {
    ctx.fillStyle = '#e0e0e0'
    ctx.fillRect(photoX + 1, photoY + 1, photoW - 2, photoH - 2)
    ctx.fillStyle = '#999999'
    ctx.font = 'bold 56px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(
      `${etudiant.value.prenom[0]}${etudiant.value.nom[0]}`.toUpperCase(),
      photoX + photoW / 2, photoY + photoH / 2 + 20
    )
    ctx.textAlign = 'left'
  }

  // --- Titre + Année (tous les deux en NOIR gras) ---
  const titleX = photoX + photoW + 24
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 38px Arial'
  ctx.fillText("CARTE D'ETUDIANT", titleX, photoY + 56)

  ctx.fillStyle = '#111111'
  ctx.font = 'bold 34px Arial'
  ctx.fillText(annee, titleX, photoY + 106)

  // ── 4. Bande diagonale rouge/noir ────────────────────────────────────
  const stripeY = topH
  const stripeH = 34
  const stripeStartX = stripW
  const stripeWidth = W - stripW

  ctx.save()
  ctx.beginPath()
  ctx.rect(stripeStartX, stripeY, stripeWidth, stripeH)
  ctx.clip()

  const sw = 22
  for (let i = -stripeH * 2; i < stripeWidth + stripeH * 2; i += sw * 2) {
    ctx.fillStyle = '#E30613'
    ctx.beginPath()
    ctx.moveTo(stripeStartX + i, stripeY)
    ctx.lineTo(stripeStartX + i + sw, stripeY)
    ctx.lineTo(stripeStartX + i + sw + stripeH, stripeY + stripeH)
    ctx.lineTo(stripeStartX + i + stripeH, stripeY + stripeH)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#111111'
    ctx.beginPath()
    ctx.moveTo(stripeStartX + i + sw, stripeY)
    ctx.lineTo(stripeStartX + i + sw * 2, stripeY)
    ctx.lineTo(stripeStartX + i + sw * 2 + stripeH, stripeY + stripeH)
    ctx.lineTo(stripeStartX + i + sw + stripeH, stripeY + stripeH)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()

  // ── 5. Zone basse ────────────────────────────────────────────────────
  const botY = stripeY + stripeH + 12

  // --- Logo UPTECH (bas droite) — demi-disque rouge + texte ---
  const logoAreaX = W - 230
  const logoY = botY + 2
  const discR = 34
  const discCx = logoAreaX + discR + 4
  const discCy = logoY + discR

  // Demi-disque rouge (sommet en haut, plat en bas)
  ctx.fillStyle = '#E30613'
  ctx.beginPath()
  ctx.arc(discCx, discCy, discR, Math.PI, 0, false) // arc supérieur
  ctx.closePath()
  ctx.fill()
  // Base plate
  ctx.fillStyle = '#E30613'
  ctx.fillRect(discCx - discR, discCy - 1, discR * 2, 4)

  // Demi-cercle blanc intérieur (effet évidé)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(discCx, discCy, discR * 0.55, Math.PI, 0, false)
  ctx.closePath()
  ctx.fill()

  // "UP'TECH" à droite du disque
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 26px Arial'
  ctx.fillText("UP'TECH", discCx + discR + 8, discCy - 10)
  ctx.font = '11px Arial'
  ctx.fillStyle = '#666666'
  ctx.fillText('Formation professionnelle', discCx + discR + 8, discCy + 10)

  // Infos étudiant (sous logo, bas droite)
  const infoX = logoAreaX
  const infoY = logoY + discR * 2 + 14
  const lineH = 21

  const fields: Array<{ label: string; value: string; bold?: boolean; red?: boolean }> = [
    { label: 'Prénom(s)', value: etudiant.value.prenom },
    { label: 'Nom', value: etudiant.value.nom.toUpperCase() },
    { label: 'Niveau acad.', value: niveauAcad || '—' },
    { label: 'Matricule', value: etudiant.value.numero_etudiant, bold: true, red: true },
  ]
  fields.forEach((f, i) => {
    ctx.font = '11px Arial'
    ctx.fillStyle = '#777777'
    ctx.fillText(f.label + ' :', infoX, infoY + i * lineH)
    ctx.font = f.bold ? 'bold 12.5px Arial' : '12.5px Arial'
    ctx.fillStyle = f.red ? '#E30613' : '#111111'
    ctx.fillText(f.value, infoX + 90, infoY + i * lineH)
  })

  // --- Coordonnées (bas gauche) ---
  const addrX = contentX
  const addrY = botY + 16
  const contacts: Array<{ text: string; red?: boolean }> = [
    { text: 'Sicap Amitie 1, Villa N 3031' },
    { text: '33 821 34 25 / 77 841 50 44' },
    { text: 'uptechformation@gmail.com' },
    { text: 'www.uptechformation.com', red: true },
  ]
  contacts.forEach((c, i) => {
    ctx.font = '12.5px Arial'
    ctx.fillStyle = c.red ? '#E30613' : '#333333'
    // petit bullet rouge
    ctx.fillStyle = '#E30613'
    ctx.beginPath()
    ctx.arc(addrX + 4, addrY + i * 24 - 4, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = c.red ? '#E30613' : '#333333'
    ctx.fillText(c.text, addrX + 14, addrY + i * 24)
  })

  // ── 6. Bordure arrondie ──────────────────────────────────────────────
  ctx.strokeStyle = '#cccccc'
  ctx.lineWidth = 2
  roundRect(ctx, 1, 1, W - 2, H - 2, 18)
  ctx.stroke()

  cardGenerated.value = true
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
