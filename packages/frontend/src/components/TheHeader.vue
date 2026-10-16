<template>
  <header class="topbar">
    <a class="brand" href="/configure">
      <svg width="26" height="26" viewBox="0 0 48 48" aria-hidden="true"><rect x="1" y="1" width="46" height="46" rx="11" fill="#1f1f1f" stroke="#2e2e2e"/><path d="M15 34V14l18 20V14" fill="none" stroke="#3ecf8e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="brand-name">{{ info?.name || 'NexoTV' }}</span>
    </a>
    <span class="crumb-sep" aria-hidden="true">/</span>
    <span class="crumb">{{ reconfigure ? 'Edit install' : 'New install' }}</span>
    <span class="topbar-gap"></span>
    <nav class="topbar-links" aria-label="Project">
      <a href="https://github.com/joaosavi/nexotv#readme" target="_blank" rel="noopener">Docs</a>
      <a href="https://github.com/joaosavi/nexotv" target="_blank" rel="noopener">GitHub</a>
    </nav>
  </header>
</template>

<script setup lang="ts">
import { useAddonInfo } from '../composables/useAddonInfo'

defineProps<{ reconfigure: boolean }>()
const { info } = useAddonInfo()
</script>
