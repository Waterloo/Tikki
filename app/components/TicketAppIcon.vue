<script setup lang="ts">
import { appIconUrl } from '~~/shared/ticket-app-icons'
import type { TicketApp } from '~/types/ticket-apps'

const props = withDefaults(defineProps<{
  app: Pick<TicketApp, 'id' | 'icon'>
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>(), { size: 'md' })

// The one place that shows a Ticket App's icon: a tinted built-in icon, or the uploaded image for the color mode.
const SIZE = { xs: 'size-5 rounded-md', sm: 'size-[30px] rounded-lg', md: 'size-[34px] rounded-[9px]', lg: 'size-11 rounded-xl' } as const
const GLYPH = { xs: 'size-3.5', sm: 'size-[17px]', md: 'size-[17px]', lg: 'size-[22px]' } as const

const colorMode = useColorMode()
// Without a dark image the light one shows in dark mode, so the browser loads one URL only.
const src = computed(() => appIconUrl(props.app.id, props.app.icon, colorMode.value === 'dark' && props.app.icon.dark ? 'dark' : 'light'))
</script>

<template>
  <img
    v-if="app.icon.kind === 'image'"
    :src="src"
    alt=""
    class="shrink-0 object-contain"
    :class="SIZE[size]"
    data-app-icon="image"
  >
  <span
    v-else
    class="flex shrink-0 items-center justify-center"
    :class="SIZE[size]"
    :style="{ color: app.icon.color, backgroundColor: `color-mix(in srgb, ${app.icon.color} 13%, transparent)` }"
    aria-hidden="true"
    data-app-icon="builtin"
  >
    <UIcon :name="app.icon.name" :class="GLYPH[size]" />
  </span>
</template>
