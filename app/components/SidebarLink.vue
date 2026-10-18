<script setup lang="ts">
/** One row in the main sidebar or the Settings menu. */
const props = defineProps<{ to: string, current?: boolean, external?: boolean }>()
</script>

<template>
  <NuxtLink
    :to="props.to"
    :external="props.external"
    :target="props.external ? '_blank' : undefined"
    :aria-current="props.current ? 'page' : undefined"
    class="flex items-center gap-2.5 min-h-10 px-2.5 rounded-lg border text-sm transition-colors"
    :class="props.current
      ? 'bg-(--ui-bg) border-(--ui-border) font-medium text-(--ui-text-highlighted)'
      : 'border-transparent text-(--ui-text) hover:bg-(--app-hover)'"
  >
    <slot />
  </NuxtLink>
</template>
