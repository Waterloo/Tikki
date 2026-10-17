<script setup lang="ts">
const props = defineProps<{ priority: 'low' | 'normal' | 'high' | 'urgent' }>()

// Urgent is solid so it differs by lightness, not only by hue.
const look = computed(() => ({
  low: { label: 'Low', color: 'neutral', variant: 'outline' },
  normal: { label: 'Normal', color: 'primary', variant: 'subtle' },
  high: { label: 'High', color: 'warning', variant: 'subtle' },
  urgent: { label: 'Urgent', color: 'error', variant: 'solid' },
} as const)[props.priority])
</script>

<template>
  <UBadge :color="look.color" :variant="look.variant" size="sm">
    {{ look.label }}
  </UBadge>
</template>
