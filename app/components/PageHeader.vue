<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
  breadcrumb?: { label: string, to?: string }[]
}>()
</script>

<template>
  <header class="flex flex-col gap-5">
    <nav v-if="breadcrumb?.length" aria-label="Breadcrumb" class="hidden lg:flex items-center gap-2 text-sm text-(--ui-text-muted)">
      <template v-for="(crumb, i) in breadcrumb" :key="crumb.label">
        <span v-if="i > 0" aria-hidden="true">/</span>
        <NuxtLink v-if="crumb.to" :to="crumb.to" class="hover:text-(--ui-text-highlighted)">
          {{ crumb.label }}
        </NuxtLink>
        <span v-else :aria-current="i === breadcrumb.length - 1 ? 'page' : undefined" class="text-(--ui-text-highlighted)">{{ crumb.label }}</span>
      </template>
    </nav>
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex flex-col gap-1.5 min-w-0">
        <div v-if="$slots.eyebrow" class="flex flex-wrap items-center gap-2 mb-1">
          <slot name="eyebrow" />
        </div>
        <h1 class="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-(--ui-text-highlighted) [overflow-wrap:anywhere]">
          {{ title }}
        </h1>
        <p v-if="subtitle" class="text-sm text-(--ui-text-muted)">
          {{ subtitle }}
        </p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>
