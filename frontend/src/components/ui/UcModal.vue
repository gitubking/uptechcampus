<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="uc-modal-overlay" @click.self="emit('close')">
        <div class="uc-modal-box" :style="{ maxWidth: width }">
          <div class="uc-modal-header">
            <div>
              <h2 class="uc-modal-title">{{ title }}</h2>
              <p v-if="subtitle" class="uc-modal-subtitle">{{ subtitle }}</p>
            </div>
            <button class="uc-modal-close" @click="emit('close')">×</button>
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
