<script setup lang="ts">
import { useToast } from '@/composables/useToast'
const toast = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="uc-toast-container" role="region" aria-live="polite" aria-label="Notifications">
      <TransitionGroup name="uc-toast">
        <div
          v-for="t in toast.toasts"
          :key="t.id"
          class="uc-toast"
          :class="`uc-toast--${t.kind}`"
          role="alert"
          @click="toast.dismiss(t.id)"
        >
          <div class="uc-toast-icon" :aria-hidden="true">
            <svg v-if="t.kind === 'success'" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
            <svg v-else-if="t.kind === 'error'" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
            <svg v-else-if="t.kind === 'warning'" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            <svg v-else width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <div class="uc-toast-body">
            <div v-if="t.title" class="uc-toast-title">{{ t.title }}</div>
            <div class="uc-toast-msg">{{ t.message }}</div>
          </div>
          <button class="uc-toast-close" @click.stop="toast.dismiss(t.id)" aria-label="Fermer">×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.uc-toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: calc(100vw - 40px);
  width: 380px;
  pointer-events: none;
}
.uc-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px 12px 12px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.08);
  border-left: 4px solid #64748b;
  font-size: 13.5px;
  color: #1e293b;
  cursor: pointer;
  max-width: 100%;
}
.uc-toast-icon { flex-shrink: 0; padding-top: 2px; }
.uc-toast-body { flex: 1; min-width: 0; }
.uc-toast-title {
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 2px;
  color: #0f172a;
}
.uc-toast-msg {
  line-height: 1.45;
  color: #334155;
  word-wrap: break-word;
}
.uc-toast-close {
  flex-shrink: 0;
  background: none;
  border: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: #94a3b8;
  padding: 0 4px;
  margin-top: -2px;
  align-self: flex-start;
}
.uc-toast-close:hover { color: #334155; }

.uc-toast--success { border-left-color: #16a34a; }
.uc-toast--success .uc-toast-icon { color: #16a34a; }
.uc-toast--error   { border-left-color: #dc2626; }
.uc-toast--error   .uc-toast-icon { color: #dc2626; }
.uc-toast--warning { border-left-color: #d97706; }
.uc-toast--warning .uc-toast-icon { color: #d97706; }
.uc-toast--info    { border-left-color: #2563eb; }
.uc-toast--info    .uc-toast-icon { color: #2563eb; }

/* Transitions */
.uc-toast-enter-active, .uc-toast-leave-active { transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
.uc-toast-enter-from { opacity: 0; transform: translateX(30px); }
.uc-toast-leave-to   { opacity: 0; transform: translateX(30px); }
.uc-toast-move       { transition: transform 0.3s ease; }

@media (max-width: 600px) {
  .uc-toast-container {
    left: 10px;
    right: 10px;
    bottom: 10px;
    width: auto;
  }
}
</style>
