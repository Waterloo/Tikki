<script setup lang="ts">
const props = defineProps<{
  channel: 'web' | 'ai' | 'api' | 'app'
  /** The Application name, for tickets that came through the API. */
  application?: string
  /** The Ticket App name, for channel `app`. Missing after the app was deleted. */
  ticketApp?: string
}>()

const NEUTRAL = 'bg-[#eef0f3] text-[#3d424b] dark:bg-[#222429] dark:text-[#c3c6cc]'

const look = computed(() => {
  switch (props.channel) {
    case 'ai': return { label: 'Claude', icon: 'i-lucide-sparkles', class: 'bg-[#f4f1ec] text-[#6b4a1f] dark:bg-[#2a2218] dark:text-[#e2c08a]' }
    case 'api': return { label: props.application ?? 'Application', icon: 'i-lucide-key-round', class: NEUTRAL }
    case 'app': return { label: props.ticketApp ? `via ${props.ticketApp}` : 'via a Ticket App', icon: 'i-lucide-app-window', class: NEUTRAL }
    default: return { label: 'Web', icon: 'i-lucide-globe', class: NEUTRAL }
  }
})
</script>

<template>
  <span class="inline-flex items-center gap-1 min-h-[22px] px-2 rounded-full text-xs whitespace-nowrap shrink-0" :class="look.class">
    <UIcon :name="look.icon" class="size-3" aria-hidden="true" />
    {{ look.label }}
  </span>
</template>
