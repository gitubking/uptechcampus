<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import QRCode from 'qrcode'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const canWrite = computed(() => ['dg', 'secretariat'].includes(auth.user?.role ?? ''))
const canDelete = computed(() => auth.user?.role === 'dg')

// ── Suppression définitive ────────────────────────────────────────────
const showDeleteModal = ref(false)
const deleteStep = ref<1 | 2>(1)
const deletePreview = ref<any>(null)
const deletePreviewLoading = ref(false)
const confirmDeleteName = ref('')
const deletingEtudiant = ref(false)

async function openDeleteModal() {
  showDeleteModal.value = true
  deleteStep.value = 1
  deletePreview.value = null
  confirmDeleteName.value = ''
  deletingEtudiant.value = false
  deletePreviewLoading.value = true
  try {
    const { data } = await api.get(`/etudiants/${etudiant.value.id}/deletion-preview`)
    deletePreview.value = data
  } catch {
    deletePreview.value = null
  } finally {
    deletePreviewLoading.value = false
  }
}

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
const activeTab = ref<'infos' | 'inscriptions' | 'documents' | 'finance' | 'timeline' | 'commentaires' | 'parents' | 'exonerations'>('infos')
const echeancesMap = ref<Record<number, any[]>>({})
const paiementsMap = ref<Record<number, any[]>>({})

// ── Réinscription étudiant existant ──────────────────────────────────────────
const showReinscModal = ref(false)
const reinscLoading = ref(false)
const reinscSaving = ref(false)
const reinscForm = ref({ annee_academique_id: '', filiere_id: '', classe_id: '', statut: 'inscrit_actif', mensualite: '', frais_inscription: '', mois_debut: '' })
const reinscAnnees = ref<any[]>([])
const reinscFilieres = ref<any[]>([])
const reinscClasses = ref<any[]>([])
const reinscError = ref('')
const reinscSuccess = ref(false)

async function openReinscModal() {
  showReinscModal.value = true
  reinscSuccess.value = false
  reinscError.value = ''
  reinscForm.value = { annee_academique_id: '', filiere_id: '', classe_id: '', statut: 'inscrit_actif', mensualite: '', frais_inscription: '', mois_debut: '' }
  reinscLoading.value = true
  try {
    const [a, f] = await Promise.all([
      api.get('/annees-academiques'),
      api.get('/filieres')
    ])
    reinscAnnees.value = a.data
    reinscFilieres.value = f.data.filter((f: any) => f.actif !== false)
    // Pré-sélectionner l'année active
    const active = reinscAnnees.value.find((a: any) => a.actif)
    if (active) reinscForm.value.annee_academique_id = String(active.id)
  } finally {
    reinscLoading.value = false
  }
}

async function onReinscFiliereChange() {
  reinscForm.value.classe_id = ''
  reinscClasses.value = []
  if (!reinscForm.value.filiere_id) return
  const { data } = await api.get(`/classes?filiere_id=${reinscForm.value.filiere_id}`)
  reinscClasses.value = data
  // Pré-remplir montants depuis la filière
  const fil = reinscFilieres.value.find((f: any) => String(f.id) === reinscForm.value.filiere_id)
  if (fil) {
    reinscForm.value.mensualite = fil.mensualite ?? ''
    reinscForm.value.frais_inscription = fil.frais_inscription ?? ''
  }
}

async function saveReinscription() {
  reinscError.value = ''
  if (!reinscForm.value.annee_academique_id) { reinscError.value = 'Choisissez une année académique.'; return }
  reinscSaving.value = true
  try {
    await api.post('/inscriptions', {
      etudiant_id: etudiant.value.id,
      annee_academique_id: Number(reinscForm.value.annee_academique_id),
      filiere_id: reinscForm.value.filiere_id ? Number(reinscForm.value.filiere_id) : null,
      classe_id: reinscForm.value.classe_id ? Number(reinscForm.value.classe_id) : null,
      statut: reinscForm.value.statut,
      mensualite: reinscForm.value.mensualite ? Number(reinscForm.value.mensualite) : null,
      frais_inscription: reinscForm.value.frais_inscription ? Number(reinscForm.value.frais_inscription) : null,
      mois_debut: reinscForm.value.mois_debut || null,
    })
    reinscSuccess.value = true
    // Recharger la fiche étudiant
    const { data } = await api.get(`/etudiants/${etudiant.value.id}`)
    etudiant.value = data
    for (const insc of data.inscriptions ?? []) {
      api.get(`/echeances?inscription_id=${insc.id}`).then(r => {
        echeancesMap.value = { ...echeancesMap.value, [insc.id]: r.data.data ?? r.data }
      })
    }
  } catch (e: any) {
    reinscError.value = e?.response?.data?.message ?? 'Erreur lors de la réinscription.'
  } finally {
    reinscSaving.value = false
  }
}

// --- Formation individuelle ---
const fiData = ref<any>(null)
const isFiStudent = computed(() => !!fiData.value)

// --- Conditions d'accès documents ---
// Fiche d'inscription : disponible si frais d'inscription payé (classique) OU inscription FI payée
const ficheDisponible = computed(() => {
  // Cas FI : inscription FI payée
  if (isFiStudent.value) {
    const paiements = fiData.value?.paiements || []
    return paiements.some((p: any) => p.type === 'inscription' && (p.statut === 'paye' || p.statut === 'partiel'))
  }
  // Cas classique
  const insc = etudiant.value?.inscriptions?.[0]
  if (!insc) return false
  const paiements = paiementsMap.value[insc.id] || []
  return paiements.some((p: any) => p.type_paiement === 'frais_inscription' && p.statut === 'confirme')
})
// Certificat : disponible si inscription payée + au moins un paiement supplémentaire
const certificatDisponible = computed(() => {
  if (!ficheDisponible.value) return false
  // Cas FI : inscription FI payée = suffit (pas de mensualité pour FI)
  if (isFiStudent.value) return true
  // Cas classique
  const insc = etudiant.value?.inscriptions?.[0]
  if (!insc) return false
  const paiements = paiementsMap.value[insc.id] || []
  return paiements.some((p: any) => p.type_paiement === 'mensualite' && p.statut === 'confirme')
})

// Statistiques clés
interface EtudiantStats {
  moyenne: number | null
  nb_notes: number
  presences_total: number
  presences_ok: number
  taux_presence: number | null
  docs_total: number
  docs_recu: number
  pct_dossier: number
  total_echeances: number
  echeances_payees: number
  pct_paiements: number | null
}
const stats = ref<EtudiantStats | null>(null)

function statColor(pct: number | null, inverse = false): string {
  if (pct === null) return '#9ca3af'
  const val = inverse ? 100 - pct : pct
  if (val >= 75) return '#16a34a'
  if (val >= 50) return '#d97706'
  return '#dc2626'
}

// SVG donut: circumference ≈ 100 (r = 15.9155)
function donutDash(pct: number | null): string {
  if (pct === null || pct === 0) return '0 100'
  return `${Math.min(pct, 100)} ${Math.max(0, 100 - Math.min(pct, 100))}`
}

async function loadStats() {
  if (!etudiant.value?.id) return
  try {
    const { data } = await api.get(`/etudiants/${etudiant.value.id}/stats`)
    stats.value = data
  } catch { stats.value = null }
}

async function fetchEtudiant() {
  loading.value = true
  try {
    const { data } = await api.get(`/etudiants/${route.params.id}`)
    etudiant.value = data
    const inscriptions: any[] = data.inscriptions ?? []
    // Charger les échéances et relances pour chaque inscription
    for (const insc of inscriptions) {
      api.get(`/echeances?inscription_id=${insc.id}`).then(r => {
        echeancesMap.value = { ...echeancesMap.value, [insc.id]: r.data.data ?? r.data }
      }).catch(() => {})
      loadRelances(insc.id)
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
    // Charger formation individuelle si l'étudiant en a une
    api.get('/formations-individuelles').then(r => {
      const allFi: any[] = r.data || []
      const myFi = allFi.find((fi: any) => String(fi.etudiant_id) === String(data.id))
      fiData.value = myFi || null
      console.log('[FI-LOAD]', data.id, allFi.length, myFi ? 'FOUND' : 'NOT FOUND')
    }).catch((err) => { console.error('[FI-ERR]', err) })
  } finally {
    loading.value = false
    loadChecklist()
    loadStats()
  }
}

function printRecuDetail(p: any, insc: any) {
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const prenom = insc.etudiant?.prenom ?? etudiant.value?.prenom ?? ''
  const nom = insc.etudiant?.nom ?? etudiant.value?.nom ?? ''
  const filiere = insc.filiere?.nom ?? insc.classe?.filiere?.nom ?? '—'
  const classe = insc.classe?.nom ?? insc.filiere?.nom ?? '—'
  let typeLabel = p.type_paiement === 'frais_inscription' ? "Frais d'inscription"
    : p.type_paiement === 'tenue' ? 'Tenue scolaire'
    : p.type_paiement === 'rattrapage' ? 'Rattrapage'
    : p.type_paiement
  if (p.type_paiement === 'mensualite') {
    const echs = (echeancesMap.value[insc.id] || [])
      .filter((e: any) => e.type_echeance === 'mensualite')
      .sort((a: any, b: any) => a.mois.localeCompare(b.mois))
    const moisKey = p.mois_concerne?.substring(0, 7) ?? ''
    const idx = echs.findIndex((e: any) => e.mois.substring(0, 7) === moisKey)
    const total = echs.length
    typeLabel = idx >= 0 ? `Mensualité ${idx + 1}/${total}` : 'Mensualité'
  }
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
          <div class="info-box"><label>Classe</label><span>${classe}</span></div>
          <div class="info-box"><label>Filière</label><span>${filiere}</span></div>
          <div class="info-box"><label>Objet</label><span>${typeLabel}</span></div>
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

function echLabel(ech: any, allEchs: any[]): string {
  if (ech.type_echeance === 'frais_inscription') return 'Inscription'
  if (ech.type_echeance === 'tenue') return 'Tenue'
  if (ech.type_echeance === 'mensualite') {
    const sorted = [...allEchs]
      .filter(e => e.type_echeance === 'mensualite')
      .sort((a, b) => a.mois.localeCompare(b.mois))
    const idx = sorted.findIndex(e => e.id === ech.id)
    return `M${idx + 1}`
  }
  return ech.type_echeance
}

// ── Fiche financière (onglet Finance) ────────────────────────────────
const financeSummary = computed(() => {
  if (!etudiant.value?.inscriptions) return []
  return etudiant.value.inscriptions.map((insc: any) => {
    const echs = echeancesMap.value[insc.id] || []
    const pays = paiementsMap.value[insc.id] || []
    const totalPrevu = echs.reduce((s: number, e: any) => s + Number(e.montant), 0)
    const totalPaye = pays.filter((p: any) => p.statut === 'confirme').reduce((s: number, p: any) => s + Number(p.montant), 0)
    const reste = Math.max(0, totalPrevu - totalPaye)
    const now = new Date().toISOString().substring(0, 7)
    const echsRetard = echs.filter((e: any) => e.mois.substring(0, 7) <= now && e.statut !== 'paye')
    return { insc, echs, pays, totalPrevu, totalPaye, reste, nbRetard: echsRetard.length }
  })
})

async function printRecuFinance(p: any, insc: any) {
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const prenom = etudiant.value?.prenom ?? ''
  const nom = etudiant.value?.nom ?? ''
  const filiere = insc.filiere?.nom ?? '—'
  const classe = insc.classe?.nom ?? insc.filiere?.nom ?? '—'
  let typeLabel = p.type_paiement === 'frais_inscription' ? "Frais d'inscription"
    : p.type_paiement === 'tenue' ? 'Tenue scolaire'
    : p.type_paiement === 'rattrapage' ? 'Rattrapage' : p.type_paiement
  if (p.type_paiement === 'mensualite') {
    const echs = (echeancesMap.value[insc.id] || [])
      .filter((e: any) => e.type_echeance === 'mensualite')
      .sort((a: any, b: any) => a.mois.localeCompare(b.mois))
    const moisKey = p.mois_concerne?.substring(0, 7) ?? ''
    const idx = echs.findIndex((e: any) => e.mois.substring(0, 7) === moisKey)
    const total = echs.length
    typeLabel = idx >= 0 ? `Mensualité ${idx + 1}/${total}` : 'Mensualité'
  }
  const dateLabel = new Date(p.confirmed_at ?? p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const moisLabel = p.mois_concerne
    ? new Date((p.mois_concerne.length === 7 ? p.mois_concerne + '-01' : p.mois_concerne)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : null
  const modeStr = ({ especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', virement: 'Virement', cheque: 'Chèque' } as Record<string,string>)[p.mode_paiement] ?? p.mode_paiement
  const montantStr = Number(p.montant).toLocaleString('fr-FR')
  const qrData = JSON.stringify({ r: p.numero_recu, m: p.montant, d: p.confirmed_at ?? p.created_at, e: `${prenom} ${nom}` })
  let qrDataUrl = ''
  try { qrDataUrl = await QRCode.toDataURL(qrData, { width: 80, margin: 1 }) } catch { /* ignore */ }
  const recuBlock = (exemplaire: string) => `
    <div class="recu-block"><div class="exemplaire">${exemplaire}</div>
      <div class="hdr"><img src="${logoUrl}" alt="Logo"><div class="hdr-info">
        <div class="tagline">Institut de Formation</div>
        <h1>Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</h1>
        <div class="meta">NINEA : 006118310 _ BP 50281 RP DAKAR | Sicap Amitié 1, Villa N° 3031 — Dakar | Tél : 33 821 34 25 / 77 841 50 44</div>
        <div class="agree">Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT</div>
      </div></div>
      <div class="content">
        <div class="recu-title">Reçu de paiement <span class="recu-num">${p.numero_recu}</span></div>
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
          <div class="montant-box"><div class="lbl">Montant payé</div><div class="amt">${montantStr} FCFA</div></div>
          ${qrDataUrl ? `<div class="qr-box"><img src="${qrDataUrl}" alt="QR"><div class="qr-label">Vérification</div></div>` : ''}
        </div>
        <div class="sign-area">
          <div class="sign-box"><div class="sign-line"></div><label>Signature du caissier</label></div>
          <div class="sign-box"><div class="sign-line"></div><label>Cachet de l'établissement</label></div>
        </div>
        <div class="footer-bar">Amitié 1, Villa n°3031 — Dakar | +221 77 841 50 44 / 77 618 45 52 | uptechformation.com</div>
      </div></div>`
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reçu ${p.numero_recu}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}@page{size:A4 portrait;margin:10mm}body{font-family:Arial,sans-serif;color:#111;font-size:11px;width:148mm}.recu-block{page-break-inside:avoid;padding-bottom:6px}.exemplaire{text-align:right;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#aaa;padding:4px 16px 2px}.hdr{display:flex;align-items:center;gap:14px;padding:10px 16px 8px;border-bottom:2px solid #E30613}.hdr img{width:52px;height:52px;object-fit:contain;flex-shrink:0}.hdr-info .tagline{font-size:7px;font-weight:700;color:#E30613;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}.hdr-info h1{font-size:11px;font-weight:900;color:#111;line-height:1.2;margin-bottom:3px}.hdr-info .meta{font-size:8px;color:#555;line-height:1.5}.hdr-info .agree{font-size:7px;color:#888;margin-top:2px}.content{padding:10px 16px}.recu-title{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#111;margin-bottom:8px}.recu-num{font-size:11px;font-weight:400;color:#888;font-family:monospace;letter-spacing:1px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}.info-box{background:#f9f9f9;border:1px solid #eee;border-radius:4px;padding:6px 10px}.info-box label{font-size:7px;text-transform:uppercase;color:#aaa;font-weight:700;letter-spacing:0.5px;display:block;margin-bottom:2px}.info-box span{font-size:11px;font-weight:700;color:#111}.full{grid-column:1/-1}.montant-qr{display:flex;align-items:center;gap:12px;margin:10px 0}.montant-box{border:1.5px solid #111;border-radius:6px;padding:8px 16px;text-align:center;flex:1}.montant-box .lbl{font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:2px}.montant-box .amt{font-size:20px;font-weight:900;color:#111}.qr-box{text-align:center;flex-shrink:0}.qr-box img{width:70px;height:70px}.qr-label{font-size:6px;color:#aaa;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}.sign-area{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:10px;padding-top:8px;border-top:1px dashed #ddd}.sign-box{text-align:center}.sign-line{border-bottom:1px solid #ccc;height:30px;margin-bottom:4px}.sign-box label{font-size:7px;color:#aaa;text-transform:uppercase}.footer-bar{border-top:1px solid #ccc;color:#777;font-size:7px;text-align:center;padding:4px 16px;margin-top:10px}.cut-line{display:flex;align-items:center;gap:8px;margin:8px 0;color:#aaa;font-size:8px}.cut-line::before,.cut-line::after{content:'';flex:1;border-top:1px dashed #aaa}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head>
  <body>${recuBlock('Exemplaire établissement')}<div class="cut-line">✂  Découper ici</div>${recuBlock('Exemplaire étudiant')}</body></html>`
  openPrintAndClose(html)
}

// ── Indicateur de risque ──────────────────────────────────────────────
const risque = ref<any>(null)
async function loadRisque() {
  try {
    const { data } = await api.get('/etudiants/risques')
    const etudiantId = parseInt(route.params.id as string)
    risque.value = data.find((r: any) => r.etudiant_id === etudiantId) ?? null
  } catch { risque.value = null }
}
const risqueIcon = computed(() => {
  if (!risque.value) return null
  return { red: '🔴', yellow: '🟡', green: '🟢' }[risque.value.risque_global as string] ?? null
})
const risqueLabel = computed(() => {
  if (!risque.value) return null
  return { red: 'Risque élevé d\'abandon', yellow: 'À surveiller', green: 'Situation OK' }[risque.value.risque_global as string] ?? null
})

onMounted(() => {
  fetchEtudiant()
  loadRisque()
})

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

// --- Webcam photo ---
const showWebcamModal = ref(false)
const webcamVideo = ref<HTMLVideoElement | null>(null)
const webcamStream = ref<MediaStream | null>(null)
const webcamCaptured = ref<string | null>(null)
const webcamLoading = ref(false)

async function openWebcam() {
  showWebcamModal.value = true
  webcamCaptured.value = null
  await nextTick()
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    })
    webcamStream.value = stream
    if (webcamVideo.value) {
      webcamVideo.value.srcObject = stream
      webcamVideo.value.play()
    }
  } catch {
    alert('Impossible d\'accéder à la webcam. Vérifiez les permissions du navigateur.')
    closeWebcam()
  }
}

function captureWebcam() {
  if (!webcamVideo.value) return
  const video = webcamVideo.value
  const w = video.videoWidth || 640
  const h = video.videoHeight || 480
  const size = Math.min(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 300
  const ctx = canvas.getContext('2d')!
  // Miroir horizontal (comme le preview) + crop carré centré
  ctx.translate(300, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, (w - size) / 2, (h - size) / 2, size, size, 0, 0, 300, 300)
  webcamCaptured.value = canvas.toDataURL('image/jpeg', 0.85)
}

function closeWebcam() {
  webcamStream.value?.getTracks().forEach(t => t.stop())
  webcamStream.value = null
  showWebcamModal.value = false
  webcamCaptured.value = null
}

async function saveWebcamPhoto() {
  if (!webcamCaptured.value) return
  webcamLoading.value = true
  try {
    const { data } = await api.post(`/etudiants/${etudiant.value.id}/photo`, { photo_base64: webcamCaptured.value })
    etudiant.value.photo_path = data.photo_path
    closeWebcam()
  } catch (err: any) {
    alert(err?.response?.data?.message || 'Erreur enregistrement photo')
  } finally {
    webcamLoading.value = false
  }
}

// --- Badge étudiant ---
const showBadge = ref(false)
const badgeCanvas = ref<HTMLCanvasElement | null>(null)
const badgeGenerated = ref(false)

async function generateBadge() {
  showBadge.value = true
  badgeGenerated.value = false
  await new Promise(r => setTimeout(r, 80))
  const canvas = badgeCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!

  // Portrait — 90 × 126 mm @ 300 DPI ≈ 1063 × 1488 px
  const W = 380, H = 520          // logique
  const SCALE = 2.8               // rendu 300dpi
  canvas.width  = Math.round(W * SCALE)
  canvas.height = Math.round(H * SCALE)
  ctx.scale(SCALE, SCALE)

  const insc0 = etudiant.value.inscriptions?.[0]
  const fi = fiData.value
  const filiereNom = fi ? (fi.type_formation?.nom ?? 'Formation Individuelle') : (insc0?.filiere?.nom ?? insc0?.classe?.filiere?.nom ?? '')
  const classeNom = fi ? 'Formation Individuelle' : (insc0?.classe?.nom ?? '—')
  const anneeAcad = fi ? (fi.annee_academique?.libelle ?? '') : (insc0?.annee_academique?.libelle ?? '')

  // ── 1. Fond blanc ────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // ── 2. Bande rouge en haut ───────────────────────────────────────────
  const headerH = 90
  ctx.fillStyle = '#E30613'
  ctx.fillRect(0, 0, W, headerH)

  // Logo UP'TECH (centré dans l'en-tête)
  await drawImage(ctx, UPTECH_LOGO, W / 2 - 32, 8, 64, 64)

  // ── 3. Photo ronde ───────────────────────────────────────────────────
  const cx = W / 2
  const cy = headerH + 66
  const r  = 58

  // Halo blanc autour du cercle
  ctx.beginPath()
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  // Clip circulaire
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()

  if (etudiant.value.photo_path) {
    await drawImage(ctx, etudiant.value.photo_path, cx - r, cy - r, r * 2, r * 2)
  } else {
    // Fond rouge initiales
    ctx.fillStyle = '#E30613'
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${r}px Arial`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      `${etudiant.value.prenom[0]}${etudiant.value.nom[0]}`.toUpperCase(),
      cx, cy
    )
    ctx.textBaseline = 'alphabetic'
  }
  ctx.restore()

  // Bordure rouge cercle
  ctx.beginPath()
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2)
  ctx.strokeStyle = '#E30613'
  ctx.lineWidth = 3
  ctx.stroke()

  // ── 4. Nom complet ──────────────────────────────────────────────────
  const nameY = cy + r + 30
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 26px Arial'
  ctx.textAlign = 'center'
  const fullName = `${etudiant.value.prenom.toUpperCase()} ${etudiant.value.nom.toUpperCase()}`
  // Réduire taille si trop long
  let nameFontSize = 26
  while (ctx.measureText(fullName).width > W - 40 && nameFontSize > 14) {
    nameFontSize--
    ctx.font = `bold ${nameFontSize}px Arial`
  }
  ctx.fillText(fullName, cx, nameY)

  // ── 5. Numéro étudiant ──────────────────────────────────────────────
  if (etudiant.value.numero_etudiant) {
    ctx.fillStyle = '#E30613'
    ctx.font = 'bold 16px Courier New'
    ctx.fillText(etudiant.value.numero_etudiant, cx, nameY + 24)
  }

  // ── 6. Ligne séparatrice ────────────────────────────────────────────
  const sepY = nameY + 40
  ctx.strokeStyle = '#f0f0f0'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(40, sepY)
  ctx.lineTo(W - 40, sepY)
  ctx.stroke()

  // ── 7. Filière ──────────────────────────────────────────────────────
  ctx.fillStyle = '#555555'
  ctx.font = '16px Arial'
  ctx.fillText(filiereNom, cx, sepY + 22)

  // ── 8. Classe ───────────────────────────────────────────────────────
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 18px Arial'
  ctx.fillText(classeNom, cx, sepY + 46)

  // ── 9. Année académique ─────────────────────────────────────────────
  ctx.fillStyle = '#888888'
  ctx.font = '13px Arial'
  ctx.fillText(anneeAcad, cx, sepY + 68)

  // ── 10. QR code (vérification) ──────────────────────────────────────
  try {
    const verifyUrl = `${window.location.origin}/verify/${etudiant.value.numero_etudiant}`
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 80, margin: 1 })
    const qrSize = 70
    await drawImage(ctx, qrDataUrl, cx - qrSize / 2, sepY + 82, qrSize, qrSize)
    ctx.fillStyle = '#aaaaaa'
    ctx.font = '10px Arial'
    ctx.fillText('Vérifier', cx, sepY + 82 + qrSize + 14)
  } catch { /* ignore */ }

  // ── 11. Barre noire en bas ──────────────────────────────────────────
  const footerH = 36
  ctx.fillStyle = '#111111'
  ctx.fillRect(0, H - footerH, W, footerH)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 11px Arial'
  ctx.textAlign = 'center'
  ctx.fillText("UP'TECH — Institut Supérieur de Formation", cx, H - footerH + 14)
  ctx.font = '9px Arial'
  ctx.fillStyle = '#cccccc'
  ctx.fillText('Sicap Amitié 1, Villa 3031 — Dakar  |  uptechformation.com', cx, H - footerH + 27)
  ctx.textAlign = 'left'

  badgeGenerated.value = true
}

function downloadBadge() {
  const canvas = badgeCanvas.value
  if (!canvas) return
  const link = document.createElement('a')
  link.download = `badge-${etudiant.value.numero_etudiant}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

function printBadge() {
  const canvas = badgeCanvas.value
  if (!canvas) return
  const dataUrl = canvas.toDataURL('image/png')
  const html = `<html><head><title>Badge étudiant</title>
    <style>
      body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f5f5; }
      img { max-height: 90vh; width: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
      @media print { body { background: white; } img { box-shadow: none; max-height: 100%; } }
    </style></head>
    <body><img src="${dataUrl}" /></body></html>`
  openPrintAndClose(html)
}

// --- Carte étudiant ---
const showCard = ref(false)
const cardCanvas = ref<HTMLCanvasElement | null>(null)
const cardGenerated = ref(false)
const carteBloquee = computed(() => {
  // FI student : carte disponible si inscription FI payée
  if (isFiStudent.value) return !ficheDisponible.value
  // Classique : doit avoir une classe
  return !etudiant.value?.inscriptions?.[0]?.classe?.id
})

// Logo UPTECH exact (PNG embarqué en base64)
const UPTECH_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAVMAAABrCAYAAADKFWEAAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAV3UlEQVR4Ae2dv4/sSBHHn/ovWPEPMPwQEtHtJUQEjURCtpeQMqdLL9gLCZDuIiSSJUAiXE66hOiBRIgYSCFYMshGiHtCIMSiJ4RAJzTU17uebZfbdper7W6/rZa8nvbY3dXfrvpM2Z7xvnhhxRQwBUwBU8AUMAVMAVPAFDAFTAFTwBQwBUwBU8AUMAVMAVPAFDAFTAFTwBQoqcCfvvrWBS2elo9sEWtwRZrtSs6f9W0KmAKFFQAEaLml5WSLWoMDaXhVeEqte1PAFFhbAQr8GwOoGqCxDyFA9WLt+bT+TAFTYGUFEOi03BlIFwFpC9d70vdy5am17kwBU2BNBSjIkTm1QX9e/+3969O/Xv789J/f/s6WRA3+/ctfnf7x/R+c/vy1r591DLQFUHdrzq31ZQqYAispQMGNG0ydwP/rd947ffbpq5OV+Qr87/XrBqpcW6rfrTS11o0pMFMBR5ekHF3rdx/RcqCFfNadIsvx8f0bWu9p2c3scPuHUWDjZlMHpH//7vfmE8SO7CmAzJ5rTHVyPG1pnByOnrKQs7fF0aWGpGPadvftkQ9r8fFtO+36JfWPIKV20VZqSbWZt+cQ6G3fpdZsnM3Yl7YlmHOuyVDdedIK83NSLEc69pqWi6Fe4tu1fsVbVc37nrc2Waeg7txw+ss73+7BwDboFfjnj37MgUoOpy0ih6fAbYvzwkAh8IXFeeHxU4GJ4ANcJ4IvdbyhrXjdgHTKhqXfJ83C0ox36T4PYY/jr88gy2nT/cO8jvf89K7ztL+i/6eWHl6p5p35PG87UieY4hreOdBxbbSmcnf3+9Ph8OvTy5c/O3344UfNcnv7k46JsBmwwvL640/O13Y7O1VQefXNb511ftScZSuRCRrdJHK8ILCcFzotcyzx8akBciS7RjRJHS8XTRVUqbZP7Ueah6UmmC5uy934vLa6OC/0S6Z52067Vs078/m2zYE1BfRlCNLSWenxeDwBlPv9u6fLy7eZUE+B5P03OmiMZH1naAFguImGff77hz92jlu7AtCHetNr2YT15vFJkwQnPDwd7nzC/qH+zE7x8WFbU6+RzexeREvqePnBqqCasjf1fd+1anGAwa5Dt89Yzd0KfSF1vHw/zOvIByVsc15nCzXRKap5Zz7fabhfoWDGr5vOAQ7grF2QeV5ff3Da7b7IxR+sS2Aajg+vcYcd14Rxx33tggya2XPbnxXJllS4NPsdnlp2Xui0zLHExw/O5YAdga1PVg/sG2k7PAavVUEVaV+ke3u871pVA0xXA2mrwQRQHWk0S9vH9rsKK+ed+Txvm9UpsDt38dcEDDLQsexzTFQNTEOYIWvFBwjuuq9Vwv7p9YFNibAqcrygL+fH9I28xxxLfHwbTJL17kWvpI6XH2gw5YrQHO8j8yyZn7n7HqnfgWvjzuts4qNUzTvzed42q3OYrnG9FBCVZKExcXPBNAQbstU1vgoW9mkwHYXjNXNXqo7uHwQ3P1IVVEG7qf1H9/Ndq0pmps3XnpAl5hqbtJ2brhZtzXmdTW077Vo17/XCFDeQtBBthV4CpoAcLgEsnakaTJMD+LYNiad16rFPRzy8UgWVFBRD+/uuVUVhStqmarnIfgB5JDt1pJGmv67C1NZB0V59MMVNJcBPMajesUvBtAUdTv+XytLbPh7XNNmaInK8oC/nhfPBHGvO8U02dEX93iX2HdjbapQ0XmqfF1VQ9fwv0X5+nO9aVQqmxbPSVpd9Vw/UnJ+p7WOb1ESnqOad+Xyn4X6FArpzzTQ3QHBKf3HxuVa8bOulYdoCDz8JzX09tW37+cG09b/mVzUpvnBoj3haJ8E0dhxtSzo2xa65+/inceBVMZjuFVogo6QPRJQGyreKtuhYXpxXtEfzwssbANP7+/vm6006YYadfy2YAnj4uljOr1QZTOHww3MbvHfgoRG8R4Ez2EYko1AF1Vhfkvd8dzzFYHozot3UeOjYsDRAnTpm6P1j2NLDa+cVtlE/vKjmPeJHvP2gToGdPTMFSOfepU8Vck2YAn64lporazeYwgEHQRgGHmVBvDTBcaDjKRAH23jMnMJjVUEV2qR57UOLyH4K1sExaPoJjz10+0RNpUVM2+P8cXDrnJ/fFrTkRTXWsjDFd0Zz3WQaE3VtmLYAxG/staVt63EdcXbuEGN1UTAGfTk/pm/kPeZY6uPJ8VNsHxr74HXXCICH2uDbU+wZ3Mfz1qbrKpgGczndU3ePQe1S5sR320JNBSzWnqP6oMYJ9pE5naKyjfl8p+F+hQI6W2YKkC5xfTQmbimYAoBaoBpM4YepAdP3WTp2P3K8LAA6zafaFN3Pd5pKqhSDaQKUomPEcb4/NBWwWHtof7DvBLu5dSrbZL6UC6ZrghRil4SpFqgGUzh8asD0gmPset8d31tWT7Upup+X9YW9NwnTXX+cKmDtu+05n+4bsXnotkZtHRTtrQ/TNa6RckFKwxRAnHsN1WAKh48FQmxbLziGshM6vR/6PT9vY6ge6z95mx9qdXj7FmEaG01OYDmf7huxueH25bSNt83qFNjq0/ylbzbFxK0BprgpNecXUwZTOGEsEGLbmMPGj6OMFHeVtSXWf/I2L+/dYErzxrI/Rzomax75YOWzsCGY4gElusHPE64GmAKK+NqU9HuoBtPkgKFsk5eOvyAbZcHI95fUO21L/dpLenrY12Danz9HOmrmgc/CRmCKn4fqBj5ftFpgCjDii/2S8rxh2nwvEZlkiu8ceGg8Hofjr2nJkI2GPSTZNGQ3QUBaSsC0eQD00BgStsfGmBNYzif6xoCt3L6ctvG2WZ0Ce9ZpPq6TrnXnPiZuTTAFHCXXT58pTAecfxRgB+auC1dHbZmy38uNKwJTslMzztgocwLLZbYvp22xsQfb5sIUD2/WTYpmQsvfzWdAPOG3/Kmn++xYJTBEOgZ9iZ2WnU6Lj5/jLy8DV13hpUhLPh4vN9BgSgzJ7Vc0Dy5cUs+C+Hyizmx7MV7mwBT/QqQkSNF3bZkpAJn6YG2DaTK0ZM487uoJ7ybbFfN/n9AB28Vg2geWIx1V8xCbm7nbZP43B6YAWekB1whT3N1PyU4NpsnBcsnos3A12a6Y/xMEpEUFU2RcfnrhNjXHxOxP3MbbQz3nqbTWPtUccg2WhWkNWSlAXiNMAcmUf5FtME1y+EMsbJfdlmQXD7i27uW2qWDa9jux5lY5slMzTt4e6gbTRhVpZlpDVlozTFOyU4PpZDAj68p8pz4GAb5t0q4xcHne2nTdYErzzLI/Rzqq5mFsjqTvMdsmZlQCU/xktJaB1pqZApRT104NpqPBclMGpAiUUbumfJ8gIC1vDEz3pB2BZ9biu6o5qqvmYWqeJO8vB9PSd/BDkWuGKe7sjxWD6TlY7mlOD7Tc0rKnpUA2Goby2S5JwLX7EgSk5U2BqXTcY/s7T37Qalp6vRxMS36vlAtcM0wBy7H/8vpMYSpzzLF4W+w9VRATBKTFYNpXzHke6wXrMp+lwE760n7JXzvFxKwdpmM3ogym/RCqY4vBNBZr3W1Lz5Tz3f5Uc6LNbJeBaU2n+BC7dpjiRtRQMZguHZBz21cFLkFAWiwz7Svm/BsP0zWeni8RsXaYAphD/zfKYNoPoTq2GEynY3DpmXJ+2gbVPEmy1fyZaU138VuhtwDT1x9/Ek1ODaZLB+Tc9lVBShCQFstM+4o538Z4Bev8MMW/a65gYB0btgDTv71/bTB9ujMrc8x+lK2wxWA6HedLT4Pz0zao5qnDkYm+ZD5LWdLkDahSzywdG+gWYDr0FSnLTJcOyLntq4KUICAtlpn2FXN+LO5Xfi8/TAGulQcx2d8WYApoxorBtB9CdWzZFEwP8zRzXhfLsV6bZ6Si3TnL7kWnOJ/Xvpw/de0Y2q+kZKa13XyC2FuBaewmlMG074d1bDGYToMsNlM5geX8tA1j88Tty2kbb5vVU2CqG9zYwOe/txWYxh4anRmmlKEk60i/eW9L86T6yTOAoG3fHvmwdlRP7hf9yE6Zup2tVBONh2tHekiL6jSf5n1OcV44b2ycsT5zAiu3fTlti4092GYwfevE4Ja1HvslFOtvZlC0k+heCoODHmvX/OsQ6lcED/Y4PLHTG0zbKTuvDabkg8wvxH41AfuKYHo8HpmxogBc7NitZKaxh55khuleCMU5c3I8x//5hdjpWdCcG6rohcq3vXwgBtNnBdNanl/KgWEwbUO3yTLxwJA5kEw9JgJCR/AQ9Rlpox1DLWvReLh2pIe0FIHpTjhvbJyxMebM/pzPa19O22JjD7ZNneYjM/3ww4+qW/Dd17Dg2iSywNqW5a+ZYjLF1z9ZgIxC5EjtR57m5LzQ6Q2mmKpOKQFTGDA63xO+0RnAYyUnsJzPa19O22JjD7ZNwTQElr3Oo0De0/x2MpvH2E0EwqwgYtdKz/15odMbTFvpzmuDKfkQ8wsn9Svm82dxH18YTPNQq9JWloEpfCc7UPePHhlZOW8w7Xw4kR7SYjA1mFYKqa2YtRxMEczNKb/2GipO7Qcy0hYYzhtMDaYP3qDK/q5aj3psS+pX28lMP/v0VXXXIXFd9F8vf95hJ26U1XhtF3bxsixM4ZLNTalrWgOKzNlG69gfx108OPbYX+eFbbPTubG2S703qs2UjqSHtBTLTOn7xrPHGhmnCqasPUf12bbRHPGisk3msxTYo7/Nxw0UFvxV1P/6nfc6jAJIdZOgmcDhY2EXL0zPA5/+vHW3I132tJBjNI5F/XXWN1QHQC9l/TpPx0g0lzmmzJhMe4vGw8dOekhLMZjCB7j9qfXIOFXAYn7nqP3ZttEYeFHZJvPZKZgiM2XBX0XdYMqdxup6BTRB7Ly8fxVMcSkHUJxa9n27HD5AU+HJ94uMU3wGFLTJrXPU/mzbqF1eKoIpsiqD6fzJxb974YXpeeDTb/VSCsyfZwKAl1utgmkApFG7I9mV6qt0dBYTluaSUqotfL9j2NLDa+cNpvSEJAaJRetbyUzLXDPtu6htSVFgFEocBLxOEJCWYjAlW2ePlQAYXlNXjeFlXzGnsY3mhJfKMlM8l3NNUKb0tRWY4r8U8MLGd+DTb/VSCswGDMDq5VarQIQ+U5ZIZgpLk44dar+9xHCnbIdluY1dXtcm2ghLZTAFuBgAite3AlMOUtSZlkeq4yagLcMaXJM+F2GILPNaBRgvt6koTCkrVI13CLSS7bu+Zs7r7OItVgbTf3z/BxwAxetbgCmeAxsrDKbFtdyIPfdkJ7vzywNHW1fBhSAgLUVhSvaqxiuBZmzf27haTmkXb7UymOI7nbUF3BZgenX1Toyl1WlZ29yO2AOg7ni45Kur4OLldpSEKaxVgSYGyNRtuEwwcKbhvA7yGFdYVGMcuEQSth+8Jucc/Z4paICnxY84eJH3tgDTm5sfGkzz35iMXGcLHFr18tnBlDJ9B7ClQjDXfiNnGM7r7OEOUBlMQYTabkJtAaaxm0/QsrYPpo3Zc+Dhkq+uggpBQFpKZ6aw113p4CXSDOCm/saK8zp7eNsVwvTv3/1eVRCoHaYXF58DN6NlY/Cqat5JO7pxslQRgYFnaV5uVQ0whdXO07J0hnqkPkYyUjKjKc6/8TDFv9+oCQK1w3S/fzcKUmysSccN2rJvYm6RP88VphCz+dkxfVCpNOAfMG39ltq9SJsy53U28F4qzEwBgT9/7evVgKB2mMZ++QQNUTYIsFpsviPtEoOSB1VKXQUSgoC01JKZhnY7TzDLBVW0Q+1JivPPAqY1nerXDNOhr0Q9oNRgOvPD5LAsSBHwBlOo8FDOD8gBEHGK3maZY+t72g/7X9Oya1uSrZ1P7GvADt5bpZlpTXf1a4Zp7ElRLUgjmSmyLW/LqAYJ19p4EM2pN5kifR1m1non79H5mX1JbKQ+chVc83R+YMl0xtD81n+oj4TtL1gZtXmqvR1rbLxKQTz51agQBIAYHVN8qRWmuPF0f38fStZ7zfQ7jM+QvWsKmAKbUEAK01qeb1orTMduPLVUNZhuIjTMSFNApoAUpgBCDdlpjTBNyUqhn8FU5qO2tymwCQXmwLSG7LRGmE5dKwVIUUKY/uZLXz2ucN1Mco3N9p13zdR027Zue4pD3XXfOTAFEErf2a8NpriDP3WtFLqhhDD96ee/PHBXMunuqR2bdpfZdDKdUnwA30a4np0Fz4Xp/16/Lvq909pgGnsI9AM6+38NpvZBQUGbEty2TxmdbmcBdS5MgYiSv4qqCabX1x/0iTmyxWBqIDGYVu8DV2KgamAKXpR61mktML28fDv59L7lq8G0+kCyjLBMRliT7sfVYQpA/OWdb3euA4awWOp1DTDF3fuhJ0O14IytQ03smqmB1bLUan3gUgRUCmzRl/ZjcMD107WBWgNMJddJQ90MptUGT02ZkdlSPjv2q8MUoMBPTdd8EEppmN7e/iTko+i1wdRgatnoJnygDEzXBmpJmGpACp0MppsIJMsMy2eGpeegHExboK7xVP5SMNWC1GBqILWsdBM+QN85FZYc10wBiLCscQ11bZjiZtPca6ShNnhtmekmgql0VmT9l82M6RdtwrIETAEMAHXJX0mtCVN8/WnOXXvoECsGU4OpZadV+8BBiNGH3ZeCaQsR/JvoJW5MrQVTfCE/9Wei7Zin1gbTqgPJMsKyGWFp/W/og27eb/SXhinA8tmnr7I/aWppmOK39rlO6zlcQ5j+4gtfwe+B6ZPQFtPAfKCgD+BBNbtZGWl70BowbWGCn5/mujm1FExxbRRPf8qdjbYaYB3ClF7PO6VoJ9DWpoApUIcCa8K0BQpO/bVQXQKmeLDz8XhszVxsbTCtw/fNClMgqwIcpsge1yqA6txfTuWCKU7nl85EuZ4G06wubI2ZAnUoQIGNf+Z2PvX8549+zGN/8Tp+PYUHpkiyVQ1McSqPLHTs3zEvNejIg7Vv6/AEs8IUMAVUChBIL0OYIlMsWXCzChkrvlY1lrVKYIrs8+rqnSYDzfkVpzk6vf74k/MH16Pu8u+zqWbcDjYFTIHFFKCgvg+BiuyppoLMFTYBssicseB1WHDnHafrWG5uftjciV/qbnzYr/R1JPuWPZlmMS+whk0BU0CtAIH0JoRp6exUCqit7I8PgVBnen1UT541YAqYAvUoQEG9Y0HenGZvBVJbsBOZNNeY6vt6vMAsMQVMgSwKUGB3nmuKwMd1SVzDtDJfAfysduC/EdxlmThrxBQwBepTgAB6AET5gptByKxw3dKWNA3wFTNAdOCntLhGvavPA8wiU8AUyKIABfgFLXccplbvf8AoNAFI7aZTFo+1RkyByhWgYO/ckFKAo5flPvO2kPnvKp9+M88UMAVyKoCgp+X2mcMv14cBILrPOT/WlilgCmxMAYIATv3xKyncoLJFpsGeNNttbMrNXFPAFDAFTAFTwBQwBUwBU8AUMAVMAVPAFDAFTAFTwBQwBUwBU8AUMAVMAVPAFDAFTIG1Ffg/nr1xpD8EfgMAAAAASUVORK5CYII='

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
  const fi = fiData.value
  const filiere = fi ? (fi.type_formation?.nom ?? 'Formation Individuelle') : (insc0?.filiere?.nom ?? insc0?.classe?.filiere?.nom ?? '')
  const classe = insc0?.classe
  const classeNom = fi ? 'Formation Individuelle' : (classe?.nom ?? '—')
  const classeNiveau = classe?.niveau ?? 1
  const hasNiveau0 = fi ? false : !!((insc0?.filiere as any)?.type_has_niveau ?? (insc0?.classe?.filiere as any)?.type_has_niveau ?? false)
  const niveauLabel = hasNiveau0
    ? (classeNiveau === 1 ? '1ère Année' : `${classeNiveau}ème Année`)
    : classeNom
  const anneeAcad = fi ? (fi.annee_academique?.libelle ?? '') : (insc0?.annee_academique?.libelle ?? '')

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
  const annee = anneeAcad
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

  // ── 6. QR Code de vérification ───────────────────────────────────────
  try {
    const verifyUrl = `${window.location.origin}/verify/${etudiant.value.numero_etudiant}`
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      width: 120, margin: 1,
      color: { dark: '#111111', light: '#ffffff' },
    })
    const qrSize = 102
    const qrX = W - pad - qrSize - 6   // aligné à droite
    const qrY = cY - 4                  // même niveau que les contacts
    await drawImage(ctx, qrDataUrl, qrX, qrY, qrSize, qrSize)
    // Cadre léger autour du QR
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 1
    ctx.strokeRect(qrX, qrY, qrSize, qrSize)
    // Label sous le QR
    ctx.fillStyle = '#999999'
    ctx.font = '11px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('Scanner pour vérifier', qrX + qrSize / 2, qrY + qrSize + 14)
    ctx.textAlign = 'left'
  } catch { /* QR code optionnel — silencieux si erreur */ }

  // ── 7. Bordure arrondie ──────────────────────────────────────────────
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
  const fi = fiData.value
  if (!etd || (!insc && !fi)) { alert("Aucune inscription trouvée pour cet étudiant."); return }
  const fmt = (n: number | null | undefined) =>
    n != null ? new Intl.NumberFormat('fr-FR').format(n) + ' FCFA' : '—'
  const val = (v: any) => v || '—'
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return d }
  }
  const filiere = fi ? (fi.type_formation?.nom ?? 'Formation Individuelle') : (insc?.filiere?.nom ?? insc?.classe?.filiere?.nom ?? '—')
  const niveau = fi ? 'Formation Individuelle' : (insc?.niveau_entree?.nom ?? '—')
  const bourse = fi ? 'N/A' : (insc?.niveau_bourse?.nom ? `${insc.niveau_bourse.nom} (${insc.niveau_bourse.pourcentage}%)` : 'Aucune')
  const annee = fi ? (fi.annee_academique?.libelle ?? '—') : (insc?.annee_academique?.libelle ?? '—')
  const sLabel = fi ? (fi.statut === 'solde' ? 'Soldé' : fi.statut === 'en_cours' ? 'En cours' : fi.statut) : (statutLabel[insc?.statut] ?? insc?.statut ?? '—')
  const nv = (insc?.classe as any)?.niveau
  const hasNiveau = fi ? false : !!(
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
.hdr img{width:113px;height:113px;object-fit:contain;display:block;margin-bottom:12px}
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
.footer-bar{margin-top:auto;border-top:2px solid #E30613;padding-top:6px;font-size:9px;text-align:center;color:#333}
.page-wrap{min-height:calc(100vh - 12mm);display:flex;flex-direction:column}
.page2{page-break-before:always;padding-top:10mm;min-height:calc(100vh - 12mm);display:flex;flex-direction:column}
.ri-hdr{text-align:center;margin-bottom:28px}
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
<div class="page-wrap">
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
${fi ? `
<div class="sec"><div class="sec-title">Paramètres de formation</div><table>
<tr><td class="lbl">Type de formation</td><td>${fi.type_formation?.nom ?? 'Formation Individuelle'}</td><td class="lbl2">Année académique</td><td>${annee}</td></tr>
<tr><td class="lbl">Date début</td><td>${fmtDate(fi.date_debut)}</td><td class="lbl2">Date fin</td><td>${fmtDate(fi.date_fin)}</td></tr>
<tr><td class="lbl">Modules</td><td colspan="3">${(fi.modules || []).map((m: any) => m.matiere_nom).join(', ') || '—'}</td></tr>
</table></div>
<div class="sec"><div class="sec-title">Conditions financières</div><table class="fin-tbl">
<tr><td class="lbl" style="width:40%">Coût total</td><td>${fmt(fi.cout_total)}</td></tr>
${(fi.paiements || []).map((p: any) => `<tr><td class="lbl">${p.type === 'inscription' ? 'Inscription' : 'Solde'}</td><td>${fmt(p.montant)} ${p.statut === 'paye' ? '✓ Payé' : p.statut === 'partiel' ? '◐ Partiel' : '✗ Non payé'}</td></tr>`).join('')}
</table></div>
` : `
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
`}
<div class="sign-row">
<div class="sign-box"><h4>Signature de l'étudiant(e)</h4><div class="sign-line">Lu et approuvé — Signature</div></div>
<div class="sign-box"><h4>Cachet et signature de la Direction</h4><div class="sign-line">Tampon + Signature</div></div>
</div>
<div class="mention">En signant cette fiche, l'étudiant(e) reconnaît avoir pris connaissance du règlement intérieur et s'engage à respecter ses obligations académiques et financières.</div>
<div class="footer-bar">Amitié 1, Villa n°3031 — Dakar, Sénégal | +221 77 841 50 44 / 77 618 45 52 | uptechformation.com</div>
</div><!-- /page-wrap -->
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
<div class="footer-bar">UP'TECH Formation — Amitié 1, Villa n°3031, Dakar, Sénégal | +221 77 841 50 44 / 77 618 45 52</div>
</div>
<script>window.onload=()=>{window.print()}<\/script></body></html>`
  openPrintWindow(html)
}

function printCertificatDetail() {
  const etd = etudiant.value
  const insc = etd.inscriptions?.[0]
  const fi = fiData.value
  if (!etd || (!insc && !fi)) { alert("Aucune inscription trouvée pour cet étudiant."); return }
  const val = (v: any) => v || '—'
  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return d }
  }
  const filiere = fi ? (fi.type_formation?.nom ?? 'Formation Individuelle') : (insc?.filiere?.nom ?? insc?.classe?.filiere?.nom ?? '—')
  const niveau = fi ? 'Formation Individuelle' : (insc?.niveau_entree?.nom ?? '—')
  const annee = fi ? (fi.annee_academique?.libelle ?? '—') : (insc?.annee_academique?.libelle ?? '—')
  const nvc = (insc?.classe as any)?.niveau
  const hasNiveauC = fi ? false : !!(
    (insc?.filiere as any)?.type_has_niveau
    ?? (insc?.classe?.filiere as any)?.type_has_niveau
    ?? false
  )
  const niveauEtude = (nvc && hasNiveauC) ? (nvc === 1 ? '1ère année' : `${nvc}ème année`) : null
  const logoUrl = `${window.location.origin}/icons/icon-192.png`
  const refNum = `UPTECH/${new Date().getFullYear()}/${String(etd.id ?? Math.floor(Math.random()*9000+1000)).padStart(4,'0')}`
  const dateJour = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const dots = '◦ '.repeat(80)
  const sLabel = fi ? (fi.statut === 'en_cours' ? 'En cours' : fi.statut) : (statutLabel[insc?.statut] ?? insc?.statut ?? '—')
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<title>Certificat d'inscription — ${etd.prenom} ${etd.nom}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff;padding:6mm 15mm;min-height:100vh;display:flex;flex-direction:column}
@page{size:A4 portrait;margin:0}@media print{body{padding:6mm 15mm;min-height:100vh}}
.hdr{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:4px;gap:0}
.hdr img{width:113px;height:113px;object-fit:contain;display:block;margin-bottom:12px}
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
.footer-bar{margin-top:auto;border-top:2px solid #E30613;padding-top:6px;font-size:9px;text-align:center;color:#333}
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
Le Directeur des études de l'Institut Supérieur de Formation UP'TECH certifie que :<br><br>
<span class="highlight">${etd.prenom?.toUpperCase()} ${etd.nom?.toUpperCase()}</span>
${etd.date_naissance ? `, né(e) le <span class="underline">${fmtDate(etd.date_naissance)}</span> à <span class="underline">${val(etd.lieu_naissance)}</span>,` : ''}
${etd.cni_numero ? `porteur/porteuse de la CNI N° <span class="underline">${etd.cni_numero}</span>,` : ''}
<br><br>est régulièrement inscrit(e) dans notre établissement pour l'année académique <span class="underline">${annee}</span>, dans la filière ci-dessous :
</div>
<div class="cert-card"><table>
<tr><td>Numéro étudiant</td><td>${etd.numero_etudiant ?? '—'}</td></tr>
<tr><td>Filière / Formation</td><td>${filiere}</td></tr>
${fi ? `
<tr><td>Type</td><td>Formation Individuelle</td></tr>
<tr><td>Modules</td><td>${(fi.modules || []).map((m: any) => m.matiere_nom).join(', ') || '—'}</td></tr>
<tr><td>Période</td><td>${fmtDate(fi.date_debut)} — ${fmtDate(fi.date_fin)}</td></tr>
` : `
<tr><td>Niveau d'entrée</td><td>${niveau}</td></tr>
${niveauEtude ? `<tr><td>Année d'étude</td><td><strong>${niveauEtude}</strong></td></tr>` : ''}
<tr><td>Classe</td><td>${insc?.classe?.nom ?? 'Pool (à affecter)'}</td></tr>
`}
<tr><td>Statut</td><td>${fi ? (fi.statut === 'en_cours' ? 'En cours' : fi.statut) : sLabel}</td></tr>
</table></div>
<div class="cert-usage">Ce certificat est délivré à l'intéressé(e) pour servir et valoir ce que de droit, notamment pour les démarches administratives, bancaires et auprès des autorités compétentes.</div>
<div class="cert-sign"><div class="cert-sign-box">
<div class="sign-place">Dakar, le ${dateJour}</div>
<div class="sign-zone"></div>
<div class="sign-name">Le Directeur des études</div>
<div class="sign-title">UP'TECH Formation</div>
</div></div>
<div class="footer-bar">UP'TECH Formation — Amitié 1, Villa n°3031, Dakar, Sénégal | +221 77 841 50 44 / 77 618 45 52 | uptechformation.com</div>
<script>window.onload=()=>{window.print()}<\/script></body></html>`
  openPrintWindow(html)
}

// --- Checklist documents ---
interface ChecklistItem {
  code: string
  label: string
  recu: boolean
  date_reception: string | null
  toggling?: boolean
}
const checklist = ref<ChecklistItem[]>([])
const checklistLoading = ref(false)

async function loadChecklist() {
  if (!etudiant.value?.id) return
  checklistLoading.value = true
  try {
    const { data } = await api.get(`/etudiants/${etudiant.value.id}/checklist-documents`)
    checklist.value = data
  } catch {
    // silencieux
  } finally {
    checklistLoading.value = false
  }
}

async function toggleDoc(item: ChecklistItem) {
  item.toggling = true
  try {
    const { data } = await api.patch(
      `/etudiants/${etudiant.value.id}/checklist-documents/${item.code}`,
      { recu: !item.recu }
    )
    item.recu = data.recu
    item.date_reception = data.date_reception
  } catch {
    alert('Erreur lors de la mise à jour')
  } finally {
    item.toggling = false
  }
}

const checklistRecuCount = computed(() => checklist.value.filter(d => d.recu).length)

// ── Commentaires internes ─────────────────────────────────────────────────────
interface Commentaire {
  id: number
  etudiant_id: number
  auteur_id: number
  auteur_nom: string
  auteur_prenom: string
  auteur_role: string
  auteur_photo: string | null
  contenu: string
  categorie: string
  created_at: string
  updated_at: string | null
}

const commentaires = ref<Commentaire[]>([])
const commentairesLoading = ref(false)
const newCommentaire = ref('')
const newCategorie = ref('general')
const commentaireSubmitting = ref(false)
const editingCommentId = ref<number | null>(null)
const editingContenu = ref('')
const editingCategorie = ref('general')
const commentaireDeleting = ref<number | null>(null)

const categorieOptions = [
  { value: 'general',       label: 'Général',         color: 'bg-gray-100 text-gray-600',     dot: '#6b7280' },
  { value: 'positif',       label: '✨ Positif',       color: 'bg-green-100 text-green-700',   dot: '#16a34a' },
  { value: 'pedagogique',   label: '📚 Pédagogique',  color: 'bg-blue-100 text-blue-700',     dot: '#2563eb' },
  { value: 'financier',     label: '💰 Financier',    color: 'bg-amber-100 text-amber-700',   dot: '#d97706' },
  { value: 'disciplinaire', label: '⚠️ Disciplinaire',color: 'bg-red-100 text-red-700',       dot: '#dc2626' },
  { value: 'rh',            label: '👥 Suivi RH',     color: 'bg-purple-100 text-purple-700', dot: '#7c3aed' },
]

function categorieInfo(value: string) {
  return categorieOptions.find(c => c.value === value) ?? categorieOptions[0]!
}

async function loadCommentaires() {
  if (!etudiant.value?.id) return
  commentairesLoading.value = true
  try {
    const { data } = await api.get(`/etudiants/${etudiant.value.id}/commentaires`)
    commentaires.value = data
  } catch { commentaires.value = [] }
  finally { commentairesLoading.value = false }
}

async function submitCommentaire() {
  if (!newCommentaire.value.trim() || commentaireSubmitting.value) return
  commentaireSubmitting.value = true
  try {
    const { data } = await api.post(`/etudiants/${etudiant.value.id}/commentaires`, {
      contenu: newCommentaire.value.trim(),
      categorie: newCategorie.value,
    })
    commentaires.value.unshift(data)
    newCommentaire.value = ''
    newCategorie.value = 'general'
  } catch (err: any) {
    alert(err?.response?.data?.message || 'Erreur lors de l\'ajout du commentaire.')
  } finally {
    commentaireSubmitting.value = false
  }
}

function startEdit(c: Commentaire) {
  editingCommentId.value = c.id
  editingContenu.value = c.contenu
  editingCategorie.value = c.categorie
}

function cancelEdit() {
  editingCommentId.value = null
  editingContenu.value = ''
}

async function saveEdit(c: Commentaire) {
  if (!editingContenu.value.trim()) return
  try {
    const { data } = await api.put(`/commentaires/${c.id}`, {
      contenu: editingContenu.value.trim(),
      categorie: editingCategorie.value,
    })
    const idx = commentaires.value.findIndex(x => x.id === c.id)
    if (idx !== -1) commentaires.value[idx] = data
    editingCommentId.value = null
  } catch (err: any) {
    alert(err?.response?.data?.message || 'Erreur lors de la modification.')
  }
}

async function deleteCommentaire(id: number) {
  if (!confirm('Supprimer ce commentaire ?')) return
  commentaireDeleting.value = id
  try {
    await api.delete(`/commentaires/${id}`)
    commentaires.value = commentaires.value.filter(c => c.id !== id)
  } catch (err: any) {
    alert(err?.response?.data?.message || 'Erreur lors de la suppression.')
  } finally {
    commentaireDeleting.value = null
  }
}

// ── Timeline ────────────────────────────────────────────────────────────────
interface TimelineEvent {
  type: 'inscription' | 'paiement' | 'note' | 'absence' | 'document' | 'relance'
  event_date: string
  titre: string
  meta: Record<string, any>
}

const timeline = ref<TimelineEvent[]>([])
const timelineLoading = ref(false)

async function loadTimeline() {
  if (!etudiant.value?.id) return
  timelineLoading.value = true
  try {
    const { data } = await api.get(`/etudiants/${etudiant.value.id}/timeline`)
    timeline.value = data
  } catch {
    timeline.value = []
  } finally {
    timelineLoading.value = false
  }
}

const timelineGrouped = computed(() => {
  const groups: { month: string; events: TimelineEvent[] }[] = []
  const seen: Record<string, number> = {}
  for (const event of timeline.value) {
    if (!event.event_date) continue
    const d = new Date(event.event_date)
    const key = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    if (seen[key] === undefined) {
      seen[key] = groups.length
      groups.push({ month: key, events: [] })
    }
    groups[seen[key]]?.events.push(event)
  }
  return groups
})

const tlPaiementLabel: Record<string, string> = {
  frais_inscription: "Frais d'inscription",
  mensualite: 'Mensualité',
  tenue: 'Tenue scolaire',
  rattrapage: 'Rattrapage',
  autre: 'Autre paiement',
}

const tlModeLabel: Record<string, string> = {
  especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money',
  virement: 'Virement', cheque: 'Chèque',
}

const tlTypeLabel: Record<string, string> = {
  inscription: 'Inscription', paiement: 'Paiement',
  note: 'Note', absence: 'Absence', document: 'Document reçu', relance: 'Relance',
}

// ── Relances paiement ─────────────────────────────────────────────────────────
const relancesMap = ref<Record<number, any[]>>({}) // clé = inscription_id
const relanceSending = ref<Record<number, boolean>>({}) // clé = inscription_id

async function loadRelances(inscriptionId: number) {
  try {
    const { data } = await api.get(`/relances?inscription_id=${inscriptionId}`)
    relancesMap.value = { ...relancesMap.value, [inscriptionId]: data }
  } catch { /* ignore */ }
}

async function sendManualRelance(inscriptionId: number) {
  if (relanceSending.value[inscriptionId]) return
  relanceSending.value = { ...relanceSending.value, [inscriptionId]: true }
  try {
    const { data } = await api.post('/relances/manual', { inscription_id: inscriptionId })
    const msg = data.simulated
      ? 'Relance simulée (configurez BREVO_API_KEY pour envoi réel).'
      : 'Relance envoyée avec succès.'
    alert(msg)
    await loadRelances(inscriptionId)
    // Recharger la timeline si active
    if (activeTab.value === 'timeline') await loadTimeline()
  } catch (err: any) {
    const msg = err?.response?.data?.message || 'Erreur lors de l\'envoi de la relance.'
    const simulated = err?.response?.data?.simulated
    alert(simulated ? `Simulation — ${msg}` : msg)
  } finally {
    relanceSending.value = { ...relanceSending.value, [inscriptionId]: false }
  }
}

// ── Exonérations de l'étudiant ───────────────────────────────────────
const exonerations = ref<any[]>([])
const exonerationsLoading = ref(false)
const canManageExo      = computed(() => ['dg', 'resp_fin', 'secretariat'].includes(auth.user?.role ?? ''))
const canValidateExo    = computed(() => ['dg', 'resp_fin'].includes(auth.user?.role ?? ''))
const canCancelExo      = computed(() => auth.user?.role === 'dg')

const showExoForm = ref(false)
const savingExo = ref(false)
const exoError = ref('')
const exoForm = ref({
  inscription_id: 0,
  motif: 'bourse_merite',
  portee: 'mensualites_toutes',
  mois_concerne: '',
  mode_calcul: 'pourcentage' as 'pourcentage' | 'montant_fixe',
  valeur: 0,
  libelle: '',
  date_effet: new Date().toISOString().slice(0, 10),
  notes: '',
})
const EXO_MOTIFS = [
  { code: 'bourse_merite',    label: 'Bourse de mérite' },
  { code: 'bourse_sociale',   label: 'Bourse sociale' },
  { code: 'convention',       label: 'Convention / Partenariat' },
  { code: 'enfant_personnel', label: 'Enfant du personnel' },
  { code: 'decision_dg',      label: 'Décision DG' },
  { code: 'autre',            label: 'Autre' },
]
const EXO_PORTEES = [
  { code: 'totale',                label: 'Totalité des frais' },
  { code: 'inscription',           label: 'Inscription uniquement' },
  { code: 'tenue',                 label: 'Tenue uniquement' },
  { code: 'mensualites_toutes',    label: 'Toutes les mensualités' },
  { code: 'mensualite_specifique', label: 'Mensualité spécifique' },
]

function exoMotifLabel(c: string)  { return EXO_MOTIFS.find(m => m.code === c)?.label ?? c }
function exoPorteeLabel(c: string) { return EXO_PORTEES.find(p => p.code === c)?.label ?? c }
function exoStatutLabel(s: string) {
  return ({ en_attente: 'En attente', validee: 'Validée', rejetee: 'Rejetée', annulee: 'Annulée' } as Record<string,string>)[s] ?? s
}
function exoStatutClass(s: string) {
  return ({
    en_attente: 'bg-yellow-100 text-yellow-800',
    validee:    'bg-green-100 text-green-800',
    rejetee:    'bg-red-100 text-red-800',
    annulee:    'bg-gray-100 text-gray-700',
  } as Record<string,string>)[s] ?? 'bg-gray-100 text-gray-700'
}
function fmtExoMoney(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\u202F/g, ' ') + ' FCFA'
}
function fmtExoMois(d: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

async function loadExonerations() {
  if (!etudiant.value?.id) return
  exonerationsLoading.value = true
  try {
    const { data } = await api.get('/exonerations', { params: { etudiant_id: etudiant.value.id } })
    exonerations.value = data.data ?? data ?? []
  } finally {
    exonerationsLoading.value = false
  }
}

function openExoForm() {
  const inscActives = (etudiant.value?.inscriptions ?? []).filter((i: any) => i.statut === 'active' || i.statut === 'inscrit_actif' || i.statut === 'en_cours')
  const defaultInsc = inscActives[0]?.id ?? etudiant.value?.inscriptions?.[0]?.id ?? 0
  exoForm.value = {
    inscription_id: defaultInsc,
    motif: 'bourse_merite',
    portee: 'mensualites_toutes',
    mois_concerne: '',
    mode_calcul: 'pourcentage',
    valeur: 0,
    libelle: '',
    date_effet: new Date().toISOString().slice(0, 10),
    notes: '',
  }
  exoError.value = ''
  showExoForm.value = true
}

async function saveExo() {
  if (!exoForm.value.inscription_id) { exoError.value = 'Inscription requise.'; return }
  if (!(exoForm.value.valeur > 0))   { exoError.value = 'Valeur doit être > 0.'; return }
  if (exoForm.value.mode_calcul === 'pourcentage' && exoForm.value.valeur > 100) {
    exoError.value = 'Pourcentage ≤ 100%.'; return
  }
  if (exoForm.value.portee === 'mensualite_specifique' && !exoForm.value.mois_concerne) {
    exoError.value = 'Précisez le mois concerné.'; return
  }
  savingExo.value = true
  exoError.value = ''
  try {
    await api.post('/exonerations', {
      ...exoForm.value,
      mois_concerne: exoForm.value.mois_concerne || null,
    })
    showExoForm.value = false
    await loadExonerations()
  } catch (e: any) {
    exoError.value = e.response?.data?.message ?? 'Erreur'
  } finally {
    savingExo.value = false
  }
}

async function validerExo(e: any) {
  if (!confirm(`Valider cette exonération ? Elle sera appliquée aux échéances.`)) return
  try {
    await api.post(`/exonerations/${e.id}/valider`)
    await loadExonerations()
    // Recharger les échéances du paiement
    if (e.inscription_id) {
      try {
        const { data: echs } = await api.get(`/inscriptions/${e.inscription_id}/echeances`)
        echeancesMap.value = { ...echeancesMap.value, [e.inscription_id]: echs }
      } catch { /* noop */ }
    }
  } catch (err: any) {
    alert(err.response?.data?.message ?? 'Erreur')
  }
}

async function rejeterExo(e: any) {
  const motif = prompt('Motif du rejet (optionnel) :') ?? ''
  try {
    await api.post(`/exonerations/${e.id}/rejeter`, { motif: motif || null })
    await loadExonerations()
  } catch (err: any) { alert(err.response?.data?.message ?? 'Erreur') }
}

async function annulerExo(e: any) {
  const motif = prompt('Motif de l\'annulation (optionnel) :') ?? ''
  if (!confirm('Annuler cette exonération validée ? Les échéances seront recalculées.')) return
  try {
    await api.post(`/exonerations/${e.id}/annuler`, { motif: motif || null })
    await loadExonerations()
    if (e.inscription_id) {
      try {
        const { data: echs } = await api.get(`/inscriptions/${e.inscription_id}/echeances`)
        echeancesMap.value = { ...echeancesMap.value, [e.inscription_id]: echs }
      } catch { /* noop */ }
    }
  } catch (err: any) { alert(err.response?.data?.message ?? 'Erreur') }
}

async function supprimerExo(e: any) {
  if (!confirm('Supprimer cette exonération ?')) return
  try {
    await api.delete(`/exonerations/${e.id}`)
    await loadExonerations()
  } catch (err: any) { alert(err.response?.data?.message ?? 'Erreur') }
}

function switchTab(key: string) {
  activeTab.value = key as any
  if (key === 'timeline' && !timeline.value.length && !timelineLoading.value) {
    loadTimeline()
  }
  if (key === 'commentaires' && !commentaires.value.length && !commentairesLoading.value) {
    loadCommentaires()
  }
  if (key === 'parents') {
    loadParents()
  }
  if (key === 'exonerations' && !exonerations.value.length && !exonerationsLoading.value) {
    loadExonerations()
  }
}

function formatEventDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
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

// ── Export Dossier Complet PDF ────────────────────────────────────────────────
const dossierLoading = ref(false)

async function exportDossierPDF() {
  if (!etudiant.value) return
  dossierLoading.value = true
  try {
    const etd = etudiant.value
    const insc = etd.inscriptions?.[0]

    // Fetch notes bulletin
    let bulletinUes: any[] = []
    let bulletinNotes: any[] = []
    if (insc?.id) {
      try {
        const r = await api.get(`/notes/bulletin/${insc.id}`)
        bulletinUes = r.data?.ues ?? []
        bulletinNotes = r.data?.notes ?? []
      } catch { /* no notes */ }
    }

    const logoUrl = `${window.location.origin}/icons/icon-192.png`
    const now = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

    // ── Helpers ──
    const fmtNum = (n: any) => n != null ? new Intl.NumberFormat('fr-FR').format(Number(n)) : '—'
    const fmtFcfa = (n: any) => n != null ? fmtNum(n) + ' FCFA' : '—'
    const fmtDate = (d: any) => {
      if (!d) return '—'
      try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return String(d) }
    }
    const fmtDateShort = (d: any) => {
      if (!d) return '—'
      try { return new Date(d).toLocaleDateString('fr-FR') } catch { return String(d) }
    }
    const fmtMoisLabel = (raw: string) => {
      if (!raw) return '—'
      try {
        const s = raw.length === 7 ? raw + '-01' : raw
        return new Date(s).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      } catch { return raw }
    }

    const tPay: Record<string,string> = {
      frais_inscription: "Frais d'inscription", mensualite: 'Mensualité',
      tenue: 'Tenue', rattrapage: 'Rattrapage', autre: 'Autre'
    }
    const tMode: Record<string,string> = {
      especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money',
      virement: 'Virement', cheque: 'Chèque'
    }

    // ── Data ──
    const filiere = insc?.filiere?.nom ?? insc?.classe?.filiere?.nom ?? '—'
    const classe = insc?.classe?.nom ?? 'Non affecté'
    const annee = insc?.annee_academique?.libelle ?? '—'
    const niveauEntree = insc?.niveau_entree?.nom ?? '—'
    const bourse = insc?.niveau_bourse ? `${insc.niveau_bourse.nom} (${insc.niveau_bourse.pourcentage}%)` : 'Aucune'
    const inscStatus = statutLabel[insc?.statut] ?? insc?.statut ?? '—'
    const hasNiveauFlag = !!((insc?.filiere as any)?.type_has_niveau ?? (insc?.classe?.filiere as any)?.type_has_niveau ?? false)
    const niveauEtude = (hasNiveauFlag && (insc?.classe as any)?.niveau)
      ? ((insc?.classe as any).niveau === 1 ? '1ère Année' : `${(insc?.classe as any).niveau}ème Année`)
      : null

    const paiements: any[] = insc ? (paiementsMap.value[insc.id] ?? []) : []
    const echeances: any[] = insc ? (echeancesMap.value[insc.id] ?? []) : []
    const totalPaye = paiements.reduce((s, p) => s + Number(p.montant ?? 0), 0)
    const overdueCount = echeances.filter(e => e.statut === 'non_paye' && new Date(e.mois) < new Date()).length

    // ── Notes stats ──
    const normalNotes = bulletinNotes.filter((n: any) => n.session === 'normale')
    let moyenneCoeff: string | null = null
    if (bulletinUes.length && normalNotes.length) {
      let sumW = 0, sumC = 0
      for (const ue of bulletinUes) {
        const n = normalNotes.find((x: any) => x.ue_id === ue.id)
        if (n) { const c = Number(ue.coefficient ?? 1); sumW += Number(n.note) * c; sumC += c }
      }
      if (sumC > 0) moyenneCoeff = (sumW / sumC).toFixed(2)
    }

    // ── Presence ──
    const taux = risque.value?.taux_presence as number | null | undefined
    const presCount = risque.value?.presences_count ?? 0
    const totalSeances = risque.value?.total_seances ?? 0

    // ── Document stats ──
    const docRecu = checklist.value.filter(d => d.recu).length
    const docTotal = checklist.value.length

    // ── Note color ──
    const nc = (n: any) => n != null ? (Number(n) >= 10 ? '#15803d' : '#dc2626') : '#9ca3af'

    // ── HTML rows ──
    const rowsEch = echeances.map(e => {
      const paid = e.statut === 'paye'
      const late = !paid && new Date(e.mois) < new Date()
      const col = paid ? '#15803d' : late ? '#dc2626' : '#6b7280'
      const lbl = paid ? '✓ Payé' : late ? '⚠ En retard' : 'À venir'
      return `<tr><td>${fmtMoisLabel(e.mois)}</td><td>${tPay[e.type_echeance] ?? e.type_echeance}</td><td style="text-align:right">${fmtNum(e.montant)} FCFA</td><td style="color:${col};font-weight:700">${lbl}</td></tr>`
    }).join('')

    const rowsPay = paiements.map((p: any) => `<tr>
      <td>${fmtDateShort(p.confirmed_at ?? p.created_at)}</td>
      <td>${tPay[p.type_paiement] ?? p.type_paiement}</td>
      <td style="text-align:right;font-weight:700">${fmtNum(p.montant)} FCFA</td>
      <td>${tMode[p.mode_paiement] ?? p.mode_paiement ?? '—'}</td>
      <td style="font-family:monospace;font-size:8px">${p.numero_recu ?? '—'}</td></tr>`).join('')

    const rowsNotes = bulletinUes.map((ue: any) => {
      const nN = bulletinNotes.find((x: any) => x.ue_id === ue.id && x.session === 'normale')?.note
      const nR = bulletinNotes.find((x: any) => x.ue_id === ue.id && x.session === 'rattrapage')?.note
      const nF = (nR != null && Number(nR) > Number(nN ?? 0)) ? nR : nN
      return `<tr>
        <td style="font-weight:600;font-family:monospace">${ue.code}</td>
        <td>${ue.nom}</td>
        <td style="text-align:center">${ue.coefficient ?? 1}</td>
        <td style="text-align:center;color:${nc(nN)};font-weight:${nN != null ? 700 : 400}">${nN ?? '—'}</td>
        <td style="text-align:center;color:${nc(nR)};font-weight:${nR != null ? 700 : 400}">${nR ?? '—'}</td>
        <td style="text-align:center;color:${nc(nF)};font-weight:700;font-size:11px">${nF ?? '—'}</td></tr>`
    }).join('')

    const rowsDocs = checklist.value.map(d => `<tr>
      <td>${d.label}</td>
      <td style="text-align:center;color:${d.recu ? '#15803d' : '#9ca3af'};font-weight:700">${d.recu ? '✓' : '✗'}</td>
      <td>${d.recu && d.date_reception ? fmtDateShort(d.date_reception) : '—'}</td></tr>`).join('')

    const tauxNum = taux ?? 0
    const tauxColor = tauxNum >= 75 ? '#16a34a' : tauxNum >= 50 ? '#d97706' : '#dc2626'

    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/>
<title>Dossier — ${etd.prenom} ${etd.nom}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:9.5px;color:#111;background:#fff}
@page{size:A4 portrait;margin:12mm 15mm 14mm}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
/* Header */
.hdr{display:flex;align-items:center;gap:14px;padding-bottom:10px;border-bottom:2.5px solid #E30613;margin-bottom:12px}
.hdr img{width:58px;height:58px;object-fit:contain;flex-shrink:0}
.hdr-txt{flex:1}
.hdr-txt .tg{font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#E30613;margin-bottom:2px}
.hdr-txt h1{font-size:11px;font-weight:900;color:#111;line-height:1.3;margin-bottom:2px}
.hdr-txt .mt{font-size:7.5px;color:#555}
.hdr-right{text-align:right;flex-shrink:0}
.hdr-right .bt{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:1px;display:block;color:#111}
.hdr-right .bnum{font-size:9px;color:#888;font-family:monospace;display:block;margin-top:2px}
.hdr-right .bdate{font-size:7px;color:#aaa;display:block;margin-top:2px}
/* KPI bar */
.kpi{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.kpi-box{flex:1;min-width:60px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:6px 10px;text-align:center}
.kpi-box .kv{font-size:15px;font-weight:900;display:block;line-height:1}
.kpi-box .kl{font-size:6.5px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-top:3px;display:block}
.green .kv{color:#15803d}.red .kv{color:#dc2626}.amber .kv{color:#d97706}
/* Section */
.sec{margin-bottom:12px}
.st{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#fff;background:#E30613;padding:4px 10px}
.sb{border:1px solid #e5e7eb;border-top:none;padding:10px 12px}
/* Identité */
.id-wrap{display:grid;grid-template-columns:78px 1fr 1fr;gap:12px}
.id-photo{width:78px;height:94px;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f3f4f6}
.id-photo img{width:100%;height:100%;object-fit:cover}
.id-init{font-size:22px;font-weight:900;color:#E30613;text-transform:uppercase}
.ir{display:flex;align-items:baseline;gap:5px;margin-bottom:5px}
.il{font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#9ca3af;min-width:68px;flex-shrink:0}
.iv{font-size:9px;font-weight:600;color:#111}
/* Tables */
table{width:100%;border-collapse:collapse}
th{background:#f3f4f6;font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#374151;padding:5px 8px;border:1px solid #e5e7eb;text-align:left}
td{font-size:8.5px;color:#111;padding:4px 8px;border:1px solid #e5e7eb;vertical-align:middle}
tr:nth-child(even) td{background:#fafafa}
tfoot td{background:#f0fdf4!important;color:#15803d;font-weight:900;font-size:10px}
.pt{font-size:7.5px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.5px;margin:10px 0 5px}
/* Presence bar */
.pb-wrap{display:flex;gap:16px;align-items:center}
.pb{flex:1;height:13px;background:#e5e7eb;border-radius:10px;overflow:hidden}
.pb-fill{height:100%;border-radius:10px}
.pb-tick{display:flex;justify-content:space-between;font-size:6.5px;color:#9ca3af;margin-top:2px}
.pb-stat{text-align:center;min-width:80px}
.pb-pct{font-size:22px;font-weight:900;display:block;line-height:1}
.pb-sub{font-size:7px;color:#6b7280;margin-top:3px;display:block}
/* Signature */
.sig{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:20px;padding-top:14px;border-top:1px dashed #ccc}
.sig-box{text-align:center}
.sig-line{border-bottom:1px solid #ccc;height:38px;margin-bottom:5px}
.sig-lbl{font-size:7px;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px}
/* Footer */
.ft{margin-top:12px;padding-top:8px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between}
.ft-l,.ft-r{font-size:7px;color:#9ca3af}.ft-r{text-align:right}
/* Page break */
.pb-page{break-before:page;page-break-before:always}
.insc-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
</style></head><body>

<!-- HEADER -->
<div class="hdr">
  <img src="${logoUrl}" alt="Logo">
  <div class="hdr-txt">
    <div class="tg">Institut de Formation</div>
    <h1>Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication</h1>
    <div class="mt">NINEA : 006118310 — BP 50281 RP DAKAR | Sicap Amitié 1, Villa N° 3031 — Dakar | Tél : 33 821 34 25 / 77 841 50 44</div>
  </div>
  <div class="hdr-right">
    <span class="bt">Dossier Étudiant</span>
    <span class="bnum">${etd.numero_etudiant}</span>
    <span class="bdate">Édité le ${now}</span>
  </div>
</div>

<!-- KPI RÉSUMÉ -->
<div class="kpi">
  <div class="kpi-box ${taux != null ? (tauxNum >= 75 ? 'green' : tauxNum >= 50 ? 'amber' : 'red') : ''}">
    <span class="kv">${taux != null ? tauxNum + '%' : '—'}</span>
    <span class="kl">Présence</span>
  </div>
  <div class="kpi-box ${totalPaye > 0 ? 'green' : ''}">
    <span class="kv">${fmtNum(totalPaye)}</span>
    <span class="kl">FCFA payés</span>
  </div>
  ${moyenneCoeff ? `<div class="kpi-box ${Number(moyenneCoeff) >= 10 ? 'green' : 'red'}">
    <span class="kv">${moyenneCoeff}/20</span><span class="kl">Moyenne</span>
  </div>` : ''}
  <div class="kpi-box ${docTotal > 0 ? (docRecu === docTotal ? 'green' : 'amber') : ''}">
    <span class="kv">${docRecu}/${docTotal}</span>
    <span class="kl">Dossier</span>
  </div>
  <div class="kpi-box ${overdueCount > 0 ? 'red' : 'green'}">
    <span class="kv">${overdueCount}</span>
    <span class="kl">Éch. en retard</span>
  </div>
</div>

<!-- 1. IDENTITÉ -->
<div class="sec">
  <div class="st">1. Identité de l'étudiant</div>
  <div class="sb">
    <div class="id-wrap">
      <div class="id-photo">
        ${etd.photo_path?.startsWith('data:') ? `<img src="${etd.photo_path}" alt="Photo">` : `<span class="id-init">${(etd.prenom[0]??'')}${(etd.nom[0]??'')}</span>`}
      </div>
      <div>
        <div class="ir"><span class="il">Prénom</span><span class="iv">${etd.prenom}</span></div>
        <div class="ir"><span class="il">Nom</span><span class="iv">${etd.nom}</span></div>
        <div class="ir"><span class="il">N° étudiant</span><span class="iv" style="font-family:monospace">${etd.numero_etudiant}</span></div>
        <div class="ir"><span class="il">Email</span><span class="iv">${etd.email ?? '—'}</span></div>
        <div class="ir"><span class="il">Téléphone</span><span class="iv">${etd.telephone ?? '—'}</span></div>
      </div>
      <div>
        <div class="ir"><span class="il">Date naissance</span><span class="iv">${fmtDate(etd.date_naissance)}</span></div>
        <div class="ir"><span class="il">Lieu naissance</span><span class="iv">${etd.lieu_naissance ?? '—'}</span></div>
        <div class="ir"><span class="il">Adresse</span><span class="iv">${etd.adresse ?? '—'}</span></div>
        <div class="ir"><span class="il">N° CNI</span><span class="iv" style="font-family:monospace">${etd.cni_numero ?? '—'}</span></div>
        <div class="ir"><span class="il">Parent / Tuteur</span><span class="iv">${etd.nom_parent ?? '—'}</span></div>
        ${etd.telephone_parent ? `<div class="ir"><span class="il">Tél. parent</span><span class="iv">${etd.telephone_parent}</span></div>` : ''}
      </div>
    </div>
  </div>
</div>

<!-- 2. INSCRIPTION -->
${insc ? `<div class="sec">
  <div class="st">2. Inscription en cours</div>
  <div class="sb">
    <div class="insc-grid">
      <div>
        <div class="ir"><span class="il">Filière</span><span class="iv">${filiere}</span></div>
        <div class="ir"><span class="il">Classe</span><span class="iv">${classe}${niveauEtude ? ' — ' + niveauEtude : ''}</span></div>
        <div class="ir"><span class="il">Année académique</span><span class="iv">${annee}</span></div>
      </div>
      <div>
        <div class="ir"><span class="il">Statut</span><span class="iv">${inscStatus}</span></div>
        <div class="ir"><span class="il">Niveau d'entrée</span><span class="iv">${niveauEntree}</span></div>
        <div class="ir"><span class="il">Bourse</span><span class="iv">${bourse}</span></div>
      </div>
      <div>
        <div class="ir"><span class="il">Mensualité</span><span class="iv">${insc.mensualite ? fmtFcfa(insc.mensualite) : '—'}</span></div>
        <div class="ir"><span class="il">Frais inscription</span><span class="iv">${insc.frais_inscription ? fmtFcfa(insc.frais_inscription) : '—'}</span></div>
        <div class="ir"><span class="il">Date inscription</span><span class="iv">${fmtDate(insc.created_at)}</span></div>
      </div>
    </div>
  </div>
</div>` : ''}

<!-- 3. SITUATION FINANCIÈRE -->
<div class="sec">
  <div class="st">3. Situation financière</div>
  <div class="sb">
    ${echeances.length ? `<div class="pt">Plan de paiement</div>
    <table><thead><tr><th>Période</th><th>Type</th><th style="text-align:right">Montant</th><th>Statut</th></tr></thead>
    <tbody>${rowsEch}</tbody></table>` : ''}
    ${paiements.length ? `<div class="pt" style="margin-top:${echeances.length ? 12 : 0}px">Historique des paiements confirmés</div>
    <table><thead><tr><th>Date</th><th>Type</th><th style="text-align:right">Montant</th><th>Mode</th><th>N° Reçu</th></tr></thead>
    <tbody>${rowsPay}</tbody>
    <tfoot><tr><td colspan="2" style="text-align:right">TOTAL PAYÉ</td>
      <td style="text-align:right">${fmtNum(totalPaye)} FCFA</td>
      <td colspan="2"></td></tr></tfoot></table>` :
      (!echeances.length ? `<p style="color:#9ca3af;font-size:8.5px;font-style:italic">Aucune donnée financière enregistrée.</p>` : '')}
  </div>
</div>

<!-- 4. RELEVÉ DE NOTES -->
${bulletinUes.length ? `<div class="sec pb-page">
  <div class="st">4. Relevé de notes</div>
  <div class="sb">
    <table><thead><tr>
      <th style="width:55px">Code</th>
      <th>Unité d'Enseignement</th>
      <th style="width:48px;text-align:center">Coeff.</th>
      <th style="width:58px;text-align:center">Normale</th>
      <th style="width:58px;text-align:center">Rattrapage</th>
      <th style="width:58px;text-align:center">Finale</th>
    </tr></thead>
    <tbody>${rowsNotes}</tbody>
    ${moyenneCoeff ? `<tfoot><tr>
      <td colspan="4" style="text-align:right;background:#f3f4f6!important;color:#374151;font-weight:700">Moyenne générale pondérée</td>
      <td colspan="2" style="text-align:center;font-size:12px;color:${Number(moyenneCoeff)>=10?'#15803d':'#dc2626'};background:#f3f4f6!important;font-weight:900">${moyenneCoeff} / 20</td>
    </tr></tfoot>` : ''}
    </table>
    <p style="font-size:7px;color:#9ca3af;margin-top:5px">* La note finale retient la meilleure des deux sessions.</p>
  </div>
</div>` : ''}

<!-- 5. ASSIDUITÉ -->
<div class="sec">
  <div class="st">5. Assiduité (60 derniers jours)</div>
  <div class="sb">
    ${taux != null ? `<div class="pb-wrap">
      <div style="flex:1">
        <div class="pb"><div class="pb-fill" style="width:${tauxNum}%;background:${tauxColor}"></div></div>
        <div class="pb-tick"><span>0%</span><span>50%</span><span>75%</span><span>100%</span></div>
        <p style="font-size:7.5px;color:#6b7280;margin-top:6px">Seuil minimum requis : 75% | Source : feuilles d'émargement numérique</p>
      </div>
      <div class="pb-stat">
        <span class="pb-pct" style="color:${tauxColor}">${tauxNum}%</span>
        <span class="pb-sub">${presCount} présence(s)<br>${totalSeances} séance(s) au total</span>
      </div>
    </div>` : `<p style="color:#9ca3af;font-size:8.5px;font-style:italic">Aucune donnée de présence disponible.</p>`}
  </div>
</div>

<!-- 6. DOSSIER DOCUMENTAIRE -->
${checklist.value.length ? `<div class="sec">
  <div class="st">6. Dossier documentaire (${docRecu} / ${docTotal} documents reçus)</div>
  <div class="sb">
    <table><thead><tr><th>Document requis</th><th style="width:55px;text-align:center">Reçu</th><th style="width:95px">Date réception</th></tr></thead>
    <tbody>${rowsDocs}</tbody></table>
  </div>
</div>` : ''}

<!-- SIGNATURE -->
<div class="sig">
  <div class="sig-box">
    <div class="sig-line"></div>
    <div class="sig-lbl">Signature du Directeur des études</div>
  </div>
  <div class="sig-box">
    <div class="sig-line"></div>
    <div class="sig-lbl">Cachet de l'établissement</div>
  </div>
</div>

<!-- FOOTER -->
<div class="ft">
  <div class="ft-l">UPTECH CAMPUS — Sicap Amitié 1, Villa N°3031 — Dakar, Sénégal<br>Tél : +221 77 841 50 44 — uptechformation.com | Agréé : N°RepSEN/Ensup-priv/AP/387-2021</div>
  <div class="ft-r">Document confidentiel — Usage officiel uniquement<br>Généré le ${now} par le système UPTECH Campus</div>
</div>

</body></html>`

    openPrintAndClose(html)
  } finally {
    dossierLoading.value = false
  }
}

// ── Gestion des comptes parents ───────────────────────────────────────────────
const parentsLies = ref<any[]>([])
const loadingParents = ref(false)
const parentUsersAll = ref<any[]>([])
const newParentUserId = ref('')
const lieurParent = ref(false)

async function loadParents() {
  if (!etudiant.value?.id) return
  loadingParents.value = true
  try {
    const { data } = await api.get(`/parent-lien?etudiant_id=${etudiant.value.id}`)
    parentsLies.value = Array.isArray(data) ? data : []
    // Load all parent-role users for the selector
    const { data: users } = await api.get('/users?role=parent')
    parentUsersAll.value = Array.isArray(users) ? users : []
  } catch { parentsLies.value = [] }
  finally { loadingParents.value = false }
}

async function lierParent() {
  if (!newParentUserId.value || !etudiant.value?.id) return
  lieurParent.value = true
  try {
    await api.post('/parent-lien', { parent_user_id: Number(newParentUserId.value), etudiant_id: etudiant.value.id })
    newParentUserId.value = ''
    await loadParents()
  } catch (e: any) {
    alert(e?.response?.data?.message ?? 'Erreur lors du lien.')
  } finally { lieurParent.value = false }
}

async function delierParent(lienId: number) {
  if (!confirm('Retirer ce parent ?')) return
  await api.delete(`/parent-lien/${lienId}`)
  await loadParents()
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
          <!-- Bouton upload fichier -->
          <button v-if="canWrite" @click="photoInput?.click()"
            :disabled="photoLoading"
            title="Importer une photo depuis un fichier"
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
          <!-- Bouton webcam -->
          <button v-if="canWrite" @click="openWebcam"
            :disabled="photoLoading"
            title="Prendre une photo avec la webcam"
            class="absolute -bottom-1.5 -left-1.5 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 transition">
            <svg class="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </button>
          <input ref="photoInput" type="file" accept="image/*" class="hidden" @change="uploadPhoto" />
        </div>

        <!-- Infos principales -->
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h1 class="text-xl font-bold text-gray-900">{{ etudiant.prenom }} {{ etudiant.nom }}</h1>
                <!-- Feu tricolore risque -->
                <span v-if="risque" :title="risqueLabel ?? ''"
                  class="rqd-badge"
                  :class="`rqd-badge--${risque.risque_global}`">
                  {{ risqueIcon }} {{ risqueLabel }}
                </span>
                <span v-if="etudiant.sexe === 'masculin'"
                  title="Masculin"
                  style="background:#dbeafe;color:#1e40af;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">♂ M</span>
                <span v-else-if="etudiant.sexe === 'feminin'"
                  title="Féminin"
                  style="background:#fce7f3;color:#9d174d;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">♀ F</span>
                <span v-if="etudiant.handicape"
                  :title="etudiant.type_handicap || 'Personne en situation de handicap'"
                  style="background:#fef3c7;color:#78350f;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">♿ Handicap</span>
                <span v-if="etudiant.statut_professionnel === 'salarie'"
                  :title="etudiant.employeur ? 'Employeur : ' + etudiant.employeur : 'Salarié·e'"
                  style="background:#dcfce7;color:#166534;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">💼 Salarié·e</span>
                <span v-else-if="etudiant.statut_professionnel === 'independant'"
                  :title="etudiant.employeur ? 'Structure : ' + etudiant.employeur : 'Indépendant·e'"
                  style="background:#ede9fe;color:#5b21b6;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">🧑‍💻 Indépendant·e</span>
                <span v-else-if="etudiant.statut_professionnel === 'sans_emploi'"
                  title="Sans emploi"
                  style="background:#fee2e2;color:#991b1b;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">🔍 Sans emploi</span>
                <span v-else-if="etudiant.statut_professionnel === 'etudiant'"
                  title="Étudiant·e à temps plein"
                  style="background:#dbeafe;color:#1e40af;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">🎓 Étudiant·e</span>
              </div>
              <p class="text-sm text-gray-500 font-mono mt-0.5">{{ etudiant.numero_etudiant }}</p>
              <!-- Détail risque si alerte -->
              <div v-if="risque && risque.risque_global !== 'green'" class="rqd-details">
                <span v-if="risque.risque_presence !== 'green'" class="rqd-chip" :class="`rqd-chip--${risque.risque_presence}`">
                  {{ risque.risque_presence === 'red' ? '🔴' : '🟡' }}
                  Présence {{ risque.taux_presence !== null ? risque.taux_presence + '%' : 'aucune séance' }}
                </span>
                <span v-if="risque.risque_paiement !== 'green'" class="rqd-chip" :class="`rqd-chip--${risque.risque_paiement}`">
                  {{ risque.risque_paiement === 'red' ? '🔴' : '🟡' }}
                  Paiement retard {{ risque.jours_retard }}j
                </span>
                <span v-if="risque.risque_dossier !== 'green'" class="rqd-chip" :class="`rqd-chip--${risque.risque_dossier}`">
                  {{ risque.risque_dossier === 'red' ? '🔴' : '🟡' }}
                  Dossier {{ risque.docs_recu }}/{{ risque.total_docs }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span
                v-if="etudiant.inscriptions?.[0]"
                class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0"
                :class="statutClass[etudiant.inscriptions[0].statut] ?? 'bg-gray-100 text-gray-600'"
              >
                {{ statutLabel[etudiant.inscriptions[0].statut] ?? etudiant.inscriptions[0].statut }}
              </span>
              <span v-if="isFiStudent" style="background:#eef2ff;color:#4f46e5;font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;">
                🎓 Formation Individuelle
              </span>
              <span v-if="etudiant.inscriptions?.[0]?.regime_formation === 'initiale'"
                title="Formation initiale"
                style="background:#e0f2fe;color:#075985;font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;">
                🎓 Initiale
              </span>
              <span v-else-if="etudiant.inscriptions?.[0]?.regime_formation === 'continue'"
                title="Formation continue"
                style="background:#fef3c7;color:#854d0e;font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;">
                🔄 Continue
              </span>
              <!-- Bouton Badge étudiant -->
              <button @click="generateBadge"
                :disabled="carteBloquee"
                :title="carteBloquee ? 'L\'étudiant doit avoir une inscription active' : 'Générer le badge nominatif'"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-700 text-white text-xs font-medium rounded-lg transition"
                :class="carteBloquee ? 'opacity-40 cursor-not-allowed' : 'hover:bg-red-800'">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Badge
              </button>
              <!-- Bouton Carte étudiant -->
              <button @click="generateCard"
                :disabled="carteBloquee"
                :title="carteBloquee ? (isFiStudent ? 'L\'inscription FI doit être payée' : 'L\'étudiant doit être affecté à une classe') : 'Générer la carte étudiant'"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg transition"
                :class="carteBloquee ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-700'">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2" />
                </svg>
                Carte étudiant
              </button>
              <button @click="ficheDisponible && printFicheDetail()"
                :disabled="!ficheDisponible"
                :title="!ficheDisponible ? (isFiStudent ? 'Disponible après paiement de l\'inscription FI' : 'Disponible après paiement des frais d\'inscription') : 'Imprimer la fiche'"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg transition"
                :class="!ficheDisponible ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-700'">
                🖨️ Fiche d'inscription
              </button>
              <button @click="certificatDisponible && printCertificatDetail()"
                :disabled="!certificatDisponible"
                :title="!certificatDisponible ? (isFiStudent ? 'Disponible après paiement de l\'inscription FI' : 'Disponible après paiement inscription + 1ère mensualité') : 'Imprimer le certificat'"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg transition"
                :class="!certificatDisponible ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-700'">
                📄 Certificat
              </button>
              <!-- Export dossier complet PDF -->
              <button @click="exportDossierPDF"
                :disabled="dossierLoading"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition"
                style="background:#1e40af;color:#fff;"
                :style="dossierLoading ? 'opacity:0.6;cursor:not-allowed' : 'opacity:1'"
                title="Exporter le dossier complet (identité, paiements, notes, présence, documents)">
                <svg v-if="!dossierLoading" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <svg v-else class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                {{ dossierLoading ? 'Génération…' : 'Exporter dossier PDF' }}
              </button>
              <button v-if="canDelete" @click="openDeleteModal"
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
            <span v-else-if="isFiStudent" class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
              {{ fiData.type_formation?.nom ?? 'Formation Individuelle' }}
            </span>
          </div>
        </div>
      </div>

      <!-- ── 4 chiffres clés ──────────────────────────────────────────── -->
      <div class="stat-strip">

        <!-- Moyenne générale -->
        <div class="stat-card">
          <div class="stat-donut-wrap">
            <svg viewBox="0 0 40 40" class="stat-donut">
              <circle cx="20" cy="20" r="15.9155" class="stat-donut-bg"/>
              <circle cx="20" cy="20" r="15.9155" class="stat-donut-arc"
                :stroke="statColor(stats?.moyenne != null ? (stats!.moyenne! / 20) * 100 : null)"
                :stroke-dasharray="donutDash(stats?.moyenne != null ? Math.round((stats!.moyenne! / 20) * 100) : null)"
                stroke-dashoffset="25"/>
            </svg>
            <span class="stat-donut-val"
              :style="{ color: statColor(stats?.moyenne != null ? (stats!.moyenne! / 20) * 100 : null) }">
              {{ stats?.moyenne != null ? stats.moyenne : '—' }}
            </span>
          </div>
          <div class="stat-label">Moyenne générale</div>
          <div class="stat-sub">
            <span v-if="stats?.nb_notes">sur 20 — {{ stats.nb_notes }} note(s)</span>
            <span v-else class="text-gray-400">Aucune note</span>
          </div>
        </div>

        <!-- Taux de présence -->
        <div class="stat-card">
          <div class="stat-donut-wrap">
            <svg viewBox="0 0 40 40" class="stat-donut">
              <circle cx="20" cy="20" r="15.9155" class="stat-donut-bg"/>
              <circle cx="20" cy="20" r="15.9155" class="stat-donut-arc"
                :stroke="statColor(stats?.taux_presence ?? null)"
                :stroke-dasharray="donutDash(stats?.taux_presence ?? null)"
                stroke-dashoffset="25"/>
            </svg>
            <span class="stat-donut-val"
              :style="{ color: statColor(stats?.taux_presence ?? null) }">
              {{ stats?.taux_presence != null ? stats.taux_presence + '%' : '—' }}
            </span>
          </div>
          <div class="stat-label">Taux de présence</div>
          <div class="stat-sub">
            <span v-if="stats?.presences_total">{{ stats.presences_ok }}/{{ stats.presences_total }} séances</span>
            <span v-else class="text-gray-400">Aucune séance</span>
          </div>
        </div>

        <!-- % dossier complété -->
        <div class="stat-card">
          <div class="stat-donut-wrap">
            <svg viewBox="0 0 40 40" class="stat-donut">
              <circle cx="20" cy="20" r="15.9155" class="stat-donut-bg"/>
              <circle cx="20" cy="20" r="15.9155" class="stat-donut-arc"
                :stroke="statColor(stats?.pct_dossier ?? null)"
                :stroke-dasharray="donutDash(stats?.pct_dossier ?? null)"
                stroke-dashoffset="25"/>
            </svg>
            <span class="stat-donut-val"
              :style="{ color: statColor(stats?.pct_dossier ?? null) }">
              {{ stats !== null ? (stats.pct_dossier ?? 0) + '%' : '—' }}
            </span>
          </div>
          <div class="stat-label">Dossier complété</div>
          <div class="stat-sub">
            <span v-if="stats?.docs_total">{{ stats.docs_recu }}/{{ stats.docs_total }} documents</span>
            <span v-else class="text-gray-400">Aucun type configuré</span>
          </div>
        </div>

        <!-- % paiements honorés -->
        <div class="stat-card">
          <div class="stat-donut-wrap">
            <svg viewBox="0 0 40 40" class="stat-donut">
              <circle cx="20" cy="20" r="15.9155" class="stat-donut-bg"/>
              <circle cx="20" cy="20" r="15.9155" class="stat-donut-arc"
                :stroke="statColor(stats?.pct_paiements ?? null)"
                :stroke-dasharray="donutDash(stats?.pct_paiements ?? null)"
                stroke-dashoffset="25"/>
            </svg>
            <span class="stat-donut-val"
              :style="{ color: statColor(stats?.pct_paiements ?? null) }">
              {{ stats?.pct_paiements != null ? stats.pct_paiements + '%' : '—' }}
            </span>
          </div>
          <div class="stat-label">Paiements honorés</div>
          <div class="stat-sub">
            <span v-if="stats?.total_echeances">{{ stats.echeances_payees }}/{{ stats.total_echeances }} échéances</span>
            <span v-else class="text-gray-400">Aucune échéance</span>
          </div>
        </div>

      </div>

      <!-- Onglets -->
      <div class="etd-tab-bar flex border-b border-gray-200 mb-5">
        <button v-for="tab in [
          { key: 'infos', label: 'Informations' },
          { key: 'inscriptions', label: `Inscriptions (${etudiant.inscriptions?.length ?? 0})` },
          { key: 'documents', label: `Documents (${checklistRecuCount}/${checklist.length})` },
          { key: 'finance', label: 'Finances' },
          { key: 'exonerations', label: `🎖️ Exonérations${exonerations.length ? ` (${exonerations.length})` : ''}` },
          { key: 'timeline', label: '📅 Timeline' },
          { key: 'commentaires', label: `🗒️ Notes internes${commentaires.length ? ` (${commentaires.length})` : ''}` },
          { key: 'parents', label: `👨‍👩‍👧 Parents${parentsLies.length ? ` (${parentsLies.length})` : ''}` },
        ]" :key="tab.key"
          @click="switchTab(tab.key)"
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
            { label: 'Sexe', value: etudiant.sexe === 'masculin' ? '♂ Masculin' : etudiant.sexe === 'feminin' ? '♀ Féminin' : null },
            { label: 'Situation', value: etudiant.handicape ? `♿ Personne en situation de handicap${etudiant.type_handicap ? ' (' + etudiant.type_handicap + ')' : ''}` : null },
            { label: 'Statut professionnel', value: ({
                salarie: '💼 Salarié·e',
                independant: '🧑‍💻 Indépendant·e / freelance',
                sans_emploi: '🔍 Sans emploi',
                etudiant: '🎓 Étudiant·e à temps plein',
                autre: 'Autre',
              } as Record<string, string>)[etudiant.statut_professionnel] ?? null },
            { label: 'Employeur / structure', value: etudiant.employeur },
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
        <!-- Formation individuelle -->
        <div v-if="isFiStudent" class="bg-white rounded-xl border border-indigo-200 p-5 mb-4">
          <div class="flex items-start justify-between mb-3">
            <div>
              <span style="background:#eef2ff;color:#4f46e5;font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;">🎓 Formation Individuelle</span>
              <p class="font-medium text-gray-900 mt-2">{{ fiData.type_formation?.nom ?? 'Formation Individuelle' }}</p>
              <p class="text-sm text-gray-500 mt-0.5">{{ fiData.annee_academique?.libelle ?? '' }}</p>
            </div>
            <span :style="fiData.statut === 'solde' ? 'background:#dcfce7;color:#166534;' : fiData.statut === 'en_cours' ? 'background:#dbeafe;color:#1e40af;' : 'background:#f3f4f6;color:#6b7280;'"
              style="font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;">
              {{ fiData.statut === 'solde' ? '✓ Soldé' : fiData.statut === 'en_cours' ? '▶ En cours' : fiData.statut }}
            </span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
            <div style="background:#f9fafb;border-radius:8px;padding:8px 12px;">
              <div style="font-size:10px;color:#6b7280;text-transform:uppercase;">Coût total</div>
              <div style="font-weight:700;font-size:14px;">{{ new Intl.NumberFormat('fr-FR').format(fiData.cout_total) }} F</div>
            </div>
            <div style="background:#f9fafb;border-radius:8px;padding:8px 12px;">
              <div style="font-size:10px;color:#6b7280;text-transform:uppercase;">Payé</div>
              <div style="font-weight:700;font-size:14px;color:#059669;">{{ new Intl.NumberFormat('fr-FR').format((fiData.paiements || []).reduce((s: number, p: any) => s + (parseFloat(p.montant_paye) || 0), 0)) }} F</div>
            </div>
            <div style="background:#f9fafb;border-radius:8px;padding:8px 12px;">
              <div style="font-size:10px;color:#6b7280;text-transform:uppercase;">Modules</div>
              <div style="font-weight:700;font-size:14px;">{{ (fiData.modules || []).length }}</div>
            </div>
          </div>
          <!-- Modules -->
          <table style="width:100%;font-size:12px;border-collapse:collapse;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="text-align:left;padding:6px 10px;font-weight:600;color:#6b7280;">Matière</th>
                <th style="text-align:left;padding:6px 10px;font-weight:600;color:#6b7280;">Formateur</th>
                <th style="text-align:center;padding:6px 10px;font-weight:600;color:#6b7280;">Heures</th>
                <th style="text-align:center;padding:6px 10px;font-weight:600;color:#6b7280;">Progression</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in fiData.modules" :key="m.id" style="border-top:1px solid #f3f4f6;">
                <td style="padding:6px 10px;font-weight:500;">{{ m.matiere_nom }}</td>
                <td style="padding:6px 10px;color:#6b7280;">{{ m.enseignant_nom || '—' }}</td>
                <td style="padding:6px 10px;text-align:center;">{{ m.heures_effectuees }} / {{ m.volume_horaire }}h</td>
                <td style="padding:6px 10px;text-align:center;">
                  <div style="display:inline-block;width:60px;height:5px;background:#eee;border-radius:3px;overflow:hidden;vertical-align:middle;">
                    <div :style="{ width: (m.volume_horaire > 0 ? Math.round(m.heures_effectuees / m.volume_horaire * 100) : 0) + '%' }"
                      style="height:100%;background:#6366f1;border-radius:3px;"></div>
                  </div>
                  <span style="font-size:10px;margin-left:4px;">{{ m.volume_horaire > 0 ? Math.round(m.heures_effectuees / m.volume_horaire * 100) : 0 }}%</span>
                </td>
              </tr>
            </tbody>
          </table>
          <!-- Paiements -->
          <h4 style="margin:12px 0 6px;font-size:12px;font-weight:600;color:#374151;">Paiements</h4>
          <div v-for="p in fiData.paiements" :key="p.id" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-top:1px solid #f3f4f6;font-size:12px;">
            <span style="font-weight:500;">{{ p.type === 'inscription' ? 'Inscription' : 'Solde' }}</span>
            <span>{{ new Intl.NumberFormat('fr-FR').format(p.montant_paye) }} / {{ new Intl.NumberFormat('fr-FR').format(p.montant) }} F</span>
            <span :style="p.statut === 'paye' ? 'color:#059669;' : p.statut === 'partiel' ? 'color:#d97706;' : 'color:#dc2626;'" style="font-weight:600;font-size:11px;">
              {{ p.statut === 'paye' ? '✓ Payé' : p.statut === 'partiel' ? '◐ Partiel' : '✗ Non payé' }}
            </span>
          </div>
        </div>

        <!-- Bouton Réinscrire -->
        <div class="flex justify-end mb-3">
          <button @click="openReinscModal"
            style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:9px;background:#1e293b;color:#fff;font-size:13px;font-weight:600;cursor:pointer;border:none;font-family:'Poppins',sans-serif;">
            ➕ Nouvelle inscription
          </button>
        </div>

        <div v-if="!etudiant.inscriptions?.length && !isFiStudent" class="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
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
              <div class="flex flex-wrap gap-2">
                <span v-for="ech in echeancesMap[insc.id]" :key="ech.id"
                  class="inline-flex flex-col items-center px-3 py-2 rounded-lg text-xs border min-w-[80px] text-center gap-0.5"
                  :class="ech.statut === 'paye'
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : ech.statut === 'partiellement_paye'
                      ? 'bg-orange-50 text-orange-700 border-orange-200'
                      : new Date(ech.mois) < new Date()
                        ? 'bg-red-50 text-red-600 border-red-200'
                        : 'bg-gray-50 text-gray-500 border-gray-200'">
                  <!-- 0. Type label -->
                  <span class="font-bold text-[10px] leading-tight uppercase tracking-wide opacity-60">
                    {{ echLabel(ech, echeancesMap[insc.id] ?? []) }}
                  </span>
                  <!-- 1. Date du mois concerné -->
                  <span class="font-semibold text-[11px] leading-tight">
                    {{ new Date(ech.mois).toLocaleDateString('fr-FR', { month:'short', year:'numeric' }) }}
                  </span>
                  <!-- 2. Statut -->
                  <span class="font-bold text-[11px] leading-tight">
                    <template v-if="ech.statut === 'paye'">✓ Payé</template>
                    <template v-else-if="ech.statut === 'partiellement_paye'">◑ Partiel</template>
                    <template v-else-if="new Date(ech.mois) < new Date()">✗ En retard</template>
                    <template v-else>◦ À venir</template>
                  </span>
                  <!-- 3. Montant versé / prévu -->
                  <span class="text-[10px] leading-tight opacity-75">
                    <template v-if="ech.statut === 'paye'">{{ Number(ech.montant).toLocaleString('fr-FR') }} / {{ Number(ech.montant).toLocaleString('fr-FR') }}</template>
                    <template v-else-if="ech.statut === 'partiellement_paye'">— / {{ Number(ech.montant).toLocaleString('fr-FR') }}</template>
                    <template v-else>0 / {{ Number(ech.montant).toLocaleString('fr-FR') }}</template>
                  </span>
                  <!-- 4. Date de paiement effectif -->
                  <span v-if="ech.date_paiement" class="text-[10px] leading-tight font-semibold">
                    {{ new Date(ech.date_paiement).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' }) }}
                  </span>
                </span>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-400">
                <span class="text-green-600 font-medium">✓ {{ (echeancesMap[insc.id] ?? []).filter((e: any) => e.statut === 'paye').length }} payé(s)</span>
                <span class="text-red-500 font-medium">✗ {{ (echeancesMap[insc.id] ?? []).filter((e: any) => e.statut === 'non_paye' && new Date(e.mois) < new Date()).length }} en retard</span>
                <span class="text-gray-400">◦ {{ (echeancesMap[insc.id] ?? []).filter((e: any) => e.statut === 'non_paye' && new Date(e.mois) >= new Date()).length }} à venir</span>
                <!-- Badge dernières relances -->
                <span v-if="relancesMap[insc.id]?.length"
                  class="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                  </svg>
                  {{ relancesMap[insc.id]?.length ?? 0 }} relance(s) envoyée(s)
                </span>
              </div>
              <!-- Bouton relance manuelle -->
              <div v-if="canWrite && (echeancesMap[insc.id] ?? []).some((e: any) => e.statut === 'non_paye')"
                class="mt-3">
                <button @click="sendManualRelance(insc.id)"
                  :disabled="relanceSending[insc.id]"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                  :class="relanceSending[insc.id]
                    ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'">
                  <svg v-if="!relanceSending[insc.id]" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                  </svg>
                  <svg v-else class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  {{ relanceSending[insc.id] ? 'Envoi…' : 'Envoyer une relance' }}
                </button>
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

      <!-- Onglet : Documents (checklist dépôt) -->
      <div v-else-if="activeTab === 'documents'">
        <!-- En-tête avec progression -->
        <div class="doc-checklist-header">
          <div class="doc-checklist-title">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="doc-checklist-icon">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <div>
              <h3 class="doc-checklist-name">Dossier documentaire</h3>
              <p class="doc-checklist-sub">Cochez les documents physiquement remis par l'étudiant</p>
            </div>
          </div>
          <div class="doc-progress-wrap">
            <span class="doc-progress-label">{{ checklistRecuCount }} / {{ checklist.length }} reçu{{ checklistRecuCount > 1 ? 's' : '' }}</span>
            <div class="doc-progress-bar">
              <div
                class="doc-progress-fill"
                :style="{ width: checklist.length ? (checklistRecuCount / checklist.length * 100) + '%' : '0%' }"
              ></div>
            </div>
          </div>
        </div>

        <!-- Liste des cases à cocher -->
        <div v-if="checklistLoading" class="doc-checklist-empty">Chargement…</div>
        <div v-else-if="!checklist.length" class="doc-checklist-empty">
          Aucun type de document configuré.<br>
          <small>Ajoutez des types dans <strong>Paramètres → Pédagogique → Types de documents</strong></small>
        </div>
        <div v-else class="doc-checklist-grid">
          <button
            v-for="item in checklist"
            :key="item.code"
            @click="canWrite && toggleDoc(item)"
            :disabled="item.toggling"
            class="doc-checklist-item"
            :class="{
              'doc-checklist-item--recu': item.recu,
              'doc-checklist-item--pending': !item.recu,
              'doc-checklist-item--readonly': !canWrite,
            }"
          >
            <!-- Case à cocher visuelle -->
            <div class="doc-checkbox" :class="item.recu ? 'doc-checkbox--checked' : ''">
              <svg v-if="item.toggling" class="doc-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"/>
                <path fill="currentColor" class="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <svg v-else-if="item.recu" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <!-- Libellé + date -->
            <div class="doc-checklist-info">
              <span class="doc-checklist-label">{{ item.label }}</span>
              <span v-if="item.recu && item.date_reception" class="doc-checklist-date">
                Reçu le {{ new Date(item.date_reception).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }) }}
              </span>
              <span v-else-if="!item.recu" class="doc-checklist-missing">Non remis</span>
            </div>
            <!-- Badge statut -->
            <span class="doc-checklist-badge" :class="item.recu ? 'doc-badge--ok' : 'doc-badge--ko'">
              {{ item.recu ? '✓ Reçu' : 'Manquant' }}
            </span>
          </button>
        </div>
      </div>

      <!-- ── Onglet : Finances ─────────────────────────────────────── -->
      <div v-else-if="activeTab === 'finance'">
        <div v-for="fs in financeSummary" :key="fs.insc.id" class="mb-8">
          <!-- En-tête inscription -->
          <div class="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h3 class="text-sm font-bold text-gray-800 mb-3">
              {{ fs.insc.filiere?.nom ?? '—' }}
              <span class="text-xs font-normal text-gray-400 ml-2">{{ fs.insc.annee_academique?.libelle ?? '' }}</span>
            </h3>

            <!-- Dates -->
            <div class="flex flex-wrap gap-4 mb-4 text-xs text-gray-500">
              <div class="flex items-center gap-1.5">
                <span class="text-gray-400">📅</span>
                <span class="font-medium text-gray-600">Début des cours :</span>
                <span>{{ fs.insc.classe?.date_debut_cours ? new Date(fs.insc.classe.date_debut_cours).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—' }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-gray-400">📋</span>
                <span class="font-medium text-gray-600">Date d'inscription :</span>
                <span>{{ fs.insc.created_at ? new Date(fs.insc.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—' }}</span>
              </div>
            </div>

            <!-- KPIs -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div class="bg-gray-50 rounded-lg p-3 text-center">
                <div class="text-[10px] uppercase text-gray-400 font-semibold tracking-wide">Total prévu</div>
                <div class="text-lg font-black text-gray-800">{{ fs.totalPrevu.toLocaleString('fr-FR') }} <span class="text-xs font-normal">F</span></div>
              </div>
              <div class="bg-green-50 rounded-lg p-3 text-center">
                <div class="text-[10px] uppercase text-green-500 font-semibold tracking-wide">Total payé</div>
                <div class="text-lg font-black text-green-700">{{ fs.totalPaye.toLocaleString('fr-FR') }} <span class="text-xs font-normal">F</span></div>
              </div>
              <div class="rounded-lg p-3 text-center" :class="fs.reste > 0 ? 'bg-red-50' : 'bg-green-50'">
                <div class="text-[10px] uppercase font-semibold tracking-wide" :class="fs.reste > 0 ? 'text-red-400' : 'text-green-500'">Reste</div>
                <div class="text-lg font-black" :class="fs.reste > 0 ? 'text-red-600' : 'text-green-700'">{{ fs.reste.toLocaleString('fr-FR') }} <span class="text-xs font-normal">F</span></div>
              </div>
              <div class="rounded-lg p-3 text-center" :class="fs.nbRetard > 0 ? 'bg-amber-50' : 'bg-green-50'">
                <div class="text-[10px] uppercase font-semibold tracking-wide" :class="fs.nbRetard > 0 ? 'text-amber-500' : 'text-green-500'">Retards</div>
                <div class="text-lg font-black" :class="fs.nbRetard > 0 ? 'text-amber-600' : 'text-green-700'">{{ fs.nbRetard }}</div>
              </div>
            </div>

            <!-- Barre progression -->
            <div class="w-full bg-gray-100 rounded-full h-2 mb-1">
              <div class="h-2 rounded-full transition-all" :class="fs.totalPaye >= fs.totalPrevu ? 'bg-green-500' : 'bg-red-500'" :style="`width:${Math.min(100, fs.totalPrevu > 0 ? (fs.totalPaye / fs.totalPrevu * 100) : 0)}%`"></div>
            </div>
            <div class="text-[10px] text-gray-400 text-right">{{ fs.totalPrevu > 0 ? Math.round(fs.totalPaye / fs.totalPrevu * 100) : 0 }}% payé</div>
          </div>

          <!-- Échéancier -->
          <div class="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h4 class="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">Échéancier</h4>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-gray-100">
                    <th class="text-left py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Mois</th>
                    <th class="text-left py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Type</th>
                    <th class="text-right py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Montant</th>
                    <th class="text-center py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="ech in fs.echs" :key="ech.id" class="border-b border-gray-50 hover:bg-gray-50">
                    <td class="py-2 px-3 text-gray-700">{{ fmtMoisEch(ech.mois) }}</td>
                    <td class="py-2 px-3">
                      <span class="text-xs px-2 py-0.5 rounded-full" :class="ech.type_echeance === 'frais_inscription' ? 'bg-blue-50 text-blue-600' : ech.type_echeance === 'tenue' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-600'">
                        {{ echLabel(ech, fs.echs) }}
                      </span>
                    </td>
                    <td class="py-2 px-3 text-right font-semibold">{{ Number(ech.montant).toLocaleString('fr-FR') }} F</td>
                    <td class="py-2 px-3 text-center">
                      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        :class="ech.statut === 'paye' ? 'bg-green-50 text-green-700' : ech.statut === 'partiel' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'">
                        <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
                        {{ ech.statut === 'paye' ? 'Payé' : ech.statut === 'partiel' ? 'Partiel' : 'Non payé' }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Historique paiements -->
          <div class="bg-white rounded-xl border border-gray-200 p-5">
            <h4 class="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">Historique des paiements</h4>
            <div v-if="!fs.pays.length" class="text-sm text-gray-400 text-center py-6">Aucun paiement enregistré</div>
            <div v-else class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-gray-100">
                    <th class="text-left py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Reçu</th>
                    <th class="text-left py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Date</th>
                    <th class="text-left py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Type</th>
                    <th class="text-left py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Mode</th>
                    <th class="text-right py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Montant</th>
                    <th class="text-center py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Statut</th>
                    <th class="text-center py-2 px-3 text-[10px] uppercase text-gray-400 font-semibold">Reçu</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in fs.pays" :key="p.id" class="border-b border-gray-50 hover:bg-gray-50">
                    <td class="py-2 px-3 font-mono text-xs text-gray-500">{{ p.numero_recu }}</td>
                    <td class="py-2 px-3 text-gray-600 text-xs">{{ new Date(p.confirmed_at ?? p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) }}</td>
                    <td class="py-2 px-3">
                      <span class="text-xs px-2 py-0.5 rounded-full" :class="p.type_paiement === 'frais_inscription' ? 'bg-blue-50 text-blue-600' : p.type_paiement === 'tenue' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-600'">
                        {{ p.type_paiement === 'frais_inscription' ? 'Inscription' : p.type_paiement === 'mensualite' ? 'Mensualité' : p.type_paiement === 'tenue' ? 'Tenue' : p.type_paiement }}
                      </span>
                    </td>
                    <td class="py-2 px-3 text-xs text-gray-500">{{ ({ especes:'Espèces', wave:'Wave', orange_money:'OM', virement:'Virement', cheque:'Chèque' } as Record<string,string>)[p.mode_paiement] ?? p.mode_paiement }}</td>
                    <td class="py-2 px-3 text-right font-bold text-green-600">+{{ Number(p.montant).toLocaleString('fr-FR') }} F</td>
                    <td class="py-2 px-3 text-center">
                      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        :class="p.statut === 'confirme' ? 'bg-green-50 text-green-700' : p.statut === 'en_attente' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'">
                        {{ p.statut === 'confirme' ? 'OK' : p.statut === 'en_attente' ? 'Attente' : 'Rejeté' }}
                      </span>
                    </td>
                    <td class="py-2 px-3 text-center">
                      <button v-if="p.statut === 'confirme'" @click="printRecuFinance(p, fs.insc)"
                        class="text-xs border border-gray-200 text-gray-400 px-2 py-1 rounded hover:bg-gray-50 transition" title="Imprimer reçu">
                        <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div v-if="!financeSummary.length" class="text-center text-gray-400 py-12">Aucune inscription trouvée</div>
      </div>

      <!-- ── Onglet : Timeline ─────────────────────────────────────── -->
      <div v-else-if="activeTab === 'timeline'" class="tl-wrapper">

        <!-- Chargement -->
        <div v-if="timelineLoading" class="flex items-center justify-center py-16">
          <svg class="animate-spin w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>

        <!-- Vide -->
        <div v-else-if="!timeline.length" class="tl-empty">
          <div class="tl-empty-icon">📅</div>
          <p class="tl-empty-title">Aucun événement enregistré</p>
          <p class="tl-empty-sub">Les inscriptions, paiements, notes, absences, documents et relances apparaîtront ici.</p>
        </div>

        <!-- Timeline -->
        <div v-else class="tl-timeline">
          <div v-for="(group, gi) in timelineGrouped" :key="group.month" class="tl-group">

            <!-- Mois / Année -->
            <div class="tl-month-sep">
              <span class="tl-month-pill">{{ group.month }}</span>
            </div>

            <!-- Événements du mois -->
            <div v-for="(ev, ei) in group.events" :key="ei" class="tl-item">

              <!-- Colonne icône + trait vertical -->
              <div class="tl-icon-col">
                <div class="tl-dot" :class="`tl-dot--${ev.type}`">
                  <span v-if="ev.type === 'inscription'" class="tl-dot-emoji">🎓</span>
                  <span v-else-if="ev.type === 'paiement'" class="tl-dot-emoji">💳</span>
                  <span v-else-if="ev.type === 'note'" class="tl-dot-emoji">📝</span>
                  <span v-else-if="ev.type === 'absence'" class="tl-dot-emoji">⚠️</span>
                  <span v-else-if="ev.type === 'document'" class="tl-dot-emoji">📄</span>
                  <span v-else-if="ev.type === 'relance'" class="tl-dot-emoji">📧</span>
                </div>
                <div class="tl-line"
                  v-if="ei < group.events.length - 1 || gi < timelineGrouped.length - 1">
                </div>
              </div>

              <!-- Carte événement -->
              <div class="tl-card" :class="`tl-card--${ev.type}`">

                <!-- En-tête carte -->
                <div class="tl-card-head">
                  <span class="tl-badge" :class="`tl-badge--${ev.type}`">
                    {{ tlTypeLabel[ev.type] }}
                  </span>
                  <span class="tl-card-date">{{ formatEventDate(ev.event_date) }}</span>
                </div>

                <!-- Inscription -->
                <template v-if="ev.type === 'inscription'">
                  <p class="tl-card-title">{{ ev.titre }}</p>
                  <p v-if="ev.meta?.annee" class="tl-card-sub">{{ ev.meta.annee }}</p>
                  <span class="tl-status-pill"
                    :class="{
                      'tl-status--green': ev.meta?.statut === 'inscrit_actif',
                      'tl-status--amber': ev.meta?.statut === 'pre_inscrit',
                      'tl-status--blue':  ev.meta?.statut === 'en_examen',
                      'tl-status--gray':  ['diplome','abandonne'].includes(ev.meta?.statut),
                    }">
                    {{ statutLabel[ev.meta?.statut] ?? ev.meta?.statut }}
                  </span>
                </template>

                <!-- Paiement -->
                <template v-else-if="ev.type === 'paiement'">
                  <p class="tl-card-title">{{ tlPaiementLabel[ev.titre] ?? ev.titre }}</p>
                  <p class="tl-montant">
                    {{ Number(ev.meta?.montant ?? 0).toLocaleString('fr-FR') }}
                    <span class="tl-devise">FCFA</span>
                  </p>
                  <div class="tl-chips">
                    <span v-if="ev.meta?.mode" class="tl-chip">
                      {{ tlModeLabel[ev.meta.mode] ?? ev.meta.mode }}
                    </span>
                    <span v-if="ev.meta?.numero_recu" class="tl-chip tl-chip--mono">
                      {{ ev.meta.numero_recu }}
                    </span>
                    <span v-if="ev.meta?.mois" class="tl-chip">
                      {{ new Date(ev.meta.mois.length === 7 ? ev.meta.mois + '-01' : ev.meta.mois).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) }}
                    </span>
                  </div>
                </template>

                <!-- Note -->
                <template v-else-if="ev.type === 'note'">
                  <p class="tl-card-title">{{ ev.titre }}</p>
                  <div class="tl-note-row">
                    <span class="tl-note-val"
                      :class="(ev.meta?.note ?? 0) >= 10 ? 'tl-note--pass' : 'tl-note--fail'">
                      {{ ev.meta?.note !== undefined ? ev.meta.note : '—' }}<span class="tl-note-denom">/20</span>
                    </span>
                    <span class="tl-card-sub">
                      Session {{ ev.meta?.session === 'rattrapage' ? 'rattrapage' : 'normale' }}
                    </span>
                  </div>
                </template>

                <!-- Absence -->
                <template v-else-if="ev.type === 'absence'">
                  <p class="tl-card-title">{{ ev.titre }}</p>
                  <p class="tl-card-sub">Absence constatée</p>
                </template>

                <!-- Document -->
                <template v-else-if="ev.type === 'document'">
                  <p class="tl-card-title">{{ ev.titre }}</p>
                  <p class="tl-card-sub">Document physiquement remis</p>
                </template>

                <!-- Relance -->
                <template v-else-if="ev.type === 'relance'">
                  <p class="tl-card-title">{{ ev.titre }}</p>
                  <div class="tl-chips mt-1">
                    <span class="tl-chip"
                      :class="ev.meta?.type_relance === 'manuel' ? 'tl-chip--amber' : 'tl-chip--blue'">
                      {{ ev.meta?.type_relance === 'manuel' ? '✋ Manuelle' : '🤖 Automatique' }}
                    </span>
                    <span v-if="ev.meta?.jours_avant === 0" class="tl-chip">Jour J</span>
                    <span v-else-if="ev.meta?.jours_avant < 0" class="tl-chip">J{{ ev.meta.jours_avant }}</span>
                    <span v-else-if="ev.meta?.jours_avant > 0" class="tl-chip">J-{{ ev.meta.jours_avant }}</span>
                    <span v-if="ev.meta?.email" class="tl-chip tl-chip--mono" style="font-size:10px">{{ ev.meta.email }}</span>
                  </div>
                </template>

              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- ── Onglet : Notes internes ────────────────────────────────── -->
      <div v-else-if="activeTab === 'commentaires'" class="comm-wrapper">

        <!-- Bandeau "staff seulement" -->
        <div class="comm-staff-notice">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
          </svg>
          <span>Notes visibles uniquement par le staff — l'étudiant n'y a pas accès.</span>
        </div>

        <!-- Formulaire d'ajout -->
        <div class="comm-form-card">
          <div class="comm-form-row">
            <select v-model="newCategorie" class="comm-cat-select">
              <option v-for="opt in categorieOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <textarea
            v-model="newCommentaire"
            placeholder="Ajouter une note interne… (ex : Très motivé, difficultés en maths, A besoin d'un suivi RH)"
            class="comm-textarea"
            rows="3"
            @keydown.ctrl.enter="submitCommentaire"
          ></textarea>
          <div class="comm-form-actions">
            <span class="text-xs text-gray-400">Ctrl+Entrée pour envoyer</span>
            <button @click="submitCommentaire"
              :disabled="!newCommentaire.trim() || commentaireSubmitting"
              class="comm-submit-btn"
              :class="(!newCommentaire.trim() || commentaireSubmitting) ? 'opacity-50 cursor-not-allowed' : ''">
              <svg v-if="commentaireSubmitting" class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
              </svg>
              {{ commentaireSubmitting ? 'Envoi…' : 'Ajouter' }}
            </button>
          </div>
        </div>

        <!-- Chargement -->
        <div v-if="commentairesLoading" class="flex items-center justify-center py-12">
          <svg class="animate-spin w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>

        <!-- Liste vide -->
        <div v-else-if="!commentaires.length" class="comm-empty">
          <div class="text-3xl mb-2">🗒️</div>
          <p class="font-semibold text-gray-600">Aucune note interne</p>
          <p class="text-sm text-gray-400 mt-1">Soyez le premier à laisser une observation.</p>
        </div>

        <!-- Liste des commentaires -->
        <div v-else class="comm-list">
          <div v-for="comm in commentaires" :key="comm.id" class="comm-card">

            <!-- Mode lecture -->
            <template v-if="editingCommentId !== comm.id">
              <div class="comm-card-head">
                <!-- Avatar + auteur -->
                <div class="comm-author">
                  <div class="comm-avatar">
                    <img v-if="comm.auteur_photo" :src="comm.auteur_photo" class="w-full h-full object-cover rounded-full"/>
                    <span v-else class="comm-avatar-initials">
                      {{ (comm.auteur_prenom?.[0] ?? '') + (comm.auteur_nom?.[0] ?? '') }}
                    </span>
                  </div>
                  <div>
                    <span class="comm-author-name">{{ comm.auteur_prenom }} {{ comm.auteur_nom }}</span>
                    <span class="comm-author-role">{{ comm.auteur_role }}</span>
                  </div>
                </div>
                <!-- Badge catégorie + date -->
                <div class="comm-meta-right">
                  <span class="comm-cat-badge" :class="categorieInfo(comm.categorie).color">
                    {{ categorieInfo(comm.categorie).label }}
                  </span>
                  <span class="comm-date">
                    {{ formatDate(comm.updated_at ?? comm.created_at) }}
                    <span v-if="comm.updated_at" class="text-gray-300 text-xs"> (modifié)</span>
                  </span>
                </div>
              </div>
              <!-- Contenu -->
              <p class="comm-contenu">{{ comm.contenu }}</p>
              <!-- Actions -->
              <div v-if="auth.user?.id === comm.auteur_id || auth.user?.role === 'dg'"
                class="comm-actions">
                <button @click="startEdit(comm)" class="comm-action-btn comm-action-btn--edit">
                  ✏️ Modifier
                </button>
                <button @click="deleteCommentaire(comm.id)"
                  :disabled="commentaireDeleting === comm.id"
                  class="comm-action-btn comm-action-btn--del">
                  {{ commentaireDeleting === comm.id ? '…' : '🗑️ Supprimer' }}
                </button>
              </div>
            </template>

            <!-- Mode édition -->
            <template v-else>
              <div class="mb-2">
                <select v-model="editingCategorie" class="comm-cat-select">
                  <option v-for="opt in categorieOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </div>
              <textarea v-model="editingContenu" class="comm-textarea" rows="3"
                @keydown.ctrl.enter="saveEdit(comm)"></textarea>
              <div class="comm-form-actions mt-2">
                <button @click="cancelEdit" class="comm-action-btn comm-action-btn--edit">Annuler</button>
                <button @click="saveEdit(comm)"
                  :disabled="!editingContenu.trim()"
                  class="comm-submit-btn"
                  :class="!editingContenu.trim() ? 'opacity-50 cursor-not-allowed' : ''">
                  Enregistrer
                </button>
              </div>
            </template>

          </div>
        </div>

      </div>

      <!-- ── Onglet : Exonérations ──────────────────────────────────── -->
      <div v-else-if="activeTab === 'exonerations'">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#1e40af;">
          💡 Les exonérations (bourses, remises, décisions DG) sont créées ici puis validées par le DG / Resp. financier. Une exonération validée diminue automatiquement le montant dû sur les échéances concernées.
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="font-size:15px;font-weight:600;color:#111;margin:0;">Exonérations ({{ exonerations.length }})</h3>
          <button v-if="canManageExo" @click="openExoForm"
                  style="padding:8px 14px;background:#b91c1c;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">
            + Nouvelle exonération
          </button>
        </div>

        <div v-if="exonerationsLoading" class="text-sm text-gray-500 py-8 text-center">Chargement…</div>
        <div v-else-if="exonerations.length === 0" class="text-sm text-gray-400 py-8 text-center">
          Aucune exonération pour cet étudiant
        </div>
        <div v-else class="overflow-x-auto border border-gray-200 rounded-lg bg-white">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th class="px-3 py-2 text-left">Motif</th>
                <th class="px-3 py-2 text-left">Portée</th>
                <th class="px-3 py-2 text-right">Valeur</th>
                <th class="px-3 py-2 text-right">Appliqué</th>
                <th class="px-3 py-2 text-left">Statut</th>
                <th class="px-3 py-2 text-left">Demandée le</th>
                <th class="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="exo in exonerations" :key="exo.id" class="border-t border-gray-100">
                <td class="px-3 py-2">
                  <div class="font-medium text-gray-900">{{ exoMotifLabel(exo.motif) }}</div>
                  <div v-if="exo.libelle" class="text-xs text-gray-500">{{ exo.libelle }}</div>
                </td>
                <td class="px-3 py-2">
                  <div>{{ exoPorteeLabel(exo.portee) }}</div>
                  <div v-if="exo.mois_concerne" class="text-xs text-gray-500">{{ fmtExoMois(exo.mois_concerne) }}</div>
                </td>
                <td class="px-3 py-2 text-right font-semibold">
                  <span v-if="exo.mode_calcul === 'pourcentage'">{{ Number(exo.valeur) }}%</span>
                  <span v-else>{{ fmtExoMoney(Number(exo.valeur)) }}</span>
                </td>
                <td class="px-3 py-2 text-right font-semibold text-emerald-700">
                  {{ Number(exo.montant_applique) > 0 ? fmtExoMoney(Number(exo.montant_applique)) : '—' }}
                </td>
                <td class="px-3 py-2">
                  <span class="px-2 py-1 rounded-full text-xs font-semibold" :class="exoStatutClass(exo.statut)">
                    {{ exoStatutLabel(exo.statut) }}
                  </span>
                  <div v-if="exo.statut === 'rejetee' && exo.motif_rejet" class="text-xs text-red-600 mt-1">{{ exo.motif_rejet }}</div>
                  <div v-if="exo.statut === 'annulee' && exo.motif_annulation" class="text-xs text-gray-500 mt-1">{{ exo.motif_annulation }}</div>
                </td>
                <td class="px-3 py-2 text-xs text-gray-500">{{ formatEventDate(exo.created_at) }}</td>
                <td class="px-3 py-2 text-center">
                  <div class="flex gap-1 justify-center flex-wrap">
                    <button v-if="canValidateExo && exo.statut === 'en_attente'"
                            @click="validerExo(exo)"
                            class="px-2 py-1 text-xs rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
                      ✓ Valider
                    </button>
                    <button v-if="canValidateExo && exo.statut === 'en_attente'"
                            @click="rejeterExo(exo)"
                            class="px-2 py-1 text-xs rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
                      ✗ Rejeter
                    </button>
                    <button v-if="canCancelExo && exo.statut === 'validee'"
                            @click="annulerExo(exo)"
                            class="px-2 py-1 text-xs rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
                      ↶ Annuler
                    </button>
                    <button v-if="canCancelExo"
                            @click="supprimerExo(exo)"
                            class="px-2 py-1 text-xs rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Modal création exonération -->
        <Teleport to="body">
          <div v-if="showExoForm" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" @click.self="showExoForm = false">
            <div class="bg-white rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-xl">
              <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h3 class="text-base font-semibold text-gray-900">Nouvelle exonération</h3>
                <button @click="showExoForm = false" class="text-gray-400 hover:text-gray-600 text-xl">×</button>
              </div>
              <div class="px-6 py-5 space-y-4">
                <div v-if="exoError" class="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{{ exoError }}</div>

                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Inscription <span class="text-red-500">*</span></label>
                  <select v-model.number="exoForm.inscription_id" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option :value="0" disabled>— Choisir une inscription —</option>
                    <option v-for="insc in (etudiant.inscriptions || [])" :key="insc.id" :value="insc.id">
                      {{ insc.filiere?.nom || '—' }} / {{ insc.annee_academique?.libelle || '' }} ({{ insc.statut }})
                    </option>
                  </select>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Motif <span class="text-red-500">*</span></label>
                    <select v-model="exoForm.motif" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                      <option v-for="m in EXO_MOTIFS" :key="m.code" :value="m.code">{{ m.label }}</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Portée <span class="text-red-500">*</span></label>
                    <select v-model="exoForm.portee" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                      <option v-for="p in EXO_PORTEES" :key="p.code" :value="p.code">{{ p.label }}</option>
                    </select>
                  </div>
                </div>

                <div v-if="exoForm.portee === 'mensualite_specifique'">
                  <label class="block text-xs font-medium text-gray-700 mb-1">Mois concerné <span class="text-red-500">*</span></label>
                  <input v-model="exoForm.mois_concerne" type="month" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Mode de calcul <span class="text-red-500">*</span></label>
                    <select v-model="exoForm.mode_calcul" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                      <option value="pourcentage">Pourcentage (%)</option>
                      <option value="montant_fixe">Montant fixe (FCFA)</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">
                      {{ exoForm.mode_calcul === 'pourcentage' ? 'Pourcentage (%)' : 'Montant (FCFA)' }} <span class="text-red-500">*</span>
                    </label>
                    <input v-model.number="exoForm.valeur" type="number" min="0" :max="exoForm.mode_calcul === 'pourcentage' ? 100 : undefined" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Libellé / Justification</label>
                  <input v-model="exoForm.libelle" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Ex: Bourse d'excellence — 1er de promo" />
                </div>

                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Date d'effet</label>
                  <input v-model="exoForm.date_effet" type="date" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>

                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Notes internes</label>
                  <textarea v-model="exoForm.notes" rows="2" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>
              </div>
              <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-2 bg-gray-50 rounded-b-xl">
                <button @click="showExoForm = false" class="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Annuler</button>
                <button @click="saveExo" :disabled="savingExo" class="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
                  {{ savingExo ? 'Enregistrement…' : 'Soumettre la demande' }}
                </button>
              </div>
            </div>
          </div>
        </Teleport>
      </div>

      <!-- ── Onglet : Parents / Tuteurs ─────────────────────────────── -->
      <div v-else-if="activeTab === 'parents'" style="max-width:620px;">
        <div v-if="loadingParents" class="flex items-center justify-center py-10">
          <svg class="animate-spin w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
        <template v-else>
          <!-- Info banner -->
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:18px;font-size:13px;color:#1e40af;">
            💡 Les comptes parents permettent aux tuteurs de suivre les notes, absences et paiements de leur enfant via le <strong>Portail Parent</strong>. Créez d'abord un utilisateur avec le rôle <strong>Parent/Tuteur</strong> depuis la gestion des utilisateurs, puis liez-le ici.
          </div>

          <!-- Liste des parents liés -->
          <div v-if="parentsLies.length" style="margin-bottom:18px;">
            <p style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">
              👨‍👩‍👧 Parents / Tuteurs liés ({{ parentsLies.length }})
            </p>
            <div v-for="p in parentsLies" :key="p.id"
              style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;background:#fff;">
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#4f46e5);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;flex-shrink:0;">
                  {{ (p.parent_prenom?.[0] ?? '') + (p.parent_nom?.[0] ?? '') }}
                </div>
                <div>
                  <div style="font-size:13px;font-weight:600;color:#111;">{{ p.parent_prenom }} {{ p.parent_nom }}</div>
                  <div style="font-size:12px;color:#6b7280;">{{ p.parent_email }}</div>
                </div>
              </div>
              <button v-if="canWrite" @click="delierParent(p.id)"
                style="font-size:11px;padding:4px 10px;background:#fee2e2;color:#b91c1c;border:none;border-radius:4px;cursor:pointer;">
                Retirer
              </button>
            </div>
          </div>
          <p v-else style="font-size:13px;color:#9ca3af;margin-bottom:18px;">Aucun parent lié pour le moment.</p>

          <!-- Lier un parent -->
          <div v-if="canWrite" style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;background:#fafafa;">
            <p style="font-size:12px;font-weight:700;color:#374151;margin:0 0 10px;">Lier un compte parent</p>
            <div style="display:flex;gap:8px;">
              <select v-model="newParentUserId"
                style="flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:#fff;">
                <option value="">— Choisir un utilisateur parent —</option>
                <option v-for="u in parentUsersAll.filter(u => !parentsLies.some(l => l.parent_user_id === u.id))"
                  :key="u.id" :value="String(u.id)">
                  {{ u.prenom }} {{ u.nom }} — {{ u.email }}
                </option>
              </select>
              <button @click="lierParent" :disabled="!newParentUserId || lieurParent"
                style="padding:8px 16px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;"
                :style="(!newParentUserId || lieurParent) ? 'opacity:0.5;cursor:not-allowed' : ''">
                {{ lieurParent ? 'Liaison…' : '🔗 Lier' }}
              </button>
            </div>
            <p v-if="!parentUsersAll.length" style="font-size:11px;color:#9ca3af;margin:8px 0 0;">
              Aucun utilisateur avec le rôle Parent/Tuteur trouvé. <a href="/users" style="color:#6366f1;">Créer un compte parent →</a>
            </p>
          </div>
        </template>
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

  <!-- Modal Badge étudiant -->
  <Teleport to="body">
    <div v-if="showBadge" class="card-overlay" @click.self="showBadge = false">
      <div class="card-modal" style="max-width:360px;">
        <div class="card-modal-header">
          <div>
            <h2 class="card-modal-title">Badge nominatif</h2>
            <p class="card-modal-sub">Aperçu — 90 × 126 mm (format badge portrait)</p>
          </div>
          <button @click="showBadge = false" class="card-close">✕</button>
        </div>
        <div class="card-modal-body">
          <canvas ref="badgeCanvas" class="card-canvas" style="max-width:280px;" />
          <p v-if="!badgeGenerated" class="card-loading">Génération en cours…</p>
        </div>
        <div v-if="badgeGenerated" class="card-modal-footer">
          <button @click="printBadge" class="uc-btn-outline">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Imprimer
          </button>
          <button @click="downloadBadge" class="uc-btn-primary">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Télécharger PNG
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Modal suppression progressive -->
  <Teleport to="body">
    <div v-if="showDeleteModal" class="del-overlay" @click.self="showDeleteModal = false">
      <div class="del-modal">
        <div class="del-header">
          <div class="del-steps">
            <span class="del-step" :class="{ 'del-step--active': deleteStep === 1, 'del-step--done': deleteStep > 1 }">
              {{ deleteStep > 1 ? '✓' : '1' }} Bilan
            </span>
            <span class="del-step-sep">→</span>
            <span class="del-step" :class="{ 'del-step--active': deleteStep === 2 }">2 Confirmation</span>
          </div>
          <button @click="showDeleteModal = false" class="del-close">✕</button>
        </div>

        <template v-if="deleteStep === 1">
          <div class="del-icon">⚠️</div>
          <h2 class="del-title">Données qui seront supprimées</h2>
          <p class="del-subtitle">Étudiant : <strong>{{ etudiant?.prenom }} {{ etudiant?.nom }}</strong></p>
          <div v-if="deletePreviewLoading" class="del-loading">Chargement du bilan…</div>
          <div v-else-if="deletePreview" class="del-tree">
            <div class="del-tree-root"><span class="del-tree-icon">👤</span><span class="del-tree-label">Étudiant + photo</span></div>
            <div v-for="niveau in deletePreview.niveaux" :key="niveau.label" class="del-tree-level">
              <div class="del-tree-node" :class="{ 'del-tree-node--zero': niveau.count === 0 }">
                <span class="del-tree-bullet">├─</span>
                <span class="del-tree-count" :class="niveau.count > 0 ? 'del-count--warn' : 'del-count--zero'">{{ niveau.count }}</span>
                <span class="del-tree-text">{{ niveau.detail }}</span>
              </div>
              <div v-for="enfant in niveau.enfants" :key="enfant.label"
                class="del-tree-node del-tree-node--child" :class="{ 'del-tree-node--zero': enfant.count === 0 }">
                <span class="del-tree-bullet del-tree-bullet--child">│&nbsp;&nbsp;└─</span>
                <span class="del-tree-count" :class="enfant.count > 0 ? 'del-count--warn' : 'del-count--zero'">{{ enfant.count }}</span>
                <span class="del-tree-text">{{ enfant.detail }}</span>
              </div>
            </div>
          </div>
          <div class="del-actions">
            <button @click="showDeleteModal = false" class="del-btn-cancel">Annuler</button>
            <button @click="deleteStep = 2; confirmDeleteName = ''" class="del-btn-next">Continuer →</button>
          </div>
        </template>

        <template v-if="deleteStep === 2">
          <div class="del-icon">🗑️</div>
          <h2 class="del-title">Confirmation finale</h2>
          <p class="del-warning">Cette action est <strong>irréversible</strong>. Toutes les données listées seront définitivement effacées.</p>
          <p class="del-confirm-label">Tapez <strong>{{ etudiant?.prenom }} {{ etudiant?.nom }}</strong> pour confirmer :</p>
          <input v-model="confirmDeleteName" type="text" class="del-input"
            placeholder="Nom complet de l'étudiant" @keyup.enter="confirmDeleteEtudiant" autofocus />
          <div class="del-actions">
            <button @click="deleteStep = 1" class="del-btn-cancel">← Retour</button>
            <button @click="confirmDeleteEtudiant"
              :disabled="deletingEtudiant || confirmDeleteName.trim().toLowerCase() !== `${etudiant?.prenom} ${etudiant?.nom}`.toLowerCase()"
              class="del-btn-confirm">
              {{ deletingEtudiant ? 'Suppression…' : 'Supprimer définitivement' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>

  <!-- Modal Webcam -->
  <Teleport to="body">
    <div v-if="showWebcamModal" class="webcam-overlay" @click.self="closeWebcam">
      <div class="webcam-modal">
        <div class="webcam-header">
          <span class="webcam-title">📷 Photo par webcam</span>
          <button @click="closeWebcam" class="webcam-close">✕</button>
        </div>
        <div class="webcam-body">
          <!-- Flux live (masqué après capture) -->
          <template v-if="!webcamCaptured">
            <video
              ref="webcamVideo"
              class="webcam-preview webcam-preview--flip"
              autoplay
              playsinline
              muted
            ></video>
            <p class="webcam-hint">Centrez le visage de l'étudiant dans le cadre</p>
          </template>
          <!-- Aperçu après capture -->
          <template v-else>
            <img :src="webcamCaptured" class="webcam-preview" alt="Aperçu capture" />
            <p class="webcam-hint">Vérifiez la photo avant d'enregistrer</p>
          </template>
        </div>
        <div class="webcam-footer">
          <template v-if="!webcamCaptured">
            <button @click="closeWebcam" class="webcam-btn-cancel">Annuler</button>
            <button @click="captureWebcam" class="webcam-btn-capture">
              <svg class="webcam-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" stroke-width="2" fill="currentColor"/>
                <circle cx="12" cy="12" r="9" stroke-width="2"/>
              </svg>
              Capturer
            </button>
          </template>
          <template v-else>
            <button @click="webcamCaptured = null" class="webcam-btn-cancel">↩ Reprendre</button>
            <button @click="saveWebcamPhoto" :disabled="webcamLoading" class="webcam-btn-save">
              {{ webcamLoading ? 'Enregistrement…' : '✓ Enregistrer cette photo' }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ── Modal Réinscription ───────────────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="showReinscModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
      <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="color:#fff;font-size:16px;font-weight:700;font-family:'Poppins',sans-serif;">➕ Nouvelle inscription</div>
            <div style="color:#94a3b8;font-size:12px;margin-top:2px;font-family:'Poppins',sans-serif;">{{ etudiant?.prenom }} {{ etudiant?.nom }}</div>
          </div>
          <button @click="showReinscModal=false" style="background:rgba(255,255,255,.1);border:none;color:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;">✕</button>
        </div>

        <!-- Body -->
        <div style="padding:24px;" v-if="!reinscSuccess">
          <div v-if="reinscLoading" style="text-align:center;color:#94a3b8;padding:20px 0;font-family:'Poppins',sans-serif;">Chargement…</div>
          <template v-else>
            <!-- Année académique -->
            <div style="margin-bottom:14px;">
              <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;font-family:'Poppins',sans-serif;">Année académique *</label>
              <select v-model="reinscForm.annee_academique_id"
                style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:'Poppins',sans-serif;background:#f8fafc;">
                <option value="">— Sélectionner —</option>
                <option v-for="a in reinscAnnees" :key="a.id" :value="String(a.id)">
                  {{ a.libelle }}{{ a.actif ? ' (en cours)' : '' }}
                </option>
              </select>
            </div>

            <!-- Filière -->
            <div style="margin-bottom:14px;">
              <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;font-family:'Poppins',sans-serif;">Filière</label>
              <select v-model="reinscForm.filiere_id" @change="onReinscFiliereChange"
                style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:'Poppins',sans-serif;background:#f8fafc;">
                <option value="">— Aucune —</option>
                <option v-for="f in reinscFilieres" :key="f.id" :value="String(f.id)">{{ f.nom }}</option>
              </select>
            </div>

            <!-- Classe -->
            <div v-if="reinscClasses.length" style="margin-bottom:14px;">
              <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;font-family:'Poppins',sans-serif;">Classe</label>
              <select v-model="reinscForm.classe_id"
                style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:'Poppins',sans-serif;background:#f8fafc;">
                <option value="">— Non affectée —</option>
                <option v-for="cl in reinscClasses" :key="cl.id" :value="String(cl.id)">{{ cl.nom }}</option>
              </select>
            </div>

            <!-- Statut -->
            <div style="margin-bottom:14px;">
              <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;font-family:'Poppins',sans-serif;">Statut</label>
              <select v-model="reinscForm.statut"
                style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:'Poppins',sans-serif;background:#f8fafc;">
                <option value="inscrit_actif">Inscrit actif</option>
                <option value="pre_inscrit">Pré-inscrit</option>
                <option value="diplome">Diplômé</option>
                <option value="abandonne">Abandonné</option>
              </select>
            </div>

            <!-- Montants -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
              <div>
                <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;font-family:'Poppins',sans-serif;">Frais inscription (F)</label>
                <input type="number" v-model="reinscForm.frais_inscription" placeholder="ex: 50000"
                  style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:'Poppins',sans-serif;background:#f8fafc;box-sizing:border-box;" />
              </div>
              <div>
                <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;font-family:'Poppins',sans-serif;">Mensualité (F)</label>
                <input type="number" v-model="reinscForm.mensualite" placeholder="ex: 35000"
                  style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:'Poppins',sans-serif;background:#f8fafc;box-sizing:border-box;" />
              </div>
            </div>

            <!-- Mois début -->
            <div style="margin-bottom:20px;">
              <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;margin-bottom:4px;font-family:'Poppins',sans-serif;">Mois de début paiements</label>
              <input type="month" v-model="reinscForm.mois_debut"
                style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:'Poppins',sans-serif;background:#f8fafc;box-sizing:border-box;" />
            </div>

            <div v-if="reinscError" style="background:#fef2f2;color:#dc2626;border-radius:8px;padding:10px 14px;font-size:12px;margin-bottom:14px;font-family:'Poppins',sans-serif;">
              ⚠️ {{ reinscError }}
            </div>

            <div style="display:flex;gap:10px;justify-content:flex-end;">
              <button @click="showReinscModal=false"
                style="padding:9px 18px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#374151;font-size:13px;font-weight:600;cursor:pointer;font-family:'Poppins',sans-serif;">
                Annuler
              </button>
              <button @click="saveReinscription" :disabled="reinscSaving"
                style="padding:9px 20px;border:none;border-radius:8px;background:#1e293b;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:'Poppins',sans-serif;opacity:1;"
                :style="{ opacity: reinscSaving ? '.6' : '1' }">
                {{ reinscSaving ? 'Enregistrement…' : '✓ Inscrire' }}
              </button>
            </div>
          </template>
        </div>

        <!-- Succès -->
        <div v-else style="padding:32px 24px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">✅</div>
          <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:6px;font-family:'Poppins',sans-serif;">Inscription enregistrée !</div>
          <div style="font-size:13px;color:#64748b;margin-bottom:20px;font-family:'Poppins',sans-serif;">Les échéances ont été générées automatiquement.</div>
          <button @click="showReinscModal=false"
            style="padding:10px 24px;border:none;border-radius:8px;background:#1e293b;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:'Poppins',sans-serif;">
            Fermer
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

/* Modal suppression progressive */
.del-overlay { position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px; }
.del-modal { background:#fff;border-radius:12px;max-width:480px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.25);overflow:hidden; }
.del-header { display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;background:#fafafa; }
.del-steps { display:flex;align-items:center;gap:8px; }
.del-step { font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;border:1.5px solid #e5e5e5;color:#aaa;background:#fff; }
.del-step--active { border-color:#E30613;color:#E30613;background:#fff5f5; }
.del-step--done { border-color:#22c55e;color:#16a34a;background:#f0fdf4; }
.del-step-sep { font-size:11px;color:#ccc; }
.del-close { background:none;border:none;cursor:pointer;color:#aaa;font-size:18px;line-height:1;padding:2px 6px; }
.del-icon { font-size:32px;margin-bottom:10px;padding-top:24px;text-align:center; }
.del-title { font-size:16px;font-weight:800;color:#111;margin:0 0 6px;padding:0 24px;text-align:center; }
.del-subtitle { font-size:12.5px;color:#666;margin-bottom:16px;padding:0 24px;text-align:center; }
.del-loading { font-size:12.5px;color:#aaa;padding:16px 24px;text-align:center; }
.del-tree { margin:0 24px 16px;text-align:left;background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;padding:12px 14px; }
.del-tree-root { display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:#111;margin-bottom:6px;font-family:'Poppins',sans-serif; }
.del-tree-icon { font-size:14px; }
.del-tree-level { margin-bottom:2px; }
.del-tree-node { display:flex;align-items:center;gap:6px;padding:3px 0;font-family:'Poppins',sans-serif; }
.del-tree-node--child { padding-left:4px; }
.del-tree-node--zero { opacity:0.45; }
.del-tree-bullet { color:#aaa;font-family:monospace;font-size:11px;flex-shrink:0; }
.del-tree-bullet--child { font-size:10px; }
.del-tree-count { min-width:22px;text-align:center;font-size:11px;font-weight:800;border-radius:4px;padding:1px 5px;flex-shrink:0; }
.del-count--warn { background:#fee2e2;color:#E30613; }
.del-count--zero { background:#f3f4f6;color:#9ca3af; }
.del-tree-text { font-size:12px;color:#444; }
.del-warning { font-size:12.5px;color:#555;line-height:1.6;margin:0 24px 16px;background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:12px;text-align:left; }
.del-confirm-label { font-size:12.5px;color:#666;margin-bottom:8px;text-align:left;padding:0 24px; }
.del-input { width:calc(100% - 48px);margin:0 24px 16px;display:block;border:1.5px solid #e5e5e5;border-radius:6px;padding:9px 12px;font-size:13px;font-family:'Poppins',sans-serif;outline:none;transition:border-color 0.15s;box-sizing:border-box; }
.del-input:focus { border-color:#E30613; }
.del-actions { display:flex;gap:10px;justify-content:flex-end;padding:14px 24px;border-top:1px solid #f0f0f0;background:#fafafa; }
.del-btn-cancel { border:1px solid #e5e5e5;background:#fff;border-radius:6px;padding:8px 16px;font-size:12.5px;font-weight:600;color:#555;cursor:pointer;font-family:'Poppins',sans-serif; }
.del-btn-cancel:hover { background:#f5f5f5; }
.del-btn-next { background:#111;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:'Poppins',sans-serif; }
.del-btn-next:hover { background:#333; }
.del-btn-confirm { background:#E30613;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:'Poppins',sans-serif;transition:background 0.15s; }
.del-btn-confirm:hover:not(:disabled) { background:#c00510; }
/* ── Checklist documents ─────────────────────────────────────────────────── */
.doc-checklist-header {
  background:#fff; border:1px solid #e5e7eb; border-radius:12px;
  padding:16px 20px; margin-bottom:14px;
  display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;
}
.doc-checklist-title { display:flex; align-items:center; gap:12px; }
.doc-checklist-icon { width:22px; height:22px; color:#E30613; flex-shrink:0; }
.doc-checklist-name { font-size:14px; font-weight:700; color:#111; margin:0; }
.doc-checklist-sub { font-size:11.5px; color:#888; margin:2px 0 0; }
.doc-progress-wrap { display:flex; align-items:center; gap:10px; }
.doc-progress-label { font-size:12px; font-weight:700; color:#555; white-space:nowrap; }
.doc-progress-bar { width:120px; height:6px; background:#f0f0f0; border-radius:10px; overflow:hidden; }
.doc-progress-fill { height:100%; background:#16a34a; border-radius:10px; transition:width 0.4s ease; }
.doc-checklist-empty { text-align:center; color:#aaa; font-size:13px; padding:40px 20px; background:#fff; border:1px solid #e5e7eb; border-radius:12px; line-height:1.8; }
.doc-checklist-grid { display:flex; flex-direction:column; gap:8px; }
.doc-checklist-item {
  display:flex; align-items:center; gap:14px;
  background:#fff; border:1.5px solid #e5e7eb; border-radius:10px;
  padding:13px 16px; cursor:pointer; text-align:left; width:100%;
  transition:border-color 0.15s, background 0.15s;
}
.doc-checklist-item--recu { border-color:#bbf7d0; background:#f0fdf4; }
.doc-checklist-item--pending:hover { border-color:#E30613; background:#fff5f5; }
.doc-checklist-item--readonly { cursor:default; }
.doc-checklist-item:disabled { opacity:0.6; cursor:not-allowed; }
.doc-checkbox {
  width:22px; height:22px; flex-shrink:0;
  border:2px solid #d1d5db; border-radius:5px;
  display:flex; align-items:center; justify-content:center;
  background:#fff; transition:all 0.15s;
}
.doc-checkbox--checked { background:#16a34a; border-color:#16a34a; }
.doc-checkbox svg { width:13px; height:13px; color:#fff; }
.doc-spin { width:14px; height:14px; color:#aaa; animation:spin 0.8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
.doc-checklist-info { flex:1; min-width:0; }
.doc-checklist-label { display:block; font-size:13px; font-weight:600; color:#111; }
.doc-checklist-date { display:block; font-size:11px; color:#16a34a; margin-top:2px; }
.doc-checklist-missing { display:block; font-size:11px; color:#aaa; margin-top:2px; }
.doc-checklist-badge { font-size:11px; font-weight:700; padding:3px 9px; border-radius:20px; flex-shrink:0; }
.doc-badge--ok { background:#dcfce7; color:#15803d; }
.doc-badge--ko { background:#f3f4f6; color:#9ca3af; }

/* ── Modal Webcam ────────────────────────────────────────────────────── */
.webcam-overlay {
  position:fixed;inset:0;z-index:9999;
  background:rgba(0,0,0,0.72);
  display:flex;align-items:center;justify-content:center;padding:20px;
}
.webcam-modal {
  background:#fff;border-radius:14px;max-width:380px;width:100%;
  box-shadow:0 28px 70px rgba(0,0,0,0.4);overflow:hidden;
}
.webcam-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:13px 18px;border-bottom:1px solid #f0f0f0;background:#fafafa;
}
.webcam-title { font-size:14px;font-weight:700;color:#111; }
.webcam-close { background:none;border:none;cursor:pointer;color:#aaa;font-size:18px;line-height:1;padding:2px 6px; }
.webcam-close:hover { color:#333; }
.webcam-body {
  padding:18px 18px 10px;
  display:flex;flex-direction:column;align-items:center;gap:10px;
  background:#111;
}
.webcam-preview {
  width:300px;height:300px;
  border-radius:8px;object-fit:cover;
  display:block;background:#222;
}
.webcam-preview--flip { transform:scaleX(-1); }
.webcam-hint { font-size:11px;color:#888;text-align:center;margin:0;padding-bottom:6px; }
.webcam-footer {
  display:flex;gap:10px;justify-content:center;align-items:center;
  padding:13px 18px;border-top:1px solid #f0f0f0;background:#fafafa;
}
.webcam-btn-cancel {
  border:1px solid #e5e5e5;background:#fff;border-radius:6px;
  padding:8px 14px;font-size:12.5px;font-weight:600;color:#555;cursor:pointer;
  font-family:'Poppins',sans-serif;
}
.webcam-btn-cancel:hover { background:#f5f5f5; }
.webcam-btn-capture {
  background:#E30613;color:#fff;border:none;border-radius:6px;
  padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer;
  font-family:'Poppins',sans-serif;
  display:flex;align-items:center;gap:7px;
}
.webcam-btn-capture:hover { background:#c00510; }
.webcam-btn-icon { width:16px;height:16px;flex-shrink:0; }
.webcam-btn-save {
  background:#16a34a;color:#fff;border:none;border-radius:6px;
  padding:8px 18px;font-size:12.5px;font-weight:700;cursor:pointer;
  font-family:'Poppins',sans-serif;
}
.webcam-btn-save:hover:not(:disabled) { background:#15803d; }
.webcam-btn-save:disabled { opacity:0.4;cursor:not-allowed; }

/* ── Indicateur risque d'abandon ── */
.rqd-badge {
  display:inline-flex; align-items:center; gap:4px;
  padding:3px 9px; border-radius:20px; font-size:11px; font-weight:700;
}
.rqd-badge--red    { background:#fef2f2; color:#b91c1c; }
.rqd-badge--yellow { background:#fffbeb; color:#92400e; }
.rqd-badge--green  { background:#f0fdf4; color:#15803d; }
.rqd-details { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
.rqd-chip {
  display:inline-flex; align-items:center; gap:3px;
  padding:2px 8px; border-radius:20px; font-size:10.5px; font-weight:600;
}
.rqd-chip--red    { background:#fee2e2; color:#b91c1c; }
.rqd-chip--yellow { background:#fef9c3; color:#a16207; }

/* ── Timeline ───────────────────────────────────────────────────────── */
.tl-wrapper { padding-bottom: 32px; }

/* État vide */
.tl-empty {
  text-align: center; padding: 56px 20px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
}
.tl-empty-icon { font-size: 40px; margin-bottom: 10px; }
.tl-empty-title { font-size: 15px; font-weight: 700; color: #374151; margin-bottom: 5px; }
.tl-empty-sub   { font-size: 12.5px; color: #9ca3af; }

/* Conteneur principal */
.tl-timeline { display: flex; flex-direction: column; }

/* Séparateur mensuel */
.tl-month-sep {
  display: flex; align-items: center; gap: 10px;
  margin: 20px 0 12px 0;
}
.tl-month-sep::before, .tl-month-sep::after {
  content: ''; flex: 1; height: 1px; background: #e5e7eb;
}
.tl-month-pill {
  font-size: 11px; font-weight: 700; text-transform: capitalize;
  color: #6b7280; background: #f3f4f6; border: 1px solid #e5e7eb;
  padding: 3px 12px; border-radius: 20px; white-space: nowrap; flex-shrink: 0;
}

/* Ligne d'événement */
.tl-item {
  display: flex; gap: 14px; align-items: flex-start;
  margin-bottom: 2px;
}

/* Colonne gauche : point + trait */
.tl-icon-col {
  display: flex; flex-direction: column; align-items: center;
  flex-shrink: 0; width: 40px;
}
.tl-dot {
  width: 40px; height: 40px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; position: relative; z-index: 1;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.tl-dot-emoji { font-size: 16px; line-height: 1; }
.tl-dot--inscription { background: #dbeafe; border: 2px solid #93c5fd; }
.tl-dot--paiement    { background: #dcfce7; border: 2px solid #86efac; }
.tl-dot--note        { background: #ede9fe; border: 2px solid #c4b5fd; }
.tl-dot--absence     { background: #fee2e2; border: 2px solid #fca5a5; }
.tl-dot--document    { background: #fef9c3; border: 2px solid #fde047; }
.tl-dot--relance     { background: #fff7ed; border: 2px solid #fdba74; }

.tl-line {
  width: 2px; min-height: 24px; flex: 1;
  background: linear-gradient(to bottom, #e5e7eb, #f3f4f6);
  margin: 2px 0;
}

/* Carte */
.tl-card {
  flex: 1; min-width: 0;
  background: #fff; border: 1.5px solid #e5e7eb; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 14px;
  transition: box-shadow 0.15s;
}
.tl-card:hover { box-shadow: 0 3px 12px rgba(0,0,0,0.07); }
.tl-card--absence { border-color: #fecaca; background: #fff8f8; }

/* En-tête carte */
.tl-card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px; gap: 8px;
}
.tl-badge {
  font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
  text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0;
}
.tl-badge--inscription { background: #dbeafe; color: #1d4ed8; }
.tl-badge--paiement    { background: #dcfce7; color: #15803d; }
.tl-badge--note        { background: #ede9fe; color: #7c3aed; }
.tl-badge--absence     { background: #fee2e2; color: #b91c1c; }
.tl-badge--document    { background: #fef9c3; color: #92400e; }
.tl-badge--relance     { background: #fff7ed; color: #c2410c; }

.tl-card-date {
  font-size: 10.5px; color: #9ca3af; white-space: nowrap; flex-shrink: 0;
}
.tl-card-title {
  font-size: 13.5px; font-weight: 700; color: #111827;
  margin: 0 0 2px; line-height: 1.3;
}
.tl-card-sub {
  font-size: 11.5px; color: #6b7280; margin: 2px 0 0;
}

/* Statut pill (inscriptions) */
.tl-status-pill {
  display: inline-block; font-size: 10.5px; font-weight: 600;
  padding: 2px 8px; border-radius: 20px; margin-top: 4px;
}
.tl-status--green { background: #dcfce7; color: #166534; }
.tl-status--amber { background: #fef3c7; color: #92400e; }
.tl-status--blue  { background: #dbeafe; color: #1e40af; }
.tl-status--gray  { background: #f3f4f6; color: #6b7280; }

/* Montant paiement */
.tl-montant {
  font-size: 18px; font-weight: 800; color: #15803d; margin: 4px 0 6px; line-height: 1;
}
.tl-devise { font-size: 11px; font-weight: 600; color: #6b7280; margin-left: 2px; }

/* Chips paiement */
.tl-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.tl-chip {
  font-size: 10.5px; background: #f3f4f6; color: #374151;
  padding: 2px 8px; border-radius: 20px; border: 1px solid #e5e7eb;
}
.tl-chip--mono  { font-family: monospace; font-size: 10px; }
.tl-chip--amber { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
.tl-chip--blue  { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }

/* Note */
.tl-note-row {
  display: flex; align-items: center; gap: 10px; margin-top: 4px;
}
.tl-note-val {
  font-size: 20px; font-weight: 800; line-height: 1;
}
.tl-note--pass { color: #15803d; }
.tl-note--fail { color: #dc2626; }
/* ── 4 stat cards ───────────────────────────────────────────────────── */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 16px 0 20px;
}
@media (max-width: 640px) {
  .stat-strip { grid-template-columns: repeat(2, 1fr); }
}

.stat-card {
  background: #fff;
  border: 1.5px solid #e5e7eb;
  border-radius: 14px;
  padding: 16px 12px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.stat-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  border-color: #d1d5db;
}

.stat-donut-wrap {
  position: relative;
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-donut {
  width: 72px;
  height: 72px;
  transform: rotate(-90deg);
  position: absolute;
  top: 0; left: 0;
}

.stat-donut-bg {
  fill: none;
  stroke: #f3f4f6;
  stroke-width: 3.5;
}

.stat-donut-arc {
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
  transition: stroke-dasharray 0.6s ease, stroke 0.3s;
}

.stat-donut-val {
  position: relative;
  z-index: 1;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.5px;
}

.stat-label {
  font-size: 11.5px;
  font-weight: 700;
  color: #374151;
  text-align: center;
  line-height: 1.3;
}

.stat-sub {
  font-size: 10.5px;
  color: #9ca3af;
  text-align: center;
  line-height: 1.3;
}

.tl-note-denom { font-size: 12px; font-weight: 600; color: #9ca3af; }

/* ── Commentaires internes ──────────────────────────────────────────── */
.comm-wrapper { padding-bottom: 32px; }

.comm-staff-notice {
  display: flex; align-items: center; gap: 8px;
  background: #fffbeb; border: 1px solid #fde68a;
  color: #92400e; font-size: 12px; font-weight: 500;
  padding: 10px 14px; border-radius: 8px; margin-bottom: 16px;
}

.comm-form-card {
  background: #fff; border: 1.5px solid #e5e7eb; border-radius: 12px;
  padding: 14px 16px; margin-bottom: 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}

.comm-form-row { margin-bottom: 10px; }

.comm-cat-select {
  font-size: 12px; padding: 5px 10px; border-radius: 7px;
  border: 1px solid #d1d5db; background: #f9fafb; color: #374151;
  outline: none; cursor: pointer;
}
.comm-cat-select:focus { border-color: #6366f1; background: #fff; }

.comm-textarea {
  width: 100%; font-size: 13px; line-height: 1.6;
  padding: 10px 12px; border-radius: 8px;
  border: 1.5px solid #e5e7eb; background: #fafafa;
  color: #111827; resize: vertical; outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}
.comm-textarea:focus { border-color: #6366f1; background: #fff; }

.comm-form-actions {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 10px; gap: 8px;
}

.comm-submit-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
  background: #4f46e5; color: #fff; border: none; cursor: pointer;
  transition: background 0.15s;
}
.comm-submit-btn:hover:not(:disabled) { background: #4338ca; }

/* Vide */
.comm-empty {
  text-align: center; padding: 40px 16px; color: #6b7280;
}

/* Liste */
.comm-list { display: flex; flex-direction: column; gap: 12px; }

.comm-card {
  background: #fff; border: 1.5px solid #e5e7eb; border-radius: 12px;
  padding: 14px 16px; transition: box-shadow 0.15s;
}
.comm-card:hover { box-shadow: 0 3px 12px rgba(0,0,0,0.07); }

.comm-card-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; margin-bottom: 10px; flex-wrap: wrap;
}

.comm-author { display: flex; align-items: center; gap: 10px; }

.comm-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  background: #e0e7ff; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.comm-avatar-initials {
  font-size: 12px; font-weight: 700; color: #4f46e5; text-transform: uppercase;
}

.comm-author-name { font-size: 13px; font-weight: 700; color: #111827; display: block; }
.comm-author-role { font-size: 10.5px; color: #9ca3af; text-transform: capitalize; }

.comm-meta-right {
  display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;
}

.comm-cat-badge {
  font-size: 10.5px; font-weight: 600; padding: 2px 9px; border-radius: 20px;
}

.comm-date {
  font-size: 10.5px; color: #9ca3af; white-space: nowrap;
}

.comm-contenu {
  font-size: 13.5px; color: #374151; line-height: 1.65;
  white-space: pre-wrap; word-break: break-word;
  margin: 0 0 10px;
}

.comm-actions {
  display: flex; gap: 8px; border-top: 1px solid #f3f4f6; padding-top: 10px;
}

.comm-action-btn {
  font-size: 11.5px; font-weight: 500; padding: 4px 10px;
  border-radius: 6px; border: 1px solid transparent; cursor: pointer;
  transition: all 0.12s;
}
.comm-action-btn--edit {
  background: #f3f4f6; color: #374151; border-color: #e5e7eb;
}
.comm-action-btn--edit:hover { background: #e5e7eb; }
.comm-action-btn--del {
  background: #fff0f0; color: #dc2626; border-color: #fecaca;
}
.comm-action-btn--del:hover:not(:disabled) { background: #fee2e2; }
.comm-action-btn--del:disabled { opacity: 0.5; cursor: not-allowed; }

/* ═══════════════════════════════════════════════════════════
   RESPONSIVE MOBILE
   ═══════════════════════════════════════════════════════════ */
@media (max-width: 768px) {

  /* ── Onglets → défilement horizontal sans barre ─────────── */
  .etd-tab-bar {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    flex-wrap: nowrap;
    gap: 0;
  }
  .etd-tab-bar::-webkit-scrollbar { display: none; }
  .etd-tab-bar button {
    flex-shrink: 0;
    white-space: nowrap;
    padding-left: 14px;
    padding-right: 14px;
    font-size: 12px;
  }

  /* ── Stat strip ──────────────────────────────────────────── */
  .stat-strip { grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0 16px; }
  .stat-card { padding: 12px 8px 10px; }
  .stat-donut-wrap, .stat-donut { width: 58px; height: 58px; }
  .stat-donut-val { font-size: 13px; }

  /* ── Checklist documents ─────────────────────────────────── */
  .doc-checklist-header { flex-direction: column; align-items: flex-start; gap: 10px; }
  .doc-progress-bar { width: 80px; }
  .doc-checklist-item { padding: 10px 12px; gap: 10px; }

  /* ── Commentaires ────────────────────────────────────────── */
  .comm-card-head { flex-direction: column; gap: 6px; }
  .comm-meta-right { flex-direction: row; align-items: center; gap: 8px; }
  .comm-form-actions { flex-direction: column; align-items: stretch; gap: 8px; }
  .comm-submit-btn { width: 100%; justify-content: center; }

  /* ── Modal carte / suppression ───────────────────────────── */
  .card-modal { max-width: calc(100vw - 20px); }
  .card-modal-body { padding: 14px 14px; }
  .del-modal { max-width: calc(100vw - 20px); }
  .del-actions { flex-direction: column; padding: 12px 16px; }
  .del-actions > button { width: 100%; }
  .del-tree { margin: 0 12px 14px; }
  .del-warning, .del-confirm-label { padding: 0 12px; margin-left: 0; margin-right: 0; }
  .del-input { width: calc(100% - 24px); margin: 0 12px 14px; }
  .del-title, .del-subtitle { padding: 0 12px; }

  /* ── Risque détail ───────────────────────────────────────── */
  .rqd-details { flex-wrap: wrap; gap: 4px; }
  .rqd-chip { font-size: 10.5px; padding: 3px 7px; }
}

@media (max-width: 480px) {
  .stat-strip { gap: 6px; }
  .stat-card { padding: 10px 6px 8px; }
  .etd-tab-bar button { font-size: 11px; padding-left: 10px; padding-right: 10px; }
}
</style>
