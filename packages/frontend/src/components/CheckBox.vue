<template>
  <label class="check" :class="{ disabled }">
    <input type="checkbox" :id="id" :checked="modelValue" :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)">
    <span class="check-box" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
    </span>
    <span><slot /></span>
  </label>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; id: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
