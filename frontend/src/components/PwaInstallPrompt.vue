<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

const showPrompt = ref(false)
const showUpdateBanner = ref(false)
const isIos = ref(false)
const isIosInstalled = ref(false)
let deferredPrompt: any = null

const isIosDevice = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault()
  deferredPrompt = e
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
  localStorage.setItem('pwa-prompt-dismissed', String(Date.now()))
}

onMounted(() => {
  const dismissed = localStorage.getItem('pwa-prompt-dismissed')
  if (dismissed && Date.now() - Number(dismissed) < 7 * 24 * 60 * 60 * 1000) return

  isIos.value = isIosDevice()
  isIosInstalled.value = (window.navigator as any).standalone === true

  if (isIos.value && !isIosInstalled.value) {
    setTimeout(() => { showPrompt.value = true }, 4000)
  }

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

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
  <!-- Update banner -->
  <Transition name="slide-down">
    <div v-if="showUpdateBanner" class="pwa-update-banner">
      <span>🔄 Nouvelle version disponible</span>
      <button @click="reloadForUpdate" class="pwa-btn-update">Actualiser</button>
    </div>
  </Transition>

  <!-- Install prompt — Android/Chrome -->
  <Transition name="slide-up">
    <div v-if="showPrompt && !isIos" class="pwa-prompt">
      <img src="/icons/icon-192.png" alt="UPTECH" class="pwa-prompt-icon" />
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

  <!-- iOS instructions -->
  <Transition name="slide-up">
    <div v-if="showPrompt && isIos" class="pwa-prompt pwa-prompt--ios">
      <img src="/icons/icon-192.png" alt="UPTECH" class="pwa-prompt-icon" />
      <div class="pwa-prompt-text">
        <p class="pwa-prompt-title">Installer sur iPhone / iPad</p>
        <p class="pwa-prompt-sub">
          Appuyez sur
          <svg class="pwa-ios-share" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
          puis <strong>« Sur l'écran d'accueil »</strong>
        </p>
      </div>
      <button @click="dismiss" class="pwa-btn-dismiss">Fermer</button>
    </div>
  </Transition>
</template>

<style scoped>
.pwa-prompt {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(20px + env(safe-area-inset-bottom));
  z-index: 9999;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% - 32px);
  max-width: 480px;
  border-left: 4px solid #E30613;
}

.pwa-prompt--ios { border-left-color: #007aff; }

.pwa-prompt-icon { width: 44px; height: 44px; border-radius: 10px; flex-shrink: 0; }

.pwa-prompt-text { flex: 1; min-width: 0; }
.pwa-prompt-title { font-size: 13px; font-weight: 700; color: #111; margin: 0 0 3px; }
.pwa-prompt-sub { font-size: 11.5px; color: #666; margin: 0; display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }

.pwa-ios-share { width: 14px; height: 14px; display: inline; vertical-align: middle; color: #007aff; flex-shrink: 0; }

.pwa-prompt-actions { display: flex; gap: 8px; flex-shrink: 0; }

.pwa-btn-dismiss {
  border: 1.5px solid #e5e5e5; background: #fff; border-radius: 8px;
  padding: 8px 12px; font-size: 11.5px; font-weight: 600; color: #888;
  cursor: pointer; font-family: inherit; min-height: 36px;
}
.pwa-btn-dismiss:hover { background: #f5f5f5; }

.pwa-btn-install {
  background: #E30613; color: #fff; border: none; border-radius: 8px;
  padding: 8px 14px; font-size: 11.5px; font-weight: 700;
  cursor: pointer; font-family: inherit; min-height: 36px;
}
.pwa-btn-install:hover { background: #c00; }

/* Update banner */
.pwa-update-banner {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  background: #111; color: #fff; font-size: 12.5px; font-weight: 600;
  padding: 12px 20px; padding-top: max(12px, env(safe-area-inset-top));
  display: flex; align-items: center; justify-content: center; gap: 16px;
}

.pwa-btn-update {
  background: #E30613; color: #fff; border: none; border-radius: 6px;
  padding: 6px 14px; font-size: 11.5px; font-weight: 700;
  cursor: pointer; font-family: inherit; min-height: 32px;
}

/* Transitions */
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.35s cubic-bezier(0.34,1.56,0.64,1); }
.slide-up-enter-from { transform: translateX(-50%) translateY(120px); opacity: 0; }
.slide-up-leave-to  { transform: translateX(-50%) translateY(120px); opacity: 0; }

.slide-down-enter-active, .slide-down-leave-active { transition: all 0.25s ease; }
.slide-down-enter-from { transform: translateY(-100%); opacity: 0; }
.slide-down-leave-to  { transform: translateY(-100%); opacity: 0; }

@media (max-width: 480px) {
  .pwa-prompt { flex-wrap: wrap; padding: 14px; }
  .pwa-prompt-actions { width: 100%; justify-content: flex-end; }
}
</style>
