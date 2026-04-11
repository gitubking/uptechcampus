<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'

const auth = useAuthStore()

// ── Types ────────────────────────────────────────────────────────────
interface Participant { id: number; nom: string; prenom: string; role: string }
interface DernierMessage { contenu: string; created_at: string; sender: string | null }
interface Conversation {
  id: number; type: string; nom: string | null; couleur: string
  participants: Participant[]; dernier_message: DernierMessage | null; nb_non_lus: number
}
interface Message {
  id: number; contenu: string; created_at: string; is_mine: boolean
  sender: { id: number; nom: string; prenom: string } | null
}
interface Annonce {
  id: number; titre: string; type: string; contenu: string
  destinataires: string[] | null; epingle: boolean; publie_at: string | null; statut: string
}

// ── State ────────────────────────────────────────────────────────────
const conversations = ref<Conversation[]>([])
const activeConversation = ref<Conversation | null>(null)
const messages = ref<Message[]>([])
const annonces = ref<Annonce[]>([])
const loadingConvs = ref(true)
const loadingMessages = ref(false)
const sendingMessage = ref(false)
const newMessage = ref('')

// Filtres conversations
const searchConv = ref('')
const tabConv = ref<'tous' | 'groupes' | 'directs'>('tous')

// Modals
const showModalAnnonce = ref(false)
const showModalNouveauMsg = ref(false)

// Forms
const formAnnonce = ref({
  titre: '', type: 'info', contenu: '',
  destinataires: ['tous'] as string[],
  canaux: ['messagerie'] as string[],
  publie_at: '',
})
// Nouveau message groupé
const formMsg = ref({
  cible: 'personne' as 'personne' | 'classe' | 'filiere' | 'tous',
  cible_id: '' as string,
  recherche: '',
  sujet: '',
  message: '',
})
const sendingNewMsg = ref(false)

// Données pour ciblage
const classesList = ref<{id:number; nom:string}[]>([])
const filieresList = ref<{id:number; nom:string}[]>([])
const usersList = ref<{id:number; nom:string; prenom:string; role:string}[]>([])
const usersFiltered = computed(() => {
  if (!formMsg.value.recherche.trim()) return []
  const q = formMsg.value.recherche.toLowerCase()
  return usersList.value.filter(u =>
    (u.prenom + ' ' + u.nom).toLowerCase().includes(q)
  ).slice(0, 8)
})

async function loadTargetData() {
  try {
    // Si enseignant : récupérer son profil et ses séances pour connaître ses classes
    if (isEnseignant.value && !monEnseignantId.value) {
      try {
        const { data: profil } = await api.get('/enseignants/me')
        monEnseignantId.value = profil.id ? Number(profil.id) : null
        // Charger les séances pour identifier les classes de cet enseignant
        const { data: seancesData } = await api.get('/seances')
        const ids = new Set<number>()
        for (const s of seancesData) {
          if (Number(s.enseignant_id) === monEnseignantId.value && s.classe_id) {
            ids.add(Number(s.classe_id))
          }
        }
        mesClasseIds.value = ids
      } catch (e) {
        console.error('[Communication] Erreur profil enseignant:', e)
      }
    }

    const [c, f, e, et] = await Promise.all([
      api.get('/classes'),
      api.get('/filieres'),
      api.get('/enseignants'),
      api.get('/etudiants'),
    ])
    let allClasses = (Array.isArray(c.data) ? c.data : c.data.data ?? []).map((x: any) => ({ id: x.id, nom: x.nom }))
    // Enseignant : restreindre aux classes où il enseigne
    if (isEnseignant.value && mesClasseIds.value.size > 0) {
      allClasses = allClasses.filter((cl: any) => mesClasseIds.value.has(Number(cl.id)))
    }
    classesList.value = allClasses
    filieresList.value = (Array.isArray(f.data) ? f.data : []).map((x: any) => ({ id: x.id, nom: x.nom }))
    const ens = (Array.isArray(e.data) ? e.data : e.data.data ?? []).map((x: any) => ({
      id: x.user_id, nom: x.nom, prenom: x.prenom, role: 'enseignant'
    }))
    let etds = (Array.isArray(et.data) ? et.data : et.data.data ?? []).map((x: any) => ({
      id: x.user_id, nom: x.nom, prenom: x.prenom, role: 'etudiant', classe_id: x.classe_id
    }))
    // Enseignant : restreindre les étudiants à ceux de ses classes
    if (isEnseignant.value && mesClasseIds.value.size > 0) {
      etds = etds.filter((u: any) => u.classe_id && mesClasseIds.value.has(Number(u.classe_id)))
    }
    usersList.value = isEnseignant.value
      ? etds.filter((u: any) => u.id) // Enseignant ne voit que les étudiants de ses classes
      : [...ens, ...etds].filter(u => u.id)
  } catch {}
}
const savingAnnonce = ref(false)

const isEnseignant = computed(() => auth.user?.role === 'enseignant')
const monEnseignantId = ref<number | null>(null)
const mesClasseIds = ref<Set<number>>(new Set())

const canWrite = computed(() =>
  ['dg', 'dir_peda', 'coordinateur', 'secretariat'].includes(auth.user?.role ?? '')
)

// Référence pour auto-scroll messages
const messagesContainer = ref<HTMLElement | null>(null)

// ── Polling ──────────────────────────────────────────────────────────
let pollTimer: ReturnType<typeof setInterval> | null = null

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    if (activeConversation.value) fetchMessages(activeConversation.value.id, false)
    fetchConversations(false)
  }, 8000)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
onUnmounted(() => stopPolling())

// ── API ──────────────────────────────────────────────────────────────
async function fetchConversations(showLoader = true) {
  if (showLoader) loadingConvs.value = true
  try {
    const { data } = await api.get('/conversations')
    conversations.value = data
  } finally {
    if (showLoader) loadingConvs.value = false
  }
}

async function fetchMessages(convId: number, showLoader = true) {
  if (showLoader) loadingMessages.value = true
  try {
    const { data } = await api.get(`/conversations/${convId}`)
    messages.value = data.messages
    await nextTick()
    scrollToBottom()
  } finally {
    if (showLoader) loadingMessages.value = false
  }
}

async function fetchAnnonces() {
  const { data } = await api.get('/annonces')
  annonces.value = data
}

async function selectConversation(conv: Conversation) {
  activeConversation.value = conv
  await fetchMessages(conv.id)
  startPolling()
  // Réinitialiser nb_non_lus localement
  conv.nb_non_lus = 0
}

async function sendMessage() {
  if (!newMessage.value.trim() || !activeConversation.value || sendingMessage.value) return
  sendingMessage.value = true
  try {
    const { data } = await api.post(`/conversations/${activeConversation.value.id}/messages`, {
      contenu: newMessage.value.trim(),
    })
    messages.value.push(data)
    newMessage.value = ''
    await nextTick()
    scrollToBottom()
  } finally {
    sendingMessage.value = false
  }
}

async function deleteMessage(msgId: number) {
  if (!confirm('Supprimer ce message ?')) return
  await api.delete(`/messages/${msgId}`)
  messages.value = messages.value.filter((m: any) => m.id !== msgId)
}

async function deleteConversation(conv: any) {
  if (!confirm(`Supprimer la conversation "${conv.nom}" et tous ses messages ?`)) return
  await api.delete(`/conversations/${conv.id}`)
  conversations.value = conversations.value.filter((c: any) => c.id !== conv.id)
  if (activeConversation.value?.id === conv.id) {
    activeConversation.value = conversations.value[0] || null
    messages.value = []
  }
}

async function sendNewMessage() {
  if (!formMsg.value.message.trim() || sendingNewMsg.value) return
  sendingNewMsg.value = true
  try {
    const { data: conv } = await api.post('/conversations/groupe', {
      cible: formMsg.value.cible,
      cible_id: formMsg.value.cible_id || null,
      sujet: formMsg.value.sujet || null,
    })
    await api.post(`/conversations/${conv.id}/messages`, { contenu: formMsg.value.message.trim() })
    formMsg.value = { cible: 'personne', cible_id: '', recherche: '', sujet: '', message: '' }
    showModalNouveauMsg.value = false
    await fetchConversations()
    const created = conversations.value.find(c => c.id === conv.id)
    if (created) selectConversation(created)
  } finally {
    sendingNewMsg.value = false
  }
}

function openNouveauMsg() {
  formMsg.value.cible = isEnseignant.value ? 'classe' : 'personne'
  formMsg.value.cible_id = ''
  formMsg.value.recherche = ''
  loadTargetData()
  showModalNouveauMsg.value = true
}

async function saveAnnonce(publie = false) {
  savingAnnonce.value = true
  try {
    const { data } = await api.post('/annonces', { ...formAnnonce.value })
    if (publie) await api.post(`/annonces/${data.id}/publier`)
    await fetchAnnonces()
    showModalAnnonce.value = false
    resetFormAnnonce()
  } finally {
    savingAnnonce.value = false
  }
}

// ── Init ─────────────────────────────────────────────────────────────
fetchConversations()
fetchAnnonces()

// ── Helpers ──────────────────────────────────────────────────────────
function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

function resetFormAnnonce() {
  formAnnonce.value = { titre: '', type: 'info', contenu: '', destinataires: ['tous'], canaux: ['messagerie'], publie_at: '' }
}

function convName(conv: Conversation) {
  if (conv.nom) return conv.nom
  const others = conv.participants.filter(p => p.id !== auth.user?.id)
  if (others.length === 0) return 'Moi'
  return others.map(p => `${p.prenom} ${p.nom}`).join(', ')
}

function convInitials(conv: Conversation) {
  const name = convName(conv)
  return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
}

function membresLabel(conv: Conversation) {
  if (conv.type === 'groupe') return `${conv.participants.length} membres`
  return ''
}

const avatarColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#6366f1', '#E30613']
function avatarBg(conv: Conversation) {
  return avatarColors[conv.id % avatarColors.length]
}

function formatTime(dt: string | null) {
  if (!dt) return ''
  const d = new Date(dt)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'short' })
}

function formatDateLabel(dt: string) {
  const d = new Date(dt)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return "Aujourd'hui"
  if (diffDays === 1) return 'Hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

// Grouper messages par date
const messagesParDate = computed(() => {
  const groups: { label: string; msgs: Message[] }[] = []
  let lastDate = ''
  for (const m of messages.value) {
    const label = formatDateLabel(m.created_at)
    if (label !== lastDate) {
      groups.push({ label, msgs: [] })
      lastDate = label
    }
    groups[groups.length - 1]!.msgs.push(m)
  }
  return groups
})

const filteredConversations = computed(() => {
  let list = conversations.value
  if (tabConv.value === 'groupes') list = list.filter(c => c.type === 'groupe')
  if (tabConv.value === 'directs') list = list.filter(c => c.type === 'direct')
  if (searchConv.value.trim()) {
    const s = searchConv.value.toLowerCase()
    list = list.filter(c => convName(c).toLowerCase().includes(s))
  }
  return list
})

function announceBadgeClass(type: string) {
  const t: Record<string, string> = {
    info:      'bg-blue-100 text-blue-700',
    urgent:    'bg-amber-100 text-amber-700',
    alerte:    'bg-red-100 text-red-700',
    evenement: 'bg-green-100 text-green-700',
  }
  return t[type] ?? 'bg-gray-100 text-gray-700'
}

function announceTypeLabel(type: string) {
  const t: Record<string, string> = { info: 'Info', urgent: 'Urgent', alerte: 'Alerte', evenement: 'Événement' }
  return t[type] ?? type
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

// Toggle destinataires / canaux chips
function toggleChip(arr: string[], val: string) {
  const idx = arr.indexOf(val)
  if (idx === -1) arr.push(val)
  else arr.splice(idx, 1)
}
</script>

<template>
  <div class="uc-content cm-layout" style="padding:0">

    <!-- ══ HERO ══ -->
    <div class="cm-hero">
      <div class="cm-hero-glow"></div>
      <div class="cm-hero-content">
        <div class="cm-hero-left">
          <div class="cm-hero-icon">💬</div>
          <div>
            <h1 class="cm-hero-title">Communication</h1>
            <p class="cm-hero-sub">Messagerie interne &amp; diffusion d'annonces</p>
          </div>
        </div>
        <div class="cm-hero-kpis">
          <div class="cm-hkpi">
            <div class="cm-hkpi-val">{{ conversations.length }}</div>
            <div class="cm-hkpi-lbl">Conversations</div>
          </div>
          <div class="cm-hkpi cm-hkpi--red">
            <div class="cm-hkpi-val">{{ conversations.reduce((s, c) => s + c.nb_non_lus, 0) }}</div>
            <div class="cm-hkpi-lbl">Non lus</div>
          </div>
          <div class="cm-hkpi cm-hkpi--green">
            <div class="cm-hkpi-val">{{ annonces.filter(a => a.statut === 'publie').length }}</div>
            <div class="cm-hkpi-lbl">Annonces</div>
          </div>
          <div class="cm-hkpi cm-hkpi--orange">
            <div class="cm-hkpi-val">{{ annonces.filter(a => a.statut === 'brouillon').length }}</div>
            <div class="cm-hkpi-lbl">Brouillons</div>
          </div>
        </div>
        <div class="cm-hero-actions">
          <a href="/notifications" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#E30613;color:#fff;font-size:12px;font-weight:600;text-decoration:none;">
            🔔 Notifications
          </a>
          <button v-if="canWrite" @click="showModalAnnonce = true" class="cm-hero-btn cm-hero-btn--ghost">
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
            Annonce
          </button>
          <button @click="openNouveauMsg()" class="cm-hero-btn">
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            Nouveau message
          </button>
        </div>
      </div>
    </div>

    <!-- Corps 3 colonnes -->
    <div class="cm-body">

      <!-- ── COLONNE GAUCHE : Conversations ── -->
      <aside class="cm-col-left">

        <!-- Search + tabs -->
        <div class="cm-search-area">
          <div class="cm-search-wrap">
            <svg class="cm-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input v-model="searchConv" type="text" placeholder="Rechercher une conversation…" class="cm-search-input" />
          </div>
          <div class="cm-conv-tabs">
            <button v-for="t in ['tous', 'groupes', 'directs']" :key="t"
              @click="tabConv = t as any"
              class="cm-conv-tab"
              :class="tabConv === t ? 'cm-conv-tab--active' : ''">
              {{ t }}
            </button>
          </div>
        </div>

        <!-- Liste conversations -->
        <div class="cm-conv-list">
          <div v-if="loadingConvs" class="cm-empty-text">Chargement…</div>
          <div v-else-if="filteredConversations.length === 0" class="cm-empty-text">Aucune conversation</div>

          <div v-for="conv in filteredConversations" :key="conv.id"
            @click="selectConversation(conv)"
            class="cm-conv-item"
            :class="activeConversation?.id === conv.id ? 'cm-conv-item--active' : ''">
            <div class="cm-avatar" :style="{ backgroundColor: avatarBg(conv) }">
              {{ convInitials(conv) }}
            </div>
            <div class="cm-conv-info">
              <div class="cm-conv-top">
                <p class="cm-conv-name">{{ convName(conv) }}</p>
                <span class="cm-conv-time">{{ conv.dernier_message ? formatTime(conv.dernier_message.created_at) : '' }}</span>
              </div>
              <div class="cm-conv-bottom">
                <p class="cm-conv-preview">{{ conv.dernier_message?.contenu ?? 'Aucun message' }}</p>
                <span v-if="conv.nb_non_lus > 0" class="cm-unread-badge">
                  {{ conv.nb_non_lus > 9 ? '9+' : conv.nb_non_lus }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- ── COLONNE CENTRALE : Messages ── -->
      <div class="cm-col-center">

        <!-- Pas de conversation sélectionnée -->
        <div v-if="!activeConversation" class="cm-no-conv">
          <svg width="64" height="64" fill="none" stroke="#ddd" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p class="cm-no-conv-text">Sélectionnez une conversation</p>
        </div>

        <template v-else>
          <!-- Header chat -->
          <div class="cm-chat-header">
            <div class="cm-avatar cm-avatar--sm" :style="{ backgroundColor: avatarBg(activeConversation) }">
              {{ convInitials(activeConversation) }}
            </div>
            <div class="cm-chat-info">
              <p class="cm-chat-name">{{ convName(activeConversation) }}</p>
              <p v-if="membresLabel(activeConversation)" class="cm-chat-sub">{{ membresLabel(activeConversation) }}</p>
            </div>
            <button class="cm-delete-conv-btn" @click="deleteConversation(activeConversation)" title="Supprimer la discussion">
              🗑 Supprimer la discussion
            </button>
          </div>

          <!-- Zone messages -->
          <div ref="messagesContainer" class="cm-messages">
            <div v-if="loadingMessages" class="cm-empty-text" style="padding:32px 0">Chargement…</div>
            <template v-for="group in messagesParDate" :key="group.label">
              <div class="cm-date-sep">
                <span class="cm-date-label">{{ group.label }}</span>
              </div>
              <div v-for="msg in group.msgs" :key="msg.id"
                class="cm-msg-row"
                :class="msg.is_mine ? 'cm-msg-row--mine' : ''">
                <div v-if="!msg.is_mine" class="cm-avatar cm-avatar--xs" :style="{ backgroundColor: avatarBg(activeConversation) }">
                  {{ msg.sender ? `${msg.sender.prenom[0]}${msg.sender.nom[0]}` : '?' }}
                </div>
                <div class="cm-bubble-wrap">
                  <p v-if="!msg.is_mine" class="cm-sender-name">{{ msg.sender?.prenom }} {{ msg.sender?.nom }}</p>
                  <div class="cm-bubble" :class="msg.is_mine ? 'cm-bubble--mine' : 'cm-bubble--other'">
                    {{ msg.contenu }}
                  </div>
                  <div class="cm-msg-footer" :class="msg.is_mine ? 'cm-msg-footer--right' : ''">
                    <p class="cm-msg-time">
                      {{ new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}
                    </p>
                    <button class="cm-del-msg-btn" @click="deleteMessage(msg.id)" title="Supprimer">🗑</button>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Input zone -->
          <div class="cm-input-zone">
            <textarea
              v-model="newMessage"
              @keydown="handleKeydown"
              placeholder="Écrire un message… (Entrée pour envoyer)"
              rows="1"
              class="cm-msg-input"
            ></textarea>
            <button @click="sendMessage" :disabled="!newMessage.trim() || sendingMessage" class="cm-send-btn">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </template>
      </div>

      <!-- ── COLONNE DROITE : Annonces ── -->
      <aside class="cm-col-right">
        <div class="cm-annonces-header">
          <h3 class="cm-annonces-title">Annonces & Diffusions</h3>
          <button v-if="canWrite" @click="showModalAnnonce = true" class="cm-annonces-add-btn">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        <div v-if="canWrite" class="cm-annonces-cta">
          <button @click="showModalAnnonce = true" class="cm-btn-nouvelle-annonce">
            + Nouvelle annonce
          </button>
        </div>

        <div class="cm-annonces-list">
          <div v-if="annonces.length === 0" class="cm-empty-text" style="padding:24px 0">Aucune annonce</div>
          <div v-for="a in annonces" :key="a.id"
            class="cm-annonce-item"
            :class="a.epingle ? 'cm-annonce-item--epingle' : ''">
            <div class="cm-annonce-top">
              <span class="cm-annonce-badge" :class="announceBadgeClass(a.type)">{{ announceTypeLabel(a.type) }}</span>
              <span v-if="a.statut === 'brouillon'" class="cm-draft-label">brouillon</span>
            </div>
            <p class="cm-annonce-titre">{{ a.titre }}</p>
            <p class="cm-annonce-contenu">{{ a.contenu }}</p>
            <div class="cm-annonce-footer">
              <span>{{ a.publie_at ? new Date(a.publie_at).toLocaleDateString('fr-FR') : 'Non publié' }}</span>
              <span v-if="a.destinataires?.length">{{ a.destinataires.join(', ') }}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>

  <!-- ── Modal : Nouvelle annonce ─────────────────────────────────── -->
  <UcModal v-model="showModalAnnonce" title="Nouvelle annonce" width="520px" @close="showModalAnnonce = false">
    <div class="cm-modal-form-body">
      <UcFormGroup label="Titre" :required="true">
        <input v-model="formAnnonce.titre" type="text" placeholder="Titre de l'annonce" class="cm-input" />
      </UcFormGroup>
      <UcFormGroup label="Type" :required="true">
        <select v-model="formAnnonce.type" class="cm-input">
          <option value="info">Info</option>
          <option value="urgent">Urgent</option>
          <option value="alerte">Alerte</option>
          <option value="evenement">Événement</option>
        </select>
      </UcFormGroup>
      <UcFormGroup :label="`Message (${formAnnonce.contenu.length}/500)`">
        <textarea v-model="formAnnonce.contenu" rows="4" maxlength="500" placeholder="Contenu de l'annonce…" class="cm-input" style="resize:none"></textarea>
      </UcFormGroup>
      <UcFormGroup label="Destinataires">
        <div class="cm-chips">
          <button v-for="d in ['tous', 'etudiants', 'enseignants', 'administration']" :key="d"
            @click="toggleChip(formAnnonce.destinataires, d)"
            class="cm-chip"
            :class="formAnnonce.destinataires.includes(d) ? 'cm-chip--active' : ''">
            {{ d }}
          </button>
        </div>
      </UcFormGroup>
      <UcFormGroup label="Canal de diffusion">
        <div class="cm-chips">
          <button v-for="c in ['messagerie', 'sms', 'email']" :key="c"
            @click="toggleChip(formAnnonce.canaux, c)"
            class="cm-chip"
            :class="formAnnonce.canaux.includes(c) ? 'cm-chip--canal' : ''">
            {{ c }}
          </button>
        </div>
      </UcFormGroup>
      <UcFormGroup label="Programmer pour plus tard (optionnel)">
        <input v-model="formAnnonce.publie_at" type="datetime-local" class="cm-input" />
      </UcFormGroup>
    </div>

    <template #footer>
      <button @click="showModalAnnonce = false" class="cm-btn-cancel">Annuler</button>
      <button @click="saveAnnonce(false)" :disabled="savingAnnonce" class="cm-btn-draft">Brouillon</button>
      <button @click="saveAnnonce(true)" :disabled="savingAnnonce || !formAnnonce.titre || !formAnnonce.contenu" class="uc-btn-primary" :style="(savingAnnonce || !formAnnonce.titre || !formAnnonce.contenu) ? 'opacity:0.4' : ''">
        {{ savingAnnonce ? 'Publication…' : 'Publier maintenant' }}
      </button>
    </template>
  </UcModal>

  <!-- ── Modal : Nouveau message ──────────────────────────────────── -->
  <UcModal v-model="showModalNouveauMsg" title="✉️ Nouveau message" width="480px" @close="showModalNouveauMsg = false">
    <div class="cm-modal-form-body">

      <!-- Cible -->
      <UcFormGroup label="Envoyer à" :required="true">
        <div class="cm-cible-chips">
          <button v-for="opt in (isEnseignant
            ? [
                { k:'classe',   label:'🏫 Une classe' },
                { k:'personne', label:'👤 Un étudiant' },
              ]
            : [
                { k:'tous',     label:'🌍 Tout le monde' },
                { k:'classe',   label:'🏫 Une classe' },
                { k:'filiere',  label:'📚 Une filière' },
                { k:'personne', label:'👤 Une personne' },
              ]
          )" :key="opt.k"
            class="cm-cible-chip"
            :class="{ 'cm-cible-chip--active': formMsg.cible === opt.k }"
            @click="formMsg.cible = opt.k as any; formMsg.cible_id = ''; formMsg.recherche = ''">
            {{ opt.label }}
          </button>
        </div>
      </UcFormGroup>

      <!-- Sélecteur classe -->
      <UcFormGroup v-if="formMsg.cible === 'classe'" label="Classe" :required="true">
        <select v-model="formMsg.cible_id" class="cm-input">
          <option value="">— Sélectionner une classe —</option>
          <option v-for="c in classesList" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
        </select>
      </UcFormGroup>

      <!-- Sélecteur filière -->
      <UcFormGroup v-if="formMsg.cible === 'filiere'" label="Filière" :required="true">
        <select v-model="formMsg.cible_id" class="cm-input">
          <option value="">— Sélectionner une filière —</option>
          <option v-for="f in filieresList" :key="f.id" :value="String(f.id)">{{ f.nom }}</option>
        </select>
      </UcFormGroup>

      <!-- Recherche personne -->
      <UcFormGroup v-if="formMsg.cible === 'personne'" label="Rechercher" :required="true">
        <div style="position:relative">
          <input v-model="formMsg.recherche" type="text" placeholder="Nom de l'enseignant ou étudiant…" class="cm-input" />
          <div v-if="usersFiltered.length" class="cm-autocomplete">
            <div v-for="u in usersFiltered" :key="u.id"
              class="cm-autocomplete-item"
              @click="formMsg.cible_id = String(u.id); formMsg.recherche = u.prenom + ' ' + u.nom">
              <span class="cm-ac-role" :style="u.role === 'enseignant' ? 'background:#dbeafe;color:#1d4ed8' : 'background:#dcfce7;color:#15803d'">
                {{ u.role === 'enseignant' ? 'Prof' : 'Étud.' }}
              </span>
              {{ u.prenom }} {{ u.nom }}
            </div>
          </div>
        </div>
      </UcFormGroup>

      <!-- Info "tout le monde" -->
      <div v-if="formMsg.cible === 'tous'" class="cm-info-box">
        📢 Ce message sera envoyé à <strong>tous les enseignants et étudiants</strong> de l'établissement.
      </div>

      <UcFormGroup label="Sujet (optionnel)">
        <input v-model="formMsg.sujet" type="text" placeholder="Ex : Réunion pédagogique vendredi" class="cm-input" />
      </UcFormGroup>
      <UcFormGroup label="Message" :required="true">
        <textarea v-model="formMsg.message" rows="5" class="cm-input" placeholder="Rédigez votre message…" style="resize:vertical;min-height:100px"></textarea>
      </UcFormGroup>
    </div>

    <template #footer>
      <button @click="showModalNouveauMsg = false" class="cm-btn-cancel">Annuler</button>
      <button @click="sendNewMessage"
        :disabled="!formMsg.message.trim() || sendingNewMsg || (formMsg.cible !== 'tous' && !formMsg.cible_id)"
        class="uc-btn-primary"
        :style="(!formMsg.message.trim() || sendingNewMsg || (formMsg.cible !== 'tous' && !formMsg.cible_id)) ? 'opacity:0.4' : ''">
        {{ sendingNewMsg ? 'Envoi en cours…' : '📤 Envoyer' }}
      </button>
    </template>
  </UcModal>
</template>

<style scoped>
/* Layout */
.cm-layout { display:flex; flex-direction:column; height:calc(100vh - 4rem); }

/* Body 3 columns */
.cm-body { display:flex; flex:1; overflow:hidden; }

/* Left column */
.cm-col-left { width:272px; flex-shrink:0; background:#fff; border-right:1px solid #eee; display:flex; flex-direction:column; }
.cm-search-area { padding:10px; border-bottom:1px solid #f0f0f0; }
.cm-search-wrap { position:relative; margin-bottom:8px; }
.cm-search-icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); width:15px; height:15px; color:#bbb; }
.cm-search-input { width:100%; padding:8px 10px 8px 32px; font-size:13px; border:1px solid #eee; border-radius:8px; outline:none; box-sizing:border-box; }
.cm-search-input:focus { border-color:#E30613; }
.cm-conv-tabs { display:flex; gap:4px; }
.cm-conv-tab { flex:1; padding:6px; font-size:12px; font-weight:500; border-radius:7px; border:none; cursor:pointer; background:none; color:#888; text-transform:capitalize; transition:all 0.15s; }
.cm-conv-tab:hover { background:#f9f9f9; }
.cm-conv-tab--active { background:#fde8e8; color:#E30613; }
.cm-conv-list { flex:1; overflow-y:auto; }
.cm-conv-item { display:flex; align-items:flex-start; gap:10px; padding:12px 14px; cursor:pointer; border-left:2px solid transparent; transition:all 0.15s; }
.cm-conv-item:hover { background:#fff5f5; border-left-color:#fca5a5; }
.cm-conv-item--active { background:#fde8e8; border-left-color:#E30613; }
.cm-conv-info { flex:1; min-width:0; }
.cm-conv-top { display:flex; align-items:center; justify-content:space-between; gap:4px; }
.cm-conv-name { font-size:13px; font-weight:600; color:#111; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cm-conv-time { font-size:11px; color:#aaa; flex-shrink:0; }
.cm-conv-bottom { display:flex; align-items:center; justify-content:space-between; gap:4px; margin-top:2px; }
.cm-conv-preview { font-size:12px; color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cm-unread-badge { min-width:20px; height:20px; background:#E30613; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#fff; font-weight:700; padding:0 4px; flex-shrink:0; }

/* Center column */
.cm-col-center { flex:1; display:flex; flex-direction:column; background:#f4f4f4; }
.cm-no-conv { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
.cm-no-conv-text { font-size:13px; color:#bbb; }
.cm-chat-header { display:flex; align-items:center; gap:10px; padding:10px 16px; background:#fff; border-bottom:1px solid #eee; flex-shrink:0; }
.cm-delete-conv-btn {
  margin-left:auto; display:flex; align-items:center; gap:6px;
  padding: 7px 14px; border-radius: 8px; border: none; cursor: pointer;
  background: linear-gradient(135deg,#ef4444,#dc2626); color:#fff;
  font-size:12px; font-weight:600; font-family:'Poppins',sans-serif;
  transition: opacity 0.15s; box-shadow: 0 2px 8px rgba(239,68,68,0.3);
}
.cm-delete-conv-btn:hover { opacity:0.85; }
.cm-chat-info { flex:1; min-width:0; }
.cm-chat-name { font-size:13.5px; font-weight:600; color:#111; }
.cm-chat-sub { font-size:12px; color:#888; margin-top:1px; }
.cm-messages { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:4px; }
.cm-date-sep { display:flex; justify-content:center; margin:12px 0; }
.cm-date-label { padding:3px 12px; background:#e5e7eb; border-radius:20px; font-size:11.5px; color:#666; }
.cm-msg-row { display:flex; align-items:flex-end; gap:6px; margin-bottom:2px; }
.cm-msg-row--mine { flex-direction:row-reverse; }
.cm-bubble-wrap { max-width:65%; }
.cm-sender-name { font-size:11px; color:#aaa; margin-bottom:2px; padding-left:4px; }
.cm-bubble { padding:8px 12px; border-radius:18px; font-size:13.5px; }
.cm-bubble--mine { background:#E30613; color:#fff; border-bottom-right-radius:4px; }
.cm-bubble--other { background:#fff; color:#111; border:1px solid #eee; border-bottom-left-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.06); }
.cm-msg-footer { display:flex; align-items:center; gap:6px; margin-top:3px; }
.cm-msg-footer--right { flex-direction:row-reverse; }
.cm-msg-time { font-size:11px; color:#aaa; padding-left:4px; }
.cm-del-msg-btn {
  background: #fee2e2; border: none; cursor:pointer;
  font-size:11px; color:#ef4444;
  padding: 2px 6px; border-radius: 4px;
  transition: background 0.15s;
}
.cm-del-msg-btn:hover { background: #fca5a5; }
.cm-input-zone { display:flex; align-items:flex-end; gap:10px; padding:12px 14px; background:#fff; border-top:1px solid #eee; flex-shrink:0; }
.cm-msg-input { flex:1; resize:none; font-size:13.5px; border:1px solid #eee; border-radius:10px; padding:9px 14px; outline:none; font-family:inherit; max-height:128px; }
.cm-msg-input:focus { border-color:#E30613; }
.cm-send-btn { width:38px; height:38px; background:#E30613; color:#fff; border:none; border-radius:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; }
.cm-send-btn:hover { opacity:0.88; }
.cm-send-btn:disabled { opacity:0.4; cursor:not-allowed; }

/* Right column */
.cm-col-right { width:272px; flex-shrink:0; background:#fff; border-left:1px solid #eee; display:flex; flex-direction:column; }
.cm-annonces-header { display:flex; align-items:center; justify-content:space-between; padding:11px 14px; border-bottom:1px solid #f0f0f0; flex-shrink:0; }
.cm-annonces-title { font-size:13px; font-weight:600; color:#111; }
.cm-annonces-add-btn { width:26px; height:26px; background:#f5f5f5; border:none; border-radius:6px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#555; }
.cm-annonces-add-btn:hover { background:#eee; }
.cm-annonces-cta { padding:10px 12px; border-bottom:1px solid #f0f0f0; }
.cm-btn-nouvelle-annonce { width:100%; padding:8px; background:#111; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; }
.cm-btn-nouvelle-annonce:hover { background:#333; }
.cm-annonces-list { flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:8px; }
.cm-annonce-item { padding:10px 12px; border-radius:8px; border:1px solid #eee; cursor:pointer; }
.cm-annonce-item:hover { background:#fff5f5; }
.cm-annonce-item--epingle { border-left:3px solid #E30613; }
.cm-annonce-top { display:flex; align-items:center; gap:6px; margin-bottom:5px; }
.cm-annonce-badge { font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; }
.cm-draft-label { font-size:11px; color:#aaa; font-style:italic; }
.cm-annonce-titre { font-size:13px; font-weight:600; color:#111; margin-bottom:2px; }
.cm-annonce-contenu { font-size:12px; color:#666; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.cm-annonce-footer { display:flex; align-items:center; justify-content:space-between; margin-top:8px; font-size:11px; color:#aaa; }

/* Avatar */
.cm-avatar { width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:13px; font-weight:700; flex-shrink:0; }
.cm-avatar--sm { width:36px; height:36px; font-size:12px; }
.cm-avatar--xs { width:28px; height:28px; font-size:11px; }

/* Announcement header button */
.cm-btn-outline { display:flex; align-items:center; gap:6px; padding:7px 14px; font-size:13px; font-weight:500; border:1px solid #ddd; border-radius:7px; background:#fff; color:#444; cursor:pointer; }
.cm-btn-outline:hover { background:#f9f9f9; }

/* Modal form internals */
.cm-modal-form-body { display:flex; flex-direction:column; gap:12px; }
.cm-input { width:100%; padding:8px 12px; border:1px solid #e0e0e0; border-radius:7px; font-size:13px; color:#111; outline:none; box-sizing:border-box; font-family:inherit; }
.cm-input:focus { border-color:#E30613; box-shadow:0 0 0 2px rgba(227,6,19,0.08); }

/* Chips */
.cm-chips { display:flex; flex-wrap:wrap; gap:6px; }
.cm-chip { padding:5px 12px; font-size:12px; border-radius:20px; border:1px solid #ddd; background:#fff; color:#555; cursor:pointer; transition:all 0.15s; }
.cm-chip:hover { border-color:#ccc; }
.cm-chip--active { background:#E30613; color:#fff; border-color:#E30613; }
.cm-chip--canal { background:#111; color:#fff; border-color:#111; }

/* Modal footer buttons */
.cm-btn-cancel { padding:8px 14px; font-size:13px; color:#555; border:1px solid #ddd; background:#fff; border-radius:7px; cursor:pointer; }
.cm-btn-cancel:hover { background:#f9f9f9; }

/* Cible chips */
.cm-cible-chips { display:flex; flex-wrap:wrap; gap:8px; }
.cm-cible-chip {
  padding:7px 14px; font-size:12px; font-weight:600; border-radius:20px;
  border:2px solid #e5e7eb; background:#fff; cursor:pointer; color:#374151;
  transition:all 0.15s;
}
.cm-cible-chip:hover { border-color:#6366f1; color:#6366f1; }
.cm-cible-chip--active { border-color:#E30613; background:#fff1f2; color:#E30613; }

/* Info box */
.cm-info-box {
  padding:10px 14px; background:#eff6ff; border:1px solid #bfdbfe;
  border-radius:8px; font-size:13px; color:#1d4ed8; line-height:1.5;
}

/* Autocomplete */
.cm-autocomplete {
  position:absolute; top:100%; left:0; right:0; z-index:50;
  background:#fff; border:1px solid #e5e7eb; border-radius:8px;
  box-shadow:0 4px 16px rgba(0,0,0,0.1); max-height:200px; overflow-y:auto; margin-top:2px;
}
.cm-autocomplete-item {
  display:flex; align-items:center; gap:8px;
  padding:9px 12px; cursor:pointer; font-size:13px; color:#1e293b;
  transition:background 0.1s;
}
.cm-autocomplete-item:hover { background:#f8fafc; }
.cm-ac-role {
  font-size:10px; font-weight:700; padding:2px 7px; border-radius:20px; flex-shrink:0;
}
.cm-btn-draft { padding:8px 14px; font-size:13px; color:#444; border:1px solid #ddd; background:#fff; border-radius:7px; cursor:pointer; }
.cm-btn-draft:hover { background:#f9f9f9; }
.cm-btn-draft:disabled { opacity:0.4; cursor:not-allowed; }

/* Empty */
.cm-empty-text { text-align:center; font-size:13px; color:#aaa; padding:16px; }

@media (max-width: 768px) {
  .cm-body { flex-direction: column; overflow: auto; }
  .cm-col-left { width: 100%; flex-shrink: 0; max-height: 280px; border-right: none; border-bottom: 1px solid #eee; }
  .cm-conv-list { max-height: 200px; }
}

/* ════════════════════════════════════════════════════════
   HERO COMMUNICATION
════════════════════════════════════════════════════════ */
.cm-hero {
  position: relative;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0d1117 100%);
  border-radius: 16px;
  margin: 16px 16px 0;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(15,23,42,0.18);
  flex-shrink: 0;
}
.cm-hero-glow {
  position: absolute;
  top: -50px; right: -40px;
  width: 240px; height: 240px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%);
  pointer-events: none;
}
.cm-hero-content {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 18px 24px;
  flex-wrap: wrap;
}
.cm-hero-left { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.cm-hero-icon {
  width: 44px; height: 44px;
  background: rgba(255,255,255,0.07);
  border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
  border: 1px solid rgba(255,255,255,0.1);
  flex-shrink: 0;
}
.cm-hero-title { font-size: 18px; font-weight: 800; color: #fff; margin: 0 0 2px; font-family: 'Poppins', sans-serif; }
.cm-hero-sub { font-size: 11.5px; color: rgba(255,255,255,0.45); margin: 0; }

.cm-hero-kpis { display: flex; gap: 8px; flex-wrap: wrap; }
.cm-hkpi {
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 9px;
  padding: 8px 13px;
  text-align: center;
  min-width: 72px;
}
.cm-hkpi--red    { border-color: rgba(227,6,19,0.35); }
.cm-hkpi--green  { border-color: rgba(34,197,94,0.35); }
.cm-hkpi--orange { border-color: rgba(249,115,22,0.35); }
.cm-hkpi-val {
  font-size: 16px; font-weight: 800; color: #fff;
  line-height: 1.1; font-family: 'Poppins', sans-serif;
}
.cm-hkpi--red   .cm-hkpi-val { color: #f87171; }
.cm-hkpi--green .cm-hkpi-val { color: #4ade80; }
.cm-hkpi--orange .cm-hkpi-val { color: #fb923c; }
.cm-hkpi-lbl {
  font-size: 9.5px; color: rgba(255,255,255,0.4);
  font-weight: 600; margin-top: 2px;
  text-transform: uppercase; letter-spacing: .04em;
  white-space: nowrap;
}

.cm-hero-actions { margin-left: auto; display: flex; gap: 8px; }
.cm-hero-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px;
  background: linear-gradient(135deg, #E30613, #c0050f);
  border: none; border-radius: 9px;
  color: #fff; font-size: 12.5px; font-weight: 700;
  cursor: pointer; font-family: 'Poppins', sans-serif;
  box-shadow: 0 4px 12px rgba(227,6,19,0.3);
  transition: opacity 0.15s;
}
.cm-hero-btn:hover { opacity: 0.88; }
.cm-hero-btn--ghost {
  background: rgba(255,255,255,0.08);
  box-shadow: none;
  border: 1px solid rgba(255,255,255,0.15);
  color: rgba(255,255,255,0.8);
}
.cm-hero-btn--ghost:hover { background: rgba(255,255,255,0.15); opacity: 1; }

@media (max-width: 900px) {
  .cm-hero { margin: 12px 12px 0; }
  .cm-hero-content { padding: 14px 16px; gap: 10px; }
}
@media (max-width: 640px) {
  .cm-hero-kpis { display: grid; grid-template-columns: repeat(2,1fr); width: 100%; }
  .cm-hero-actions { width: 100%; }
  .cm-hero-btn { flex: 1; justify-content: center; }
}
</style>
