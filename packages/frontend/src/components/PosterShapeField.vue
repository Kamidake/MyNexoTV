<template>
  <div class="field field-wide">
    <span class="field-label" :id="`${id}-label`">Channel artwork</span>
    <div class="chips" role="group" :aria-labelledby="`${id}-label`">
      <button v-for="s in SHAPES" :key="s.value" type="button" class="chip"
        :class="{ active: modelValue === s.value }" :aria-pressed="modelValue === s.value"
        @click="emit('update:modelValue', s.value)">{{ s.label }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PosterShape } from '../types/config'

defineProps<{ id: string; modelValue: PosterShape }>()
const emit = defineEmits<{ 'update:modelValue': [value: PosterShape] }>()

const SHAPES: { value: PosterShape; label: string }[] = [
  { value: 'poster', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape 16:9' },
]
</script>
