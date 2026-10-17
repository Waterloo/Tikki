<script setup lang="ts">
const props = defineProps<{ priority: 'low' | 'normal' | 'high' | 'urgent' }>()

// Colors from the canvas. Urgent is solid, so it differs by lightness and not only by hue.
const LOOK = {
  low: { label: 'Low', class: 'text-[#3d424b] bg-[#f1f2f4] border-[#e1e4e8] dark:text-[#c3c6cc] dark:bg-[#222429] dark:border-[#34373e]' },
  normal: { label: 'Normal', class: 'text-[#1f3a68] bg-[#eef3fb] border-[#d6e1f4] dark:text-[#a9c3f0] dark:bg-[#16223a] dark:border-[#22345a]' },
  high: { label: 'High', class: 'text-[#7a3400] bg-[#ffefdd] border-[#f6cf9f] dark:text-[#f4b77a] dark:bg-[#2e1d0d] dark:border-[#4a2e12]' },
  urgent: { label: 'Urgent', class: 'text-white bg-[#b42318] border-[#b42318]' },
} as const

const look = computed(() => LOOK[props.priority])
</script>

<template>
  <span class="inline-flex items-center min-h-6 px-2.5 rounded-full border text-xs font-medium whitespace-nowrap" :class="look.class">
    {{ look.label }}
  </span>
</template>
