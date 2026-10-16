<template>
  <section class="step" :aria-labelledby="`step-${n}-title`">
    <span class="step-num" :class="{ done }" aria-hidden="true">{{ n }}</span>
    <div class="step-body">
      <h2 :id="`step-${n}-title`" class="step-title">{{ title }}</h2>
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ n: number; title: string; done?: boolean }>()
</script>
