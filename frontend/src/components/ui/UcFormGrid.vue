<template>
  <div :class="['uc-form-grid', `uc-form-grid--${cols}`]" :style="{ gap }">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  cols?: 1 | 2 | 3
  gap?: string
}>(), {
  cols: 2,
  gap: '12px',
})
</script>
