<script setup lang="ts">
const { role } = useCurrentUser()
const route = useRoute()

const items = computed(() => navigationFor(role.value))
const { pages, refresh: refreshPages } = useAppPages()
// The list is small and changes when an Admin edits an app, so it is loaded again on each navigation.
const loadPages = () => refreshPages().catch(() => {})

// One cheap count: on navigation and on a slow poll, never every second.
const { count: unread, refresh } = useUnreadCount()
const POLL_MS = 60_000
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refresh()
  loadPages()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh()
  }, POLL_MS)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  // The sidebar leaves on sign-out: the next User must not see this User's apps.
  pages.value = []
})
watch(() => route.fullPath, refresh)
watch(() => route.path, loadPages)
const linkClass = (current: boolean) => current
  ? 'bg-(--ui-bg) border-(--ui-border) font-medium text-(--ui-text-highlighted)'
  : 'border-transparent text-(--ui-text) hover:bg-(--app-hover)'
</script>

<template>
  <div class="flex flex-col gap-5">
    <nav aria-label="Main" class="flex flex-col gap-0.5">
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :aria-current="isCurrent(item, route.fullPath, route.path) ? 'page' : undefined"
        class="flex items-center gap-2.5 min-h-10 px-2.5 rounded-lg border text-sm transition-colors"
        :class="linkClass(isCurrent(item, route.fullPath, route.path))"
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
    <nav v-if="pages.length" aria-labelledby="apps-nav-h" class="flex flex-col gap-0.5">
      <h2 id="apps-nav-h" class="px-2.5 pb-1 text-xs font-medium text-(--ui-text-muted)">
        Apps
      </h2>
      <NuxtLink
        v-for="page in pages"
        :key="page.id"
        :to="`/apps/${page.id}`"
        :aria-current="route.path === `/apps/${page.id}` ? 'page' : undefined"
        class="flex items-center gap-2.5 min-h-10 px-2.5 rounded-lg border text-sm transition-colors"
        :class="linkClass(route.path === `/apps/${page.id}`)"
      >
        <AppPageIcon :app="page" class="size-[18px] shrink-0" />
        <span class="truncate flex-1">{{ page.name }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>
