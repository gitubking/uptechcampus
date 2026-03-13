<template>
  <div class="uc-page-header">
    <div>
      <h1 class="uc-page-header-title">{{ title }}</h1>
      <p v-if="subtitle" class="uc-page-header-sub">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="uc-page-header-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  subtitle?: string
}>(), {
  subtitle: undefined,
})
</script>
