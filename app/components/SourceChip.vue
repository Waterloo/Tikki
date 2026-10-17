<script setup lang="ts">
const props = defineProps<{
  channel: 'web' | 'ai' | 'api'
  /** The Application name, for tickets that came through the API. */
  application?: string
}>()

const look = computed(() => {
  switch (props.channel) {
    case 'ai': return { label: 'Claude', icon: 'i-lucide-sparkles', color: 'warning' as const }
    case 'api': return { label: props.application ?? 'Application', icon: 'i-lucide-plug', color: 'neutral' as const }
    default: return { label: 'Web', icon: 'i-lucide-globe', color: 'neutral' as const }
  }
})
</script>

<template>
  <UBadge :color="look.color" variant="subtle" :icon="look.icon" size="sm" class="shrink-0">
    {{ look.label }}
  </UBadge>
</template>
