<script setup lang="ts">
const props = withDefaults(defineProps<{
  name: string
  icon?: string
  /** The type's color as a hex value. The tint is derived, so one value works in light and dark mode. */
  color?: string
}>(), {
  icon: 'i-lucide-ticket',
  color: '#64748b',
})

const tile = computed(() => ({
  color: props.color,
  backgroundColor: `color-mix(in srgb, ${props.color} 14%, transparent)`,
}))
</script>

<template>
  <span class="inline-flex items-center gap-2 min-w-0">
    <span class="size-6 shrink-0 rounded-md flex items-center justify-center" :style="tile" aria-hidden="true">
      <UIcon :name="icon" class="size-3.5" />
    </span>
    <span class="text-sm truncate">{{ name }}</span>
  </span>
</template>
