<script setup lang="ts">
import type { AppPage } from '~/types/ticket-apps'

// The one place for the icon of an app page. Issue 38 replaces it with TicketAppIcon.
defineProps<{ app: Pick<AppPage, 'id' | 'name'> }>()
</script>

<template>
  <UIcon name="i-lucide-app-window" aria-hidden="true" />
</template>
