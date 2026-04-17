<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'

// ---------- Service Worker update detection ----------
const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegistered(r) {
    if (r) {
      // Poll for updates every 60 s when the tab is visible
      setInterval(() => { r.update() }, 60_000)
    }
  },
})

// ---------- iOS detection ----------
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches

// ---------- Refs ----------
const showInstallCard = ref(false)     // Android/Desktop
const showIosBanner = ref(false)       // iOS banner
const showIosOverlay = ref(false)      // iOS step-by-step overlay
const isOnline = ref(navigator.onLine)
const showOnlineBadge = ref(false)     // briefly shown when back online

// ---------- Android / Desktop install prompt ----------
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let onlineTimer: ReturnType<typeof setTimeout> | null = null

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault()
  deferredPrompt = e as BeforeInstallPromptEvent
  setTimeout(() => {
    showInstallCard.value = true
  }, 3000)
}

async function install() {
  if (!deferredPrompt) return
  await deferredPrompt.prompt()
  await deferredPrompt.userChoice
  deferredPrompt = null
  showInstallCard.value = false
}

function dismissInstall() {
  showInstallCard.value = false
  localStorage.setItem('pwa-prompt-dismissed', String(Date.now()))
}

// ---------- iOS handlers ----------
function dismissIosBanner() {
  showIosBanner.value = false
}

function openIosOverlay() {
  showIosBanner.value = false
  showIosOverlay.value = true
}

function closeIosOverlay() {
  showIosOverlay.value = false
}

// ---------- Online / offline ----------
function handleOnline() {
  isOnline.value = true
  showOnlineBadge.value = true
  if (onlineTimer) clearTimeout(onlineTimer)
  onlineTimer = setTimeout(() => {
    showOnlineBadge.value = false
  }, 3000)
}

function handleOffline() {
  isOnline.value = false
  showOnlineBadge.value = false
  if (onlineTimer) clearTimeout(onlineTimer)
}

// ---------- Lifecycle ----------
onMounted(() => {
  // Android / Desktop
  if (!isIos) {
    const dismissed = localStorage.getItem('pwa-prompt-dismissed')
    const notRecentlyDismissed =
      !dismissed || Date.now() - Number(dismissed) >= 7 * 24 * 60 * 60 * 1000
    if (notRecentlyDismissed) {
      window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    }
  }

  // iOS — show banner after 4 s if not already installed
  if (isIos && !isInStandaloneMode) {
    setTimeout(() => {
      showIosBanner.value = true
    }, 4000)
  }

  // Online / offline events
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
})

onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  if (onlineTimer) clearTimeout(onlineTimer)
})
</script>

<template>
  <!-- ===== SW Update banner (top) ===== -->
  <Transition name="slide-down">
    <div v-if="needRefresh" class="pwa-update-banner" role="alert">
      <span class="pwa-update-text">🔄 Mise à jour disponible</span>
      <button class="pwa-btn pwa-btn--white" @click="updateServiceWorker()">Actualiser</button>
    </div>
  </Transition>

  <!-- ===== Android / Desktop install card (bottom) ===== -->
  <Transition name="slide-up">
    <div v-if="showInstallCard" class="pwa-install-card" role="dialog" aria-label="Installer l'application">
      <div class="pwa-install-icon">
        <img src="/icons/icon-192.png" alt="UPTECH" />
      </div>
      <div class="pwa-install-text">
        <p class="pwa-install-title">Installer l'application</p>
        <p class="pwa-install-sub">Accédez à UPTECH Campus depuis votre écran d'accueil</p>
      </div>
      <div class="pwa-install-actions">
        <button class="pwa-btn pwa-btn--ghost" @click="dismissInstall">Plus tard</button>
        <button class="pwa-btn pwa-btn--primary" @click="install">Installer</button>
      </div>
    </div>
  </Transition>

  <!-- ===== iOS install banner (bottom) ===== -->
  <Transition name="slide-up">
    <div v-if="showIosBanner" class="pwa-ios-banner" role="dialog" aria-label="Ajouter à l'écran d'accueil">
      <div class="pwa-install-icon">
        <img src="/icons/icon-192.png" alt="UPTECH" />
      </div>
      <div class="pwa-install-text">
        <p class="pwa-install-title">Ajouter à l'écran d'accueil</p>
        <p class="pwa-install-sub">Appuyez sur Partager, puis « Sur l'écran d'accueil »</p>
      </div>
      <div class="pwa-install-actions">
        <button class="pwa-btn pwa-btn--ghost" @click="dismissIosBanner">Fermer</button>
        <button class="pwa-btn pwa-btn--primary" @click="openIosOverlay">Comment ?</button>
      </div>
    </div>
  </Transition>

  <!-- ===== iOS step-by-step overlay ===== -->
  <Transition name="fade">
    <div v-if="showIosOverlay" class="pwa-ios-overlay" role="dialog" aria-modal="true" aria-label="Instructions d'installation iOS">
      <div class="pwa-ios-overlay-card">
        <button class="pwa-overlay-close" @click="closeIosOverlay" aria-label="Fermer">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div class="pwa-ios-logo">
          <img src="/icons/icon-192.png" alt="UPTECH" />
        </div>
        <h2 class="pwa-ios-title">Installer UPTECH Campus</h2>
        <ol class="pwa-ios-steps">
          <li>
            <span class="step-num">1</span>
            <span class="step-text">
              Appuyez sur le bouton
              <strong>Partager</strong>
              <svg class="step-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                   aria-hidden="true">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              dans Safari
            </span>
          </li>
          <li>
            <span class="step-num">2</span>
            <span class="step-text">Faites défiler et appuyez sur <strong>« Sur l'écran d'accueil »</strong></span>
          </li>
          <li>
            <span class="step-num">3</span>
            <span class="step-text">Appuyez sur <strong>Ajouter</strong> en haut à droite</span>
          </li>
        </ol>
        <button class="pwa-btn pwa-btn--primary pwa-btn--full" @click="closeIosOverlay">Compris</button>
      </div>
    </div>
  </Transition>

  <!-- ===== Online / offline badge (bottom-left) ===== -->
  <Transition name="fade">
    <div
      v-if="!isOnline || showOnlineBadge"
      class="pwa-net-badge"
      :class="isOnline ? 'pwa-net-badge--online' : 'pwa-net-badge--offline'"
      role="status"
      :aria-label="isOnline ? 'Connecté' : 'Hors-ligne'"
    >
      <span class="pwa-net-dot" />
      {{ isOnline ? 'Connecté' : 'Hors-ligne' }}
    </div>
  </Transition>
</template>

<style scoped>
/* ---- Base font ---- */
* { font-family: 'Poppins', system-ui, sans-serif; }

/* ============================================================
   SW Update banner
   ============================================================ */
.pwa-update-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10000;
  background: #111111;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 600;
}

.pwa-update-text { flex: 1; text-align: center; }

/* ============================================================
   Shared install card styles
   ============================================================ */
.pwa-install-card,
.pwa-ios-banner {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% - 40px);
  max-width: 480px;
  border-left: 4px solid #E30613;
}

.pwa-install-icon img {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  flex-shrink: 0;
}

.pwa-install-text { flex: 1; min-width: 0; }

.pwa-install-title {
  font-size: 13px;
  font-weight: 700;
  color: #111;
  margin: 0 0 2px;
}

.pwa-install-sub {
  font-size: 11px;
  color: #888;
  margin: 0;
  line-height: 1.4;
}

.pwa-install-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ============================================================
   Buttons
   ============================================================ */
.pwa-btn {
  border-radius: 7px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  transition: background 0.18s ease, transform 0.1s ease;
}

.pwa-btn:active { transform: scale(0.96); }

.pwa-btn--primary {
  background: #E30613;
  color: #fff;
}

.pwa-btn--primary:hover { background: #b80410; }

.pwa-btn--ghost {
  background: transparent;
  color: #888;
  border: 1.5px solid #e5e5e5;
}

.pwa-btn--ghost:hover { background: #f5f5f5; }

.pwa-btn--white {
  background: #fff;
  color: #E30613;
  border: 1.5px solid #fff;
}

.pwa-btn--white:hover { background: #f5f5f5; }

.pwa-btn--full { width: 100%; justify-content: center; }

/* ============================================================
   iOS overlay
   ============================================================ */
.pwa-ios-overlay {
  position: fixed;
  inset: 0;
  z-index: 10001;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 16px;
}

.pwa-ios-overlay-card {
  background: #fff;
  border-radius: 20px;
  padding: 24px 20px 20px;
  width: 100%;
  max-width: 400px;
  position: relative;
}

.pwa-overlay-close {
  position: absolute;
  top: 14px;
  right: 14px;
  background: #f0f0f0;
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #555;
  transition: background 0.15s;
}

.pwa-overlay-close:hover { background: #e5e5e5; }

.pwa-ios-logo {
  display: flex;
  justify-content: center;
  margin-bottom: 14px;
}

.pwa-ios-logo img {
  width: 60px;
  height: 60px;
  border-radius: 14px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
}

.pwa-ios-title {
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  color: #111;
  margin: 0 0 20px;
}

.pwa-ios-steps {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pwa-ios-steps li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.step-num {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  background: #E30613;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}

.step-text {
  font-size: 13px;
  color: #333;
  line-height: 1.5;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.step-icon {
  display: inline-block;
  vertical-align: middle;
  color: #E30613;
  flex-shrink: 0;
}

/* ============================================================
   Online / offline badge
   ============================================================ */
.pwa-net-badge {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 9998;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: #e8e8e8;
  color: #333;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}

.pwa-net-badge--offline .pwa-net-dot { background: #E30613; }
.pwa-net-badge--online  .pwa-net-dot { background: #22c55e; }

.pwa-net-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ============================================================
   Transitions
   ============================================================ */
.slide-up-enter-active,
.slide-up-leave-active { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.slide-up-enter-from { transform: translateX(-50%) translateY(120px); opacity: 0; }
.slide-up-leave-to  { transform: translateX(-50%) translateY(120px); opacity: 0; }

.slide-down-enter-active,
.slide-down-leave-active { transition: all 0.3s ease; }
.slide-down-enter-from { transform: translateY(-100%); opacity: 0; }
.slide-down-leave-to  { transform: translateY(-100%); opacity: 0; }

.fade-enter-active,
.fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
