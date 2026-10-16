<template>
  <header class="ident">
    <div class="color-bars" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
    </div>
    <div v-if="loading" class="ident-skeleton">
      <div class="skeleton-icon"></div>
      <div class="skeleton-lines">
        <div class="skeleton-line w-48"></div>
        <div class="skeleton-line w-32"></div>
      </div>
    </div>
    <div v-else class="ident-content">
      <img
        v-if="info?.logoUrl"
        :src="info.logoUrl"
        class="addon-logo"
        alt=""
        @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
      >
      <div class="ident-text">
        <h1 class="app-title">{{ info?.name }}</h1>
        <p v-if="info?.description" class="subtitle">{{ info.description }}</p>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useAddonInfo } from '../composables/useAddonInfo'

const { info, loading } = useAddonInfo()
</script>
