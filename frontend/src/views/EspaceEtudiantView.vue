<script setup lang="ts">
import { inject, computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import QRCode from 'qrcode'

const dashboardData = inject<any>('dashboardData')
const auth = useAuthStore()

// ── Onglet actif (mobile) ────────────────────────────────────────────
const activeTab = ref<'planning' | 'notes' | 'finances' | 'absences'>('planning')

// ── Bottom nav mobile ────────────────────────────────────────────────
const mobileTab = ref<'accueil' | 'planning' | 'notes' | 'finances' | 'absences' | 'plus'>('accueil')

// ── Slider annonces mobile (auto-défilement) ────────────────────────
const annonceIndex = ref(0)
const annoncesCurrent = computed(() => dashboardData?.value?.annonces ?? [])
function nextAnnonce() { annonceIndex.value = (annonceIndex.value + 1) % annoncesCurrent.value.length }
function prevAnnonce() { annonceIndex.value = (annonceIndex.value - 1 + annoncesCurrent.value.length) % annoncesCurrent.value.length }

let annonceTimer: ReturnType<typeof setInterval> | null = null

// ── Écoute navigation sidebar mobile ─────────────────────────────────
function onSidebarTab(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.tab) {
    mobileTab.value = detail.tab
    if (detail.activeTab && ['planning', 'notes', 'finances'].includes(detail.activeTab)) {
      activeTab.value = detail.activeTab
    }
  }
}

onMounted(() => {
  annonceTimer = setInterval(() => {
    if (annoncesCurrent.value.length > 1) nextAnnonce()
  }, 5000)
  window.addEventListener('espace-etudiant-tab', onSidebarTab)
})
onUnmounted(() => {
  if (annonceTimer) clearInterval(annonceTimer)
  window.removeEventListener('espace-etudiant-tab', onSidebarTab)
})

function setMobileTab(tab: typeof mobileTab.value) {
  mobileTab.value = tab
  if (tab === 'planning' || tab === 'notes' || tab === 'finances' || tab === 'absences') {
    activeTab.value = tab
  }
}

// ── Absences ─────────────────────────────────────────────────────────
const absencesData = ref<any>(null)
const loadingAbsences = ref(false)

async function loadAbsences() {
  if (absencesData.value) return
  loadingAbsences.value = true
  try {
    const { data } = await api.get('/espace-etudiant/absences')
    absencesData.value = data
  } catch { absencesData.value = null }
  finally { loadingAbsences.value = false }
}

watch([mobileTab, activeTab], ([mob, act]) => {
  if (mob === 'absences' || act === 'absences') loadAbsences()
})

// ── Countdown prochain cours ─────────────────────────────────────────
const now = ref(new Date())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => { ticker = setInterval(() => { now.value = new Date() }, 1000) })
onUnmounted(() => { if (ticker) clearInterval(ticker) })

const prochainCours = computed(() => {
  const seances = dashboardData?.value?.seances_semaine ?? []
  return seances
    .filter((s: any) => new Date(s.date_debut) > now.value)
    .sort((a: any, b: any) => new Date(a.date_debut).getTime() - new Date(b.date_debut).getTime())[0] ?? null
})

const countdownText = computed(() => {
  if (!prochainCours.value) return null
  const diff = new Date(prochainCours.value.date_debut).getTime() - now.value.getTime()
  if (diff <= 0) return 'En cours'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (h >= 24) { const d = Math.floor(h / 24); return `Dans ${d}j ${h % 24}h` }
  if (h > 0) return `Dans ${h}h ${m}min`
  if (m > 0) return `Dans ${m}min ${s}s`
  return `Dans ${s}s`
})

// ── Messagerie ────────────────────────────────────────────────────────
const showMessages = ref(false)
const conversations = ref<any[]>([])
const selectedConv = ref<any>(null)
const convMessages = ref<any[]>([])
const newMessage = ref('')
const sendingMsg = ref(false)
const loadingConvs = ref(false)
const loadingMsgs = ref(false)
const msgThreadRef = ref<HTMLElement | null>(null)

const totalUnread = computed(() => conversations.value.reduce((sum: number, c: any) => sum + (c.nb_non_lus ?? 0), 0))

async function openMessages() {
  showMessages.value = true
  loadingConvs.value = true
  try {
    const { data } = await api.get('/conversations')
    conversations.value = Array.isArray(data) ? data : []
    if (conversations.value.length > 0 && !selectedConv.value) {
      await selectConv(conversations.value[0])
    }
  } finally { loadingConvs.value = false }
}

async function selectConv(conv: any) {
  selectedConv.value = conv
  loadingMsgs.value = true
  try {
    const { data } = await api.get(`/conversations/${conv.id}`)
    convMessages.value = data.messages || []
  } finally {
    loadingMsgs.value = false
    setTimeout(() => scrollToBottom(), 100)
  }
}

function scrollToBottom() {
  if (msgThreadRef.value) msgThreadRef.value.scrollTop = msgThreadRef.value.scrollHeight
}

async function sendMessage() {
  if (!newMessage.value.trim() || !selectedConv.value || sendingMsg.value) return
  sendingMsg.value = true
  try {
    await api.post(`/conversations/${selectedConv.value.id}/messages`, { contenu: newMessage.value.trim() })
    newMessage.value = ''
    await selectConv(selectedConv.value)
  } finally { sendingMsg.value = false }
}

async function deleteMessage(msgId: string) {
  if (!confirm('Supprimer ce message ?')) return
  await api.delete(`/messages/${msgId}`)
  await selectConv(selectedConv.value)
}

async function deleteConversation(conv: any) {
  if (!confirm(`Supprimer la conversation "${conv.nom}" et tous ses messages ?`)) return
  await api.delete(`/conversations/${conv.id}`)
  conversations.value = conversations.value.filter((c: any) => c.id !== conv.id)
  if (selectedConv.value?.id === conv.id) {
    selectedConv.value = conversations.value[0] || null
    convMessages.value = []
    if (selectedConv.value) await selectConv(selectedConv.value)
  }
}

function isMyMessage(msg: any): boolean {
  return msg.sender?.id === auth.user?.id || msg.sender_id === auth.user?.id
}

function fmtMsgTime(dt: string) {
  if (!dt) return ''
  const d = new Date(dt)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Helpers ──────────────────────────────────────────────────────────

const COLORS = ['#6366f1','#10b981','#f97316','#3b82f6','#ec4899','#14b8a6','#f59e0b','#8b5cf6']

function modeLabel(mode: string) {
  return ({ presentiel: 'Présentiel', en_ligne: 'En ligne', hybride: 'Hybride', exam: 'Examen' } as any)[mode] ?? mode
}
function modeIcon(mode: string) {
  return ({ presentiel: '🏫', en_ligne: '💻', hybride: '🔀', exam: '📝' } as any)[mode] ?? '📌'
}
function modeGradient(mode: string) {
  return ({ presentiel: 'linear-gradient(135deg,#10b981,#059669)', en_ligne: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', hybride: 'linear-gradient(135deg,#f59e0b,#d97706)', exam: 'linear-gradient(135deg,#ef4444,#dc2626)' } as any)[mode] ?? 'linear-gradient(135deg,#6366f1,#4f46e5)'
}

function typeBadgeStyle(type: string) {
  const map: any = { info: { bg: '#dbeafe', color: '#1d4ed8' }, urgent: { bg: '#fef3c7', color: '#b45309' }, alerte: { bg: '#fee2e2', color: '#b91c1c' }, evenement: { bg: '#dcfce7', color: '#15803d' } }
  return map[type] ?? { bg: '#f3f4f6', color: '#374151' }
}
function typeLabel(type: string) {
  return ({ info: 'Info', urgent: 'Urgent', alerte: 'Alerte', evenement: 'Événement' } as any)[type] ?? type
}

function paiementStatutStyle(statut: string) {
  if (statut === 'confirme') return { bg: '#dcfce7', color: '#15803d', label: 'Payé' }
  if (statut === 'en_attente') return { bg: '#fef3c7', color: '#b45309', label: 'En attente' }
  return { bg: '#fee2e2', color: '#b91c1c', label: 'Rejeté' }
}
function typePaiementLabel(type: string) {
  return ({ frais_inscription: 'Inscription', mensualite: 'Mensualité', rattrapage: 'Rattrapage', tenue: 'Tenue' } as any)[type] ?? type
}

function formatDate(dt: string) {
  if (!dt) return ''
  const d = new Date(dt)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return isToday ? `Aujourd'hui — ${label}` : label
}
function formatTime(dt: string) {
  if (!dt) return ''
  return new Date(dt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
function durationH(debut: string, fin: string) {
  return Math.round((new Date(fin).getTime() - new Date(debut).getTime()) / 3600000 * 10) / 10
}
function isToday(dt: string) {
  return new Date(dt).toDateString() === new Date().toDateString()
}
function isFuture(dt: string) {
  return new Date(dt) > now.value
}
function timeAgo(dt: string) {
  if (!dt) return ''
  const diff = Date.now() - new Date(dt).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'à l\'instant'
  if (mins < 60) return `Il y a ${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `Il y a ${hrs}h`
  return `Il y a ${Math.floor(hrs / 24)}j`
}
function avatarInitials(nom: string) {
  return (nom?.split(' ') ?? []).map((p: string) => p[0]).join('').substring(0, 2).toUpperCase()
}

function presenceBadge(statut: string | null) {
  if (statut === 'present')  return { label: 'Présent',  icon: '✅', bg: '#dcfce7', color: '#15803d' }
  if (statut === 'retard')   return { label: 'Retard',   icon: '⚠️', bg: '#fef3c7', color: '#92400e' }
  if (statut === 'absent')   return { label: 'Absent',   icon: '❌', bg: '#fee2e2', color: '#b91c1c' }
  return { label: 'Non saisi', icon: '—', bg: '#f3f4f6', color: '#9ca3af' }
}

// ── Séances groupées ─────────────────────────────────────────────────
function groupByDay(seances: any[]) {
  const grouped: Record<string, any[]> = {}
  for (const s of seances ?? []) {
    const key = formatDate(s.date_debut)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(s)
  }
  return Object.entries(grouped).map(([jour, seances]) => ({ jour, seances, isToday: jour.startsWith('Aujourd') }))
}
const seancesParJour = computed(() => groupByDay(dashboardData?.value?.seances_semaine))
const seancesFuturesParJour = computed(() => groupByDay(dashboardData?.value?.seances_futures))
const seancesPasseesParJour = computed(() => groupByDay(dashboardData?.value?.seances_passees))

// ── Notes & décision ─────────────────────────────────────────────────
const uesARattraper = computed(() => (dashboardData?.value?.notes?.ues ?? []).filter((u: any) => u.note !== null && u.note < 10))

const decisionJury = computed(() => {
  const notes = dashboardData?.value?.notes
  if (!notes || notes.moyenne_generale === null || notes.moyenne_generale === undefined) return null
  const moy = notes.moyenne_generale
  if (moy >= 10) return { label: 'Admis(e)', icon: '✓', bg: '#dcfce7', color: '#15803d' }
  if (moy >= 8)  return { label: 'Rattrapage', icon: '↻', bg: '#fef3c7', color: '#b45309' }
  return { label: 'Redoublant(e)', icon: '✗', bg: '#fee2e2', color: '#b91c1c' }
})

// ── Assiduité SVG circle ─────────────────────────────────────────────
const RADIUS = 42
const CIRC = 2 * Math.PI * RADIUS
const assiduiteOffset = computed(() => {
  const taux = dashboardData?.value?.presences?.taux_presence ?? 0
  return CIRC - (taux / 100) * CIRC
})
const assiduiteColor = computed(() => {
  const t = dashboardData?.value?.presences?.taux_presence ?? 0
  if (t >= 80) return '#16a34a'
  if (t >= 60) return '#f59e0b'
  return '#ef4444'
})

// ── FI-aware helpers ─────────────────────────────────────────────────
const fi = computed(() => dashboardData?.value?.formation_individuelle)
const insc = computed(() => dashboardData?.value?.inscription)
// FI = has formation_individuelle AND either no inscription or inscription has no class
const isFI = computed(() => !!fi.value && (!insc.value || !insc.value.classe || insc.value.classe === '—'))

const fraisTotaux = computed(() => isFI.value ? (fi.value?.cout_total ?? 0) : (insc.value?.frais_totaux ?? 0))
const totalPaye = computed(() => isFI.value ? (fi.value?.total_paye ?? 0) : (insc.value?.total_paye ?? 0))
const restantDu = computed(() => isFI.value ? (fi.value?.restant_du ?? 0) : (insc.value?.restant_du ?? 0))

// ── Finances ─────────────────────────────────────────────────────────
const progressionFinanciere = computed(() => {
  if (!fraisTotaux.value) return 0
  return Math.round((totalPaye.value / fraisTotaux.value) * 100)
})

// ── Print reçu ───────────────────────────────────────────────────────
function printRecu(p: any) {
  const etud = dashboardData?.value?.etudiant
  const inscData = dashboardData?.value?.inscription
  const fiInfo = dashboardData?.value?.formation_individuelle
  const typeL = (t: string) => ({ frais_inscription: 'Frais d\'inscription', mensualite: 'Mensualité', tenue: 'Tenue', rattrapage: 'Rattrapage', inscription: 'Inscription', tranche: 'Tranche' } as any)[t] ?? t
  const moisL = (m: string) => m ? new Date(m).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : ''
  const filiereLabel = inscData?.filiere ?? fiInfo?.type_formation ?? '—'
  const montantRecu = Number(p.montant ?? p.montant_paye ?? 0).toLocaleString('fr-FR')
  const objetRecu = typeL(p.type_paiement ?? p.type ?? '—')
  const dateRecu = p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR') : p.date_paiement ? new Date(p.date_paiement).toLocaleDateString('fr-FR') : '—'
  const block = (ex: string) => `<div class="rb"><div class="hd"><div class="lc">U</div><div class="si"><div class="sn">UPTECH CAMPUS</div><div class="sm">NINEA : 008595312 | Agrément : 006547/MEN/DEST</div><div class="sm">Liberté 6 Extension, Dakar – Sénégal</div></div><div class="rr"><div class="rn">${p.numero_recu||'—'}</div><div class="rd">${dateRecu}</div></div></div><div class="dv"></div><div class="tr"><span class="tt">REÇU DE PAIEMENT</span><span class="ex">${ex}</span></div><div class="sr"><div class="sf"><span class="sl">Étudiant</span><span class="sv">${etud?.prenom??''} ${etud?.nom??''}</span></div><div class="sf"><span class="sl">N°</span><span class="sv">${etud?.numero_etudiant??'—'}</span></div><div class="sf"><span class="sl">Filière</span><span class="sv">${filiereLabel}</span></div>${p.mois_concerne?`<div class="sf"><span class="sl">Mois</span><span class="sv">${moisL(p.mois_concerne)}</span></div>`:''}</div><div class="mb"><div class="ml">Montant payé</div><div class="ma">${montantRecu} FCFA</div></div><div class="to"><strong>Objet :</strong> ${objetRecu}</div><div class="fb">Ce reçu est un justificatif officiel de paiement — Uptech Campus · Dakar, Sénégal</div></div>`
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reçu</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}.rb{background:#fff;border:1px solid #ddd;border-radius:8px;padding:18px 20px;width:420px;margin:0 auto}.hd{display:flex;align-items:center;gap:12px;margin-bottom:10px}.lc{width:42px;height:42px;background:#E30613;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-weight:900}.sn{font-size:13px;font-weight:900;color:#111;letter-spacing:1px}.sm{font-size:8px;color:#777;margin-top:1px}.si{flex:1}.rr{text-align:right}.rn{font-size:11px;font-weight:700;color:#E30613}.rd{font-size:9px;color:#aaa;margin-top:2px}.dv{border-top:1.5px solid #E30613;margin:8px 0}.tr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.tt{font-size:13px;font-weight:900;color:#111;letter-spacing:1px;text-transform:uppercase}.ex{font-size:9px;color:#aaa;font-style:italic}.sr{display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:10px}.sf{display:flex;flex-direction:column}.sl{font-size:8px;color:#aaa;text-transform:uppercase;letter-spacing:0.5px}.sv{font-size:11px;font-weight:600;color:#111}.mb{border:1.5px solid #111;border-radius:6px;padding:8px 16px;text-align:center;margin:10px 0}.ml{font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:2px}.ma{font-size:20px;font-weight:900;color:#111}.to{font-size:10px;color:#555;margin-bottom:8px}.fb{border-top:1px solid #ccc;color:#777;font-size:7px;text-align:center;padding:4px 0;margin-top:10px}.cut{text-align:center;font-size:11px;color:#aaa;margin:14px 0;letter-spacing:2px;border-top:1px dashed #ccc;padding-top:8px}@media print{body{background:#fff;padding:0}}</style></head><body>${block('Exemplaire établissement')}<div class="cut">✂ &nbsp; Découper ici &nbsp; ✂</div>${block('Exemplaire étudiant')}</body></html>`
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (w) { w.addEventListener('load', () => { setTimeout(() => { w.print() }, 300); w.addEventListener('afterprint', () => { try { w.close() } catch { /* noop */ }; URL.revokeObjectURL(url) }) }) }
  else URL.revokeObjectURL(url)
}

// ── Ma Carte Étudiant (Canvas — même design que admin) ───────────────
const showCarteModal = ref(false)
const cardCanvas = ref<HTMLCanvasElement | null>(null)
const cardGenerated = ref(false)

const carteFinance = computed(() => {
  const echeances = dashboardData?.value?.echeances ?? []
  const mensualites = echeances.filter((e: any) => e.type_echeance === 'mensualite')
  const nowKey = new Date().toISOString().substring(0, 7)
  const moisPaies = mensualites.filter((e: any) => e.statut === 'paye').length
  const moisEnRetard = mensualites.filter((e: any) => e.statut !== 'paye' && (e.mois ?? '').substring(0, 7) < nowKey).length
  const totalMois = mensualites.length
  const enRegle = moisEnRetard === 0 && (insc.value?.restant_du ?? 0) === 0
  return { moisPaies, moisEnRetard, totalMois, enRegle, mensualites }
})

const UPTECH_LOGO_EE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAVMAAABrCAYAAADKFWEAAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAV3UlEQVR4Ae2dv4/sSBHHn/ovWPEPMPwQEtHtJUQEjURCtpeQMqdLL9gLCZDuIiSSJUAiXE66hOiBRIgYSCFYMshGiHtCIMSiJ4RAJzTU17uebZfbdper7W6/rZa8nvbY3dXfrvpM2Z7xvnhhxRQwBUwBU8AUMAVMAVPAFDAFTAFTwBQwBUwBU8AUMAVMAVPAFDAFTAFTwBQoqcCfvvrWBS2elo9sEWtwRZrtSs6f9W0KmAKFFQAEaLml5WSLWoMDaXhVeEqte1PAFFhbAQr8GwOoGqCxDyFA9WLt+bT+TAFTYGUFEOi03BlIFwFpC9d70vdy5am17kwBU2BNBSjIkTm1QX9e/+3969O/Xv789J/f/s6WRA3+/ctfnf7x/R+c/vy1r591DLQFUHdrzq31ZQqYAispQMGNG0ydwP/rd947ffbpq5OV+Qr87/XrBqpcW6rfrTS11o0pMFMBR5ekHF3rdx/RcqCFfNadIsvx8f0bWu9p2c3scPuHUWDjZlMHpH//7vfmE8SO7CmAzJ5rTHVyPG1pnByOnrKQs7fF0aWGpGPadvftkQ9r8fFtO+36JfWPIKV20VZqSbWZt+cQ6G3fpdZsnM3Yl7YlmHOuyVDdedIK83NSLEc69pqWi6Fe4tu1fsVbVc37nrc2Waeg7txw+ss73+7BwDboFfjnj37MgUoOpy0ih6fAbYvzwkAh8IXFeeHxU4GJ4ANcJ4IvdbyhrXjdgHTKhqXfJ83C0ox36T4PYY/jr88gy2nT/cO8jvf89K7ztL+i/6eWHl6p5p35PG87UieY4hreOdBxbbSmcnf3+9Ph8OvTy5c/O3344UfNcnv7k46JsBmwwvL644/O13Y7O1VQefXNb511ftScZSuRCRrdJHK8ILCcFzotcyzx8akBciS7RjRJHS8XTRVUqbZP7Ueah6UmmC5uy934vLa6OC/0S6Z52067Vs078/m2zYE1BfRlCNLSWenxeDwBlPv9u6fLy7eZUE+B5P03OmiMZH1naAFguImGff77hz92jlu7AtCHetNr2YT15vFJkwQnPDwd7nzC/qH+zE7x8WFbU6+RzexeREvqePnBqqCasjf1fd+1anGAwa5Dt89Yzd0KfSF1vHw/zOvIByVsc15nCzXRKap5Zz7fabhfoWDGr5vOAQ7grF2QeV5ff3Da7b7IxR+sS2Aajg+vcYcd14Rxx33tggya2XPbnxXJllS4NPsdnlp2Xui0zLHExw/O5YAdga1PVg/sG2k7PAavVUEVaV+ke3u871pVA0xXA2mrwQRQHWk0S9vH9rsKK+ed+Txvm9UpsDt38dcEDDLQsexzTFQNTEOYIWvFBwjuuq9Vwv7p9YFNibAqcrygL+fH9I28xxxLfHwbTJL17kWvpI6XH2gw5YrQHO8j8yyZn7n7HqnfgWvjzuts4qNUzTvzed42q3OYrnG9FBCVZKExcXPBNAQbstU1vgoW9mkwHYXjNXNXqo7uHwQ3P1IVVEG7qf1H9/Ndq0pmps3XnpAl5hqbtJ2brhZtzXmdTW077Vo17/XCFDeQtBBthV4CpoAcLgEsnakaTJMD+LYNiad16rFPRzy8UgWVFBRD+/uuVUVhStqmarnIfgB5JDt1pJGmv67C1NZB0V59MMVNJcBPMajesUvBtAUdTv+XytLbPh7XNNmaInK8oC/nhfPBHGvO8U02dEX93iX2HdjbapQ0XmqfF1VQ9fwv0X5+nO9aVQqmxbPSVpd9Vw/UnJ+p7WOb1ESnqOad+Xyn4X6FArpzzTQ3QHBKf3HxuVa8bOulYdoCDz8JzX09tW37+cG09b/mVzUpvjBoj3haJ8E0dhxtSzo2xa65+/inceBVMZjuFVigo6QPRJQGyreKtuhYXpxXtEfzwssbANP7+/vm6006YYadfy2YAnj4uljOr1QZTOHww3MbvHfgoRG8R4Ez2EYko1AF1Vhfkvd8dzzFYHozot3UeOjYsDRAnTpm6P1j2NLDa+cNpvSEJAaJRetbyUzLXDPtu6htSVFgFEocBLxOEJCWYjAlW2ePlQAYXlNXjeFlXzGnsY3mhJfKMlM8l3NNUKb0tRWY4r8U8MLGd+DTb/VSCswGDMDq5VarQIQ+U5ZIZgpLk44dar+9xHCnbIdluY1dXtcm2ghLZTAFuBgAite3AlMOUtSZlkeq4yagLcMaXJM+F2GILPNaBRgvt6koTCkrVI13CLSS7bu+Zs7r7OItVgbTf3z/BxwAxetbgCmeAxsrDKbFtdyIPfdkJ7vzywNHW1fBhSAgLUVhSvaqxiuBZmzf27haTmkXb7UymOI7nbUF3BZgenX1Toyl1WlZ29yO2AOg7ni45Kur4OLldpSEKaxVgSYGyNRtuEwwcKbhvA7yGFdYVGMcuEQSth+8Jucc/Z4paICnxY84eJH3tgDTm5sfGkzz35iMXGcLHFr18tnBlDJ9B7ClQjDXfiNnGM7r7OEOUBlMQYTabkJtAaaxm0/QsrYPpo3Zc+Dhkq+uggpBQFpKZ6aw113p4CXSDOCm/saK8zp7eNsVwvTv3/1eVRCoHaYXF58DN6NlY/Cqat5JO7pxslQRgYFnaV5uVQ0whdXO07J0hnqkPkYyUjKjKc6/8TDFv9+oCQK1w3S/fzcKUmysSccN2rJvYm6RP88VphCz+dkxfVCpNOAfMG39ltq9SJsy53U28F4qzEwBgT9/7evVgKB2mMZ++QQNUTYIsFpsviPtEoOSB1VKXQUSgoC01JKZhnY7TzDLBVW0Q+1JivPPAqY1nerXDNOhr0Q9oNRgOvPD5LAsSBHwBlOo8FDOD8gBEHGK3maZY+t72g/7X9Oya1uSrZ1P7GvADt5bpZlpTXf1a4Zp7ElRLUgjmSmyLW/LqAYJ19p4EM2pN5kifR1m1non79H5mX1JbKQ+chVc83R+YMl0xtD81n+oj4TtL1gZtXmqvR1rbLxKQTz51agQBIAYHVN8qRWmuPF0f38fStZ7zfQ7jM+QvWsKmAKbUEAK01qeb1orTMduPLVUNZhuIjTMSFNApoAUpgBCDdlpjTBNyUqhn8FU5qO2tymwCQXmwLSG7LRGmE5dKwVIUUKY/uZLXz2ucN1Mco3N9p13zdR027Zue4pD3XXfOTAFEErf2a8NpriDP3WtFLqhhDD96ee/PHBXMunuqR2bdpfZdDKdUnwA30a4np0Fz4Xp/16/Lvq909pgGnsI9AM6+38NpvZBQUGbEty2TxmdbmcBdS5MgYiSv4qqCabX1x/0iTmyxWBqIDGYVu8DV2KgamAKXpR61mktML28fDv59L7lq8G0+kCyjLBMRliT7sfVYQpA/OWdb3euA4awWOp1DTDF3fuhJ0O14IytQ03smqmB1bLUan3gUgRUCmzRl/ZjcMD107WBWgNMJddJQ90MptUGT02ZkdlSPjv2q8MUoMBPTdd8EEppmN7e/iTko+i1wdRgatnoJnygDEzXBmpJmGpACp0MppsIJMsMy2eGpeegHExboK7xVP5SMNWC1GBqILWsdBM+QN85FZYc10wBiLCscQ11bZjiZtPca6ShNnhtmekmgql0VmT9l82M6RdtwrIETAEMAHXJX0mtCVN8/WnOXXvoECsGU4OpZadV+8BBiNGH3ZeCaQsR/JvoJW5MrQVTfCE/9Wei7Zin1gbTqgPJMsKyGWFp/W/og27eb/SXhinA8tmnr7I/aWppmOK39rlO6zlcQ5j+4gtfwe+B6ZPQFtPAfKCgD+BBNbtZGWl70BowbWGCn5/mujm1FExxbRRPf8qdjbYaYB3ClF7PO6VoJ9DWpoApUIcCa8K0BQpO/bVQXQKmeLDz8XhszVxsbTCtw/fNClMgqwIcpsge1yqA6txfTuWCKU7nl85EuZ4G06wubI2ZAnUoQIGNf+Z2PvX8549+zGN/8Tp+PYUHpkiyVQ1McSqPLHTs3zEvNejIg7Vv6/AEs8IUMAVUChBIL0OYIlMsWXCzChkrvlY1lrVKYIrs8+rqnSYDzfkVpzk6vf74k/MH16Pu8u+zqWbcDjYFTIHFFKCgvg+BiuyppoLMFTYBssicseB1WHDnHafrWG5uftjciV/qbnzYr/R1JPuWPZlmMS+whk0BU0CtAIH0JoRp6exUCqit7I8PgVBnen1UT541YAqYAvUoQEG9Y0HenGZvBVJbsBOZNNeY6vt6vMAsMQVMgSwKUGB3nmuKwMd1SVzDtDJfAfysduC/EdxlmThrxBQwBepTgAB6AET5gptByKxw3dKWNA3wFTNAdOCntLhGvavPA8wiU8AUyKIABfgFLXccplbvf8AoNAFI7aZTFo+1RkyByhWgYO/ckFKAo5flPvO2kPnvKp9+M88UMAVyKoCgp+X2mcMv14cBILrPOT/WlilgCmxMAYIATv3xKyncoLJFpsGeNNttbMrNXFPAFDAFTAFTwBQwBUwBU8AUMAVMAVPAFDAFTAFTwBQwBUwBU8AUMAVMAVPAFDAFTIG1Ffg/nr1xpD8EfgMAAAAASUVORK5CYII='

function drawUptechLogoEE(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
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
  const quadrants = [{ fill: '#E30613', a1: Math.PI, a2: -Math.PI / 2 }, { fill: '#111111', a1: -Math.PI / 2, a2: 0 }, { fill: '#E30613', a1: 0, a2: Math.PI / 2 }, { fill: '#111111', a1: Math.PI / 2, a2: Math.PI }]
  quadrants.forEach(q => { ctx.fillStyle = q.fill; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, q.a1, q.a2, false); ctx.closePath(); ctx.fill() })
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r * 0.52, Math.PI / 2, Math.PI, false); ctx.closePath(); ctx.fill()
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = size * 0.04
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke()
  ctx.restore()
}
function roundRectEE(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}
function drawImageEE(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number): Promise<void> {
  return new Promise(resolve => {
    const img = new Image(); img.onload = () => {
      const ratio = Math.max(w / img.width, h / img.height)
      const sw = img.width * ratio, sh = img.height * ratio
      ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh); resolve()
    }; img.onerror = () => resolve(); img.src = src
  })
}
function loadLogoEE(ctx: CanvasRenderingContext2D, x: number, y: number, height: number): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => { const ratio = height / img.height; ctx.drawImage(img, x, y, img.width * ratio, height); resolve(true) }
    img.onerror = () => resolve(false); img.src = UPTECH_LOGO_EE
  })
}

async function generateCard() {
  showCarteModal.value = true; cardGenerated.value = false
  await new Promise(r => setTimeout(r, 80))
  const canvas = cardCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!

  // ── Portrait : 54 × 85.6 mm (carte ID verticale, idéale mobile) ──
  const W = 540, H = 900
  const PW = 640, PH = 1064
  canvas.width = PW; canvas.height = PH
  ctx.scale(PW / W, PH / H)

  const etud = dashboardData?.value?.etudiant
  const inscData = insc.value
  const filiere = inscData?.filiere ?? fi.value?.type_formation ?? '—'
  const classeNom = inscData?.classe ?? '—'
  const anneeAcad = inscData?.annee_academique ?? fi.value?.annee_academique ?? '—'
  const cf = carteFinance.value
  const pad = 20

  // ── 1. Fond blanc ─────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)

  // ── 2. Barre noire EN BAS ─────────────────────────────────────────
  const barH = 60
  ctx.fillStyle = '#111111'; ctx.fillRect(0, H - barH, W, barH)
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'
  let barFs = 17; ctx.font = `${barFs}px Arial`
  const barLine1 = "Institut supérieur de formation aux nouveaux métiers"
  const barLine2 = "de l'Informatique et de la Communication"
  while (ctx.measureText(barLine1).width > W - 20 && barFs > 10) { barFs--; ctx.font = `${barFs}px Arial` }
  ctx.fillText(barLine1, W / 2, H - barH + barFs + 6)
  ctx.fillText(barLine2, W / 2, H - barH + barFs * 2 + 10)
  ctx.textAlign = 'left'

  // ── 3. En-tête : logo-normal.png centré avec marges ────────────────
  const headerH = 150
  const logoMarginTop = 16
  const logoMaxH = headerH - logoMarginTop * 2
  const logoMaxW = W - pad * 2

  await new Promise<void>(resolve => {
    const img = new Image()
    img.onload = () => {
      // Calcul sans déformation : contenir dans (logoMaxW × logoMaxH)
      const ratio = Math.min(logoMaxW / img.width, logoMaxH / img.height)
      const lw = img.width * ratio
      const lh = img.height * ratio
      const lx = (W - lw) / 2          // centré horizontalement
      const ly = logoMarginTop + (logoMaxH - lh) / 2  // centré verticalement dans la zone
      ctx.drawImage(img, lx, ly, lw, lh)
      resolve()
    }
    img.onerror = () => {
      // Fallback : logo dessiné si image non trouvée
      drawUptechLogoEE(ctx, (W - 72) / 2, logoMarginTop, 72)
      resolve()
    }
    img.src = `${window.location.origin}/logo-normal.png`
  })

  // Sous-titre centré sous le logo
  ctx.textAlign = 'center'
  ctx.fillStyle = '#111111'; ctx.font = 'bold 15px Arial'
  ctx.fillText("CARTE D'ÉTUDIANT  ·  " + anneeAcad, W / 2, headerH - 8)
  ctx.textAlign = 'left'

  // ── 4. Bande diagonale HORIZONTALE (séparateur) ──────────────────
  const stripeY = headerH, stripeH = 40, sh = 14
  ctx.save(); ctx.beginPath(); ctx.rect(0, stripeY, W, stripeH); ctx.clip()
  for (let x = -(stripeH * 2); x < W + stripeH * 2; x += sh * 2) {
    ctx.fillStyle = '#E30613'; ctx.beginPath()
    ctx.moveTo(x + stripeH, stripeY); ctx.lineTo(x, stripeY + stripeH)
    ctx.lineTo(x + sh, stripeY + stripeH); ctx.lineTo(x + stripeH + sh, stripeY)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#111111'; ctx.beginPath()
    ctx.moveTo(x + stripeH + sh, stripeY); ctx.lineTo(x + sh, stripeY + stripeH)
    ctx.lineTo(x + sh * 2, stripeY + stripeH); ctx.lineTo(x + stripeH + sh * 2, stripeY)
    ctx.closePath(); ctx.fill()
  }
  ctx.restore()

  // ── 5. Photo (centrée, agrandie) ─────────────────────────────────
  const photoY = stripeY + stripeH + 22
  const photoW = 220, photoH = 270
  const photoX = (W - photoW) / 2
  ctx.strokeStyle = '#444444'; ctx.lineWidth = 2; ctx.strokeRect(photoX, photoY, photoW, photoH)
  if (etud?.photo_url?.startsWith('data:') || etud?.photo_url?.startsWith('http')) {
    await drawImageEE(ctx, etud.photo_url, photoX + 1, photoY + 1, photoW - 2, photoH - 2)
  } else {
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(photoX + 1, photoY + 1, photoW - 2, photoH - 2)
    ctx.fillStyle = '#aaaaaa'; ctx.font = 'bold 90px Arial'; ctx.textAlign = 'center'
    ctx.fillText(`${etud?.prenom?.[0] ?? ''}${etud?.nom?.[0] ?? ''}`.toUpperCase(), photoX + photoW / 2, photoY + photoH / 2 + 32)
    ctx.textAlign = 'left'
  }

  // ── 6. Infos étudiant (sous la photo, centré) ─────────────────────
  let iy = photoY + photoH + 30; const ilh = 32
  ctx.textAlign = 'center'
  // Nom complet — grand
  ctx.fillStyle = '#111111'; ctx.font = 'bold 30px Arial'
  ctx.fillText(`${etud?.prenom ?? ''} ${(etud?.nom ?? '').toUpperCase()}`, W / 2, iy); iy += ilh + 4
  // Matricule
  ctx.fillStyle = '#E30613'; ctx.font = 'bold 21px Arial'
  ctx.fillText(etud?.numero_etudiant ?? '—', W / 2, iy); iy += ilh
  // Séparateur
  ctx.strokeStyle = '#eeeeee'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(pad * 2, iy - 8); ctx.lineTo(W - pad * 2, iy - 8); ctx.stroke()
  // Filière / Classe
  const fields = [
    { label: 'Filière', value: filiere },
    { label: 'Classe', value: classeNom },
  ]
  fields.forEach(f => {
    ctx.fillStyle = '#888888'; ctx.font = '17px Arial'; ctx.fillText(f.label, W / 2, iy); iy += 22
    ctx.fillStyle = '#111111'; ctx.font = 'bold 21px Arial'; ctx.fillText(f.value, W / 2, iy); iy += ilh
  })
  ctx.textAlign = 'left'

  // ── 7. Mensualités (pastilles + badge statut) ─────────────────────
  if (!isFI.value && cf.totalMois > 0) {
    // Badge statut centré
    const badgeW = 260, badgeH = 36, badgeX2 = (W - badgeW) / 2
    ctx.fillStyle = cf.enRegle ? '#16a34a' : '#dc2626'
    ctx.beginPath(); ctx.roundRect(badgeX2, iy, badgeW, badgeH, 10); ctx.fill()
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 19px Arial'; ctx.textAlign = 'center'
    const statLabel = cf.enRegle ? '✓ EN RÈGLE' : `⚠ ${cf.moisEnRetard} mois en retard`
    ctx.fillText(statLabel, W / 2, iy + badgeH / 2 + 7); ctx.textAlign = 'left'; iy += badgeH + 14

    // Label + compteur
    ctx.fillStyle = '#555555'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'
    ctx.fillText(`Mensualités : ${cf.moisPaies} / ${cf.totalMois} mois payés`, W / 2, iy); iy += 24; ctx.textAlign = 'left'

    // Pastilles
    const available = W - pad * 2
    const dotSize = Math.min(24, Math.floor((available - (cf.totalMois - 1) * 4) / cf.totalMois))
    const totalDotsW = cf.totalMois * dotSize + (cf.totalMois - 1) * 4
    let dx = (W - totalDotsW) / 2
    const nowKey = new Date().toISOString().substring(0, 7)
    cf.mensualites.forEach((ech: any) => {
      const isPaye = ech.statut === 'paye'
      const isRetard = !isPaye && (ech.mois ?? '').substring(0, 7) < nowKey
      ctx.fillStyle = isPaye ? '#16a34a' : isRetard ? '#dc2626' : '#d1d5db'
      ctx.beginPath(); ctx.roundRect(dx, iy, dotSize, dotSize, 5); ctx.fill()
      dx += dotSize + 4
    })
    iy += dotSize + 8
  }

  // ── 8. QR Code (matricule étudiant, centré) ───────────────────────
  try {
    const qrData = JSON.stringify({
      num: etud?.numero_etudiant ?? '',
      nom: `${etud?.prenom ?? ''} ${etud?.nom ?? ''}`.trim(),
      app: 'uptech-campus',
    })
    const qrCanvas = document.createElement('canvas')
    await QRCode.toCanvas(qrCanvas, qrData, {
      width: 110, margin: 1,
      color: { dark: '#111111', light: '#ffffff' },
    })
    iy += 6
    const qrX = (W - 110) / 2
    ctx.drawImage(qrCanvas, qrX, iy)
    ctx.fillStyle = '#aaaaaa'; ctx.font = '12px Arial'; ctx.textAlign = 'center'
    ctx.fillText('Scanner pour vérifier', W / 2, iy + 120)
    ctx.textAlign = 'left'
    iy += 130
  } catch { /* silencieux */ }

  // ── 9. Bordure arrondie ───────────────────────────────────────────
  ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 2; roundRectEE(ctx, 1, 1, W - 2, H - 2, 20); ctx.stroke()
  cardGenerated.value = true
}

function downloadCard() {
  const canvas = cardCanvas.value; if (!canvas) return
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `carte-etudiant-${dashboardData?.value?.etudiant?.numero_etudiant ?? 'uptech'}.png`
  a.click()
}
function printCard() {
  const canvas = cardCanvas.value; if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const w = window.open('', '_blank')
  if (w) { w.document.write(`<!DOCTYPE html><html><head><style>*{margin:0;padding:0}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5}img{max-width:100%;box-shadow:0 4px 20px rgba(0,0,0,.2)}@media print{body{background:#fff;min-height:unset}}</style></head><body><img src="${url}" /></body></html>`); w.document.close(); setTimeout(() => w.print(), 400) }
}

// ── Accordéon historique ─────────────────────────────────────────────
const expandedSeance = ref<string | null>(null)

// ── Avis qualité séances (anonymes) ──────────────────────────────────
const avisSubmitted = ref<Set<number>>(new Set())
const avisEnCours = ref<Record<number, { note: number; commentaire: string; saving: boolean }>>({})

// Nettoie le HTML Word (balises mso-*, o:, commentaires conditionnels, styles inline)
function cleanHtml(raw: string | null | undefined): string {
  if (!raw) return ''
  let clean = raw
    .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<\/?o:[^>]*>/gi, '')
    .replace(/<\/?w:[^>]*>/gi, '')
    .replace(/<\/?m:[^>]*>/gi, '')
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  doc.querySelectorAll<HTMLElement>('*').forEach(el => {
    el.removeAttribute('style')
    el.removeAttribute('lang')
    el.removeAttribute('class')
    el.removeAttribute('dir')
  })
  doc.querySelectorAll('span').forEach(span => {
    if (span.attributes.length === 0) {
      span.replaceWith(...Array.from(span.childNodes))
    }
  })
  doc.querySelectorAll('p:empty, span:empty').forEach(el => el.remove())
  return doc.body.innerHTML
}

function initAvis(seanceId: number) {
  if (!avisEnCours.value[seanceId]) {
    avisEnCours.value[seanceId] = { note: 0, commentaire: '', saving: false }
  }
}

function setAvisNote(seanceId: number, n: number) {
  const entry = avisEnCours.value[seanceId]
  if (entry) entry.note = n
}

async function soumettreAvis(seanceId: number) {
  const a = avisEnCours.value[seanceId]
  if (!a || a.note === 0 || !a.commentaire.trim()) return
  a.saving = true
  try {
    await api.post(`/seances/${seanceId}/avis`, { note: a.note, commentaire: a.commentaire.trim() })
    avisSubmitted.value = new Set([...avisSubmitted.value, seanceId])
  } catch (e: any) {
    if (e?.response?.status === 409) {
      // Déjà soumis
      avisSubmitted.value = new Set([...avisSubmitted.value, seanceId])
    }
  } finally {
    a.saving = false
  }
}


</script>

<template>
  <div v-if="!dashboardData" class="ee-no-data">
    <div class="ee-no-data-inner">
      <span style="font-size:48px;">🎓</span>
      <p>Aucune inscription active trouvée.</p>
    </div>
  </div>

  <div v-else class="ee-page">

    <!-- ══ HERO ══════════════════════════════════════════════════════ -->
    <div class="ee-hero" :class="{ 'ee-mobile-hide': mobileTab !== 'accueil' }">
      <div class="ee-hero-bg"></div>
      <div class="ee-hero-content">
        <!-- Avatar + infos -->
        <div class="ee-hero-left">
          <div class="ee-avatar">
            {{ (dashboardData.etudiant.prenom?.[0] ?? '') + (dashboardData.etudiant.nom?.[0] ?? '') }}
          </div>
          <div class="ee-hero-info">
            <p class="ee-hero-greeting">Bonjour 👋</p>
            <h1 class="ee-hero-name">{{ dashboardData.etudiant.prenom }} {{ dashboardData.etudiant.nom }}</h1>
            <div class="ee-hero-tags">
              <template v-if="insc">
                <span class="ee-tag ee-tag--primary">{{ insc.filiere }}</span>
                <span class="ee-tag ee-tag--ghost">{{ insc.classe }}</span>
                <span class="ee-tag ee-tag--ghost">{{ insc.annee_academique }}</span>
              </template>
              <template v-else-if="fi">
                <span class="ee-tag ee-tag--primary">{{ fi.type_formation }}</span>
                <span class="ee-tag ee-tag--ghost">Formation Individuelle</span>
                <span class="ee-tag ee-tag--ghost">{{ fi.annee_academique }}</span>
              </template>
            </div>
          </div>
        </div>
        <!-- KPIs -->
        <div class="ee-hero-kpis">
          <template v-if="!isFI">
            <div class="ee-kpi">
              <div class="ee-kpi-val" :style="{ color: (dashboardData.notes?.moyenne_generale ?? 0) >= 10 ? '#4ade80' : '#f87171' }">
                {{ dashboardData.notes?.moyenne_generale?.toFixed(2) ?? '—' }}
              </div>
              <div class="ee-kpi-lbl">Moyenne /20</div>
            </div>
            <div class="ee-kpi">
              <div class="ee-kpi-val" :style="{ color: (dashboardData.presences?.taux_presence ?? 0) >= 75 ? '#4ade80' : '#f87171' }">
                {{ dashboardData.presences?.taux_presence ?? 0 }}%
              </div>
              <div class="ee-kpi-lbl">Assiduité</div>
            </div>
            <div class="ee-kpi">
              <div class="ee-kpi-val" :style="{ color: (dashboardData.notes?.ues ?? []).filter((u:any)=>u.note!==null&&u.note>=10).length === (dashboardData.notes?.ues ?? []).length ? '#4ade80' : '#fbbf24' }">
                {{ (dashboardData.notes?.ues ?? []).filter((u:any) => u.note !== null && u.note >= 10).length }}/{{ (dashboardData.notes?.ues ?? []).length }}
              </div>
              <div class="ee-kpi-lbl">UEs validées</div>
            </div>
          </template>
          <template v-else>
            <div class="ee-kpi">
              <div class="ee-kpi-val" style="color:#6366f1;">{{ fi?.modules?.length ?? 0 }}</div>
              <div class="ee-kpi-lbl">Modules</div>
            </div>
            <div class="ee-kpi">
              <div class="ee-kpi-val" style="color:#3b82f6;">
                {{ (dashboardData.seances_semaine?.length ?? 0) + (dashboardData.seances_passees?.length ?? 0) }}
              </div>
              <div class="ee-kpi-lbl">Séances</div>
            </div>
          </template>
          <div class="ee-kpi">
            <div class="ee-kpi-val" :style="{ color: restantDu > 0 ? '#f87171' : '#4ade80' }">
              {{ restantDu > 0 ? (restantDu / 1000).toFixed(0) + 'k' : '✓' }}
            </div>
            <div class="ee-kpi-lbl">{{ restantDu > 0 ? 'FCFA restant' : 'Soldé' }}</div>
          </div>
        </div>
      </div>

      <!-- Prochain cours dans le hero -->
      <div v-if="prochainCours" class="ee-hero-next">
        <div class="ee-hero-next-label">Prochain cours</div>
        <div class="ee-hero-next-info">
          <span class="ee-hero-next-icon">{{ modeIcon(prochainCours.mode) }}</span>
          <span class="ee-hero-next-name">{{ prochainCours.matiere }}</span>
          <span class="ee-hero-next-time">{{ formatTime(prochainCours.date_debut) }}</span>
          <span class="ee-hero-next-countdown">{{ countdownText }}</span>
        </div>
      </div>
    </div>

    <!-- ══ ALERTE PAIEMENT — Desktop ═════════════════════════════════ -->
    <div v-if="restantDu > 0" class="ee-alert-pay ee-alert-desktop" :class="{ 'ee-mobile-hide': true }">
      <div class="ee-alert-pay-icon"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M2 9h20" stroke="currentColor" stroke-width="1.8"/><rect x="15" y="12" width="4" height="3" rx="1" fill="currentColor"/><path d="M6 4V3a1 1 0 011-1h10a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.5"/></svg></div>
      <div class="ee-alert-pay-body">
        <strong>Solde impayé : {{ restantDu.toLocaleString('fr-FR') }} FCFA</strong>
        <span>Régularisez votre situation pour éviter tout blocage d'accès.</span>
      </div>
      <a href="#finances" @click="activeTab='finances'" class="ee-alert-pay-btn">Voir</a>
    </div>

    <!-- ══ ALERTE PAIEMENT — Mobile (minimaliste) ══════════════════ -->
    <div v-if="restantDu > 0" class="ee-m-alert" :class="{ 'ee-mobile-hide': mobileTab !== 'accueil' }">
      <div class="ee-m-alert-card">
        <div class="ee-m-alert-top">
          <div class="ee-m-alert-icon-wrap">
            <svg class="ee-m-alert-icon-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/>
              <path d="M2 7h20" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6 3V1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M18 3V1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M6 11h5M6 14.5h8M6 18h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="ee-m-alert-info">
            <span class="ee-m-alert-label">Solde impayé</span>
            <span class="ee-m-alert-amount">{{ restantDu.toLocaleString('fr-FR') }} <small>FCFA</small></span>
          </div>
        </div>
        <button class="ee-m-alert-btn" @click="setMobileTab('finances'); activeTab='finances'">
          Voir
        </button>
      </div>
    </div>

    <!-- ══ QUICK ACTIONS ══════════════════════════════════════════════ -->
    <div class="ee-quick-actions" :class="{ 'ee-mobile-hide': mobileTab !== 'accueil' }">
      <button class="ee-qa" @click="setMobileTab('planning'); activeTab='planning'">
        <span class="ee-qa-icon">📅</span>
        <span>Emploi du temps</span>
      </button>
      <button class="ee-qa" @click="setMobileTab('notes'); activeTab='notes'">
        <span class="ee-qa-icon">📋</span>
        <span>Notes</span>
      </button>
      <button class="ee-qa" @click="setMobileTab('finances'); activeTab='finances'">
        <span class="ee-qa-icon">💰</span>
        <span>Comptabilité</span>
      </button>
      <button class="ee-qa" @click="openMessages">
        <span class="ee-qa-icon">💬</span>
        <span>Messages</span>
        <span v-if="totalUnread > 0" class="ee-qa-badge">{{ totalUnread }}</span>
      </button>
      <button class="ee-qa" @click="generateCard()" style="position:relative;">
        <span class="ee-qa-icon">🪪</span>
        <span>Ma Carte</span>
        <span v-if="carteFinance.moisEnRetard > 0" class="ee-qa-badge" style="background:#ef4444;">{{ carteFinance.moisEnRetard }}</span>
      </button>
    </div>

    <!-- ══ APERÇU AUJOURD'HUI (mobile accueil uniquement) ═══════════ -->
    <div class="ee-mobile-today" :class="{ 'ee-mobile-hide': mobileTab !== 'accueil' }">
      <!-- Prochain cours compact -->
      <div v-if="prochainCours" class="ee-m-next" :style="{ background: modeGradient(prochainCours.mode) }">
        <div class="ee-m-next-left">
          <span class="ee-m-next-icon">{{ modeIcon(prochainCours.mode) }}</span>
          <div class="ee-m-next-info">
            <div class="ee-m-next-label">Prochain cours</div>
            <div class="ee-m-next-name">{{ prochainCours.matiere }}</div>
            <div class="ee-m-next-time">{{ formatTime(prochainCours.date_debut) }} — {{ formatTime(prochainCours.date_fin) }}<span v-if="prochainCours.salle"> · {{ prochainCours.salle }}</span></div>
          </div>
        </div>
        <div class="ee-m-next-cd">
          <div class="ee-m-next-cd-val">{{ countdownText }}</div>
        </div>
      </div>

      <!-- Cours du jour compact -->
      <div class="ee-m-section-header">
        <span class="ee-m-section-title">Aujourd'hui</span>
        <button class="ee-m-section-link" @click="setMobileTab('planning'); activeTab='planning'">Semaine →</button>
      </div>
      <div class="ee-m-today-card">
        <template v-if="seancesParJour.find(g => g.isToday)">
          <div v-for="s in seancesParJour.find(g => g.isToday)!.seances" :key="s.id" class="ee-m-today-row">
            <div class="ee-m-today-icon" :style="{ background: presenceBadge(s.presence_etudiant).bg }">
              {{ presenceBadge(s.presence_etudiant).icon }}
            </div>
            <div class="ee-m-today-info">
              <div class="ee-m-today-name">{{ s.matiere }}</div>
              <div class="ee-m-today-sub">{{ formatTime(s.date_debut) }} — {{ formatTime(s.date_fin) }}<span v-if="s.enseignant"> · {{ s.enseignant }}</span></div>
            </div>
            <div class="ee-m-today-badge">
              <span class="ee-m-badge" :style="{ background: presenceBadge(s.presence_etudiant).bg, color: presenceBadge(s.presence_etudiant).color }">
                {{ presenceBadge(s.presence_etudiant).label }}
              </span>
            </div>
          </div>
        </template>
        <div v-else class="ee-m-today-empty">Aucun cours aujourd'hui</div>
      </div>

      <!-- Annonces slider — 1 à la fois -->
      <div v-if="annoncesCurrent.length" class="ee-m-section-header" style="margin-top:4px;">
        <span class="ee-m-section-title">Annonces</span>
        <span class="ee-m-section-count">{{ annonceIndex + 1 }} / {{ annoncesCurrent.length }}</span>
      </div>
      <div v-if="annoncesCurrent.length" class="ee-m-annonce-slider">
        <div class="ee-m-annonce-slide">
          <div class="ee-m-annonce-header">
            <span class="ee-m-badge" :style="{ background: typeBadgeStyle(annoncesCurrent[annonceIndex].type).bg, color: typeBadgeStyle(annoncesCurrent[annonceIndex].type).color }">
              {{ typeLabel(annoncesCurrent[annonceIndex].type) }}
            </span>
            <span class="ee-m-annonce-time">{{ timeAgo(annoncesCurrent[annonceIndex].publie_at) }}</span>
          </div>
          <div class="ee-m-annonce-titre">{{ annoncesCurrent[annonceIndex].titre }}</div>
          <div v-if="annoncesCurrent[annonceIndex].contenu" class="ee-m-annonce-body">{{ annoncesCurrent[annonceIndex].contenu }}</div>
        </div>
        <div v-if="annoncesCurrent.length > 1" class="ee-m-annonce-nav">
          <button class="ee-m-annonce-arrow" @click="prevAnnonce">←</button>
          <div class="ee-m-annonce-dots">
            <span v-for="(_, i) in annoncesCurrent" :key="i"
              class="ee-m-annonce-dot" :class="{ 'ee-m-annonce-dot--active': i === annonceIndex }"
              @click="annonceIndex = Number(i)"></span>
          </div>
          <button class="ee-m-annonce-arrow" @click="nextAnnonce">→</button>
        </div>
      </div>
    </div>

    <!-- ══ CONTENU "PLUS" (mobile) ════════════════════════════════════ -->
    <div class="ee-mobile-plus" :class="{ 'ee-mobile-hide': mobileTab !== 'plus' }">
      <!-- Assiduité -->
      <div class="ee-card">
        <div class="ee-card-header">
          <div class="ee-card-header-left">
            <span class="ee-card-icon">📊</span>
            <h3 class="ee-card-title">Assiduité</h3>
          </div>
        </div>
        <div class="ee-card-body">
          <div class="ee-assiduite-gauge">
            <svg width="100" height="100" viewBox="0 0 100 100">
              <circle cx="50" cy="50" :r="RADIUS" fill="none" stroke="#f0f0f0" stroke-width="8"/>
              <circle cx="50" cy="50" :r="RADIUS" fill="none"
                :stroke="assiduiteColor" stroke-width="8" stroke-linecap="round"
                :stroke-dasharray="CIRC" :stroke-dashoffset="assiduiteOffset"
                transform="rotate(-90 50 50)" style="transition: stroke-dashoffset 0.6s ease"/>
              <text x="50" y="46" text-anchor="middle" font-size="16" font-weight="800" :fill="assiduiteColor">
                {{ dashboardData.presences.taux_presence }}%
              </text>
              <text x="50" y="60" text-anchor="middle" font-size="7" fill="#9ca3af">présence</text>
            </svg>
          </div>
          <div class="ee-assiduite-detail">
            <div class="ee-abs-row">
              <div class="ee-abs-left"><span class="ee-abs-dot" style="background:#22c55e;"></span><span class="ee-abs-lbl">Présent</span></div>
              <div class="ee-abs-right"><div class="ee-abs-track"><div class="ee-abs-fill" style="background:#22c55e;" :style="{ width: dashboardData.presences.total ? `${(dashboardData.presences.present/dashboardData.presences.total)*100}%` : '0%' }"></div></div><span class="ee-abs-count">{{ dashboardData.presences.present }}</span></div>
            </div>
            <div class="ee-abs-row">
              <div class="ee-abs-left"><span class="ee-abs-dot" style="background:#f59e0b;"></span><span class="ee-abs-lbl">Retard</span></div>
              <div class="ee-abs-right"><div class="ee-abs-track"><div class="ee-abs-fill" style="background:#f59e0b;" :style="{ width: dashboardData.presences.total ? `${(dashboardData.presences.retard/dashboardData.presences.total)*100}%` : '0%' }"></div></div><span class="ee-abs-count">{{ dashboardData.presences.retard }}</span></div>
            </div>
            <div class="ee-abs-row">
              <div class="ee-abs-left"><span class="ee-abs-dot" style="background:#ef4444;"></span><span class="ee-abs-lbl">Absent</span></div>
              <div class="ee-abs-right"><div class="ee-abs-track"><div class="ee-abs-fill" style="background:#ef4444;" :style="{ width: dashboardData.presences.total ? `${(dashboardData.presences.absent/dashboardData.presences.total)*100}%` : '0%' }"></div></div><span class="ee-abs-count">{{ dashboardData.presences.absent }}</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Documents -->
      <div class="ee-card" style="margin-top:12px;">
        <div class="ee-card-header">
          <div class="ee-card-header-left">
            <span class="ee-card-icon">📄</span>
            <h3 class="ee-card-title">Documents</h3>
          </div>
        </div>
        <div class="ee-card-body">
          <div v-if="!dashboardData.documents?.length" class="ee-empty-state"><span>📂</span><p>Aucun document</p></div>
          <div v-for="doc in dashboardData.documents" :key="doc.id" class="ee-doc-row">
            <div class="ee-doc-icon">📄</div>
            <div class="ee-doc-info">
              <div class="ee-doc-nom">{{ doc.nom_fichier }}</div>
              <div class="ee-doc-meta">{{ doc.type_document }}</div>
            </div>
            <button class="ee-doc-dl">Voir</button>
          </div>
        </div>
      </div>

      <!-- Messagerie -->
      <div class="ee-card" style="margin-top:12px;">
        <div class="ee-card-header">
          <div class="ee-card-header-left">
            <span class="ee-card-icon">💬</span>
            <h3 class="ee-card-title">Messages</h3>
            <span v-if="totalUnread > 0" class="ee-unread-badge">{{ totalUnread }}</span>
          </div>
          <button class="ee-link" @click="openMessages">Ouvrir</button>
        </div>
      </div>
    </div>

    <!-- ══ GRILLE PRINCIPALE (desktop + mobile tabs planification/notes/finances/absences) ══ -->
    <div class="ee-grid" :class="{ 'ee-mobile-hide': mobileTab === 'accueil' || mobileTab === 'plus' }">

      <!-- ── COLONNE GAUCHE ────────────────────────────────────────── -->
      <div class="ee-col-left">

        <!-- NAV ONGLETS (visible mobile) -->
        <div class="ee-tabs">
          <button :class="['ee-tab', activeTab==='planning' && 'ee-tab--active']" @click="activeTab='planning'">📅 Planning</button>
          <button :class="['ee-tab', activeTab==='notes'    && 'ee-tab--active']" @click="activeTab='notes'">📋 Notes</button>
          <button :class="['ee-tab', activeTab==='finances' && 'ee-tab--active']" @click="activeTab='finances'">💰 Finances</button>
          <button :class="['ee-tab', activeTab==='absences' && 'ee-tab--active']" @click="activeTab='absences'; loadAbsences()">🚨 Absences</button>
        </div>

        <!-- ══ PLANNING ══ -->
        <div v-show="activeTab === 'planning'" class="ee-section">

          <!-- Prochain cours card -->
          <div v-if="prochainCours" class="ee-next-course-card" :style="{ background: modeGradient(prochainCours.mode) }">
            <div class="ee-nc-left">
              <div class="ee-nc-icon">{{ modeIcon(prochainCours.mode) }}</div>
              <div>
                <div class="ee-nc-matiere">{{ prochainCours.matiere }}</div>
                <div class="ee-nc-meta">
                  <span v-if="prochainCours.enseignant">👤 {{ prochainCours.enseignant }}</span>
                  <span v-if="prochainCours.salle"> · 📍 {{ prochainCours.salle }}</span>
                </div>
                <div class="ee-nc-time">{{ formatTime(prochainCours.date_debut) }} — {{ formatTime(prochainCours.date_fin) }} ({{ durationH(prochainCours.date_debut, prochainCours.date_fin) }}h)</div>
              </div>
            </div>
            <div class="ee-nc-countdown">
              <div class="ee-nc-cd-val">{{ countdownText }}</div>
              <div class="ee-nc-cd-lbl">avant le cours</div>
            </div>
          </div>

          <!-- Cours de la semaine -->
          <div id="planning" class="ee-card">
            <div class="ee-card-header">
              <div class="ee-card-header-left">
                <span class="ee-card-icon">📅</span>
                <h2 class="ee-card-title">Cette semaine</h2>
              </div>
              <span class="ee-badge-count">{{ dashboardData.seances_semaine?.length ?? 0 }} cours</span>
            </div>
            <div class="ee-card-body">
              <div v-if="seancesParJour.length === 0" class="ee-empty-state">
                <span>📭</span><p>Aucun cours programmé cette semaine</p>
              </div>
              <template v-else>
                <div v-for="(groupe, gi) in seancesParJour" :key="groupe.jour" class="ee-day-group">
                  <div class="ee-day-header" :class="{ 'ee-day-header--today': groupe.isToday }">
                    <span class="ee-day-label">{{ groupe.jour }}</span>
                    <span class="ee-day-dot">{{ groupe.seances.length }}</span>
                  </div>
                  <div v-for="(s, si) in groupe.seances" :key="s.id" class="ee-seance"
                    :class="{ 'ee-seance--now': isToday(s.date_debut) && isFuture(s.date_debut) }"
                    :style="{ '--clr': COLORS[(gi * 3 + si) % COLORS.length] }">
                    <div class="ee-seance-stripe"></div>
                    <div class="ee-seance-time-col">
                      <div class="ee-s-time">{{ formatTime(s.date_debut) }}</div>
                      <div class="ee-s-dur">{{ durationH(s.date_debut, s.date_fin) }}h</div>
                    </div>
                    <div class="ee-seance-body">
                      <div class="ee-s-matiere">{{ s.matiere }}</div>
                      <div class="ee-s-meta">
                        <span v-if="s.enseignant">👤 {{ s.enseignant }}</span>
                        <span v-if="s.salle"> · 📍 {{ s.salle }}</span>
                        <span v-else> · 📍 À confirmer</span>
                      </div>
                    </div>
                    <div class="ee-seance-right">
                      <span class="ee-mode-chip" :style="{ background: modeGradient(s.mode) }">
                        {{ modeIcon(s.mode) }} {{ modeLabel(s.mode) }}
                      </span>
                      <span v-if="s.statut === 'effectue'" class="ee-chip ee-chip--green">✅ Émargé</span>
                      <span v-else class="ee-chip ee-chip--blue">🕐 À venir</span>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Séances à venir (au-delà de cette semaine) -->
          <div v-if="seancesFuturesParJour.length > 0" class="ee-card">
            <div class="ee-card-header">
              <div class="ee-card-header-left">
                <span class="ee-card-icon">📆</span>
                <h2 class="ee-card-title">Prochaines séances</h2>
              </div>
              <span class="ee-badge-count">{{ dashboardData.seances_futures?.length ?? 0 }} cours</span>
            </div>
            <div class="ee-card-body">
              <div v-for="(groupe, gi) in seancesFuturesParJour" :key="groupe.jour" class="ee-day-group">
                <div class="ee-day-header">
                  <span class="ee-day-label">{{ groupe.jour }}</span>
                  <span class="ee-day-dot">{{ groupe.seances.length }}</span>
                </div>
                <div v-for="(s, si) in groupe.seances" :key="s.id" class="ee-seance"
                  :style="{ '--clr': COLORS[(gi * 3 + si) % COLORS.length] }">
                  <div class="ee-seance-stripe"></div>
                  <div class="ee-seance-time-col">
                    <div class="ee-s-time">{{ formatTime(s.date_debut) }}</div>
                    <div class="ee-s-dur">{{ durationH(s.date_debut, s.date_fin) }}h</div>
                  </div>
                  <div class="ee-seance-body">
                    <div class="ee-s-matiere">{{ s.matiere }}</div>
                    <div class="ee-s-meta">
                      <span v-if="s.enseignant">👤 {{ s.enseignant }}</span>
                      <span v-if="s.salle"> · 📍 {{ s.salle }}</span>
                      <span v-else> · 📍 À confirmer</span>
                    </div>
                  </div>
                  <div class="ee-seance-right">
                    <span class="ee-mode-chip" :style="{ background: modeGradient(s.mode) }">
                      {{ modeIcon(s.mode) }} {{ modeLabel(s.mode) }}
                    </span>
                    <span class="ee-chip ee-chip--blue">🕐 À venir</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Historique -->
          <div v-if="seancesPasseesParJour.length > 0" class="ee-card">
            <div class="ee-card-header">
              <div class="ee-card-header-left">
                <span class="ee-card-icon">🗂</span>
                <h2 class="ee-card-title">Cours effectués</h2>
              </div>
              <span class="ee-badge-count">{{ dashboardData.seances_passees?.length ?? 0 }} séances</span>
            </div>
            <div class="ee-card-body">
              <div v-for="(groupe, gi) in seancesPasseesParJour" :key="groupe.jour" class="ee-day-group">
                <div class="ee-day-header">
                  <span class="ee-day-label">{{ groupe.jour }}</span>
                </div>
                <div v-for="(s, si) in groupe.seances" :key="s.id"
                  class="ee-seance ee-seance--past"
                  :class="{ 'ee-seance--open': expandedSeance === s.id }"
                  :style="{ '--clr': COLORS[(gi * 3 + si) % COLORS.length] }">
                  <div class="ee-seance-stripe"></div>
                  <div class="ee-seance-main-row"
                    @click="if (s.statut === 'effectue') { expandedSeance = expandedSeance === s.id ? null : s.id; initAvis(s.id) }"
                    :style="s.statut === 'effectue' ? 'cursor:pointer' : ''">
                    <div class="ee-seance-time-col">
                      <div class="ee-s-time">{{ formatTime(s.date_debut) }}</div>
                      <div class="ee-s-dur">{{ durationH(s.date_debut, s.date_fin) }}h</div>
                    </div>
                    <div class="ee-seance-body">
                      <div class="ee-s-matiere">{{ s.matiere }}</div>
                      <div class="ee-s-meta">
                        <span v-if="s.enseignant">👤 {{ s.enseignant }}</span>
                        <span v-if="s.salle"> · 📍 {{ s.salle }}</span>
                      </div>
                    </div>
                    <div class="ee-seance-right">
                      <span v-if="s.statut === 'effectue'" class="ee-chip ee-chip--green">✅ Émargé</span>
                      <span v-else class="ee-chip ee-chip--gray">⏳ Non émargé</span>
                      <span class="ee-chip" :style="{ background: presenceBadge(s.presence_etudiant).bg, color: presenceBadge(s.presence_etudiant).color }">
                        {{ presenceBadge(s.presence_etudiant).icon }} {{ presenceBadge(s.presence_etudiant).label }}
                      </span>
                      <span v-if="s.statut === 'effectue'" class="ee-expand-chevron">
                        {{ expandedSeance === s.id ? '▲' : '▼' }}
                      </span>
                    </div>
                  </div>
                  <!-- Accordéon contenu -->
                  <div v-if="expandedSeance === s.id && s.statut === 'effectue'" class="ee-seance-detail">
                    <div v-if="s.objectifs" class="ee-detail-block">
                      <div class="ee-detail-label">🎯 Objectifs</div>
                      <div class="ee-detail-text ee-rich-text" v-html="cleanHtml(s.objectifs)"></div>
                    </div>
                    <div v-if="s.contenu_seance" class="ee-detail-block">
                      <div class="ee-detail-label">📖 Contenu abordé</div>
                      <div class="ee-detail-text ee-rich-text" v-html="cleanHtml(s.contenu_seance)"></div>
                    </div>
                    <div v-if="s.notes" class="ee-detail-block">
                      <div class="ee-detail-label">📝 Notes du professeur</div>
                      <div class="ee-detail-text ee-rich-text" v-html="cleanHtml(s.notes)"></div>
                    </div>
                    <div v-if="!s.objectifs && !s.contenu_seance && !s.notes" class="ee-detail-empty">
                      Aucun contenu renseigné par le professeur.
                    </div>

                    <!-- ── Évaluation anonyme ─────────────────────────────── -->
                    <div class="ee-avis-block">
                      <!-- Déjà soumis -->
                      <div v-if="avisSubmitted.has(s.id)" class="ee-avis-done">
                        ✅ Votre évaluation a été enregistrée anonymement
                      </div>
                      <!-- Formulaire -->
                      <template v-else-if="avisEnCours[s.id]">
                        <div class="ee-avis-title">⭐ Évaluer cette séance <span class="ee-avis-hint">(anonyme — visible du prof et de l'administration)</span></div>
                        <!-- Étoiles -->
                        <div class="ee-stars">
                          <button v-for="n in 5" :key="n"
                            class="ee-star"
                            :class="{ 'ee-star--on': n <= (avisEnCours[s.id]?.note ?? 0) }"
                            @click.stop="setAvisNote(s.id, n)">★</button>
                        </div>
                        <!-- Commentaire -->
                        <textarea
                          v-model="avisEnCours[s.id]!.commentaire"
                          class="ee-avis-textarea"
                          placeholder="Votre commentaire sur cette séance…"
                          rows="2"
                          maxlength="500"
                          @click.stop
                        ></textarea>
                        <button
                          class="ee-avis-submit"
                          :disabled="(avisEnCours[s.id]?.note ?? 0) === 0 || !(avisEnCours[s.id]?.commentaire ?? '').trim() || !!avisEnCours[s.id]?.saving"
                          @click.stop="soumettreAvis(s.id)"
                        >
                          {{ avisEnCours[s.id]?.saving ? 'Envoi…' : 'Envoyer mon avis' }}
                        </button>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ══ NOTES ══ -->
        <div v-show="activeTab === 'notes'" class="ee-section">
          <!-- Classic student notes -->
          <div v-if="!isFI" id="notes" class="ee-card">
            <div class="ee-card-header">
              <div class="ee-card-header-left">
                <span class="ee-card-icon">📋</span>
                <h2 class="ee-card-title">Mes notes — Session normale</h2>
              </div>
              <span v-if="dashboardData.notes?.mention" class="ee-mention-pill">{{ dashboardData.notes.mention }}</span>
            </div>
            <div class="ee-card-body">

              <!-- Résumé 3 KPIs -->
              <div class="ee-notes-kpis">
                <div class="ee-nk ee-nk--main">
                  <div class="ee-nk-val">{{ dashboardData.notes?.moyenne_generale?.toFixed(2) ?? '—' }}</div>
                  <div class="ee-nk-lbl">Moyenne /20</div>
                </div>
                <div class="ee-nk">
                  <div class="ee-nk-val">{{ dashboardData.notes?.rang ? `${dashboardData.notes.rang}e` : '—' }}</div>
                  <div class="ee-nk-lbl">Rang</div>
                </div>
                <div class="ee-nk">
                  <div class="ee-nk-val">{{ (dashboardData.notes?.ues ?? []).filter((u:any) => u.note !== null && u.note >= 10).length }}/{{ (dashboardData.notes?.ues ?? []).length }}</div>
                  <div class="ee-nk-lbl">UEs validées</div>
                </div>
              </div>

              <!-- Décision jury pré-calculée -->
              <div v-if="decisionJury" class="ee-jury-banner" :style="{ background: decisionJury.bg, color: decisionJury.color }">
                <span class="ee-jury-icon">{{ decisionJury.icon }}</span>
                <span class="ee-jury-text">{{ decisionJury.label }}</span>
                <span class="ee-jury-hint">sur la base de la session normale</span>
              </div>

              <!-- Pas de notes -->
              <div v-if="(dashboardData.notes?.ues ?? []).every((u:any) => u.note === null)" class="ee-empty-state">
                <span>📭</span><p>Aucune note saisie pour l'instant.</p>
              </div>

              <!-- Liste UEs groupées par semestre -->
              <div v-else>
                <div v-if="(dashboardData.notes?.ues ?? []).some((u:any) => u.semestre > 1)">
                  <!-- Plusieurs semestres -->
                  <div v-for="sem in ([...new Set((dashboardData.notes?.ues ?? []).map((u:any) => u.semestre || 1))] as number[]).sort()" :key="sem" style="margin-bottom:14px;">
                    <div class="ee-sem-label" :class="sem===1?'ee-sem-label--s1':'ee-sem-label--s2'">
                      📅 Semestre {{ sem }}
                    </div>
                    <div class="ee-notes-list">
                      <div v-for="(ue, idx) in (dashboardData.notes?.ues ?? []).filter((u:any) => (u.semestre||1) === sem)" :key="ue.ue_id"
                        class="ee-note-row"
                        :style="{ '--ue-clr': COLORS[Number(idx) % COLORS.length] }">
                        <div class="ee-note-stripe"></div>
                        <div class="ee-note-info">
                          <div class="ee-note-matiere">{{ ue.intitule }}</div>
                          <div class="ee-note-sub">Coeff. {{ ue.coefficient }}</div>
                        </div>
                        <div class="ee-note-bar-wrap">
                          <div class="ee-note-track">
                            <div class="ee-note-fill"
                              :style="{
                                width: ue.note !== null ? Math.min(100, ue.note/20*100)+'%' : '0%',
                                background: ue.note === null ? '#e5e7eb' : ue.note >= 14 ? '#10b981' : ue.note >= 10 ? '#f59e0b' : '#ef4444'
                              }"></div>
                          </div>
                        </div>
                        <div class="ee-note-badge"
                          :style="{
                            background: ue.note === null ? '#f3f4f6' : ue.note >= 14 ? '#dcfce7' : ue.note >= 10 ? '#fef9c3' : '#fee2e2',
                            color: ue.note === null ? '#9ca3af' : ue.note >= 14 ? '#15803d' : ue.note >= 10 ? '#92400e' : '#b91c1c'
                          }">
                          {{ ue.note !== null ? ue.note : '—' }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="ee-notes-list">
                  <!-- Pas de semestre distinct — liste simple -->
                  <div v-for="(ue, idx) in dashboardData.notes?.ues ?? []" :key="ue.ue_id"
                    class="ee-note-row"
                    :style="{ '--ue-clr': COLORS[Number(idx) % COLORS.length] }">
                    <div class="ee-note-stripe"></div>
                    <div class="ee-note-info">
                      <div class="ee-note-matiere">{{ ue.intitule }}</div>
                      <div class="ee-note-sub">Coeff. {{ ue.coefficient }}</div>
                    </div>
                    <div class="ee-note-bar-wrap">
                      <div class="ee-note-track">
                        <div class="ee-note-fill"
                          :style="{
                            width: ue.note !== null ? Math.min(100, ue.note/20*100)+'%' : '0%',
                            background: ue.note === null ? '#e5e7eb' : ue.note >= 14 ? '#10b981' : ue.note >= 10 ? '#f59e0b' : '#ef4444'
                          }"></div>
                      </div>
                    </div>
                    <div class="ee-note-badge"
                      :style="{
                        background: ue.note === null ? '#f3f4f6' : ue.note >= 14 ? '#dcfce7' : ue.note >= 10 ? '#fef9c3' : '#fee2e2',
                        color: ue.note === null ? '#9ca3af' : ue.note >= 14 ? '#15803d' : ue.note >= 10 ? '#92400e' : '#b91c1c'
                      }">
                      {{ ue.note !== null ? ue.note : '—' }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- UEs à rattraper -->
              <div v-if="uesARattraper.length > 0" class="ee-rattrapage-box">
                <div class="ee-rattrapage-title">⚠️ À rattraper ({{ uesARattraper.length }})</div>
                <div v-for="ue in uesARattraper" :key="ue.ue_id" class="ee-rat-row">
                  <div class="ee-rat-info">
                    <span class="ee-rat-name">{{ ue.intitule }}</span>
                    <span class="ee-rat-note">{{ ue.note }}/20</span>
                  </div>
                  <div class="ee-rat-track">
                    <div class="ee-rat-fill" :style="{ width: `${(ue.note/20)*100}%` }"></div>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- FI student: modules progression -->
          <div v-else id="notes" class="ee-card">
            <div class="ee-card-header">
              <div class="ee-card-header-left">
                <span class="ee-card-icon">📋</span>
                <h2 class="ee-card-title">Mes modules</h2>
              </div>
              <span class="ee-badge-count">{{ fi?.modules?.length ?? 0 }} modules</span>
            </div>
            <div class="ee-card-body">
              <div v-if="!fi?.modules?.length" class="ee-empty-state">
                <span>📭</span><p>Aucun module rattaché.</p>
              </div>
              <div v-else class="ee-notes-list">
                <div v-for="(mod, idx) in fi.modules" :key="mod.id"
                  class="ee-note-row"
                  :style="{ '--ue-clr': COLORS[Number(idx) % COLORS.length] }">
                  <div class="ee-note-stripe"></div>
                  <div class="ee-note-info">
                    <div class="ee-note-matiere">{{ mod.matiere_nom }}</div>
                    <div class="ee-note-sub">
                      {{ mod.heures_effectuees ?? 0 }}h / {{ mod.volume_horaire ?? 0 }}h
                      <span v-if="mod.enseignant_nom"> · {{ mod.enseignant_nom }}</span>
                    </div>
                  </div>
                  <div class="ee-note-bar-wrap">
                    <div class="ee-note-track">
                      <div class="ee-note-fill"
                        :style="{
                          width: mod.volume_horaire ? Math.min(100, ((mod.heures_effectuees ?? 0) / mod.volume_horaire) * 100) + '%' : '0%',
                          background: mod.volume_horaire && (mod.heures_effectuees ?? 0) >= mod.volume_horaire ? '#10b981' : '#3b82f6'
                        }"></div>
                    </div>
                  </div>
                  <div class="ee-note-badge"
                    :style="{
                      background: mod.volume_horaire && (mod.heures_effectuees ?? 0) >= mod.volume_horaire ? '#dcfce7' : '#dbeafe',
                      color: mod.volume_horaire && (mod.heures_effectuees ?? 0) >= mod.volume_horaire ? '#15803d' : '#1d4ed8'
                    }">
                    {{ mod.volume_horaire ? Math.round(((mod.heures_effectuees ?? 0) / mod.volume_horaire) * 100) : 0 }}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ══ FINANCES ══ -->
        <div v-show="activeTab === 'finances'" class="ee-section">
          <div id="finances" class="ee-card">
            <div class="ee-card-header">
              <div class="ee-card-header-left">
                <span class="ee-card-icon">💰</span>
                <h2 class="ee-card-title">Suivi financier</h2>
              </div>
              <span class="ee-badge-count" :style="{ background: progressionFinanciere === 100 ? '#dcfce7' : '#fef3c7', color: progressionFinanciere === 100 ? '#15803d' : '#b45309' }">
                {{ progressionFinanciere }}%
              </span>
            </div>
            <div class="ee-card-body">

              <!-- ── Dates clés ── -->
              <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;padding:12px 14px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">
                <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;">
                  <span>📅</span>
                  <span style="font-weight:600;color:#334155;">Début des cours :</span>
                  <span>{{ insc?.date_debut_cours ? new Date(insc.date_debut_cours).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—' }}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;">
                  <span>📋</span>
                  <span style="font-weight:600;color:#334155;">Date d'inscription :</span>
                  <span>{{ insc?.date_inscription ? new Date(insc.date_inscription).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—' }}</span>
                </div>
              </div>

              <!-- ── Classique ── -->
              <template v-if="!isFI">
                <!-- KPIs -->
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
                  <div style="background:#f8fafc;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:600;letter-spacing:.05em;margin-bottom:4px;">Total prévu</div>
                    <div style="font-size:18px;font-weight:800;color:#1e293b;">{{ fraisTotaux.toLocaleString('fr-FR') }} <span style="font-size:11px;font-weight:400;">F</span></div>
                  </div>
                  <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:10px;text-transform:uppercase;color:#16a34a;font-weight:600;letter-spacing:.05em;margin-bottom:4px;">Total payé</div>
                    <div style="font-size:18px;font-weight:800;color:#15803d;">{{ totalPaye.toLocaleString('fr-FR') }} <span style="font-size:11px;font-weight:400;">F</span></div>
                  </div>
                  <div :style="{ background: restantDu > 0 ? '#fef2f2' : '#f0fdf4', borderRadius:'10px', padding:'12px', textAlign:'center' }">
                    <div :style="{ fontSize:'10px', textTransform:'uppercase', fontWeight:'600', letterSpacing:'.05em', marginBottom:'4px', color: restantDu > 0 ? '#f87171' : '#16a34a' }">Reste dû</div>
                    <div :style="{ fontSize:'18px', fontWeight:'800', color: restantDu > 0 ? '#dc2626' : '#15803d' }">
                      {{ restantDu > 0 ? restantDu.toLocaleString('fr-FR') + ' F' : '✓ Soldé' }}
                    </div>
                  </div>
                </div>

                <!-- Barre de progression -->
                <div style="margin-bottom:18px;">
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:4px;">
                    <span>Avancement du paiement</span>
                    <strong>{{ progressionFinanciere }}%</strong>
                  </div>
                  <div style="background:#e2e8f0;border-radius:999px;height:8px;overflow:hidden;">
                    <div :style="{ width: progressionFinanciere + '%', height:'100%', borderRadius:'999px', background: progressionFinanciere === 100 ? '#16a34a' : progressionFinanciere >= 50 ? '#f59e0b' : '#ef4444', transition:'width .4s' }"></div>
                  </div>
                </div>

                <!-- Échéancier -->
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;" v-if="dashboardData.echeances?.length">
                  <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Échéancier</div>
                  <div style="overflow-x:auto;">
                    <table style="width:100%;font-size:12px;border-collapse:collapse;">
                      <thead>
                        <tr style="border-bottom:1px solid #f1f5f9;">
                          <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Mois</th>
                          <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Type</th>
                          <th style="text-align:right;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Montant</th>
                          <th style="text-align:center;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="ech in dashboardData.echeances" :key="ech.id" style="border-bottom:1px solid #f8fafc;">
                          <td style="padding:7px 8px;color:#334155;">{{ ech.mois ? new Date((ech.mois.length===7?ech.mois+'-01':ech.mois)).toLocaleDateString('fr-FR',{month:'long',year:'numeric'}) : '—' }}</td>
                          <td style="padding:7px 8px;">
                            <span :style="{ fontSize:'10px', padding:'2px 8px', borderRadius:'999px', background: ech.type_echeance==='frais_inscription'?'#eff6ff': ech.type_echeance==='tenue'?'#f5f3ff':'#f8fafc', color: ech.type_echeance==='frais_inscription'?'#2563eb': ech.type_echeance==='tenue'?'#7c3aed':'#475569' }">
                              {{ ech.type_echeance === 'frais_inscription' ? 'Inscription' : ech.type_echeance === 'tenue' ? 'Tenue' : ech.type_echeance === 'mensualite' ? 'Mensualité' : ech.type_echeance }}
                            </span>
                          </td>
                          <td style="padding:7px 8px;text-align:right;font-weight:600;color:#1e293b;">{{ Number(ech.montant).toLocaleString('fr-FR') }} F</td>
                          <td style="padding:7px 8px;text-align:center;">
                            <span :style="{ fontSize:'10px', padding:'2px 8px', borderRadius:'999px', fontWeight:'600', display:'inline-flex', alignItems:'center', gap:'4px', background: ech.statut==='paye'?'#f0fdf4':ech.statut==='partiel'?'#fffbeb':'#fef2f2', color: ech.statut==='paye'?'#15803d':ech.statut==='partiel'?'#b45309':'#dc2626' }">
                              {{ ech.statut === 'paye' ? '✓ Payé' : ech.statut === 'partiel' ? 'Partiel' : 'Non payé' }}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <!-- Historique paiements -->
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
                  <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Historique des paiements</div>
                  <div v-if="!dashboardData.paiements?.length" class="ee-empty-state"><span>📂</span><p>Aucun paiement enregistré</p></div>
                  <div v-else style="overflow-x:auto;">
                    <table style="width:100%;font-size:12px;border-collapse:collapse;">
                      <thead>
                        <tr style="border-bottom:1px solid #f1f5f9;">
                          <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Reçu</th>
                          <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Date</th>
                          <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Type</th>
                          <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Mode</th>
                          <th style="text-align:right;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Montant</th>
                          <th style="text-align:center;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-transform:uppercase;">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="p in dashboardData.paiements" :key="p.id" style="border-bottom:1px solid #f8fafc;">
                          <td style="padding:7px 8px;font-family:monospace;font-size:10px;color:#94a3b8;">{{ p.numero_recu }}</td>
                          <td style="padding:7px 8px;color:#475569;font-size:11px;">{{ new Date(p.confirmed_at ?? p.created_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }) }}</td>
                          <td style="padding:7px 8px;">
                            <span :style="{ fontSize:'10px', padding:'2px 8px', borderRadius:'999px', background: p.type_paiement==='frais_inscription'?'#eff6ff':p.type_paiement==='tenue'?'#f5f3ff':'#f8fafc', color: p.type_paiement==='frais_inscription'?'#2563eb':p.type_paiement==='tenue'?'#7c3aed':'#475569' }">
                              {{ p.type_paiement === 'frais_inscription' ? 'Inscription' : p.type_paiement === 'mensualite' ? 'Mensualité' : p.type_paiement === 'tenue' ? 'Tenue' : p.type_paiement }}
                            </span>
                          </td>
                          <td style="padding:7px 8px;color:#475569;font-size:11px;">{{ ({ especes:'Espèces', wave:'Wave', orange_money:'OM', virement:'Virement', cheque:'Chèque' } as any)[p.mode_paiement] ?? p.mode_paiement }}</td>
                          <td style="padding:7px 8px;text-align:right;font-weight:700;color:#16a34a;">+{{ Number(p.montant).toLocaleString('fr-FR') }} F</td>
                          <td style="padding:7px 8px;text-align:center;">
                            <span :style="{ fontSize:'10px', padding:'2px 8px', borderRadius:'999px', fontWeight:'600', background: p.statut==='confirme'?'#f0fdf4':p.statut==='en_attente'?'#fffbeb':'#fef2f2', color: p.statut==='confirme'?'#15803d':p.statut==='en_attente'?'#b45309':'#dc2626' }">
                              {{ p.statut === 'confirme' ? 'Confirmé' : p.statut === 'en_attente' ? 'En attente' : 'Rejeté' }}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </template>

              <!-- ── Formation Individuelle ── -->
              <template v-else>
                <!-- KPIs FI -->
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
                  <div style="background:#f8fafc;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:600;letter-spacing:.05em;margin-bottom:4px;">Coût total</div>
                    <div style="font-size:18px;font-weight:800;color:#1e293b;">{{ fraisTotaux.toLocaleString('fr-FR') }} <span style="font-size:11px;font-weight:400;">F</span></div>
                  </div>
                  <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:10px;text-transform:uppercase;color:#16a34a;font-weight:600;letter-spacing:.05em;margin-bottom:4px;">Total payé</div>
                    <div style="font-size:18px;font-weight:800;color:#15803d;">{{ totalPaye.toLocaleString('fr-FR') }} <span style="font-size:11px;font-weight:400;">F</span></div>
                  </div>
                  <div :style="{ background: restantDu > 0 ? '#fef2f2' : '#f0fdf4', borderRadius:'10px', padding:'12px', textAlign:'center' }">
                    <div :style="{ fontSize:'10px', textTransform:'uppercase', fontWeight:'600', letterSpacing:'.05em', marginBottom:'4px', color: restantDu > 0 ? '#f87171' : '#16a34a' }">Reste dû</div>
                    <div :style="{ fontSize:'18px', fontWeight:'800', color: restantDu > 0 ? '#dc2626' : '#15803d' }">
                      {{ restantDu > 0 ? restantDu.toLocaleString('fr-FR') + ' F' : '✓ Soldé' }}
                    </div>
                  </div>
                </div>

                <!-- Barre FI -->
                <div style="margin-bottom:18px;">
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:4px;">
                    <span>Avancement du paiement</span>
                    <strong>{{ progressionFinanciere }}%</strong>
                  </div>
                  <div style="background:#e2e8f0;border-radius:999px;height:8px;overflow:hidden;">
                    <div :style="{ width: progressionFinanciere + '%', height:'100%', borderRadius:'999px', background: progressionFinanciere === 100 ? '#16a34a' : progressionFinanciere >= 50 ? '#f59e0b' : '#ef4444', transition:'width .4s' }"></div>
                  </div>
                </div>

                <!-- Tranches FI -->
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
                  <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Tranches de paiement</div>
                  <div v-if="!fi?.paiements?.length" class="ee-empty-state"><span>📂</span><p>Aucun paiement enregistré</p></div>
                  <div v-else>
                    <div v-for="p in fi?.paiements ?? []" :key="p.id" style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9;">
                      <div>
                        <div style="font-size:12px;font-weight:600;color:#334155;">{{ p.type === 'inscription' ? 'Inscription' : p.type === 'tranche' ? 'Tranche' : p.type }}</div>
                        <div v-if="p.date_echeance" style="font-size:11px;color:#94a3b8;margin-top:2px;">Échéance : {{ new Date(p.date_echeance).toLocaleDateString('fr-FR') }}</div>
                      </div>
                      <div style="text-align:right;">
                        <div style="font-size:13px;font-weight:700;color:#1e293b;">{{ Number(p.montant_paye ?? 0).toLocaleString('fr-FR') }} / {{ Number(p.montant ?? 0).toLocaleString('fr-FR') }} F</div>
                        <span :style="{ fontSize:'10px', padding:'2px 8px', borderRadius:'999px', fontWeight:'600', marginTop:'3px', display:'inline-block', background: p.statut==='paye'?'#f0fdf4':p.statut==='partiel'?'#fffbeb':'#fef2f2', color: p.statut==='paye'?'#15803d':p.statut==='partiel'?'#b45309':'#dc2626' }">
                          {{ p.statut === 'paye' ? 'Payé' : p.statut === 'partiel' ? 'Partiel' : 'En attente' }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>

            </div>
          </div>
        </div>

        <!-- ══ ABSENCES ══ -->
        <div v-show="activeTab === 'absences'" class="ee-section">
          <!-- Loading -->
          <div v-if="loadingAbsences" style="display:flex;align-items:center;justify-content:center;padding:48px 0;gap:10px;color:#64748b;font-size:14px;">
            <svg class="ee-spin" style="width:20px;height:20px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            Chargement des absences…
          </div>

          <template v-else-if="absencesData">
            <!-- Alerte si trop d'absences injustifiées -->
            <div v-if="absencesData.stats?.alerte" style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;">
              <span style="font-size:20px;flex-shrink:0;">⚠️</span>
              <div>
                <div style="font-weight:700;color:#b91c1c;font-size:14px;">Alerte assiduité</div>
                <div style="color:#991b1b;font-size:13px;margin-top:2px;">
                  Vous avez <strong>{{ absencesData.stats.absent_injustifie }}</strong> absence(s) injustifiée(s).
                  Contactez l'administration pour régulariser votre situation.
                </div>
              </div>
            </div>

            <!-- Stats cards -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px;">
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:24px;font-weight:800;color:#16a34a;">{{ absencesData.stats.present }}</div>
                <div style="font-size:11px;color:#15803d;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Présences</div>
              </div>
              <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:24px;font-weight:800;color:#b45309;">{{ absencesData.stats.retard }}</div>
                <div style="font-size:11px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Retards</div>
              </div>
              <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:24px;font-weight:800;color:#d97706;">{{ absencesData.stats.absent_justifie }}</div>
                <div style="font-size:11px;color:#b45309;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Abs. justifiées</div>
              </div>
              <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:24px;font-weight:800;color:#dc2626;">{{ absencesData.stats.absent_injustifie }}</div>
                <div style="font-size:11px;color:#b91c1c;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Abs. injustifiées</div>
              </div>
            </div>

            <!-- Taux présence bar -->
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:13px;font-weight:600;color:#334155;">Taux de présence</span>
                <span style="font-size:14px;font-weight:800;" :style="{ color: absencesData.stats.taux_presence >= 80 ? '#16a34a' : absencesData.stats.taux_presence >= 60 ? '#d97706' : '#dc2626' }">
                  {{ absencesData.stats.taux_presence }}%
                </span>
              </div>
              <div style="height:8px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
                <div style="height:100%;border-radius:99px;transition:width 0.5s ease;"
                  :style="{ width: absencesData.stats.taux_presence + '%', background: absencesData.stats.taux_presence >= 80 ? '#22c55e' : absencesData.stats.taux_presence >= 60 ? '#f59e0b' : '#ef4444' }"></div>
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-top:6px;">{{ absencesData.stats.total }} séance(s) au total</div>
            </div>

            <!-- Liste des absences -->
            <div class="ee-card">
              <div class="ee-card-header">
                <div class="ee-card-header-left">
                  <span class="ee-card-icon">🚨</span>
                  <h3 class="ee-card-title">Historique des absences</h3>
                </div>
                <span class="ee-badge-count" :style="{ background: '#fee2e2', color: '#b91c1c' }">
                  {{ absencesData.absences?.length ?? 0 }}
                </span>
              </div>
              <div class="ee-card-body">
                <div v-if="!absencesData.absences?.length" class="ee-empty-state">
                  <span>✅</span><p>Aucune absence enregistrée — parfait !</p>
                </div>
                <div v-for="abs in absencesData.absences" :key="abs.id"
                  style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid #f1f5f9;">
                  <!-- Badge statut -->
                  <div style="flex-shrink:0;margin-top:2px;">
                    <span v-if="abs.statut === 'absent' && abs.justifie"
                      style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:99px;background:#fff7ed;color:#d97706;font-size:11px;font-weight:600;">
                      ✓ Justifiée
                    </span>
                    <span v-else-if="abs.statut === 'absent'"
                      style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:99px;background:#fef2f2;color:#dc2626;font-size:11px;font-weight:600;">
                      ✗ Absence
                    </span>
                    <span v-else
                      style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:99px;background:#fef9c3;color:#b45309;font-size:11px;font-weight:600;">
                      ⚠ Retard
                    </span>
                  </div>
                  <!-- Infos -->
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                      {{ abs.seance?.matiere ?? '—' }}
                    </div>
                    <div style="font-size:12px;color:#64748b;margin-top:2px;">
                      {{ abs.seance?.date_debut ? new Date(abs.seance.date_debut).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—' }}
                      <span v-if="abs.seance?.date_debut"> · {{ new Date(abs.seance.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</span>
                    </div>
                    <div v-if="abs.enseignant_nom" style="font-size:11px;color:#94a3b8;margin-top:1px;">
                      👤 {{ abs.enseignant_nom }}
                    </div>
                    <div v-if="abs.motif_justification" style="font-size:12px;color:#0369a1;margin-top:4px;padding:4px 8px;background:#eff6ff;border-radius:6px;">
                      💬 {{ abs.motif_justification }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <div v-else style="display:flex;align-items:center;justify-content:center;padding:48px 0;color:#94a3b8;font-size:14px;">
            Impossible de charger les absences.
          </div>
        </div>

      </div>

      <!-- ── COLONNE DROITE ─────────────────────────────────────────── -->
      <div class="ee-col-right">

        <!-- ASSIDUITÉ — SVG Circle Gauge -->
        <div id="assiduite" class="ee-card ee-card--side">
          <div class="ee-card-header">
            <div class="ee-card-header-left">
              <span class="ee-card-icon">📊</span>
              <h3 class="ee-card-title">Assiduité</h3>
            </div>
          </div>
          <div class="ee-card-body">
            <div class="ee-assiduite-gauge">
              <svg width="120" height="120" viewBox="0 0 100 100">
                <circle cx="50" cy="50" :r="RADIUS" fill="none" stroke="#f0f0f0" stroke-width="8"/>
                <circle cx="50" cy="50" :r="RADIUS" fill="none"
                  :stroke="assiduiteColor"
                  stroke-width="8"
                  stroke-linecap="round"
                  :stroke-dasharray="CIRC"
                  :stroke-dashoffset="assiduiteOffset"
                  transform="rotate(-90 50 50)"
                  style="transition: stroke-dashoffset 0.6s ease"/>
                <text x="50" y="46" text-anchor="middle" font-size="16" font-weight="800" :fill="assiduiteColor">
                  {{ dashboardData.presences.taux_presence }}%
                </text>
                <text x="50" y="60" text-anchor="middle" font-size="7" fill="#9ca3af">présence</text>
              </svg>
            </div>
            <!-- Barres détail -->
            <div class="ee-assiduite-detail">
              <div class="ee-abs-row">
                <div class="ee-abs-left">
                  <span class="ee-abs-dot" style="background:#22c55e;"></span>
                  <span class="ee-abs-lbl">Présent</span>
                </div>
                <div class="ee-abs-right">
                  <div class="ee-abs-track">
                    <div class="ee-abs-fill" style="background:#22c55e;"
                      :style="{ width: dashboardData.presences.total ? `${(dashboardData.presences.present/dashboardData.presences.total)*100}%` : '0%' }"></div>
                  </div>
                  <span class="ee-abs-count">{{ dashboardData.presences.present }}</span>
                </div>
              </div>
              <div class="ee-abs-row">
                <div class="ee-abs-left">
                  <span class="ee-abs-dot" style="background:#f59e0b;"></span>
                  <span class="ee-abs-lbl">Retard</span>
                </div>
                <div class="ee-abs-right">
                  <div class="ee-abs-track">
                    <div class="ee-abs-fill" style="background:#f59e0b;"
                      :style="{ width: dashboardData.presences.total ? `${(dashboardData.presences.retard/dashboardData.presences.total)*100}%` : '0%' }"></div>
                  </div>
                  <span class="ee-abs-count">{{ dashboardData.presences.retard }}</span>
                </div>
              </div>
              <div class="ee-abs-row">
                <div class="ee-abs-left">
                  <span class="ee-abs-dot" style="background:#ef4444;"></span>
                  <span class="ee-abs-lbl">Absent</span>
                </div>
                <div class="ee-abs-right">
                  <div class="ee-abs-track">
                    <div class="ee-abs-fill" style="background:#ef4444;"
                      :style="{ width: dashboardData.presences.total ? `${(dashboardData.presences.absent/dashboardData.presences.total)*100}%` : '0%' }"></div>
                  </div>
                  <span class="ee-abs-count">{{ dashboardData.presences.absent }}</span>
                </div>
              </div>
            </div>
            <div v-if="dashboardData.presences.absent >= 2" class="ee-abs-warning">
              ⚠️ {{ dashboardData.presences.absent }} absence(s) enregistrée(s). Au-delà de 3, une convocation peut être générée.
            </div>
          </div>
        </div>

        <!-- ANNONCES -->
        <div class="ee-card ee-card--side">
          <div class="ee-card-header">
            <div class="ee-card-header-left">
              <span class="ee-card-icon">📢</span>
              <h3 class="ee-card-title">Annonces</h3>
            </div>
            <span v-if="dashboardData.annonces?.length" class="ee-badge-count">{{ dashboardData.annonces.length }}</span>
          </div>
          <div class="ee-card-body">
            <div v-if="!dashboardData.annonces?.length" class="ee-empty-state">
              <span>🔔</span><p>Aucune annonce</p>
            </div>
            <div v-for="a in dashboardData.annonces" :key="a.id" class="ee-annonce">
              <div class="ee-annonce-header">
                <span class="ee-annonce-badge"
                  :style="{ background: typeBadgeStyle(a.type).bg, color: typeBadgeStyle(a.type).color }">
                  {{ typeLabel(a.type) }}
                </span>
                <span class="ee-annonce-time">{{ timeAgo(a.publie_at) }}</span>
              </div>
              <div class="ee-annonce-titre">{{ a.titre }}</div>
              <div v-if="a.contenu" class="ee-annonce-body">{{ a.contenu }}</div>
            </div>
          </div>
        </div>

        <!-- MESSAGES -->
        <div id="messages" class="ee-card ee-card--side">
          <div class="ee-card-header">
            <div class="ee-card-header-left">
              <span class="ee-card-icon">💬</span>
              <h3 class="ee-card-title">Messages</h3>
              <span v-if="totalUnread > 0" class="ee-unread-badge">{{ totalUnread }}</span>
            </div>
            <button class="ee-link" @click="openMessages">Ouvrir</button>
          </div>
          <div class="ee-card-body">
            <div v-if="!dashboardData.messages?.length" class="ee-empty-state">
              <span>📩</span><p>Aucun message</p>
            </div>
            <div v-for="conv in dashboardData.messages" :key="conv.id" class="ee-msg-preview-row" @click="openMessages">
              <div class="ee-msg-av" :style="{ background: COLORS[conv.id % COLORS.length] }">
                {{ avatarInitials(conv.nom || 'U') }}
              </div>
              <div class="ee-msg-pv-info">
                <div class="ee-msg-pv-name">{{ conv.nom || 'Conversation' }}</div>
                <div class="ee-msg-pv-text">{{ conv.dernier_message?.contenu || 'Nouveau message' }}</div>
              </div>
              <div v-if="conv.nb_non_lus > 0" class="ee-msg-unread">{{ conv.nb_non_lus }}</div>
            </div>
          </div>
        </div>

        <!-- DOCUMENTS -->
        <div id="documents" class="ee-card ee-card--side">
          <div class="ee-card-header">
            <div class="ee-card-header-left">
              <span class="ee-card-icon">📄</span>
              <h3 class="ee-card-title">Documents</h3>
            </div>
          </div>
          <div class="ee-card-body">
            <div v-if="!dashboardData.documents?.length" class="ee-empty-state">
              <span>📂</span><p>Aucun document</p>
            </div>
            <div v-for="doc in dashboardData.documents" :key="doc.id" class="ee-doc-row">
              <div class="ee-doc-icon">📄</div>
              <div class="ee-doc-info">
                <div class="ee-doc-nom">{{ doc.nom_fichier }}</div>
                <div class="ee-doc-meta">{{ doc.type_document }} · {{ new Date(doc.created_at).toLocaleDateString('fr-FR') }}</div>
              </div>
              <button class="ee-doc-dl">Télécharger</button>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- ══ BOTTOM NAV MOBILE ═════════════════════════════════════════ -->
    <div class="ee-bottom-nav">
      <button :class="['ee-bnav-item', mobileTab === 'accueil' && 'ee-bnav-item--active']" @click="setMobileTab('accueil')">
        <span class="ee-bnav-icon">🏠</span>
        <span class="ee-bnav-label">Accueil</span>
      </button>
      <button :class="['ee-bnav-item', mobileTab === 'planning' && 'ee-bnav-item--active']" @click="setMobileTab('planning')">
        <span class="ee-bnav-icon">📅</span>
        <span class="ee-bnav-label">Emploi</span>
      </button>
      <button :class="['ee-bnav-item', mobileTab === 'notes' && 'ee-bnav-item--active']" @click="setMobileTab('notes')">
        <span class="ee-bnav-icon">📋</span>
        <span class="ee-bnav-label">Notes</span>
      </button>
      <button :class="['ee-bnav-item', mobileTab === 'finances' && 'ee-bnav-item--active']" @click="setMobileTab('finances')">
        <span class="ee-bnav-icon">💰</span>
        <span class="ee-bnav-label">Compta</span>
      </button>
      <button :class="['ee-bnav-item', mobileTab === 'absences' && 'ee-bnav-item--active']" @click="setMobileTab('absences')">
        <span class="ee-bnav-icon">🚨</span>
        <span class="ee-bnav-label">Absences</span>
      </button>
      <button :class="['ee-bnav-item', mobileTab === 'plus' && 'ee-bnav-item--active']" @click="setMobileTab('plus')">
        <span class="ee-bnav-icon">⚙️</span>
        <span class="ee-bnav-label">Plus</span>
      </button>
    </div>

    <!-- ══ PANEL MESSAGERIE ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <div v-if="showMessages" class="msg-overlay" @click.self="showMessages=false">
        <div class="msg-panel">

          <!-- Header -->
          <div class="msg-panel-header">
            <div class="msg-panel-header-left">
              <span style="font-size:20px;">💬</span>
              <h2 class="msg-panel-title">Messagerie</h2>
              <span v-if="totalUnread > 0" class="ee-unread-badge">{{ totalUnread }}</span>
            </div>
            <button class="msg-close" @click="showMessages=false">✕</button>
          </div>

          <div class="msg-panel-body">

            <!-- Conversations -->
            <div class="msg-convs">
              <div v-if="loadingConvs" class="msg-loading">Chargement…</div>
              <div v-else-if="!conversations.length" class="msg-empty">Aucune conversation</div>
              <div v-for="conv in conversations" :key="conv.id"
                class="msg-conv-item"
                :class="{ 'msg-conv-item--active': selectedConv?.id === conv.id }"
                @click="selectConv(conv)">
                <div class="msg-conv-av" :style="{ background: COLORS[conv.id % COLORS.length] }">
                  {{ avatarInitials(conv.nom || 'G') }}
                </div>
                <div class="msg-conv-info">
                  <div class="msg-conv-name">{{ conv.nom || 'Conversation' }}</div>
                  <div class="msg-conv-preview">{{ conv.dernier_message?.contenu || '…' }}</div>
                </div>
                <div class="msg-conv-right">
                  <span v-if="conv.nb_non_lus > 0" class="ee-unread-badge">{{ conv.nb_non_lus }}</span>
                  <button class="msg-del-btn" @click.stop="deleteConversation(conv)" title="Supprimer">🗑</button>
                </div>
              </div>
            </div>

            <!-- Thread -->
            <div class="msg-thread">
              <div v-if="!selectedConv" class="msg-no-conv">
                <span>👈</span>
                <p>Sélectionnez une conversation</p>
              </div>
              <template v-else>
                <div class="msg-thread-header">
                  <div class="msg-thread-av" :style="{ background: COLORS[selectedConv.id % COLORS.length] }">
                    {{ avatarInitials(selectedConv.nom || 'G') }}
                  </div>
                  <strong class="msg-thread-name">{{ selectedConv.nom }}</strong>
                  <button class="msg-del-conv-btn" @click="deleteConversation(selectedConv)">🗑 Supprimer</button>
                </div>

                <div class="msg-messages" ref="msgThreadRef">
                  <div v-if="loadingMsgs" class="msg-loading">Chargement…</div>
                  <div v-else-if="!convMessages.length" class="msg-empty">Aucun message dans cette conversation</div>
                  <div v-for="msg in convMessages" :key="msg.id"
                    class="msg-bubble-wrap"
                    :class="{ 'msg-bubble-wrap--me': isMyMessage(msg) }">
                    <template v-if="!isMyMessage(msg)">
                      <div class="msg-bubble-av" :style="{ background: COLORS[(msg.sender?.id ?? 0) % COLORS.length] }">
                        {{ avatarInitials((msg.sender?.prenom ?? '') + ' ' + (msg.sender?.nom ?? '')) }}
                      </div>
                    </template>
                    <div class="msg-bubble-col" :class="{ 'msg-bubble-col--me': isMyMessage(msg) }">
                      <div class="msg-bubble-meta">
                        <span class="msg-bubble-sender">{{ isMyMessage(msg) ? 'Moi' : `${msg.sender?.prenom ?? ''} ${msg.sender?.nom ?? ''}` }}</span>
                        <span class="msg-bubble-time">{{ fmtMsgTime(msg.created_at) }}</span>
                        <button class="msg-del-msg" @click="deleteMessage(msg.id)" title="Supprimer">🗑</button>
                      </div>
                      <div class="msg-bubble" :class="{ 'msg-bubble--me': isMyMessage(msg) }">
                        {{ msg.contenu }}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Saisie -->
                <div class="msg-input-bar">
                  <input v-model="newMessage" class="msg-input"
                    placeholder="Écrire un message…"
                    @keydown.enter.prevent="sendMessage" />
                  <button class="msg-send" @click="sendMessage" :disabled="sendingMsg || !newMessage.trim()">
                    <span v-if="sendingMsg">…</span>
                    <span v-else>➤</span>
                  </button>
                </div>
              </template>
            </div>

          </div>
        </div>
      </div>
    </Teleport>

    <!-- ══ MA CARTE ÉTUDIANT (Canvas — carte seule) ══════════════════ -->
    <Teleport to="body">
      <div v-if="showCarteModal" class="card-overlay" @click.self="showCarteModal = false">
        <div class="card-bare">
          <button class="card-bare-close" @click="showCarteModal = false">✕</button>
          <p v-if="!cardGenerated" class="card-loading">Génération en cours…</p>
          <canvas ref="cardCanvas" class="card-canvas" />
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
/* ══════════════════════════════════════════════════════
   BASE
══════════════════════════════════════════════════════ */
.ee-page { width: 100%; box-sizing: border-box; overflow-x: hidden; }
.ee-no-data { display: flex; align-items: center; justify-content: center; height: 256px; }
.ee-no-data-inner { text-align: center; color: #888; font-size: 14px; display: flex; flex-direction: column; gap: 10px; }

/* ══════════════════════════════════════════════════════
   HERO
══════════════════════════════════════════════════════ */
.ee-hero {
  position: relative;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #1a0505 100%);
  border-radius: 16px;
  margin-bottom: 16px;
  overflow: hidden;
}
.ee-hero-bg {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 80% 50%, rgba(227,6,19,0.18) 0%, transparent 70%);
  pointer-events: none;
}
.ee-hero-content {
  position: relative;
  display: flex; align-items: center; justify-content: space-between;
  gap: 20px; padding: 24px 28px; flex-wrap: wrap;
}
.ee-hero-left { display: flex; align-items: center; gap: 18px; }
.ee-avatar {
  width: 64px; height: 64px; border-radius: 50%;
  background: linear-gradient(135deg, #E30613, #b91c1c);
  color: #fff; font-size: 22px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; box-shadow: 0 0 0 3px rgba(255,255,255,0.12);
}
.ee-hero-info { display: flex; flex-direction: column; gap: 4px; }
.ee-hero-greeting { font-size: 12px; color: rgba(255,255,255,0.5); margin: 0; }
.ee-hero-name { font-size: 22px; font-weight: 800; color: #fff; margin: 0; }
.ee-hero-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.ee-tag { font-size: 11.5px; font-weight: 600; padding: 3px 11px; border-radius: 20px; }
.ee-tag--primary { background: #E30613; color: #fff; }
.ee-tag--ghost { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); }

.ee-hero-kpis { display: flex; gap: 12px; }
.ee-kpi {
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 14px 18px; text-align: center; min-width: 72px;
}
.ee-kpi-val { font-size: 20px; font-weight: 800; color: #fff; }
.ee-kpi-lbl { font-size: 10.5px; color: rgba(255,255,255,0.45); margin-top: 4px; white-space: nowrap; }

/* Prochain cours dans hero */
.ee-hero-next {
  position: relative;
  border-top: 1px solid rgba(255,255,255,0.08);
  padding: 12px 28px;
  display: flex; align-items: center; gap: 16px;
}
.ee-hero-next-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px; white-space: nowrap; }
.ee-hero-next-info { display: flex; align-items: center; gap: 12px; flex: 1; flex-wrap: wrap; }
.ee-hero-next-icon { font-size: 16px; }
.ee-hero-next-name { font-size: 14px; font-weight: 700; color: #fff; }
.ee-hero-next-time { font-size: 12px; color: rgba(255,255,255,0.5); }
.ee-hero-next-countdown {
  font-size: 12px; font-weight: 700; color: #fbbf24;
  background: rgba(251,191,36,0.12); border-radius: 20px; padding: 2px 10px;
}

/* ══════════════════════════════════════════════════════
   ALERT
══════════════════════════════════════════════════════ */
.ee-alert-pay {
  display: flex; align-items: center; gap: 14px;
  background: #fef2f2; border: 1px solid #fecaca;
  border-radius: 12px; padding: 14px 18px; margin-bottom: 14px;
}
.ee-alert-pay-icon { font-size: 22px; flex-shrink: 0; }
.ee-alert-pay-body { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.ee-alert-pay-body strong { font-size: 14px; font-weight: 700; color: #b91c1c; }
.ee-alert-pay-body span { font-size: 12.5px; color: #dc2626; }
.ee-alert-pay-btn {
  background: #E30613; color: #fff; font-size: 13px; font-weight: 700;
  padding: 8px 16px; border-radius: 8px; text-decoration: none; flex-shrink: 0;
  transition: opacity .15s;
}
.ee-alert-pay-btn:hover { opacity: .85; }

/* ══════════════════════════════════════════════════════
   QUICK ACTIONS
══════════════════════════════════════════════════════ */
.ee-quick-actions {
  display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap;
}
.ee-qa {
  flex: 1; min-width: 80px;
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 12px 10px;
  background: #fff; border: 1.5px solid #e5e7eb; border-radius: 12px;
  font-size: 12px; font-weight: 600; color: #374151; cursor: pointer;
  transition: all .15s; position: relative;
}
.ee-qa:hover { border-color: #E30613; color: #E30613; background: #fff5f5; }
.ee-qa-icon { font-size: 22px; }
.ee-qa-badge {
  position: absolute; top: 6px; right: 6px;
  background: #E30613; color: #fff; font-size: 10px; font-weight: 700;
  width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}

/* ══════════════════════════════════════════════════════
   GRILLE
══════════════════════════════════════════════════════ */
.ee-grid { display: grid; grid-template-columns: 1fr 290px; gap: 18px; }
.ee-col-left { display: flex; flex-direction: column; gap: 16px; }
.ee-col-right { display: flex; flex-direction: column; gap: 14px; }
.ee-section { display: flex; flex-direction: column; gap: 14px; }

/* Tabs (masqués sur desktop) */
.ee-tabs { display: none; gap: 6px; background: #f8fafc; border-radius: 10px; padding: 4px; }
.ee-tab {
  flex: 1; padding: 8px; border: none; background: transparent;
  border-radius: 7px; font-size: 13px; font-weight: 600; color: #6b7280; cursor: pointer;
}
.ee-tab--active { background: #fff; color: #E30613; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }

/* ══════════════════════════════════════════════════════
   CARDS
══════════════════════════════════════════════════════ */
.ee-card { background: #fff; border-radius: 12px; border: 1px solid #f0f0f0; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
.ee-card--side {}
.ee-card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid #f4f4f5;
}
.ee-card-header-left { display: flex; align-items: center; gap: 8px; }
.ee-card-icon { font-size: 16px; }
.ee-card-title { font-size: 14px; font-weight: 700; color: #111; margin: 0; }
.ee-card-body { padding: 16px 18px; }
.ee-badge-count { font-size: 11px; font-weight: 700; background: #f3f4f6; color: #6b7280; padding: 2px 10px; border-radius: 20px; }
.ee-link { font-size: 12.5px; color: #E30613; font-weight: 600; background: none; border: none; cursor: pointer; }
.ee-link:hover { text-decoration: underline; }

/* Empty state */
.ee-empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 24px 0; color: #94a3b8; font-size: 13px; text-align: center;
}
.ee-empty-state span { font-size: 32px; }

/* ══════════════════════════════════════════════════════
   PROCHAIN COURS CARD
══════════════════════════════════════════════════════ */
.ee-next-course-card {
  border-radius: 12px; padding: 16px 18px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  color: #fff;
}
.ee-nc-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.ee-nc-icon { font-size: 28px; flex-shrink: 0; }
.ee-nc-matiere { font-size: 16px; font-weight: 800; margin-bottom: 3px; }
.ee-nc-meta { font-size: 12px; opacity: .75; margin-bottom: 3px; }
.ee-nc-time { font-size: 12px; opacity: .65; }
.ee-nc-countdown { text-align: right; flex-shrink: 0; }
.ee-nc-cd-val { font-size: 20px; font-weight: 800; }
.ee-nc-cd-lbl { font-size: 11px; opacity: .65; margin-top: 2px; }

/* ══════════════════════════════════════════════════════
   SÉANCES
══════════════════════════════════════════════════════ */
.ee-day-group { margin-bottom: 14px; }
.ee-day-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1.5px solid #f1f5f9;
}
.ee-day-header--today { border-color: #E30613; }
.ee-day-label {
  font-size: 11px; font-weight: 700; color: #1e293b; text-transform: uppercase; letter-spacing: .05em;
}
.ee-day-header--today .ee-day-label { color: #E30613; }
.ee-day-dot {
  width: 20px; height: 20px; border-radius: 50%; background: #f1f5f9;
  font-size: 11px; font-weight: 700; color: #6b7280;
  display: flex; align-items: center; justify-content: center;
}

.ee-seance {
  display: flex; align-items: stretch; gap: 0;
  background: #f8fafc; border-radius: 10px; margin-bottom: 8px;
  border: 1px solid #f1f5f9;
  transition: transform .12s, box-shadow .12s;
  overflow: hidden;
}
.ee-seance:hover { transform: translateX(2px); box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
.ee-seance--now { border-color: #bfdbfe; background: #eff6ff; }
.ee-seance--past { opacity: .85; }
.ee-seance--open { opacity: 1; box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
.ee-seance-stripe { width: 4px; background: var(--clr, #6366f1); flex-shrink: 0; }

.ee-seance-main-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; flex: 1; }
.ee-seance-time-col { padding: 10px 14px; text-align: center; width: 52px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ee-seance-body { flex: 1; min-width: 0; padding: 10px 0; }
.ee-seance-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; padding: 10px 14px; flex-shrink: 0; }

/* (used for future sessions - not past) */
.ee-seance:not(.ee-seance--past) .ee-seance-time-col,
.ee-seance:not(.ee-seance--past) .ee-seance-body,
.ee-seance:not(.ee-seance--past) .ee-seance-right {
  padding: 10px 0;
}
.ee-seance:not(.ee-seance--past) .ee-seance-time-col { padding-left: 0; padding-right: 0; }
/* fix layout for future seances */
.ee-seance:not(.ee-seance--past) {
  padding: 10px 14px 10px 0;
  display: flex; align-items: center; gap: 12px;
}
.ee-seance:not(.ee-seance--past) .ee-seance-stripe { align-self: stretch; height: auto; }

.ee-s-time { font-size: 13px; font-weight: 700; color: #111; }
.ee-s-dur { font-size: 10px; color: #94a3b8; font-weight: 600; margin-top: 2px; }
.ee-s-matiere { font-size: 13px; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ee-s-meta { font-size: 11.5px; color: #64748b; margin-top: 2px; }

.ee-mode-chip {
  font-size: 10.5px; font-weight: 700; color: #fff;
  padding: 3px 9px; border-radius: 20px; white-space: nowrap;
}
.ee-chip {
  font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px; white-space: nowrap;
}
.ee-chip--green { background: #dcfce7; color: #15803d; }
.ee-chip--blue { background: #dbeafe; color: #1d4ed8; }
.ee-chip--gray { background: #f3f4f6; color: #6b7280; }

.ee-expand-chevron { font-size: 10px; color: #9ca3af; cursor: pointer; }

/* Accordéon contenu séance */
.ee-seance-detail {
  margin: 0 14px 12px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #f8faff, #f0fdf4);
  border-radius: 10px; border: 1px solid #e0e7ff;
  display: flex; flex-direction: column; gap: 12px;
}
.ee-detail-block { display: flex; flex-direction: column; gap: 4px; }
.ee-detail-label { font-size: 10.5px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: .06em; }
.ee-detail-text { font-size: 13px; color: #1e293b; line-height: 1.6; white-space: pre-wrap; }
.ee-rich-text { white-space: normal; }
.ee-rich-text p { margin: 0 0 6px; }
.ee-rich-text ul, .ee-rich-text ol { margin: 0 0 6px; padding-left: 20px; }
.ee-rich-text li { margin-bottom: 2px; }
.ee-rich-text strong, .ee-rich-text b { font-weight: 700; }
.ee-rich-text em, .ee-rich-text i { font-style: italic; }
.ee-rich-text h1, .ee-rich-text h2, .ee-rich-text h3 { font-weight: 700; margin: 4px 0; }
.ee-detail-empty { font-size: 12px; color: #9ca3af; font-style: italic; text-align: center; }

/* ── Avis qualité ── */
.ee-avis-block {
  border-top: 1px dashed #c7d2fe;
  padding-top: 12px;
  margin-top: 2px;
}
.ee-avis-done {
  font-size: 12.5px; color: #15803d; font-weight: 600;
  background: #dcfce7; border-radius: 6px; padding: 8px 12px;
  text-align: center;
}
.ee-avis-title {
  font-size: 11.5px; font-weight: 700; color: #4f46e5;
  text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px;
}
.ee-avis-hint { font-weight: 400; color: #9ca3af; text-transform: none; font-size: 10.5px; }
.ee-stars { display: flex; gap: 4px; margin-bottom: 8px; }
.ee-star {
  font-size: 24px; background: none; border: none; cursor: pointer;
  color: #d1d5db; transition: color .15s, transform .1s;
  padding: 0; line-height: 1;
}
.ee-star--on { color: #f59e0b; }
.ee-star:hover { transform: scale(1.2); color: #f59e0b; }
.ee-avis-textarea {
  width: 100%; box-sizing: border-box;
  border: 1px solid #c7d2fe; border-radius: 8px;
  padding: 8px 10px; font-size: 12.5px; resize: vertical;
  outline: none; background: #fff; color: #1e293b;
  transition: border-color .15s;
}
.ee-avis-textarea:focus { border-color: #6366f1; }
.ee-avis-submit {
  margin-top: 8px; padding: 7px 18px;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff; border: none; border-radius: 8px;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: opacity .15s;
}
.ee-avis-submit:disabled { opacity: .45; cursor: not-allowed; }

/* ══════════════════════════════════════════════════════
   NOTES
══════════════════════════════════════════════════════ */
.ee-notes-kpis {
  display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-bottom: 14px;
}
.ee-nk {
  background: linear-gradient(135deg, #1e293b, #334155);
  border-radius: 12px; padding: 14px; text-align: center;
}
.ee-nk--main { background: linear-gradient(135deg, #E30613, #c0050f); }
.ee-nk-val { font-size: 26px; font-weight: 800; color: #fff; }
.ee-nk-lbl { font-size: 10.5px; color: rgba(255,255,255,0.55); margin-top: 3px; }
.ee-mention-pill { font-size: 11px; font-weight: 700; background: linear-gradient(135deg, #E30613, #c0050f); color: #fff; padding: 3px 12px; border-radius: 20px; }

.ee-jury-banner {
  display: flex; align-items: center; gap: 10px;
  border-radius: 10px; padding: 12px 16px; margin-bottom: 14px;
  font-size: 13px; font-weight: 700;
}
.ee-jury-icon { font-size: 16px; }
.ee-jury-text { font-weight: 800; }
.ee-jury-hint { font-size: 11px; font-weight: 400; opacity: .7; margin-left: auto; }

.ee-notes-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.ee-note-row {
  display: flex; align-items: center; gap: 10px;
  background: #f8fafc; border-radius: 10px; overflow: hidden;
  border: 1px solid #f1f5f9;
}
.ee-note-stripe { width: 4px; background: var(--ue-clr, #6366f1); align-self: stretch; flex-shrink: 0; }
.ee-note-info { flex: 1; min-width: 0; padding: 10px 0; }
.ee-note-matiere { font-size: 13px; font-weight: 600; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ee-note-sub { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }
.ee-note-bar-wrap { width: 100px; flex-shrink: 0; }
.ee-note-track { height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.ee-note-fill { height: 100%; border-radius: 999px; transition: width .4s ease; }
.ee-note-badge {
  width: 44px; height: 44px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 800; margin-right: 10px;
}

/* UEs à rattraper */
.ee-rattrapage-box {
  background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px;
  padding: 12px 14px; margin-top: 4px;
}
.ee-rattrapage-title { font-size: 11px; font-weight: 700; color: #c2410c; margin-bottom: 10px; text-transform: uppercase; letter-spacing: .05em; }
.ee-rat-row { margin-bottom: 8px; }
.ee-rat-info { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
.ee-rat-name { color: #7c2d12; font-weight: 600; }
.ee-rat-note { color: #E30613; font-weight: 700; }
.ee-rat-track { height: 6px; background: #fed7aa; border-radius: 3px; overflow: hidden; }
.ee-rat-fill { height: 100%; background: #ef4444; border-radius: 3px; }

/* ══════════════════════════════════════════════════════
   FINANCES
══════════════════════════════════════════════════════ */
.ee-fin-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 14px; }
.ee-fin-stat { background: #f9fafb; border-radius: 10px; padding: 12px; text-align: center; }
.ee-fin-stat--green { background: #f0fdf4; }
.ee-fin-stat--red { background: #fef2f2; }
.ee-fin-val { font-size: 16px; font-weight: 700; color: #111; }
.ee-fin-lbl { font-size: 10.5px; color: #888; margin-top: 4px; }

.ee-fin-progress-wrap { margin-bottom: 16px; }
.ee-fin-progress-header { display: flex; justify-content: space-between; font-size: 12.5px; color: #555; margin-bottom: 6px; }
.ee-fin-progress-track { height: 8px; background: #f1f5f9; border-radius: 999px; overflow: hidden; }
.ee-fin-progress-fill { height: 100%; border-radius: 999px; transition: width .5s ease; }

.ee-pay-list { display: flex; flex-direction: column; gap: 8px; }
.ee-pay-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; background: #f9fafb; border-radius: 10px;
}
.ee-pay-left { display: flex; flex-direction: column; gap: 2px; }
.ee-pay-type { font-size: 13px; font-weight: 700; color: #111; }
.ee-pay-num { font-size: 10.5px; color: #9ca3af; font-family: monospace; }
.ee-pay-mois { font-size: 10.5px; color: #64748b; }
.ee-pay-right { display: flex; align-items: center; gap: 8px; }
.ee-pay-amount { font-size: 14px; font-weight: 800; color: #111; }
.ee-pay-statut { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
.ee-print-btn {
  border: 1px solid #e5e7eb; background: #fff; border-radius: 7px;
  padding: 5px 7px; cursor: pointer; color: #555; font-size: 14px;
  transition: background .15s;
}
.ee-print-btn:hover { background: #f5f5f5; }

/* ══════════════════════════════════════════════════════
   ASSIDUITÉ
══════════════════════════════════════════════════════ */
.ee-assiduite-gauge { display: flex; justify-content: center; margin-bottom: 14px; }
.ee-assiduite-detail { display: flex; flex-direction: column; gap: 8px; }
.ee-abs-row { display: flex; align-items: center; gap: 8px; }
.ee-abs-left { display: flex; align-items: center; gap: 6px; width: 68px; flex-shrink: 0; }
.ee-abs-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ee-abs-lbl { font-size: 12.5px; color: #555; }
.ee-abs-right { display: flex; align-items: center; gap: 6px; flex: 1; }
.ee-abs-track { flex: 1; height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; }
.ee-abs-fill { height: 100%; border-radius: 3px; transition: width .4s ease; }
.ee-abs-count { font-size: 11.5px; color: #94a3b8; font-weight: 600; width: 24px; text-align: right; }
.ee-abs-warning { margin-top: 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #92400e; }

/* ══════════════════════════════════════════════════════
   ANNONCES
══════════════════════════════════════════════════════ */
.ee-annonce { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #f4f4f5; }
.ee-annonce:last-child { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
.ee-annonce-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.ee-annonce-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
.ee-annonce-time { font-size: 10.5px; color: #94a3b8; }
.ee-annonce-titre { font-size: 14px; font-weight: 700; color: #111; line-height: 1.4; }
.ee-annonce-body { font-size: 13px; color: #334155; margin-top: 4px; line-height: 1.6; }

/* ══════════════════════════════════════════════════════
   MESSAGES PREVIEW
══════════════════════════════════════════════════════ */
.ee-unread-badge {
  background: #E30613; color: #fff; font-size: 10px; font-weight: 700;
  min-width: 18px; height: 18px; border-radius: 20px; padding: 0 5px;
  display: flex; align-items: center; justify-content: center;
}
.ee-msg-preview-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; border-radius: 10px; cursor: pointer; transition: background .12s;
  margin-bottom: 4px;
}
.ee-msg-preview-row:hover { background: #f9fafb; }
.ee-msg-av {
  width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 12px; font-weight: 700;
}
.ee-msg-pv-info { flex: 1; min-width: 0; }
.ee-msg-pv-name { font-size: 13px; font-weight: 700; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ee-msg-pv-text { font-size: 12px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ee-msg-unread {
  min-width: 20px; height: 20px; background: #E30613; border-radius: 10px;
  font-size: 10px; font-weight: 700; color: #fff; padding: 0 5px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}

/* ══════════════════════════════════════════════════════
   DOCUMENTS
══════════════════════════════════════════════════════ */
.ee-doc-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding: 10px 12px; background: #f9fafb; border-radius: 8px; }
.ee-doc-icon { font-size: 20px; flex-shrink: 0; }
.ee-doc-info { flex: 1; min-width: 0; }
.ee-doc-nom { font-size: 13px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ee-doc-meta { font-size: 11.5px; color: #888; margin-top: 2px; }
.ee-doc-dl { font-size: 12px; background: #e5e7eb; color: #444; border: none; border-radius: 7px; padding: 6px 12px; cursor: pointer; flex-shrink: 0; }
.ee-doc-dl:hover { background: #d1d5db; }

/* ══════════════════════════════════════════════════════
   PANEL MESSAGERIE
══════════════════════════════════════════════════════ */
.msg-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  z-index: 9999; display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
  animation: fadeIn .15s ease;
}
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }

.msg-panel {
  background: #fff; border-radius: 16px;
  width: 880px; max-width: 95vw; height: 80vh; max-height: 680px;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  animation: slideUp .2s ease;
}
@keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }

.msg-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid #f0f0f0;
  background: linear-gradient(135deg, #1e293b, #0f172a);
}
.msg-panel-header-left { display: flex; align-items: center; gap: 10px; }
.msg-panel-title { font-size: 16px; font-weight: 800; color: #fff; margin: 0; }
.msg-close {
  width: 32px; height: 32px; border-radius: 50%; border: none;
  background: rgba(255,255,255,0.1); color: #fff; font-size: 14px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.msg-close:hover { background: rgba(255,255,255,0.2); }

.msg-panel-body { display: flex; flex: 1; overflow: hidden; }

/* Liste conversations */
.msg-convs {
  width: 260px; flex-shrink: 0; border-right: 1px solid #f4f4f5;
  overflow-y: auto; display: flex; flex-direction: column;
}
.msg-loading { padding: 16px; text-align: center; color: #94a3b8; font-size: 13px; }
.msg-empty { padding: 24px 16px; text-align: center; color: #94a3b8; font-size: 13px; }

.msg-conv-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; cursor: pointer; transition: background .12s;
  border-bottom: 1px solid #f9fafb;
}
.msg-conv-item:hover { background: #f9fafb; }
.msg-conv-item--active { background: #fff5f5; border-left: 3px solid #E30613; }
.msg-conv-av { width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 12px; font-weight: 700; }
.msg-conv-info { flex: 1; min-width: 0; }
.msg-conv-name { font-size: 13px; font-weight: 700; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msg-conv-preview { font-size: 11.5px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msg-conv-right { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
.msg-del-btn { background: none; border: none; font-size: 14px; cursor: pointer; padding: 2px; opacity: .5; transition: opacity .15s; }
.msg-del-btn:hover { opacity: 1; }

/* Thread */
.msg-thread { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.msg-no-conv { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #94a3b8; font-size: 14px; }
.msg-no-conv span { font-size: 36px; }

.msg-thread-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px; border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}
.msg-thread-av { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 12px; font-weight: 700; flex-shrink: 0; }
.msg-thread-name { font-size: 14px; font-weight: 700; color: #111; flex: 1; }
.msg-del-conv-btn {
  font-size: 12px; font-weight: 600; color: #E30613;
  background: #fff0f0; border: 1px solid #fecaca; border-radius: 7px;
  padding: 5px 12px; cursor: pointer; transition: background .15s;
}
.msg-del-conv-btn:hover { background: #fee2e2; }

/* Messages thread */
.msg-messages { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }

.msg-bubble-wrap { display: flex; align-items: flex-end; gap: 8px; }
.msg-bubble-wrap--me { flex-direction: row-reverse; }
.msg-bubble-av { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; font-weight: 700; margin-bottom: 18px; }
.msg-bubble-col { display: flex; flex-direction: column; gap: 3px; max-width: 65%; }
.msg-bubble-col--me { align-items: flex-end; }
.msg-bubble-meta { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: #9ca3af; }
.msg-bubble-col--me .msg-bubble-meta { flex-direction: row-reverse; }
.msg-bubble-sender { font-weight: 600; color: #64748b; }
.msg-del-msg { background: none; border: none; font-size: 12px; cursor: pointer; opacity: .4; transition: opacity .12s; }
.msg-del-msg:hover { opacity: 1; }

.msg-bubble {
  padding: 10px 14px; border-radius: 16px;
  font-size: 13.5px; line-height: 1.5; color: #1e293b;
  background: #f1f5f9; border-bottom-left-radius: 4px;
  word-break: break-word;
}
.msg-bubble--me {
  background: linear-gradient(135deg, #E30613, #c0050f);
  color: #fff; border-bottom-left-radius: 16px; border-bottom-right-radius: 4px;
}

/* Saisie */
.msg-input-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 18px; border-top: 1px solid #f0f0f0;
  background: #fff;
}
.msg-input {
  flex: 1; border: 1.5px solid #e5e7eb; border-radius: 24px;
  padding: 10px 16px; font-size: 13.5px; outline: none;
  transition: border-color .15s;
}
.msg-input:focus { border-color: #E30613; }
.msg-send {
  width: 42px; height: 42px; border-radius: 50%; border: none;
  background: linear-gradient(135deg, #E30613, #c0050f);
  color: #fff; font-size: 16px; cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: opacity .15s;
}
.msg-send:disabled { opacity: .4; cursor: not-allowed; }
.msg-send:not(:disabled):hover { opacity: .88; }

/* ══════════════════════════════════════════════════════
   BOTTOM NAV (masqué desktop, visible mobile)
══════════════════════════════════════════════════════ */
.ee-bottom-nav { display: none; }
.ee-mobile-today { display: none; }
.ee-mobile-plus { display: none; }
.ee-m-alert { display: none; }

/* ══════════════════════════════════════════════════════
   RESPONSIVE — TABLETTE (≤ 900px)
══════════════════════════════════════════════════════ */
@media (max-width: 900px) {
  .ee-grid { grid-template-columns: 1fr; }
  .ee-col-right { order: -1; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .ee-hero-kpis { display: grid; grid-template-columns: repeat(4,1fr); width: 100%; gap: 8px; }
  .ee-kpi { min-width: unset; }
}

/* ══════════════════════════════════════════════════════
   RESPONSIVE — TÉLÉPHONE (≤ 640px)
══════════════════════════════════════════════════════ */
@media (max-width: 640px) {
  /* ── Mobile-hide helper ── */
  .ee-mobile-hide { display: none !important; }

  /* ── Page padding for bottom nav ── */
  .ee-page { padding-bottom: 62px; }

  /* ── Bottom nav visible ── */
  .ee-bottom-nav {
    display: flex; justify-content: space-around; align-items: center;
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 90;
    background: linear-gradient(180deg, #0d1117 0%, #111827 100%);
    border-top: 1px solid rgba(255,255,255,0.06);
    padding: 6px 0 max(8px, env(safe-area-inset-bottom));
  }
  .ee-bnav-item {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: none; border: none; cursor: pointer;
    padding: 4px 0; opacity: 0.45; transition: opacity 0.15s;
    position: relative;
  }
  .ee-bnav-item--active { opacity: 1; }
  .ee-bnav-item--active::after {
    content: ''; position: absolute; top: -6px; left: 50%; transform: translateX(-50%);
    width: 20px; height: 2.5px; border-radius: 2px; background: #E30613;
  }
  .ee-bnav-icon { font-size: 22px; line-height: 1.2; }
  .ee-bnav-label { font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.55); }
  .ee-bnav-item--active .ee-bnav-label { color: #fff; }

  /* ── Mobile alert masquée sur desktop ── */
  .ee-m-alert { display: block; }
  .ee-alert-desktop { display: none !important; }

  /* ── Mobile: Alerte paiement redesign — minimaliste fond clair ── */
  .ee-m-alert { margin: 10px 0 0; }
  .ee-m-alert-card {
    background: #fff; border: 1px solid #fecaca;
    border-radius: 12px; padding: 12px 14px;
    display: flex; align-items: center; gap: 12px;
  }
  .ee-m-alert-top {
    display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
  }
  .ee-m-alert-icon-wrap {
    width: 36px; height: 36px; border-radius: 10px;
    background: #fef2f2;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .ee-m-alert-icon { font-size: 16px; }
  .ee-m-alert-icon-svg { width: 20px; height: 20px; color: #b91c1c; }
  .ee-m-alert-info { display: flex; flex-direction: column; min-width: 0; }
  .ee-m-alert-label {
    font-size: 10px; font-weight: 600; color: #b91c1c;
  }
  .ee-m-alert-amount {
    font-size: 15px; font-weight: 800; color: #E30613; line-height: 1.2;
  }
  .ee-m-alert-amount small { font-size: 10px; font-weight: 600; color: #94a3b8; }

  .ee-m-alert-progress { display: none; }

  .ee-m-alert-btn {
    padding: 7px 14px; flex-shrink: 0;
    background: #E30613; color: #fff; border: none;
    border-radius: 8px; font-size: 11px; font-weight: 700;
    cursor: pointer; white-space: nowrap;
  }
  .ee-m-alert-btn:active { opacity: 0.85; }

  /* ── Mobile Today section visible ── */
  .ee-mobile-today { display: block; padding: 0; }
  .ee-mobile-plus { display: block; padding: 0; }

  /* ── Mobile: prochain cours compact ── */
  .ee-m-next {
    margin: 10px 0 0; border-radius: 12px; padding: 12px 14px;
    color: #fff; display: flex; align-items: center; justify-content: space-between;
    box-shadow: 0 4px 14px rgba(0,0,0,0.12);
  }
  .ee-m-next-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  .ee-m-next-icon { font-size: 22px; flex-shrink: 0; }
  .ee-m-next-info { min-width: 0; }
  .ee-m-next-label { font-size: 8px; font-weight: 700; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; }
  .ee-m-next-name { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ee-m-next-time { font-size: 10px; opacity: 0.75; font-weight: 500; }
  .ee-m-next-cd { text-align: right; flex-shrink: 0; padding-left: 8px; }
  .ee-m-next-cd-val { font-size: 14px; font-weight: 800; }

  /* ── Mobile: section header ── */
  .ee-m-section-header {
    display: flex; justify-content: space-between; align-items: center;
    margin: 12px 0 6px; padding: 0;
  }
  .ee-m-section-title { font-size: 12px; font-weight: 700; color: #334155; }
  .ee-m-section-link { font-size: 11px; font-weight: 600; color: #E30613; background: none; border: none; cursor: pointer; }
  .ee-m-section-count { font-size: 10px; font-weight: 700; background: #f3f4f6; color: #6b7280; padding: 1px 8px; border-radius: 10px; }

  /* ── Mobile: today card ── */
  .ee-m-today-card {
    background: #fff; border-radius: 12px; border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(15,23,42,0.06); overflow: hidden;
  }
  .ee-m-today-row {
    display: flex; align-items: center; padding: 10px 14px; gap: 10px;
    border-bottom: 1px solid #f1f5f9;
  }
  .ee-m-today-row:last-child { border-bottom: none; }
  .ee-m-today-icon {
    width: 32px; height: 32px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; flex-shrink: 0;
  }
  .ee-m-today-info { flex: 1; min-width: 0; }
  .ee-m-today-name { font-size: 13px; font-weight: 600; color: #0f172a; line-height: 1.3; }
  .ee-m-today-sub { font-size: 11px; color: #64748b; font-weight: 500; margin-top: 2px; }
  .ee-m-today-badge { flex-shrink: 0; }
  .ee-m-badge { font-size: 10px; font-weight: 700; padding: 3px 9px; border-radius: 10px; white-space: nowrap; }
  .ee-m-today-empty { padding: 20px; text-align: center; color: #94a3b8; font-size: 12px; }

  /* Annonces mobile — slider */
  .ee-m-annonce-slider {
    background: #fff; border-radius: 12px; border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(15,23,42,0.06); overflow: hidden;
  }
  .ee-m-annonce-slide { padding: 14px 16px; }
  .ee-m-annonce-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .ee-m-annonce-time { font-size: 10px; color: #94a3b8; }
  .ee-m-annonce-titre { font-size: 14px; font-weight: 700; color: #0f172a; line-height: 1.4; }
  .ee-m-annonce-body {
    font-size: 13px; color: #334155; line-height: 1.6; margin-top: 6px;
  }
  .ee-m-annonce-nav {
    display: flex; align-items: center; justify-content: center; gap: 14px;
    padding: 8px 16px 12px; border-top: 1px solid #f1f5f9;
  }
  .ee-m-annonce-arrow {
    width: 28px; height: 28px; border-radius: 50%; border: 1px solid #e2e8f0;
    background: #fff; color: #475569; font-size: 12px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.12s;
  }
  .ee-m-annonce-arrow:active { background: #f1f5f9; border-color: #E30613; color: #E30613; }
  .ee-m-annonce-dots { display: flex; gap: 6px; }
  .ee-m-annonce-dot {
    width: 7px; height: 7px; border-radius: 50%; background: #e2e8f0;
    cursor: pointer; transition: background 0.15s;
  }
  .ee-m-annonce-dot--active { background: #E30613; }

  /* ── Hide desktop sidebar elements on mobile ── */
  .ee-col-right { display: none !important; }

  /* Hero compact */
  .ee-hero { border-radius: 0; margin-bottom: 0; }
  .ee-hero-content { flex-direction: column; align-items: flex-start; padding: 16px 14px 14px; gap: 12px; }
  .ee-hero-left { gap: 12px; }
  .ee-avatar { width: 44px; height: 44px; font-size: 16px; }
  .ee-hero-name { font-size: 16px; }
  .ee-hero-greeting { font-size: 11px; }
  .ee-tag { font-size: 9px; padding: 2px 8px; }
  .ee-hero-kpis { display: none !important; }
  .ee-hero-next { display: none; }

  /* Alert compact */
  .ee-alert-pay { margin: 8px 0 0; border-radius: 10px; padding: 10px 12px; flex-direction: row; align-items: center; gap: 8px; }
  .ee-alert-pay-icon { font-size: 16px; }
  .ee-alert-pay-body strong { font-size: 11px; }
  .ee-alert-pay-body span { font-size: 10px; }
  .ee-alert-pay-btn { font-size: 10px; padding: 5px 12px; }

  /* Quick actions en grille CBAO */
  .ee-quick-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 0; padding: 0; }
  .ee-qa {
    padding: 14px 4px 12px; border-radius: 14px;
    border: 1.5px solid #e2e8f0;
  }
  .ee-qa-icon {
    width: 48px; height: 48px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; background: #f8fafc;
  }
  .ee-qa { font-size: 13px; font-weight: 800; }

  /* Tabs visibles */
  .ee-tabs { display: flex; }

  /* Grid sur mobile : single column, no right sidebar */
  .ee-grid { grid-template-columns: 1fr; gap: 12px; }

  /* Next course card */
  .ee-next-course-card { flex-direction: column; align-items: flex-start; gap: 10px; }
  .ee-nc-countdown { text-align: left; }

  /* Notes KPIs */
  .ee-notes-kpis { grid-template-columns: 1fr 1fr; }
  .ee-nk--main { grid-column: 1 / -1; }

  /* Finance grid */
  .ee-fin-grid { grid-template-columns: 1fr 1fr; }
  .ee-fin-stat:first-child { grid-column: 1 / -1; }
  .ee-pay-row { flex-wrap: wrap; gap: 8px; }

  /* Séance row */
  .ee-seance:not(.ee-seance--past) { flex-wrap: wrap; }
  .ee-seance-right { flex-direction: row; flex-wrap: wrap; }
  .ee-s-matiere { font-size: 12px; }

  /* Note bar masquée */
  .ee-note-bar-wrap { display: none; }
  .ee-note-badge { margin-right: 10px; }

  /* Messagerie panel */
  .msg-panel { width: 100%; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; }
  .msg-convs { width: 100%; }
  .msg-panel-body { flex-direction: column; }
  .msg-convs { border-right: none; border-bottom: 1px solid #f0f0f0; max-height: 35%; }
  .msg-thread { min-height: 0; flex: 1; }
}

@media (max-width: 400px) {
  .ee-quick-actions { grid-template-columns: repeat(2, 1fr); }
}

/* ── NOTES SEMESTRE LABELS ──────────────────────────────── */
.ee-sem-label {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
  padding: 4px 12px; border-radius: 6px; margin-bottom: 8px; display: inline-block;
}
.ee-sem-label--s1 { background: #eff6ff; color: #1d4ed8; border-left: 3px solid #3b82f6; }
.ee-sem-label--s2 { background: #f0fdf4; color: #15803d; border-left: 3px solid #10b981; }

/* ══ MA CARTE ÉTUDIANT (carte seule, sans cadre) ════════════════════ */
.card-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.72); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.card-bare {
  position: relative; width: 100%; max-width: 660px;
  animation: cardBareIn .25s cubic-bezier(.34,1.4,.64,1);
}
@keyframes cardBareIn {
  from { transform: scale(.88) translateY(20px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}
.card-bare-close {
  position: absolute; top: -14px; right: -14px; z-index: 2;
  width: 30px; height: 30px; border-radius: 50%;
  background: rgba(255,255,255,.18); border: 1.5px solid rgba(255,255,255,.35);
  color: #fff; font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.card-bare-close:hover { background: rgba(255,255,255,.3); }
.card-canvas { width: 100%; height: auto; border-radius: 14px; box-shadow: 0 30px 80px rgba(0,0,0,.55); display: block; }
.card-loading { font-size: 13px; color: rgba(255,255,255,.6); text-align: center; margin-bottom: 10px; }
</style>
