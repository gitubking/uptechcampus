<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

interface UserNotification {
  id: number
  type: string
  titre: string
  message: string
  data: any
  lu: boolean
  created_at: string
  lien?: string | null
}

const props = defineProps<{
  // Variante visuelle : light = topbar dark (étudiant/parent), dark = topbar clair (admin)
  variant?: 'light' | 'dark'
}>()

const auth = useAuthStore()
const userNotifs = ref<UserNotification[]>([])
const unreadCount = ref(0)
const showPanel = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

async function fetchNotifs() {
  if (!auth.isAuthenticated) return
  try {
    const { data } = await api.get('/user-notifications')
    userNotifs.value = data.notifications ?? []
    unreadCount.value = data.unread ?? 0
  } catch { /* silencieux */ }
}

async function markAllRead() {
  try {
    await api.post('/user-notifications/read-all')
    userNotifs.value = userNotifs.value.map(n => ({ ...n, lu: true }))
    unreadCount.value = 0
  } catch { /* silencieux */ }
}

async function markOneRead(notif: UserNotification) {
  if (notif.lu) return
  try {
    await api.post(`/user-notifications/${notif.id}/read`)
    notif.lu = true
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  } catch { /* silencieux */ }
}

function togglePanel() { showPanel.value = !showPanel.value }
function closePanel() { showPanel.value = false }

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'à l\'instant'
  if (mins < 60) return `il y a ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `il y a ${h}h`
  const d = Math.floor(h / 24)
  return `il y a ${d}j`
}

const iconMap: Record<string, string> = {
  paiement: '✅', note: '📊', echeance: '⏰', info: 'ℹ️',
  message: '💬', absence: '📅', bulletin: '🎓', relance: '⚠️',
}

onMounted(() => {
  fetchNotifs()
  pollTimer = setInterval(fetchNotifs, 30000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const isLight = props.variant === 'light' || !props.variant
</script>

<template>
  <div class="ucb-wrap">
    <button
      class="ucb-btn"
      :class="{ 'ucb-btn--active': showPanel, 'ucb-btn--dark': !isLight }"
      title="Notifications"
      @click="togglePanel"
    >
      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      <span v-if="unreadCount > 0" class="ucb-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>

    <!-- Overlay pour fermer au clic extérieur -->
    <div v-if="showPanel" class="ucb-overlay" @click="closePanel"></div>

    <!-- Dropdown panel -->
    <Transition name="ucb-drop">
      <div v-if="showPanel" class="ucb-panel">
        <div class="ucb-head">
          <span>Notifications</span>
          <button v-if="unreadCount > 0" class="ucb-read-all" @click="markAllRead">Tout marquer lu</button>
        </div>
        <div class="ucb-list">
          <div v-if="userNotifs.length === 0" class="ucb-empty">
            <svg width="32" height="32" fill="none" stroke="#d1d5db" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
            </svg>
            <p>Aucune notification</p>
          </div>
          <div
            v-for="notif in userNotifs"
            :key="notif.id"
            class="ucb-item"
            :class="{ 'ucb-item--unread': !notif.lu }"
            @click="markOneRead(notif)"
          >
            <span class="ucb-ico">{{ iconMap[notif.type] ?? 'ℹ️' }}</span>
            <div class="ucb-content">
              <p class="ucb-titre">{{ notif.titre }}</p>
              <p class="ucb-msg">{{ notif.message }}</p>
              <span class="ucb-time">{{ timeAgo(notif.created_at) }}</span>
            </div>
            <span v-if="!notif.lu" class="ucb-unread-dot"></span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ucb-wrap { position: relative; }
.ucb-btn {
  position: relative; padding: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #cbd5e1;
  cursor: pointer;
  transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.ucb-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.ucb-btn--active { background: rgba(255, 255, 255, 0.12); color: #fff; }

.ucb-btn--dark { /* topbar clair (espace admin) */
  background: #f1f5f9;
  border-color: #e2e8f0;
  color: #475569;
}
.ucb-btn--dark:hover { background: #e2e8f0; color: #1e293b; }
.ucb-btn--dark.ucb-btn--active { background: #e2e8f0; color: #0f172a; }

.ucb-badge {
  position: absolute; top: -3px; right: -3px;
  min-width: 18px; height: 18px; padding: 0 4px;
  background: #dc2626; color: #fff;
  font-size: 10px; font-weight: 700;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid #fff;
  line-height: 1;
}
.ucb-btn--dark .ucb-badge { border-color: #fff; }

.ucb-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: transparent;
}

.ucb-panel {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 380px; max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2), 0 4px 12px rgba(15, 23, 42, 0.08);
  z-index: 60;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}

.ucb-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
  font-weight: 700; color: #0f172a; font-size: 13.5px;
}
.ucb-read-all {
  font-size: 11.5px; font-weight: 600;
  color: #2563eb; background: none; border: none; cursor: pointer;
  padding: 4px 8px; border-radius: 5px;
}
.ucb-read-all:hover { background: #eff6ff; }

.ucb-list { max-height: 60vh; overflow-y: auto; }
.ucb-empty {
  padding: 32px 16px; text-align: center; color: #94a3b8;
  font-size: 13px;
}
.ucb-empty svg { margin: 0 auto 8px; display: block; }

.ucb-item {
  display: flex; gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #f8fafc;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
}
.ucb-item:hover { background: #f8fafc; }
.ucb-item--unread { background: #eff6ff; }
.ucb-item--unread:hover { background: #dbeafe; }

.ucb-ico {
  flex-shrink: 0;
  font-size: 18px;
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: #f1f5f9; border-radius: 8px;
}
.ucb-content { flex: 1; min-width: 0; }
.ucb-titre {
  font-size: 13px; font-weight: 700; color: #0f172a;
  margin: 0 0 2px;
}
.ucb-msg {
  font-size: 12px; color: #475569;
  margin: 0; line-height: 1.4;
  word-wrap: break-word;
}
.ucb-time {
  font-size: 10.5px; color: #94a3b8;
  margin-top: 4px; display: block;
}
.ucb-unread-dot {
  position: absolute; top: 16px; right: 14px;
  width: 8px; height: 8px;
  background: #2563eb; border-radius: 50%;
}

/* Transitions */
.ucb-drop-enter-active, .ucb-drop-leave-active { transition: all 0.18s ease-out; }
.ucb-drop-enter-from { opacity: 0; transform: translateY(-8px); }
.ucb-drop-leave-to { opacity: 0; transform: translateY(-4px); }

@media (max-width: 640px) {
  .ucb-panel { width: calc(100vw - 24px); right: -8px; }
}
</style>
