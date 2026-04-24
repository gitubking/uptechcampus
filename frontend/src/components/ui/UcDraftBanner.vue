<script setup lang="ts">
defineProps<{
  show: boolean
  ageLabel?: string
}>()
const emit = defineEmits<{ restore: []; discard: [] }>()
</script>

<template>
  <Transition name="ucdraft">
    <div v-if="show" class="ucdraft-banner" role="status">
      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#d97706;flex-shrink:0"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3M12 22a10 10 0 100-20 10 10 0 000 20z"/></svg>
      <div class="ucdraft-body">
        <strong>Un brouillon a été trouvé</strong>
        <span v-if="ageLabel">Sauvegardé automatiquement {{ ageLabel }}. Voulez-vous le restaurer ?</span>
        <span v-else>Voulez-vous restaurer votre saisie précédente ?</span>
      </div>
      <div class="ucdraft-actions">
        <button type="button" class="ucdraft-btn-primary" @click="emit('restore')">Restaurer</button>
        <button type="button" class="ucdraft-btn-ghost" @click="emit('discard')">Ignorer</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ucdraft-banner {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: #fffbeb; border: 1px solid #fde68a;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 13px;
}
.ucdraft-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ucdraft-body strong { color: #92400e; font-weight: 700; font-size: 13px; }
.ucdraft-body span { color: #b45309; font-size: 12px; }
.ucdraft-actions { display: flex; gap: 6px; flex-shrink: 0; }
.ucdraft-btn-primary {
  padding: 6px 12px; font-size: 12px; font-weight: 600;
  background: #d97706; color: #fff;
  border: none; border-radius: 5px; cursor: pointer;
}
.ucdraft-btn-primary:hover { background: #b45309; }
.ucdraft-btn-ghost {
  padding: 6px 12px; font-size: 12px; font-weight: 600;
  background: transparent; color: #92400e;
  border: 1px solid #fde68a; border-radius: 5px; cursor: pointer;
}
.ucdraft-btn-ghost:hover { background: #fef3c7; }

.ucdraft-enter-active, .ucdraft-leave-active { transition: all .2s ease-out; }
.ucdraft-enter-from, .ucdraft-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
