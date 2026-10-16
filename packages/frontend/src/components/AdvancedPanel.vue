<template>
  <div class="advanced" :class="{ open }">
    <button type="button" class="advanced-toggle" :aria-expanded="open" :aria-controls="id" @click="emit('update:open', !open)">
      <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      Advanced options
    </button>
    <div v-show="open" :id="id" class="advanced-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ open: boolean; id: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
</script>
