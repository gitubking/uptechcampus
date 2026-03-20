<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="uc-modal-overlay" @click.self="emit('update:modelValue', false); emit('close')">
        <div class="uc-modal-box" :style="{ maxWidth: width, width: '100%' }">
          <div class="uc-modal-header">
            <div>
              <h2 class="uc-modal-title">{{ title }}</h2>
              <p v-if="subtitle" class="uc-modal-subtitle">{{ subtitle }}</p>
            </div>
            <button type="button" class="uc-modal-close" @click.stop="emit('update:modelValue', false); emit('close')">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="uc-modal-body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="uc-modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: boolean
  title: string
  subtitle?: string
  width?: string
}>(), {
  width: '560px',
  subtitle: undefined,
})

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'close'): void
}>()
</script>
