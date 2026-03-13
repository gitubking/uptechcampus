<template>
  <div class="uc-form-group">
    <label v-if="label" class="uc-label">
      {{ label }}<span v-if="required" class="uc-label-req">*</span>
    </label>
    <slot />
    <p v-if="error" class="uc-form-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
  required?: boolean
  error?: string
}>(), {
  label: undefined,
  required: false,
  error: undefined,
})
</script>
