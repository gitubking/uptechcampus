<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const canWrite = computed(() => ['dg', 'secretariat'].includes(auth.user?.role ?? ''))
const canDelete = computed(() => auth.user?.role === 'dg')

// ── Suppression définitive ────────────────────────────────────────────
const showDeleteModal = ref(false)
const confirmDeleteName = ref('')
const deletingEtudiant = ref(false)

async function confirmDeleteEtudiant() {
  if (!etudiant.value) return
  const fullName = `${etudiant.value.prenom} ${etudiant.value.nom}`
  if (confirmDeleteName.value.trim().toLowerCase() !== fullName.toLowerCase()) return
  deletingEtudiant.value = true
  try {
    await api.delete(`/etudiants/${etudiant.value.id}`)
    router.push('/etudiants')
  } catch (err: any) {
    alert(err?.response?.data?.message || 'Erreur lors de la suppression')
    deletingEtudiant.value = false
  }
}

// --- Données ---
const etudiant = ref<any>(null)
const loading = ref(true)
const activeTab = ref<'infos' | 'inscriptions' | 'documents'>('infos')
const echeancesMap = ref<Record<number, any[]>>({})
const paiementsMap = ref<Record<number, any[]>>({})

async function fetchEtudiant() {
  loading.value = true
  try {
    const { data } = await api.get(`/etudiants/${route.params.id}`)
    etudiant.value = data
    const inscriptions: any[] = data.inscriptions ?? []
    // Charger les échéances pour chaque inscription
    for (const insc of inscriptions) {
      api.get(`/echeances?inscription_id=${insc.id}`).then(r => {
        echeancesMap.value = { ...echeancesMap.value, [insc.id]: r.data.data ?? r.data }
      }).catch(() => {})
    }
    // Charger tous les paiements et filtrer par inscription
    if (inscriptions.length) {
      api.get('/paiements').then(r => {
        const all: any[] = r.data.data ?? r.data
        const map: Record<number, any[]> = {}
        for (const insc of inscriptions) {
          map[insc.id] = all.filter(p => Number(p.inscription_id) === Number(insc.id) && p.statut === 'confirme')
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        }
        paiementsMap.value = map
      }).catch(() => {})
    }
  } finally {
    loading.value = false
  }
}

function printRecuDetail(p: any, insc: any) {
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const prenom = insc.etudiant?.prenom ?? etudiant.value?.prenom ?? ''
  const nom = insc.etudiant?.nom ?? etudiant.value?.nom ?? ''
  const filiere = insc.filiere?.nom ?? insc.classe?.filiere?.nom ?? '—'
  const typeLabel = p.type_paiement === 'frais_inscription' ? "Frais d'inscription"
    : p.type_paiement === 'mensualite' ? 'Mensualité'
    : p.type_paiement === 'tenue' ? 'Tenue scolaire'
    : p.type_paiement === 'rattrapage' ? 'Rattrapage'
    : p.type_paiement
  const dateLabel = new Date(p.confirmed_at ?? p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const moisConcerne = p.mois_concerne
  const moisLabel = moisConcerne
    ? new Date(moisConcerne.length === 7 ? moisConcerne + '-01' : moisConcerne).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : null
  const modeStr = ({ especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', virement: 'Virement', cheque: 'Chèque' } as Record<string,string>)[p.mode_paiement] ?? p.mode_paiement
  const montantStr = Number(p.montant).toLocaleString('fr-FR')

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
          <div class="info-box"><label>Filière</label><span>${filiere}</span></div>
          <div class="info-box"><label>Type</label><span>${typeLabel}</span></div>
          <div class="info-box"><label>Mode</label><span>${modeStr}</span></div>
          <div class="info-box"><label>Date</label><span>${dateLabel}</span></div>
          ${moisLabel ? `<div class="info-box"><label>Période</label><span>${moisLabel}</span></div>` : ''}
          ${p.reference ? `<div class="info-box full"><label>Référence</label><span style="font-family:monospace">${p.reference}</span></div>` : ''}
        </div>
        <div class="montant-box"><div class="lbl">Montant payé</div><div class="amt">${montantStr} FCFA</div></div>
        <div class="sign-area">
          <div class="sign-box"><div class="sign-line"></div><label>Signature du caissier</label></div>
          <div class="sign-box"><div class="sign-line"></div><label>Cachet de l'établissement</label></div>
        </div>
        <div class="footer-bar">Amitié 1, Villa n°3031 — Dakar &nbsp;|&nbsp; +221 77 841 50 44 / 77 618 45 52 &nbsp;|&nbsp; uptechformation.com</div>
      </div>
    </div>`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reçu ${p.numero_recu}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#111;font-size:11px}
    .recu-block{padding-bottom:6px}.exemplaire{text-align:right;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#aaa;padding:4px 16px 2px}
    .hdr{display:flex;align-items:center;gap:14px;padding:10px 16px 8px;border-bottom:2px solid #E30613}
    .hdr img{width:52px;height:52px;object-fit:contain;flex-shrink:0}
    .hdr-info .tagline{font-size:7px;font-weight:700;color:#E30613;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
    .hdr-info h1{font-size:11px;font-weight:900;color:#111;line-height:1.2;margin-bottom:3px}
    .hdr-info .meta{font-size:8px;color:#555;line-height:1.5}.hdr-info .agree{font-size:7px;color:#888;margin-top:2px}
    .content{padding:10px 16px}.recu-title{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#111;margin-bottom:8px}
    .recu-num{font-size:11px;font-weight:400;color:#888;font-family:monospace;letter-spacing:1px}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}
    .info-box{background:#f9f9f9;border:1px solid #eee;border-radius:4px;padding:6px 10px}
    .info-box label{font-size:7px;text-transform:uppercase;color:#aaa;font-weight:700;letter-spacing:0.5px;display:block;margin-bottom:2px}
    .info-box span{font-size:11px;font-weight:700;color:#111}.full{grid-column:1/-1}
    .montant-box{border:1.5px solid #111;border-radius:6px;padding:8px 16px;text-align:center;margin:10px 0}
    .montant-box .lbl{font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:2px}
    .montant-box .amt{font-size:20px;font-weight:900;color:#111}
    .sign-area{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:10px;padding-top:8px;border-top:1px dashed #ddd}
    .sign-box{text-align:center}.sign-line{border-bottom:1px solid #ccc;height:30px;margin-bottom:4px}
    .sign-box label{font-size:7px;color:#aaa;text-transform:uppercase}
    .footer-bar{border-top:1px solid #ccc;color:#777;font-size:7px;text-align:center;padding:4px 16px;margin-top:10px}
    .cut-line{display:flex;align-items:center;gap:8px;margin:8px 0;color:#aaa;font-size:8px}
    .cut-line::before,.cut-line::after{content:'';flex:1;border-top:1px dashed #aaa}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head>
  <body>${recuBlock('Exemplaire établissement')}<div class="cut-line">✂ &nbsp; Découper ici</div>${recuBlock('Exemplaire étudiant')}</body></html>`

  openPrintAndClose(html)
}

function fmtMoisEch(d: string) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
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
const carteBloquee = computed(() => !etudiant.value?.inscriptions?.[0]?.classe?.id)

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

  const insc0 = etudiant.value.inscriptions?.[0]
  const filiere = insc0?.filiere?.nom ?? insc0?.classe?.filiere?.nom ?? ''
  const classe = insc0?.classe
  const classeNom = classe?.nom ?? '—'
  const classeNiveau = classe?.niveau ?? 1
  const hasNiveau0 = !!((insc0?.filiere as any)?.type_has_niveau ?? (insc0?.classe?.filiere as any)?.type_has_niveau ?? false)
  const niveauLabel = hasNiveau0
    ? (classeNiveau === 1 ? '1ère Année' : `${classeNiveau}ème Année`)
    : classeNom

  // ── 1. Fond blanc ────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // ── 2. Barre noire EN BAS + texte blanc ──────────────────────────────
  const barH = 55
  ctx.fillStyle = '#111111'
  ctx.fillRect(0, H - barH, W, barH)
  ctx.fillStyle = '#ffffff'
  const barText = "Institut supérieur de formation aux nouveaux métiers de l'Informatique et de la Communication"
  let barFontSize = 22
  ctx.font = `${barFontSize}px Arial`
  while (ctx.measureText(barText).width > W - 24 && barFontSize > 10) {
    barFontSize--
    ctx.font = `${barFontSize}px Arial`
  }
  ctx.textAlign = 'center'
  ctx.fillText(barText, W / 2, H - barH + Math.round(barH / 2) + barFontSize / 3)
  ctx.textAlign = 'left'

  // ── 3. Colonne GAUCHE : titre + photo ────────────────────────────────
  const mainH = H - barH
  const pad = 18
  const leftColW = 278  // largeur de la colonne gauche

  // "CARTE D'ETUDIANT" — gras noir
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 24px Arial'
  ctx.fillText("CARTE D'ETUDIANT", pad, 45)

  // Année académique — centré sous "CARTE D'ETUDIANT"
  const annee = insc0?.annee_academique?.libelle ?? ''
  ctx.font = 'bold 20px Arial'
  ctx.textAlign = 'center'
  ctx.fillText(annee, pad + leftColW / 2, 80)
  ctx.textAlign = 'left'

  // Trait de séparation centré sous l'année
  const leftCenterX = pad + leftColW / 2
  const lineHalfW = 80
  ctx.strokeStyle = '#cccccc'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(leftCenterX - lineHalfW, 92)
  ctx.lineTo(leftCenterX + lineHalfW, 92)
  ctx.stroke()

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
  const logoH = 84
  const logoLoaded = await loadLogoImage(ctx, rightX, pad, logoH)
  if (!logoLoaded) {
    // Fallback : logo dessiné + texte
    const logoSize = 78
    drawUptechLogo(ctx, rightX, pad, logoSize)
    ctx.fillStyle = '#111111'
    ctx.font = 'bold 34px Arial'
    const uptechW2 = ctx.measureText("UP'TECH").width
    ctx.fillText("UP'TECH", rightX + logoSize + 10, pad + logoSize * 0.68)
    ctx.fillStyle = '#E30613'
    ctx.fillRect(rightX, pad + logoSize + 6, logoSize + 12 + uptechW2, 4)
  }

  // Infos étudiant (démarrent sous le logo + marge)
  let iy = pad + logoH + 32
  const ilh = 26
  const ifields = [
    { label: 'Prénom (s) : ', value: etudiant.value.prenom },
    { label: 'Nom : ', value: etudiant.value.nom.toUpperCase() },
    { label: 'Filière : ', value: filiere || '—' },
    ...(hasNiveau0 ? [{ label: "Niveau d'études : ", value: classeNiveau === 1 ? '1ère Année' : `${classeNiveau}ème Année` }] : []),
    { label: 'Classe : ', value: classeNom },
    { label: 'Matricule : ', value: etudiant.value.numero_etudiant },
  ]
  ifields.forEach((f) => {
    ctx.font = 'bold 18px Arial'
    ctx.fillStyle = '#111111'
    const lw2 = ctx.measureText(f.label).width
    ctx.fillText(f.label, rightX, iy)
    ctx.font = '18px Arial'
    ctx.fillText(f.value, rightX + lw2, iy)
    iy += ilh
  })

  // Coordonnées — ancrées en bas de la colonne droite
  const contacts = [
    { icon: '◦', text: ' Sicap Amitié 1, Villa N° 3031' },
    { icon: '◦', text: ' 33 821 34 25 / 77 841 50 44' },
    { icon: '✉', text: ' uptechformation@gmail.com' },
    { icon: '◦', text: ' www.uptechformation.com' },
  ]
  const contactSpacing = 26
  const cY = mainH - (contacts.length * contactSpacing) - 10
  contacts.forEach((c, i) => {
    ctx.font = '18px Arial'
    ctx.fillStyle = '#333333'
    ctx.fillText(c.icon + c.text, rightX, cY + i * contactSpacing)
  })

  // Séparateur horizontal — position fixe au-dessus des contacts
  const sepY = cY - 24
  ctx.strokeStyle = '#bbbbbb'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(rightX, sepY)
  ctx.lineTo(W - pad, sepY)
  ctx.stroke()

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
  const cardHtml = `<html><head><title>Carte étudiant</title>
    <style>
      body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f5f5; }
      img { max-width: 640px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
      @media print { body { background: white; } img { box-shadow: none; } }
    </style></head>
    <body><img src="${dataUrl}" /></body></html>`
  openPrintAndClose(cardHtml)
}

// --- Utilitaire impression auto (blob URL) ---
function openPrintAndClose(html: string) {
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

// --- Fiche & Certificat d'inscription ---
function openPrintWindow(html: string) {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function printFicheDetail() {
  const etd = etudiant.value
  const insc = etd.inscriptions?.[0]
  if (!etd || !insc) { alert("Aucune inscription trouvée pour cet étudiant."); return }
  const fmt = (n: number | null | undefined) =>
    n != null ? new Intl.NumberFormat('fr-FR').format(n) + ' FCFA' : '—'
  const val = (v: any) => v || '—'
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return d }
  }
  const filiere = insc?.filiere?.nom ?? insc?.classe?.filiere?.nom ?? '—'
  const niveau = insc?.niveau_entree?.nom ?? '—'
  const bourse = insc?.niveau_bourse?.nom ? `${insc.niveau_bourse.nom} (${insc.niveau_bourse.pourcentage}%)` : 'Aucune'
  const annee = insc?.annee_academique?.libelle ?? '—'
  const sLabel = statutLabel[insc?.statut] ?? insc?.statut ?? '—'
  const nv = (insc?.classe as any)?.niveau
  const hasNiveau = !!(
    (insc?.filiere as any)?.type_has_niveau
    ?? (insc?.classe?.filiere as any)?.type_has_niveau
    ?? false
  )
  const niveauEtude = (nv && hasNiveau) ? (nv === 1 ? '1ère année' : `${nv}ème année`) : null
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const dots = '◦ '.repeat(80)
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<title>Fiche d'inscription — ${etd.prenom} ${etd.nom}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:11.5px;color:#111;background:#fff;padding:6mm 15mm}
@page{size:A4 portrait;margin:0}@media print{body{padding:6mm 15mm}}
.hdr{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:4px;gap:0}
.hdr img{width:113px;height:113px;object-fit:contain;display:block;margin-bottom:-18px}
.hdr-info{text-align:center;line-height:1.4}
.hdr-info .tagline{font-size:10px;font-weight:700;color:#111;margin-bottom:1px}
.hdr-info .meta{font-size:9px;color:#333;line-height:1.4;margin-bottom:1px}
.hdr-info .agree{font-size:8.5px;color:#333;font-weight:700;text-decoration:underline}
.dots{font-size:8px;color:#E30613;letter-spacing:1px;overflow:hidden;white-space:nowrap;margin:8px 0 16px;opacity:.7}
.fiche-title{text-align:center;margin-bottom:18px}
.fiche-title h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:2px;border:2px solid #111;display:inline-block;padding:6px 24px}
.fiche-title .meta-row{font-size:10px;color:#555;margin-top:6px;display:flex;justify-content:center;gap:24px}
.fiche-title .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.sec{margin-bottom:14px}
.sec-title{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#fff;background:#E30613;padding:4px 10px;margin-bottom:0}
table{width:100%;border-collapse:collapse}
td{padding:5px 9px;border:1px solid #ccc;vertical-align:middle;font-size:11px}
td.lbl{font-weight:700;color:#444;width:32%;background:#f5f5f5;white-space:nowrap}
td.lbl2{font-weight:700;color:#444;width:18%;background:#f5f5f5;white-space:nowrap}
.fin-tbl td:last-child{text-align:right;font-weight:600}
.sign-row{display:flex;gap:16px;margin-top:24px}
.sign-box{flex:1;border:1px solid #ccc;padding:12px 14px;min-height:90px}
.sign-box h4{font-size:9.5px;font-weight:700;text-transform:uppercase;color:#555;margin-bottom:50px;border-bottom:1px dashed #ddd;padding-bottom:6px}
.sign-box .sign-line{border-top:1px solid #bbb;padding-top:4px;font-size:9px;color:#aaa;text-align:center}
.mention{margin-top:16px;font-size:8.5px;color:#777;text-align:center;font-style:italic}
.footer-bar{margin-top:10px;border-top:2px solid #E30613;padding-top:6px;font-size:9px;text-align:center;color:#333}
.page2{page-break-before:always;padding-top:10mm}
.ri-hdr{text-align:center;margin-bottom:16px}
.ri-hdr h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:2px;border:2px solid #E30613;display:inline-block;padding:6px 28px;color:#E30613}
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
</style></head><body>
<div class="hdr"><img src="${logoUrl}" alt="UP'TECH"/>
<div class="hdr-info">
<div class="tagline">Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</div>
<div class="meta">NINEA 006118310 _ BP 50281 RP DAKAR</div>
<div class="agree">Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT</div>
</div></div>
<div class="dots">${dots}</div>
<div class="fiche-title"><h2>Fiche d'Inscription</h2>
<div class="meta-row"><span>Année académique : <strong>${annee}</strong></span>${etd.numero_etudiant ? `<span>N° ${etd.numero_etudiant}</span>` : ''}<span class="badge">${sLabel}</span><span>Imprimé le : <strong>${new Date().toLocaleDateString('fr-FR')}</strong></span></div></div>
<div class="sec"><div class="sec-title">Identité de l'étudiant(e)</div><table>
<tr><td class="lbl">Prénom</td><td>${val(etd.prenom)}</td><td class="lbl2">Nom</td><td>${val(etd.nom)}</td></tr>
<tr><td class="lbl">Date de naissance</td><td>${fmtDate(etd.date_naissance)}</td><td class="lbl2">Lieu de naissance</td><td>${val(etd.lieu_naissance)}</td></tr>
<tr><td class="lbl">Email</td><td>${val(etd.email)}</td><td class="lbl2">Téléphone</td><td>${val(etd.telephone)}</td></tr>
<tr><td class="lbl">Adresse</td><td colspan="3">${val(etd.adresse)}</td></tr>
<tr><td class="lbl">N° CNI / Passeport</td><td colspan="3">${val(etd.cni_numero)}</td></tr>
<tr><td class="lbl">Parent / Tuteur</td><td>${val(etd.nom_parent)}</td><td class="lbl2">Tél. parent</td><td>${val(etd.telephone_parent)}</td></tr>
</table></div>
<div class="sec"><div class="sec-title">Paramètres d'inscription</div><table>
<tr><td class="lbl">Filière</td><td>${filiere}</td><td class="lbl2">Niveau d'entrée</td><td>${niveau}</td></tr>
<tr><td class="lbl">Année académique</td><td>${annee}</td><td class="lbl2">Bourse</td><td>${bourse}</td></tr>
${niveauEtude ? `<tr><td class="lbl">Année d'étude</td><td><strong>${niveauEtude}</strong></td><td class="lbl2">Classe affectée</td><td>${insc?.classe?.nom ?? 'Pool (à affecter)'}</td></tr>` : `<tr><td class="lbl">Classe affectée</td><td colspan="3">${insc?.classe?.nom ?? 'Pool (à affecter)'}</td></tr>`}
</table></div>
<div class="sec"><div class="sec-title">Conditions financières</div><table class="fin-tbl">
<tr><td class="lbl" style="width:40%">Frais d'inscription</td><td>${fmt(insc?.frais_inscription)}</td></tr>
<tr><td class="lbl">Mensualité</td><td>${fmt(insc?.mensualite)}</td></tr>
${insc?.frais_tenue ? `<tr><td class="lbl">Frais de tenue</td><td>${fmt(insc.frais_tenue)}</td></tr>` : ''}
</table></div>
<div class="sign-row">
<div class="sign-box"><h4>Signature de l'étudiant(e)</h4><div class="sign-line">Lu et approuvé — Signature</div></div>
<div class="sign-box"><h4>Cachet et signature de la Direction</h4><div class="sign-line">Tampon + Signature</div></div>
</div>
<div class="mention">En signant cette fiche, l'étudiant(e) reconnaît avoir pris connaissance du règlement intérieur et s'engage à respecter ses obligations académiques et financières.</div>
<div class="footer-bar">Amitié 1, Villa n°3031 — Dakar, Sénégal | +221 77 841 50 44 / 77 618 45 52 | uptechformation.com</div>
<div class="page2">
<div class="ri-hdr"><h2>Règlement Intérieur</h2><p>UP'TECH — Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</p></div>
<div class="ri-art"><span class="ri-art-title">Article 1 — Assiduité et ponctualité</span><ul><li>La présence aux cours, travaux pratiques et examens est <strong>obligatoire</strong>.</li><li>Tout retard ou absence doit être justifié dans les 48 heures auprès du secrétariat.</li><li>Au-delà de 30 % d'absences non justifiées, l'étudiant(e) peut être exclu(e) des examens.</li><li>Les retards répétés sont sanctionnés et signalés au responsable pédagogique.</li></ul></div>
<div class="ri-art"><span class="ri-art-title">Article 2 — Tenue et comportement</span><ul><li>Une tenue correcte et décente est exigée au sein de l'établissement.</li><li>Le respect mutuel entre étudiants, enseignants et personnel administratif est impératif.</li><li>Tout comportement irrespectueux, violent ou discriminatoire entraîne des sanctions disciplinaires.</li><li>L'usage du téléphone portable est interdit en salle de cours, sauf autorisation expresse.</li></ul></div>
<div class="ri-art"><span class="ri-art-title">Article 3 — Obligations financières</span><ul><li>Les frais d'inscription sont dus avant le début de l'année académique.</li><li>Les mensualités sont payables au plus tard le <strong>5 de chaque mois</strong>.</li><li>Tout retard de paiement peut entraîner la suspension temporaire de l'accès aux cours et examens.</li><li>Aucun remboursement des frais d'inscription n'est accordé après validation du dossier.</li></ul></div>
<div class="ri-art"><span class="ri-art-title">Article 4 — Utilisation du matériel et des locaux</span><ul><li>Le matériel informatique mis à disposition doit être utilisé à des fins exclusivement pédagogiques.</li><li>Tout dommage causé au matériel engage la responsabilité financière de l'étudiant(e).</li><li>Il est interdit de manger, de fumer et de consommer de l'alcool dans les locaux.</li><li>Les locaux doivent être laissés propres après chaque utilisation.</li></ul></div>
<div class="ri-art"><span class="ri-art-title">Article 5 — Examens et évaluation</span><ul><li>Toute fraude lors des examens entraîne l'annulation de l'épreuve et des sanctions disciplinaires.</li><li>Le plagiat dans les travaux rendus est strictement interdit et sanctionné.</li><li>Les résultats sont définitifs après validation par le jury pédagogique.</li><li>Les réclamations doivent être formulées par écrit dans un délai de 5 jours ouvrables.</li></ul></div>
<div class="ri-art"><span class="ri-art-title">Article 6 — Sanctions disciplinaires</span><ul><li>Les manquements au présent règlement sont sanctionnés selon leur gravité : avertissement, blâme, suspension ou exclusion définitive.</li><li>Tout recours doit être adressé par écrit à la Direction dans un délai de 5 jours.</li></ul></div>
<div class="ri-sign"><div class="ri-sign-title">Engagement de l'étudiant(e)</div>
<div class="ri-sign-text">Je soussigné(e) <strong>${val(etd.prenom)} ${val(etd.nom)}</strong>, inscrit(e) en <strong>${filiere}</strong> pour l'année académique <strong>${annee}</strong>,<br>déclare avoir lu et compris le règlement intérieur de l'établissement UP'TECH et m'engage à le respecter.<br>Fait à Dakar, le ___________________________</div>
<div class="ri-sign-boxes"><div class="ri-sign-box"><h4>Signature de l'étudiant(e)</h4><div class="sign-line">Signature précédée de la mention « Lu et approuvé »</div></div>
<div class="ri-sign-box"><h4>Cachet et signature de la Direction</h4><div class="sign-line">Tampon + Signature</div></div></div></div>
<div class="footer-bar" style="margin-top:20px">UP'TECH Formation — Amitié 1, Villa n°3031, Dakar, Sénégal | +221 77 841 50 44 / 77 618 45 52</div>
</div>
<script>window.onload=()=>{window.print()}<\/script></body></html>`
  openPrintWindow(html)
}

function printCertificatDetail() {
  const etd = etudiant.value
  const insc = etd.inscriptions?.[0]
  if (!etd || !insc) { alert("Aucune inscription trouvée pour cet étudiant."); return }
  const val = (v: any) => v || '—'
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return d }
  }
  const filiere = insc?.filiere?.nom ?? insc?.classe?.filiere?.nom ?? '—'
  const niveau = insc?.niveau_entree?.nom ?? '—'
  const annee = insc?.annee_academique?.libelle ?? '—'
  const nvc = (insc?.classe as any)?.niveau
  const hasNiveauC = !!(
    (insc?.filiere as any)?.type_has_niveau
    ?? (insc?.classe?.filiere as any)?.type_has_niveau
    ?? false
  )
  const niveauEtude = (nvc && hasNiveauC) ? (nvc === 1 ? '1ère année' : `${nvc}ème année`) : null
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const refNum = `UPTECH/${new Date().getFullYear()}/${String(etd.id ?? Math.floor(Math.random()*9000+1000)).padStart(4,'0')}`
  const dateJour = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const dots = '◦ '.repeat(80)
  const sLabel = statutLabel[insc?.statut] ?? insc?.statut ?? '—'
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<title>Certificat d'inscription — ${etd.prenom} ${etd.nom}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff;padding:6mm 15mm}
@page{size:A4 portrait;margin:0}@media print{body{padding:6mm 15mm}}
.hdr{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:4px;gap:0}
.hdr img{width:113px;height:113px;object-fit:contain;display:block;margin-bottom:-18px}
.hdr-info{text-align:center;line-height:1.4}
.hdr-info .tagline{font-size:10px;font-weight:700;color:#111;margin-bottom:1px}
.hdr-info .meta{font-size:9px;color:#333;line-height:1.4;margin-bottom:1px}
.hdr-info .agree{font-size:8.5px;color:#333;font-weight:700;text-decoration:underline}
.dots{font-size:8px;color:#E30613;letter-spacing:1px;overflow:hidden;white-space:nowrap;margin:8px 0 14px;opacity:.7}
.ref-row{display:flex;justify-content:space-between;font-size:9.5px;color:#555;margin-bottom:28px}
.cert-title{text-align:center;margin-bottom:32px}
.cert-title h2{font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#111;border-bottom:3px solid #E30613;display:inline-block;padding-bottom:6px}
.cert-title p{font-size:10px;color:#888;margin-top:6px;letter-spacing:1px;text-transform:uppercase}
.cert-body{font-size:12px;line-height:2;color:#111;text-align:justify;margin:0 10mm 28px}
.cert-body .highlight{font-weight:700;font-size:13px}
.cert-body .underline{text-decoration:underline;font-weight:600}
.cert-card{border:1px solid #ccc;border-left:4px solid #E30613;padding:12px 16px;margin:0 10mm 28px;background:#fafafa}
.cert-card table{width:100%;border-collapse:collapse}
.cert-card td{padding:4px 8px;font-size:11px;vertical-align:middle}
.cert-card td:first-child{font-weight:700;color:#555;width:38%;white-space:nowrap}
.cert-usage{font-size:10px;color:#555;font-style:italic;text-align:center;margin:0 10mm 32px;padding:8px;border:1px dashed #ccc}
.cert-sign{display:flex;justify-content:flex-end;margin:0 10mm}
.cert-sign-box{text-align:center;min-width:200px}
.cert-sign-box .sign-place{font-size:10px;color:#555;margin-bottom:4px}
.cert-sign-box .sign-name{font-size:10px;font-weight:700;color:#111;margin-bottom:2px}
.cert-sign-box .sign-title{font-size:9px;color:#888}
.cert-sign-box .sign-zone{height:60px;border-bottom:1px solid #bbb;margin:8px 0 4px}
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
<span class="highlight">${etd.prenom?.toUpperCase()} ${etd.nom?.toUpperCase()}</span>
${etd.date_naissance ? `, né(e) le <span class="underline">${fmtDate(etd.date_naissance)}</span> à <span class="underline">${val(etd.lieu_naissance)}</span>,` : ''}
${etd.cni_numero ? `porteur/porteuse de la CNI N° <span class="underline">${etd.cni_numero}</span>,` : ''}
<br><br>est régulièrement inscrit(e) dans notre établissement pour l'année académique <span class="underline">${annee}</span>, dans la filière ci-dessous :
</div>
<div class="cert-card"><table>
<tr><td>Numéro étudiant</td><td>${etd.numero_etudiant ?? '—'}</td></tr>
<tr><td>Filière</td><td>${filiere}</td></tr>
<tr><td>Niveau d'entrée</td><td>${niveau}</td></tr>
${niveauEtude ? `<tr><td>Année d'étude</td><td><strong>${niveauEtude}</strong></td></tr>` : ''}
<tr><td>Classe</td><td>${insc?.classe?.nom ?? 'Pool (à affecter)'}</td></tr>
<tr><td>Statut</td><td>${sLabel}</td></tr>
</table></div>
<div class="cert-usage">Ce certificat est délivré à l'intéressé(e) pour servir et valoir ce que de droit, notamment pour les démarches administratives, bancaires et auprès des autorités compétentes.</div>
<div class="cert-sign"><div class="cert-sign-box">
<div class="sign-place">Dakar, le ${dateJour}</div>
<div class="sign-zone"></div>
<div class="sign-name">Le Directeur Général</div>
<div class="sign-title">UP'TECH Formation</div>
</div></div>
<div class="footer-bar">UP'TECH Formation — Amitié 1, Villa n°3031, Dakar, Sénégal | +221 77 841 50 44 / 77 618 45 52 | uptechformation.com</div>
<script>window.onload=()=>{window.print()}<\/script></body></html>`
  openPrintWindow(html)
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
                :disabled="carteBloquee"
                :title="carteBloquee ? 'L\'étudiant doit être affecté à une classe pour générer sa carte' : 'Générer la carte étudiant'"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg transition"
                :class="carteBloquee ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-700'">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2" />
                </svg>
                Carte étudiant
              </button>
              <button @click="printFicheDetail()"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition">
                🖨️ Fiche d'inscription
              </button>
              <button @click="printCertificatDetail()"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition">
                📄 Certificat
              </button>
              <button v-if="canDelete" @click="showDeleteModal = true; confirmDeleteName = ''"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition"
                style="background:#fff0f0;color:#E30613;border:1px solid #fecaca;">
                🗑️ Supprimer
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
                <p class="font-medium text-gray-900">{{ insc.filiere?.nom ?? insc.classe?.filiere?.nom ?? '—' }}</p>
                <p class="text-sm text-gray-500 mt-0.5">
                  {{ insc.classe?.nom ?? 'Classe non affectée' }} — {{ insc.annee_academique?.libelle }}
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

            <!-- Plan de paiement (échéances) -->
            <div v-if="echeancesMap[insc.id]?.length" class="mt-4 border-t border-gray-100 pt-3">
              <p class="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Plan de paiement</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="ech in echeancesMap[insc.id]" :key="ech.id"
                  class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium"
                  :class="ech.statut === 'paye' ? 'bg-green-50 text-green-700' : new Date(ech.mois) < new Date() ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'">
                  <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
                  {{ fmtMoisEch(ech.mois) }}
                  <span class="text-xs opacity-70">{{ Number(ech.montant).toLocaleString('fr-FR') }}</span>
                </span>
              </div>
              <div class="mt-2 flex gap-4 text-xs text-gray-400">
                <span class="text-green-600 font-medium">✓ {{ (echeancesMap[insc.id] ?? []).filter((e: any) => e.statut === 'paye').length }} payé(s)</span>
                <span class="text-red-500 font-medium">✗ {{ (echeancesMap[insc.id] ?? []).filter((e: any) => e.statut === 'non_paye' && new Date(e.mois) < new Date()).length }} en retard</span>
                <span class="text-gray-400">◦ {{ (echeancesMap[insc.id] ?? []).filter((e: any) => e.statut === 'non_paye' && new Date(e.mois) >= new Date()).length }} à venir</span>
              </div>
            </div>

            <!-- Paiements effectués -->
            <div v-if="paiementsMap[insc.id]?.length" class="mt-4 border-t border-gray-100 pt-3">
              <p class="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Paiements effectués</p>
              <div class="space-y-1">
                <div v-for="p in paiementsMap[insc.id]" :key="p.id"
                  class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-xs">
                  <div class="flex items-center gap-3">
                    <span class="font-mono text-gray-400">{{ p.numero_recu }}</span>
                    <span class="font-semibold text-gray-700">
                      {{ p.type_paiement === 'frais_inscription' ? "Frais d'inscription" : p.type_paiement === 'mensualite' ? 'Mensualité' : p.type_paiement === 'tenue' ? 'Tenue' : p.type_paiement }}
                    </span>
                    <span v-if="p.mois_concerne" class="text-gray-400">{{ new Date(p.mois_concerne).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) }}</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="font-bold text-green-700">+{{ Number(p.montant).toLocaleString('fr-FR') }} FCFA</span>
                    <button @click="printRecuDetail(p, insc)"
                      class="p-1 rounded hover:bg-gray-200 transition text-gray-400 hover:text-gray-700"
                      title="Imprimer le reçu">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                    </button>
                  </div>
                </div>
              </div>
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

  <!-- Modal suppression définitive -->
  <Teleport to="body">
    <div v-if="showDeleteModal" class="del-overlay" @click.self="showDeleteModal = false">
      <div class="del-modal">
        <div class="del-icon">⚠️</div>
        <h2 class="del-title">Supprimer définitivement ?</h2>
        <p class="del-warning">
          Cette action est <strong>irréversible</strong>. Toutes les données de
          <strong>{{ etudiant?.prenom }} {{ etudiant?.nom }}</strong>
          seront effacées : inscriptions, paiements, notes, présences, documents et compte utilisateur.
        </p>
        <p class="del-confirm-label">
          Tapez <strong>{{ etudiant?.prenom }} {{ etudiant?.nom }}</strong> pour confirmer :
        </p>
        <input
          v-model="confirmDeleteName"
          type="text"
          class="del-input"
          placeholder="Nom complet de l'étudiant"
          @keyup.enter="confirmDeleteEtudiant"
        />
        <div class="del-actions">
          <button @click="showDeleteModal = false" class="del-btn-cancel">Annuler</button>
          <button
            @click="confirmDeleteEtudiant"
            :disabled="deletingEtudiant || confirmDeleteName.trim().toLowerCase() !== `${etudiant?.prenom} ${etudiant?.nom}`.toLowerCase()"
            class="del-btn-confirm"
          >
            {{ deletingEtudiant ? 'Suppression…' : 'Supprimer définitivement' }}
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

/* Modal suppression */
.del-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.del-modal {
  background: #fff; border-radius: 12px; padding: 32px 28px;
  max-width: 440px; width: 100%; text-align: center;
  box-shadow: 0 24px 64px rgba(0,0,0,0.25);
}
.del-icon { font-size: 36px; margin-bottom: 12px; }
.del-title { font-size: 18px; font-weight: 800; color: #111; margin: 0 0 12px; }
.del-warning {
  font-size: 13px; color: #555; line-height: 1.6; margin-bottom: 20px;
  background: #fff5f5; border: 1px solid #fecaca; border-radius: 8px; padding: 12px;
  text-align: left;
}
.del-confirm-label { font-size: 12.5px; color: #666; margin-bottom: 8px; text-align: left; }
.del-input {
  width: 100%; border: 1.5px solid #e5e5e5; border-radius: 6px;
  padding: 9px 12px; font-size: 13px; font-family: 'Poppins', sans-serif;
  margin-bottom: 20px; outline: none; transition: border-color 0.15s;
}
.del-input:focus { border-color: #E30613; }
.del-actions { display: flex; gap: 10px; justify-content: flex-end; }
.del-btn-cancel {
  border: 1px solid #e5e5e5; background: #fff; border-radius: 6px;
  padding: 9px 18px; font-size: 13px; font-weight: 600; color: #555;
  cursor: pointer; font-family: 'Poppins', sans-serif;
}
.del-btn-cancel:hover { background: #f5f5f5; }
.del-btn-confirm {
  background: #E30613; color: #fff; border: none; border-radius: 6px;
  padding: 9px 18px; font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: 'Poppins', sans-serif; transition: background 0.15s;
}
.del-btn-confirm:hover:not(:disabled) { background: #c00510; }
.del-btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
