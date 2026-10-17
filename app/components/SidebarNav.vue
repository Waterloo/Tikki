<script setup lang="ts">
const { role } = useCurrentUser()
const route = useRoute()

const items = computed(() => navigationFor(role.value))

// One cheap count: on navigation and on a slow poll, never every second.
const { count: unread, refresh } = useUnreadCount()
const POLL_MS = 60_000
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refresh()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh()
  }, POLL_MS)
})
onBeforeUnmount(() => clearInterval(timer))
watch(() => route.fullPath, refresh)
</script>

<template>
  <nav aria-label="Main" class="flex flex-col gap-0.5">
    <!-- fullPath, so "All tickets" and "Assigned to me" (the same page with a filter) are told apart. -->
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :aria-current="route.fullPath === item.to ? 'page' : undefined"
      class="flex items-center gap-2.5 min-h-10 px-2.5 rounded-lg border text-sm transition-colors"
      :class="route.fullPath === item.to
        ? 'bg-(--ui-bg) border-(--ui-border) font-medium text-(--ui-text-highlighted)'
        : 'border-transparent text-(--ui-text) hover:bg-(--app-hover)'"
    >
      <UIcon :name="item.icon" class="size-[18px] shrink-0" />
      <span class="truncate flex-1">{{ item.label }}</span>
      <span
        v-if="item.to === '/inbox' && unread > 0"
        class="text-xs font-medium px-2 py-px rounded-full bg-(--ui-primary) text-white dark:text-(--ui-bg)"
        :aria-label="`${unread} unread`"
      >{{ unread > 99 ? '99+' : unread }}</span>
    </NuxtLink>
  </nav>
</template>
