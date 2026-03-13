<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

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
const formMsg = ref({ destinataires: '', sujet: '', message: '' })
const sendingNewMsg = ref(false)
const savingAnnonce = ref(false)

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

async function sendNewMessage() {
  if (!formMsg.value.message.trim() || sendingNewMsg.value) return
  sendingNewMsg.value = true
  try {
    const nom = formMsg.value.sujet || formMsg.value.destinataires || 'Nouveau message'
    const { data: conv } = await api.post('/conversations', {
      type: 'direct',
      nom,
      user_ids: [],
    })
    await api.post(`/conversations/${conv.id}/messages`, { contenu: formMsg.value.message.trim() })
    formMsg.value = { destinataires: '', sujet: '', message: '' }
    showModalNouveauMsg.value = false
    await fetchConversations()
    const created = conversations.value.find(c => c.id === conv.id)
    if (created) selectConversation(created)
  } finally {
    sendingNewMsg.value = false
  }
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

    <!-- Header page -->
    <div class="cm-header">
      <div>
        <h1 class="cm-header-title">Communication & Messagerie</h1>
        <p class="cm-header-sub">
          {{ conversations.reduce((s, c) => s + c.nb_non_lus, 0) }} message(s) non lu(s) ·
          {{ annonces.filter(a => a.statut === 'brouillon').length }} annonce(s) en attente
        </p>
      </div>
      <div class="cm-header-actions">
        <button v-if="canWrite" @click="showModalAnnonce = true" class="cm-btn-outline">
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
          Annonce
        </button>
        <button @click="showModalNouveauMsg = true" class="uc-btn-primary">
          + Nouveau message
        </button>
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
                  <p class="cm-msg-time" :class="msg.is_mine ? 'cm-msg-time--right' : ''">
                    {{ new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}
                  </p>
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
  <Teleport to="body">
    <div v-if="showModalAnnonce" class="cm-overlay" @click.self="showModalAnnonce = false">
      <div class="cm-modal cm-modal--lg">
        <div class="cm-modal-header">
          <h2 class="cm-modal-title">Nouvelle annonce</h2>
          <button @click="showModalAnnonce = false" class="cm-modal-close">✕</button>
        </div>
        <div class="cm-modal-body">
          <div class="cm-field">
            <label class="cm-label">Titre</label>
            <input v-model="formAnnonce.titre" type="text" placeholder="Titre de l'annonce" class="cm-input" />
          </div>
          <div class="cm-field">
            <label class="cm-label">Type</label>
            <select v-model="formAnnonce.type" class="cm-input">
              <option value="info">Info</option>
              <option value="urgent">Urgent</option>
              <option value="alerte">Alerte</option>
              <option value="evenement">Événement</option>
            </select>
          </div>
          <div class="cm-field">
            <label class="cm-label">Message <span style="color:#aaa;font-weight:400">({{ formAnnonce.contenu.length }}/500)</span></label>
            <textarea v-model="formAnnonce.contenu" rows="4" maxlength="500" placeholder="Contenu de l'annonce…" class="cm-input" style="resize:none"></textarea>
          </div>
          <div class="cm-field">
            <label class="cm-label">Destinataires</label>
            <div class="cm-chips">
              <button v-for="d in ['tous', 'etudiants', 'intervenants', 'administration']" :key="d"
                @click="toggleChip(formAnnonce.destinataires, d)"
                class="cm-chip"
                :class="formAnnonce.destinataires.includes(d) ? 'cm-chip--active' : ''">
                {{ d }}
              </button>
            </div>
          </div>
          <div class="cm-field">
            <label class="cm-label">Canal de diffusion</label>
            <div class="cm-chips">
              <button v-for="c in ['messagerie', 'sms', 'email']" :key="c"
                @click="toggleChip(formAnnonce.canaux, c)"
                class="cm-chip"
                :class="formAnnonce.canaux.includes(c) ? 'cm-chip--canal' : ''">
                {{ c }}
              </button>
            </div>
          </div>
          <div class="cm-field">
            <label class="cm-label">Programmer pour plus tard (optionnel)</label>
            <input v-model="formAnnonce.publie_at" type="datetime-local" class="cm-input" />
          </div>
        </div>
        <div class="cm-modal-footer">
          <button @click="showModalAnnonce = false" class="cm-btn-cancel">Annuler</button>
          <button @click="saveAnnonce(false)" :disabled="savingAnnonce" class="cm-btn-draft">Brouillon</button>
          <button @click="saveAnnonce(true)" :disabled="savingAnnonce || !formAnnonce.titre || !formAnnonce.contenu" class="uc-btn-primary" :style="(savingAnnonce || !formAnnonce.titre || !formAnnonce.contenu) ? 'opacity:0.4' : ''">
            {{ savingAnnonce ? 'Publication…' : 'Publier maintenant' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ── Modal : Nouveau message ──────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="showModalNouveauMsg" class="cm-overlay" @click.self="showModalNouveauMsg = false">
      <div class="cm-modal">
        <div class="cm-modal-header">
          <h2 class="cm-modal-title">Nouveau message</h2>
          <button @click="showModalNouveauMsg = false" class="cm-modal-close">✕</button>
        </div>
        <div class="cm-modal-body">
          <div class="cm-field">
            <label class="cm-label">Destinataire(s)</label>
            <input v-model="formMsg.destinataires" type="text" placeholder="Nom, groupe ou filière…" class="cm-input" />
          </div>
          <div class="cm-field">
            <label class="cm-label">Sujet (optionnel)</label>
            <input v-model="formMsg.sujet" type="text" class="cm-input" />
          </div>
          <div class="cm-field">
            <label class="cm-label">Message</label>
            <textarea v-model="formMsg.message" rows="5" class="cm-input" style="resize:none"></textarea>
          </div>
        </div>
        <div class="cm-modal-footer">
          <button @click="showModalNouveauMsg = false" class="cm-btn-cancel">Annuler</button>
          <button @click="sendNewMessage" :disabled="!formMsg.message.trim() || sendingNewMsg" class="uc-btn-primary" :style="(!formMsg.message.trim() || sendingNewMsg) ? 'opacity:0.4' : ''">
            {{ sendingNewMsg ? 'Envoi…' : 'Envoyer' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Layout */
.cm-layout { display:flex; flex-direction:column; height:calc(100vh - 4rem); }

/* Header */
.cm-header { display:flex; align-items:center; justify-content:space-between; padding:14px 22px; background:#fff; border-bottom:1px solid #eee; flex-shrink:0; }
.cm-header-title { font-size:17px; font-weight:700; color:#111; }
.cm-header-sub { font-size:12.5px; color:#888; margin-top:2px; }
.cm-header-actions { display:flex; gap:8px; align-items:center; }
.cm-btn-outline { display:flex; align-items:center; gap:6px; padding:7px 14px; font-size:13px; font-weight:500; border:1px solid #ddd; border-radius:7px; background:#fff; color:#444; cursor:pointer; }
.cm-btn-outline:hover { background:#f9f9f9; }

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
.cm-msg-time { font-size:11px; color:#aaa; margin-top:3px; padding-left:4px; }
.cm-msg-time--right { text-align:right; padding-left:0; padding-right:4px; }
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

/* Modal */
.cm-overlay { position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.4); padding:16px; }
.cm-modal { background:#fff; border-radius:12px; width:100%; max-width:420px; box-shadow:0 20px 60px rgba(0,0,0,0.2); display:flex; flex-direction:column; max-height:90vh; }
.cm-modal--lg { max-width:520px; }
.cm-modal-header { display:flex; align-items:center; justify-content:space-between; padding:16px 20px 12px; border-bottom:1px solid #f0f0f0; }
.cm-modal-title { font-size:15px; font-weight:700; color:#111; }
.cm-modal-close { width:26px; height:26px; display:flex; align-items:center; justify-content:center; border:none; background:none; cursor:pointer; color:#aaa; font-size:14px; border-radius:6px; }
.cm-modal-close:hover { background:#f5f5f5; }
.cm-modal-body { padding:16px 20px; display:flex; flex-direction:column; gap:12px; overflow-y:auto; }
.cm-modal-footer { display:flex; justify-content:flex-end; gap:8px; padding:12px 20px 16px; border-top:1px solid #f0f0f0; }
.cm-btn-cancel { padding:8px 14px; font-size:13px; color:#555; border:1px solid #ddd; background:#fff; border-radius:7px; cursor:pointer; }
.cm-btn-cancel:hover { background:#f9f9f9; }
.cm-btn-draft { padding:8px 14px; font-size:13px; color:#444; border:1px solid #ddd; background:#fff; border-radius:7px; cursor:pointer; }
.cm-btn-draft:hover { background:#f9f9f9; }
.cm-btn-draft:disabled { opacity:0.4; cursor:not-allowed; }

/* Form */
.cm-field { display:flex; flex-direction:column; }
.cm-label { font-size:11.5px; font-weight:600; color:#555; margin-bottom:5px; }
.cm-input { width:100%; padding:8px 12px; border:1px solid #e0e0e0; border-radius:7px; font-size:13px; color:#111; outline:none; box-sizing:border-box; font-family:inherit; }
.cm-input:focus { border-color:#E30613; box-shadow:0 0 0 2px rgba(227,6,19,0.08); }

/* Chips */
.cm-chips { display:flex; flex-wrap:wrap; gap:6px; }
.cm-chip { padding:5px 12px; font-size:12px; border-radius:20px; border:1px solid #ddd; background:#fff; color:#555; cursor:pointer; transition:all 0.15s; }
.cm-chip:hover { border-color:#ccc; }
.cm-chip--active { background:#E30613; color:#fff; border-color:#E30613; }
.cm-chip--canal { background:#111; color:#fff; border-color:#111; }

/* Empty */
.cm-empty-text { text-align:center; font-size:13px; color:#aaa; padding:16px; }
</style>
