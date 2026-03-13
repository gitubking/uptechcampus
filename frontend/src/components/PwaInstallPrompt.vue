<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const showPrompt = ref(false)
const showUpdateBanner = ref(false)
let deferredPrompt: any = null

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault()
  deferredPrompt = e
  // Show prompt after 3 seconds if not already installed
  setTimeout(() => { showPrompt.value = true }, 3000)
}

async function install() {
  if (!deferredPrompt) return
  deferredPrompt.prompt()
  const { outcome } = await deferredPrompt.userChoice
  deferredPrompt = null
  showPrompt.value = false
}

function dismiss() {
  showPrompt.value = false
  // Don't show again for 7 days
  localStorage.setItem('pwa-prompt-dismissed', String(Date.now()))
}

onMounted(() => {
  // Check if already dismissed recently
  const dismissed = localStorage.getItem('pwa-prompt-dismissed')
  if (dismissed && Date.now() - Number(dismissed) < 7 * 24 * 60 * 60 * 1000) return

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

  // Service worker update detection
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      showUpdateBanner.value = true
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
})

function reloadForUpdate() {
  window.location.reload()
}
</script>

<template>
  <!-- Install prompt -->
  <Transition name="slide-up">
    <div v-if="showPrompt" class="pwa-prompt">
      <div class="pwa-prompt-icon">
        <img src="/icons/icon-192.png" alt="UPTECH" />
      </div>
      <div class="pwa-prompt-text">
        <p class="pwa-prompt-title">Installer l'application</p>
        <p class="pwa-prompt-sub">Accédez à UPTECH Campus depuis votre écran d'accueil</p>
      </div>
      <div class="pwa-prompt-actions">
        <button @click="dismiss" class="pwa-btn-dismiss">Plus tard</button>
        <button @click="install" class="pwa-btn-install">Installer</button>
      </div>
    </div>
  </Transition>

  <!-- Update banner -->
  <Transition name="slide-down">
    <div v-if="showUpdateBanner" class="pwa-update-banner">
      <span>🔄 Nouvelle version disponible</span>
      <button @click="reloadForUpdate" class="pwa-btn-update">Actualiser</button>
    </div>
  </Transition>
</template>

<style scoped>
.pwa-prompt {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% - 40px);
  max-width: 480px;
  border-left: 4px solid #E30613;
}

.pwa-prompt-icon img {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  flex-shrink: 0;
}

.pwa-prompt-text {
  flex: 1;
  min-width: 0;
}

.pwa-prompt-title {
  font-size: 13px;
  font-weight: 700;
  color: #111;
  margin: 0 0 2px;
}

.pwa-prompt-sub {
  font-size: 11px;
  color: #888;
  margin: 0;
}

.pwa-prompt-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.pwa-btn-dismiss {
  border: 1.5px solid #e5e5e5;
  background: #fff;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #888;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
}

.pwa-btn-install {
  background: #E30613;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
}

.pwa-btn-install:hover { background: #c00; }

/* Update banner */
.pwa-update-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  background: #111;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.pwa-btn-update {
  background: #E30613;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
}

/* Transitions */
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.3s ease; }
.slide-up-enter-from { transform: translateX(-50%) translateY(100px); opacity: 0; }
.slide-up-leave-to  { transform: translateX(-50%) translateY(100px); opacity: 0; }

.slide-down-enter-active, .slide-down-leave-active { transition: all 0.3s ease; }
.slide-down-enter-from { transform: translateY(-100%); }
.slide-down-leave-to  { transform: translateY(-100%); }
</style>
