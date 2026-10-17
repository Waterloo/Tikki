<script setup lang="ts">
const props = withDefaults(defineProps<{
  icon: string
  /** The type's color as a hex value. The tint is derived, so one value works in light and dark mode. */
  color: string
  size?: 'sm' | 'md' | 'lg'
}>(), { size: 'md' })

const SIZE = { sm: 'size-[30px] rounded-lg', md: 'size-[34px] rounded-[9px]', lg: 'size-11 rounded-xl' } as const
const ICON = { sm: 'size-[17px]', md: 'size-[17px]', lg: 'size-[22px]' } as const
</script>

<template>
  <span
    class="flex shrink-0 items-center justify-center"
    :class="SIZE[props.size]"
    :style="{ color: props.color, backgroundColor: `color-mix(in srgb, ${props.color} 13%, transparent)` }"
    aria-hidden="true"
  >
    <UIcon :name="props.icon" :class="ICON[props.size]" />
  </span>
</template>
