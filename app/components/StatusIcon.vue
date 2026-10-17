<script setup lang="ts">
import type { StatusCategory } from '~/types/tickets'

defineProps<{ category: StatusCategory }>()

// In a .vue file so the icon scan bundles them; it does not read .ts files.
const ICON: Record<StatusCategory, string> = {
  open: 'i-lucide-circle-dot',
  active: 'i-lucide-loader',
  waiting: 'i-lucide-clock',
  done: 'i-lucide-circle-check',
}
</script>

<template>
  <UIcon :name="ICON[category]" class="shrink-0" aria-hidden="true" />
</template>
