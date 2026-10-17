<script setup lang="ts">
const props = withDefaults(defineProps<{
  name: string
  icon?: string
  /** The type's color as a hex value. The tint is derived, so one value works in light and dark mode. */
  color?: string
}>(), {
  icon: 'i-lucide-ticket',
  color: '#4b5563',
})

const tile = computed(() => ({
  color: props.color,
  backgroundColor: `color-mix(in srgb, ${props.color} 13%, transparent)`,
}))
</script>

<template>
  <span class="inline-flex items-center gap-2 min-w-0">
    <span class="size-[22px] shrink-0 rounded-md flex items-center justify-center" :style="tile" aria-hidden="true">
      <UIcon :name="icon" class="size-[13px]" />
    </span>
    <span class="text-sm truncate text-(--ui-text)">{{ name }}</span>
  </span>
</template>
