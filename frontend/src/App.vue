<script setup lang="ts">
import { RouterView } from 'vue-router'
import PwaInstallPrompt from '@/components/PwaInstallPrompt.vue'
import { UcToastContainer, UcCommandPalette } from '@/components/ui'
</script>

<template>
  <RouterView />
  <PwaInstallPrompt />
  <UcCommandPalette />
  <UcToastContainer />
</template>
