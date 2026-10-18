<script setup lang="ts">
import { PERMISSIONS, type ApiKey, type ApplicationDetail, type ApplicationSummary, type Permission, type TicketTypeOption } from '~/types/applications'

definePageMeta({ roles: ['admin'] })

const route = useRoute()
const toast = useToast()

const apps = ref<ApplicationSummary[]>([])
const types = ref<TicketTypeOption[]>([])
const listState = ref<'loading' | 'ready' | 'error'>('loading')
const detail = ref<ApplicationDetail | null>(null)
const detailState = ref<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle')
const busy = ref(false)

const creating = ref(false)
const keyDialog = ref(false)
const keyName = ref('')
const keyError = ref<string | null>(null)
const keySaving = ref(false)
/** The full key, shown once after it is created. */
const newKey = ref<(ApiKey & { key: string }) | null>(null)
const revoking = ref<ApiKey | null>(null)

const selectedId = computed(() => {
  const value = Number(route.params.id)
  return Number.isInteger(value) && value > 0 ? value : null
})

const addableTypes = computed(() => types.value
  .filter(t => !detail.value?.ticket_types.some(a => a.id === t.id))
  .map(t => ({ label: t.name, icon: t.icon, onSelect: () => setTypes([...(detail.value?.ticket_types.map(a => a.id) ?? []), t.id]) })))

function errorMessage(e: unknown, fallback: string) {
  return (e as { data?: { error?: { message?: string } } }).data?.error?.message ?? fallback
}

function usedText(iso: string | null) {
  return iso ? `used ${timeAgo(iso)}` : 'never used'
}

async function loadList() {
  listState.value = 'loading'
  try {
    const [a, t] = await Promise.all([
      $fetch<{ data: ApplicationSummary[] }>('/api/v1/applications'),
      $fetch<{ data: TicketTypeOption[] }>('/api/v1/ticket-types'),
    ])
    apps.value = a.data
    types.value = t.data
    listState.value = 'ready'
    // Without an ID in the address, open the first Application, as the canvas shows one selected.
    if (selectedId.value === null && apps.value[0]) await navigateTo(`/applications/${apps.value[0].id}`, { replace: true })
  } catch (e) {
    if ((e as { status?: number }).status === 401) return navigateTo('/sign-in')
    listState.value = 'error'
  }
}

let latest = 0
async function loadDetail() {
  const id = selectedId.value
  newKey.value = null
  if (id === null) {
    detail.value = null
    detailState.value = 'idle'
    return
  }
  const request = ++latest
  detailState.value = 'loading'
  try {
    const app = await $fetch<ApplicationDetail>(`/api/v1/applications/${id}`)
    if (request !== latest) return
    detail.value = app
    detailState.value = 'ready'
  } catch (e) {
    if (request !== latest) return
    detailState.value = (e as { status?: number }).status === 404 ? 'missing' : 'error'
  }
}

/** Keeps the list row in step with the detail, without a reload. */
function applyDetail(app: ApplicationDetail) {
  detail.value = app
  const row = apps.value.find(a => a.id === app.id)
  if (row) Object.assign(row, { name: app.name, enabled: app.enabled, ticket_count: app.ticket_count, last_used_at: app.last_used_at })
}

async function update(body: Record<string, unknown>, done: string) {
  if (!detail.value) return
  busy.value = true
  try {
    applyDetail(await $fetch<ApplicationDetail>(`/api/v1/applications/${detail.value.id}`, { method: 'PATCH', body }))
    toast.add({ title: done, icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    toast.add({ title: errorMessage(e, 'The change was not saved. Try again.'), icon: 'i-lucide-circle-alert', color: 'error' })
  } finally {
    busy.value = false
  }
}

function togglePermission(permission: Permission, on: boolean | 'indeterminate') {
  if (!detail.value) return
  const current = detail.value.permissions
  const next = on === true ? [...current, permission] : current.filter(p => p !== permission)
  update({ permissions: next }, 'Permissions saved')
}

function setTypes(ids: number[]) {
  update({ ticket_type_ids: ids }, 'Allowed types saved')
}

function toggleEnabled() {
  if (!detail.value) return
  const enabled = !detail.value.enabled
  update({ enabled }, enabled ? 'Application enabled' : 'Application disabled. Its keys are refused.')
}

function onCreated(app: ApplicationDetail) {
  apps.value = [...apps.value, app].sort((a, b) => a.name.localeCompare(b.name))
  navigateTo(`/applications/${app.id}`)
}

function openKeyDialog() {
  keyName.value = detail.value?.keys.length ? '' : 'Production'
  keyError.value = null
  keyDialog.value = true
}

async function createKey() {
  if (!detail.value) return
  keySaving.value = true
  keyError.value = null
  try {
    const created = await $fetch<ApiKey & { key: string }>(`/api/v1/applications/${detail.value.id}/keys`, { method: 'POST', body: { name: keyName.value } })
    const { key: _, ...listed } = created
    detail.value.keys = [listed, ...detail.value.keys]
    newKey.value = created
    keyDialog.value = false
  } catch (e) {
    const err = (e as { data?: { error?: { message?: string, details?: { reason: string }[] | null } } }).data?.error
    keyError.value = err?.details?.[0]?.reason ?? err?.message ?? 'The key could not be created. Try again.'
  } finally {
    keySaving.value = false
  }
}

async function revoke() {
  const key = revoking.value
  if (!detail.value || !key) return
  busy.value = true
  try {
    await $fetch(`/api/v1/applications/${detail.value.id}/keys/${key.id}`, { method: 'DELETE' })
    detail.value.keys = detail.value.keys.filter(k => k.id !== key.id)
    if (newKey.value?.id === key.id) newKey.value = null
    toast.add({ title: `Key “${key.name}” revoked`, icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    toast.add({ title: errorMessage(e, 'The key was not revoked. Try again.'), icon: 'i-lucide-circle-alert', color: 'error' })
  } finally {
    busy.value = false
    revoking.value = null
  }
}

watch(selectedId, loadDetail)
onMounted(() => Promise.all([loadList(), loadDetail()]))
</script>

<template>
  <AppPage id="applications" title="Applications">
    <PageHeader
      title="Applications"
      subtitle="Your other systems create tickets for their customers with an API key. Each application sees only its own tickets."
      :breadcrumb="[{ label: 'Admin' }, { label: 'Applications', to: detail ? '/applications' : undefined }, ...(detail ? [{ label: detail.name }] : [])]"
    >
      <template #actions>
        <UButton icon="i-lucide-plus" size="lg" :disabled="listState !== 'ready'" @click="creating = true">
          New application
        </UButton>
      </template>
    </PageHeader>

    <ListSkeleton v-if="listState === 'loading'" :rows="3" />
    <ErrorState v-else-if="listState === 'error'" title="The applications could not be loaded." description="Check your connection, then try again." @retry="loadList" />
    <EmptyState
      v-else-if="!apps.length"
      icon="i-lucide-key-round"
      title="No applications yet"
      description="Add one for each system that creates tickets for its customers, for example a checkout site. Then create an API key for it."
    >
      <UButton icon="i-lucide-plus" @click="creating = true">
        New application
      </UButton>
    </EmptyState>

    <div v-else class="flex flex-wrap items-start gap-5">
      <nav aria-label="Applications" class="flex-[1_1_240px] min-w-0 flex flex-col gap-1">
        <NuxtLink
          v-for="a in apps"
          :key="a.id"
          :to="`/applications/${a.id}`"
          :aria-current="a.id === selectedId ? 'page' : undefined"
          class="flex flex-col gap-0.5 px-3.5 py-3 rounded-xl border text-(--ui-text-highlighted)"
          :class="a.id === selectedId ? 'bg-(--ui-bg) border-(--ui-border-accented)' : 'border-transparent hover:bg-(--app-hover)'"
        >
          <span class="text-sm truncate" :class="a.id === selectedId ? 'font-semibold' : 'font-medium'">{{ a.name }}</span>
          <span class="text-[13px] text-(--ui-text-muted)">
            {{ a.ticket_count }} {{ a.ticket_count === 1 ? 'ticket' : 'tickets' }} · {{ a.enabled ? usedText(a.last_used_at) : 'disabled' }}
          </span>
        </NuxtLink>
      </nav>

      <div class="flex-[999_1_560px] min-w-0 flex flex-col gap-4">
        <ListSkeleton v-if="detailState === 'loading' || detailState === 'idle'" :rows="4" />
        <ErrorState v-else-if="detailState === 'error'" title="This application could not be loaded." description="Check your connection, then try again." @retry="loadDetail" />
        <EmptyState v-else-if="detailState === 'missing'" icon="i-lucide-search-x" title="No application with this ID" description="It may have a different link. Choose one from the list." />

        <template v-else-if="detail">
          <section :aria-label="detail.name" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) px-5 py-[18px] flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-col gap-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2.5">
                <h2 class="text-xl font-semibold text-(--ui-text-highlighted) [overflow-wrap:anywhere]">
                  {{ detail.name }}
                </h2>
                <span
                  class="text-xs px-[9px] py-0.5 rounded-full"
                  :class="detail.enabled ? 'bg-[#e7f5ec] text-[#1b6136] dark:bg-[#16301f] dark:text-[#8fd3a8]' : 'bg-(--ui-bg-accented) text-(--ui-text-toned)'"
                >{{ detail.enabled ? 'Active' : 'Disabled' }}</span>
              </div>
              <span v-if="detail.description" class="text-sm text-(--ui-text-muted)">{{ detail.description }}</span>
            </div>
            <UButton color="neutral" variant="outline" :loading="busy" @click="toggleEnabled">
              {{ detail.enabled ? 'Disable application' : 'Enable application' }}
            </UButton>
          </section>

          <section aria-labelledby="access-h" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) px-5 py-[18px] flex flex-col gap-4">
            <h2 id="access-h" class="text-[15px] font-semibold text-(--ui-text-highlighted)">
              What it can do
            </h2>
            <div class="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[18px]">
              <fieldset class="flex flex-col gap-2" :disabled="busy">
                <legend class="mb-2 text-[13px] text-(--ui-text-muted)">
                  Permissions
                </legend>
                <UCheckbox
                  v-for="p in PERMISSIONS"
                  :key="p.value"
                  :model-value="detail.permissions.includes(p.value)"
                  :label="p.label"
                  :description="p.value"
                  :disabled="busy"
                  :ui="{ description: 'font-mono text-xs' }"
                  @update:model-value="togglePermission(p.value, $event)"
                />
              </fieldset>
              <div class="flex flex-col gap-2">
                <span class="text-[13px] text-(--ui-text-muted)">Allowed ticket types</span>
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    v-for="t in detail.ticket_types"
                    :key="t.id"
                    class="inline-flex items-center gap-1 text-[13px] pl-2.5 pr-1 py-0.5 rounded-full bg-(--ui-bg-accented) text-(--ui-text-highlighted)"
                  >
                    <UIcon :name="t.icon" class="size-3.5" :style="{ color: t.color }" aria-hidden="true" />
                    {{ t.name }}
                    <UButton
                      icon="i-lucide-x"
                      color="neutral"
                      variant="link"
                      size="xs"
                      :disabled="busy"
                      :aria-label="`Remove ${t.name}`"
                      @click="setTypes(detail.ticket_types.filter(a => a.id !== t.id).map(a => a.id))"
                    />
                  </span>
                  <UDropdownMenu v-if="addableTypes.length" :items="addableTypes">
                    <button
                      type="button"
                      :disabled="busy"
                      class="min-h-[30px] px-2.5 rounded-full border border-dashed border-(--ui-border-accented) bg-(--ui-bg) text-[13px] text-(--ui-text-toned) hover:bg-(--app-hover)"
                    >
                      + Add type
                    </button>
                  </UDropdownMenu>
                </div>
                <p v-if="!detail.ticket_types.length" class="text-[13px] text-(--ui-text-muted)">
                  No types yet, so it cannot create tickets.
                </p>
              </div>
            </div>
            <p class="flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-(--ui-bg-elevated) text-[13px] leading-normal text-(--ui-text-toned)">
              <UIcon name="i-lucide-lock" class="size-[15px] shrink-0 mt-0.5" aria-hidden="true" />
              {{ detail.name }} sees only the {{ detail.ticket_count }} {{ detail.ticket_count === 1 ? 'ticket' : 'tickets' }} it created. It never sees internal comments or tickets from other sources.
            </p>
          </section>

          <section aria-labelledby="keys-h" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) px-5 py-[18px] flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 id="keys-h" class="text-[15px] font-semibold text-(--ui-text-highlighted)">
                API keys
              </h2>
              <UButton icon="i-lucide-plus" color="neutral" variant="outline" @click="openKeyDialog">
                Create key
              </UButton>
            </div>

            <div v-if="newKey" role="status" class="p-3.5 rounded-xl border border-[#bfe3cc] bg-[#f2faf5] dark:border-[#2c5a3c] dark:bg-[#13241a] flex flex-col gap-2.5">
              <span class="text-sm font-medium text-[#1b6136] dark:text-[#8fd3a8]">Key created. Copy it now.</span>
              <div class="flex flex-wrap items-start gap-2">
                <div class="flex-[1_1_280px] min-w-0">
                  <CopyField :value="newKey.key" label="new API key" />
                </div>
                <UButton color="neutral" variant="outline" size="lg" @click="newKey = null">
                  Done
                </UButton>
              </div>
              <span class="text-[13px] text-(--ui-text-toned)">We store only a hash of the key, so nobody can show it again. If you lose it, create a new key and revoke this one.</span>
            </div>

            <p v-if="!detail.keys.length" class="py-3 text-sm text-(--ui-text-muted)">
              No keys. Create one, then give it to the system that calls the API.
            </p>
            <div v-else class="flex flex-col">
              <div class="hidden md:grid grid-cols-[minmax(120px,1fr)_170px_110px_120px_90px] items-center gap-3.5 min-h-9 text-[13px] text-(--ui-text-muted)">
                <span>Name</span><span>Key</span><span>Created</span><span>Last used</span><span />
              </div>
              <div
                v-for="k in detail.keys"
                :key="k.id"
                class="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(120px,1fr)_170px_110px_120px_90px] items-center gap-x-3.5 gap-y-1 py-2 md:py-0 min-h-12 border-t border-(--ui-border-muted) text-sm"
              >
                <span class="flex items-center gap-2 min-w-0 text-(--ui-text-highlighted)">
                  <span class="truncate">{{ k.name }}</span>
                  <span v-if="newKey?.id === k.id" class="text-xs px-2 py-px rounded-full bg-[#e7f5ec] text-[#1b6136] dark:bg-[#16301f] dark:text-[#8fd3a8]">New</span>
                </span>
                <span class="flex justify-end md:order-last">
                  <UButton color="error" variant="outline" size="sm" :disabled="busy" @click="revoking = k">Revoke</UButton>
                </span>
                <span class="font-mono text-[13px] text-(--ui-text-toned)">{{ k.prefix }}…</span>
                <span class="text-[13px] text-(--ui-text-muted)"><span class="md:hidden">Created </span>{{ formatDay(k.created_at) }}</span>
                <span class="text-[13px] text-(--ui-text-muted)"><span class="md:hidden">Last used </span>{{ k.last_used_at ? timeAgo(k.last_used_at) : 'Never' }}</span>
              </div>
            </div>
          </section>
        </template>
      </div>
    </div>

    <NewApplicationModal v-model:open="creating" :ticket-types="types" @created="onCreated" />

    <UModal v-model:open="keyDialog" title="Create API key" description="Name it after where it is used, for example Production or Staging.">
      <template #body>
        <form id="new-key" @submit.prevent="createKey">
          <UFormField label="Name" :error="keyError ?? undefined" required>
            <UInput v-model="keyName" maxlength="80" size="lg" class="w-full" autofocus />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="outline" @click="keyDialog = false">
            Cancel
          </UButton>
          <UButton type="submit" form="new-key" :loading="keySaving">
            Create key
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="!!revoking" title="Revoke this key?" @update:open="(v: boolean) => { if (!v) revoking = null }">
      <template #body>
        <p class="text-sm text-(--ui-text)">
          Systems that use “{{ revoking?.name }}” ({{ revoking?.prefix }}…) are refused at once. This cannot be undone.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="outline" @click="revoking = null">
            Cancel
          </UButton>
          <UButton color="error" :loading="busy" @click="revoke">
            Revoke key
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPage>
</template>
