<script setup lang="ts">
import type { AdminType, AdminTypeList } from '~/types/ticket-types'

definePageMeta({ roles: ['admin'] })

// One grid for the header and the rows, so the columns line up (canvas: Ticket types).
const COLUMNS = 'grid grid-cols-[minmax(320px,2fr)_80px_80px_110px_120px_150px_80px] items-center gap-4'

const toast = useToast()
const types = ref<AdminType[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const restoring = ref<number | null>(null)

const active = computed(() => types.value.filter(t => !t.archived_at))
const archived = computed(() => types.value.filter(t => t.archived_at))

async function load() {
  state.value = 'loading'
  try {
    types.value = (await $fetch<AdminTypeList>('/api/v1/admin/ticket-types')).data
    state.value = 'ready'
  } catch (e) {
    if (apiFailure(e).status === 401) return navigateTo('/sign-in')
    state.value = 'error'
  }
}

async function restore(type: AdminType) {
  restoring.value = type.id
  try {
    await $fetch(`/api/v1/ticket-types/${type.id}`, { method: 'PATCH', body: { archived: false } })
    toast.add({ title: `${type.name} is restored`, description: 'People can create tickets of this type again.', color: 'success' })
    await load()
  } catch (e) {
    toast.add({ title: `${type.name} was not restored`, description: apiFailure(e).message, color: 'error' })
  } finally {
    restoring.value = null
  }
}

function archivedOn(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

onMounted(load)
</script>

<template>
  <AppPage id="admin-types" title="Ticket types">
    <PageHeader
      title="Ticket types"
      subtitle="Requesters and Claude choose from these types. Each type has its own fields and an owning team."
      :breadcrumb="[{ label: 'Admin' }, { label: 'Types and fields' }]"
    >
      <template #actions>
        <UButton to="/admin/types/new" icon="i-lucide-plus" size="lg">
          New ticket type
        </UButton>
      </template>
    </PageHeader>

    <ListSkeleton v-if="state === 'loading'" />
    <ErrorState v-else-if="state === 'error'" title="The ticket types could not be loaded." description="Check your connection, then try again." @retry="load" />
    <template v-else>
      <EmptyState v-if="active.length === 0" title="No active ticket types" description="Requesters cannot create tickets until there is one. Create a type, or restore an archived one.">
        <UButton to="/admin/types/new" icon="i-lucide-plus">
          New ticket type
        </UButton>
      </EmptyState>

      <section v-else aria-label="Active ticket types" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-2">
        <div class="overflow-x-auto">
          <div class="min-w-[980px]">
            <div :class="COLUMNS" class="px-3.5 min-h-10 text-[13px] text-(--ui-text-muted)">
              <span>Type</span><span>Prefix</span><span>Fields</span><span>Open tickets</span><span>Team</span><span>Visibility</span><span>Version</span>
            </div>
            <NuxtLink
              v-for="t in active"
              :key="t.id"
              :to="`/admin/types/${t.id}`"
              :class="COLUMNS"
              class="px-3.5 py-2.5 min-h-16 border-t border-(--ui-border-muted) rounded-lg text-sm text-(--ui-text-highlighted) hover:bg-(--app-row-hover)"
            >
              <span class="flex items-center gap-3 min-w-0">
                <TypeTile :icon="t.icon" :color="t.color" />
                <span class="flex flex-col gap-0.5 min-w-0">
                  <span class="font-semibold truncate">{{ t.name }}</span>
                  <span class="text-[13px] text-(--ui-text-muted) truncate">{{ t.description }}</span>
                </span>
              </span>
              <span class="font-mono text-[13px]">{{ t.prefix }}</span>
              <span>{{ t.field_count }}</span>
              <span>{{ t.open_tickets }}</span>
              <span class="truncate">{{ t.team.name }}</span>
              <span>
                <span
                  class="text-xs px-2.5 py-0.5 rounded-full"
                  :class="t.visible_to_all ? 'bg-[#e7f5ec] text-[#1b6136] dark:bg-[#12291b] dark:text-[#86d19f]' : 'bg-(--ui-bg-accented) text-(--ui-text-toned)'"
                >{{ t.visible_to_all ? 'All internal users' : 'Requester only' }}</span>
              </span>
              <span class="text-[13px] text-(--ui-text-toned)">v{{ t.schema_version }}</span>
            </NuxtLink>
          </div>
        </div>
      </section>

      <section v-if="archived.length" id="archived" aria-labelledby="archived-h" class="flex flex-col gap-2.5 px-4 py-3.5 rounded-[14px] border border-(--ui-border) bg-(--app-sidebar)">
        <h2 id="archived-h" class="text-sm font-semibold text-(--ui-text-toned)">
          Archived types
        </h2>
        <div v-for="t in archived" :key="t.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-(--ui-text-toned)">
          <span class="font-medium">{{ t.name }}</span>
          <span class="text-[13px] text-(--ui-text-muted)">
            Archived {{ archivedOn(t.archived_at!) }}. Nobody can create new tickets of this type. Its {{ t.ticket_count }} old {{ t.ticket_count === 1 ? 'ticket keeps' : 'tickets keep' }} it, and its prefix {{ t.prefix }} stays reserved.
          </span>
          <UButton class="ml-auto" size="sm" variant="outline" :loading="restoring === t.id" :aria-label="`Restore ${t.name}`" @click="restore(t)">
            Restore
          </UButton>
        </div>
      </section>
    </template>
  </AppPage>
</template>
