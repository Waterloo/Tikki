<script setup lang="ts">
/** An app page (issue 39): the app's page URL in a frame that fills the main area. */
const route = useRoute()
const { pages, refresh } = useAppPages()
const state = ref<'loading' | 'ready' | 'error'>('loading')
const app = computed(() => pages.value.find(p => String(p.id) === route.params.id))

async function load() {
  state.value = 'loading'
  try {
    await refresh()
    state.value = 'ready'
  } catch (e) {
    if (apiProblem(e).status === 401) return navigateTo('/sign-in')
    state.value = 'error'
  }
}
onMounted(load)
watch(() => route.params.id, load)
</script>

<template>
  <UDashboardPanel id="app-page" :ui="{ body: 'p-0 sm:p-0 gap-0 sm:gap-0 bg-(--ui-bg-muted)' }">
    <template #header>
      <UDashboardNavbar :title="app?.name ?? 'Apps'" class="bg-(--ui-bg)">
        <template #leading>
          <TicketAppIcon v-if="app" :app="app" size="xs" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div v-if="state === 'loading' && !app" class="px-4 sm:px-8 pt-6">
        <USkeleton class="h-96 rounded-[14px]" />
      </div>
      <div v-else-if="state === 'error' && !app" class="px-4 sm:px-8 pt-6">
        <ErrorState title="The app could not be loaded." description="Check your connection, then try again." @retry="load" />
      </div>
      <div v-else-if="!app" class="px-4 sm:px-8 pt-6">
        <EmptyState icon="i-lucide-search-x" title="No app page here" description="It may not exist, it may be turned off, or it is not for you.">
          <UButton to="/" size="lg" variant="outline">
            Back to My tickets
          </UButton>
        </EmptyState>
      </div>
      <TicketAppFrame v-else :key="app.id" :app="app" :url="app.url" placement="page" class="flex-1 min-h-0" />
    </template>
  </UDashboardPanel>
</template>
