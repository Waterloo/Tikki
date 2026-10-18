<script setup lang="ts">
import type { TicketApp, TicketAppAccess, TicketAppPlacement } from '~/types/ticket-apps'

definePageMeta({ roles: ['admin'] })

interface TypeOption { id: number, name: string }

// One URL field for each placement. A placement is on when its URL is set.
const PLACEMENTS: { value: TicketAppPlacement, label: string, chip: string, help: string, placeholder: string }[] = [
  { value: 'sidebar', label: 'Sidebar URL', chip: 'Sidebar', help: 'A card in the ticket sidebar.', placeholder: 'https://orders.example.com/card' },
  { value: 'tab', label: 'Tab URL', chip: 'Tab', help: 'A tab next to Conversation and Activity.', placeholder: 'https://orders.example.com/history' },
  { value: 'page', label: 'Page URL', chip: 'Page', help: 'A page in the Apps menu of the main sidebar.', placeholder: 'https://orders.example.com/page' },
]
const ACCESS: { value: TicketAppAccess, label: string, description: string }[] = [
  { value: 'read', label: 'Read', description: 'The app\'s backend can read the ticket, its comments and its Activity.' },
  { value: 'comment', label: 'Comment', description: 'Also add Public Comments and Internal Comments.' },
  { value: 'update', label: 'Update', description: 'Also change the Status, Priority, assignee and Fields.' },
]
const ACCESS_LABEL: Record<TicketAppAccess, string> = { read: 'Read', comment: 'Comment', update: 'Update' }
const GUIDE = '/api/docs/ticket-apps.md'

const toast = useToast()
const apps = ref<TicketApp[]>([])
const types = ref<TypeOption[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const busy = ref<string | null>(null)

const typeNames = computed(() => new Map(types.value.map(t => [t.id, t.name])))
function showOnText(app: TicketApp) {
  if (app.ticket_type_ids === null) return 'All Ticket Types'
  if (app.ticket_type_ids.length === 0) return 'No type: the chosen types are archived'
  return app.ticket_type_ids.map(id => typeNames.value.get(id) ?? `Type ${id}`).join(', ')
}

async function load() {
  state.value = 'loading'
  try {
    const [list, typeList] = await Promise.all([
      $fetch<{ data: TicketApp[] }>('/api/v1/admin/ticket-apps'),
      $fetch<{ data: TypeOption[] }>('/api/v1/ticket-types'),
    ])
    apps.value = list.data
    types.value = typeList.data
    state.value = 'ready'
  } catch (e) {
    if (apiProblem(e).status === 401) return navigateTo('/sign-in')
    state.value = 'error'
  }
}
onMounted(load)

async function move(app: TicketApp, direction: 'up' | 'down') {
  busy.value = `${app.id}:${direction}`
  try {
    apps.value = (await $fetch<{ data: TicketApp[] }>(`/api/v1/admin/ticket-apps/${app.id}/move`, { method: 'POST', body: { direction } })).data
  } catch (e) {
    toast.add({ title: 'The order was not changed.', description: apiProblem(e).message, color: 'error' })
  } finally {
    busy.value = null
  }
}

async function setEnabled(app: TicketApp, enabled: boolean) {
  busy.value = `${app.id}:enabled`
  try {
    const saved = await $fetch<TicketApp>(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'PATCH', body: { enabled } })
    apps.value = apps.value.map(a => a.id === saved.id ? saved : a)
  } catch (e) {
    toast.add({ title: enabled ? 'The app was not turned on.' : 'The app was not turned off.', description: apiProblem(e).message, color: 'error' })
  } finally {
    busy.value = null
  }
}

// --- Add and edit --------------------------------------------------------------------------------------------------

const editing = ref<TicketApp | null>(null)
const formOpen = ref(false)
const emptyUrls = (): Record<TicketAppPlacement, string> => ({ sidebar: '', tab: '', page: '' })
const form = reactive({ name: '', urls: emptyUrls(), access: 'read' as TicketAppAccess, showOn: 'all' as 'all' | 'only', typeIds: [] as string[], enabled: true, pageForRequesters: false })
const hasUrl = computed(() => PLACEMENTS.some(p => form.urls[p.value].trim()))
const problems = ref<Record<string, string>>({})
const formError = ref<string | null>(null)
const saving = ref(false)
const confirmDelete = ref(false)
const typeItems = computed(() => types.value.map(t => ({ value: String(t.id), label: t.name })))

function openForm(app: TicketApp | null) {
  editing.value = app
  Object.assign(form, app
    ? { name: app.name, urls: { sidebar: app.urls.sidebar ?? '', tab: app.urls.tab ?? '', page: app.urls.page ?? '' }, access: app.access, showOn: app.ticket_type_ids === null ? 'all' : 'only', typeIds: (app.ticket_type_ids ?? []).map(String), enabled: app.enabled, pageForRequesters: app.page_for_requesters }
    : { name: '', urls: emptyUrls(), access: 'read', showOn: 'all', typeIds: [], enabled: true, pageForRequesters: false })
  problems.value = {}
  formError.value = null
  confirmDelete.value = false
  formOpen.value = true
}

function failed(e: unknown) {
  const p = apiProblem(e)
  if (p.details.length) problems.value = Object.fromEntries(p.details.map(d => [d.key, d.reason]))
  else formError.value = p.message
}

async function save() {
  saving.value = true
  problems.value = {}
  formError.value = null
  const typeIds = form.showOn === 'all' ? null : form.typeIds.map(Number)
  // Unchanged types are not sent, so an app whose types were all archived can still be renamed.
  const sameTypes = editing.value && JSON.stringify(editing.value.ticket_type_ids) === JSON.stringify(typeIds)
  // An empty field turns its placement off.
  const urls = Object.fromEntries(PLACEMENTS.map(p => [`${p.value}_url`, form.urls[p.value].trim() || null]))
  // Only the page can show to Requesters; without a page URL the server refuses true.
  const pageForRequesters = !!urls.page_url && form.pageForRequesters
  const body = { name: form.name, ...urls, access: form.access, ...(sameTypes ? {} : { ticket_type_ids: typeIds }), enabled: form.enabled, page_for_requesters: pageForRequesters }
  try {
    if (editing.value) {
      const saved = await $fetch<TicketApp>(`/api/v1/admin/ticket-apps/${editing.value.id}`, { method: 'PATCH', body })
      apps.value = apps.value.map(a => a.id === saved.id ? saved : a)
    } else {
      apps.value.push(await $fetch<TicketApp>('/api/v1/admin/ticket-apps', { method: 'POST', body }))
    }
    formOpen.value = false
  } catch (e) {
    failed(e)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!editing.value) return
  const id = editing.value.id
  saving.value = true
  try {
    await $fetch(`/api/v1/admin/ticket-apps/${id}`, { method: 'DELETE' })
    apps.value = apps.value.filter(a => a.id !== id)
    formOpen.value = false
  } catch (e) {
    failed(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppPage id="admin-apps" title="Ticket Apps">
    <PageHeader
      title="Ticket Apps"
      subtitle="Your own web pages inside the ticket or in the Apps menu, for example an orders panel next to a payment ticket. Only Agents and Admins see them, unless a page shows to Requesters."
      :breadcrumb="[{ label: 'Admin' }, { label: 'Ticket Apps' }]"
    >
      <template #actions>
        <UButton icon="i-lucide-plus" size="lg" @click="openForm(null)">
          Add app
        </UButton>
      </template>
    </PageHeader>

    <ListSkeleton v-if="state === 'loading'" :rows="2" />
    <ErrorState v-else-if="state === 'error'" title="The Ticket Apps could not be loaded." description="Check your connection, then try again." @retry="load" />
    <EmptyState v-else-if="apps.length === 0" icon="i-lucide-app-window" title="No Ticket Apps yet" description="Add a page from one of your own tools. Tikki shows it on the ticket and tells it which ticket is open.">
      <UButton icon="i-lucide-plus" @click="openForm(null)">
        Add app
      </UButton>
    </EmptyState>

    <ol v-else aria-label="Ticket Apps, in order" class="flex flex-col gap-3 list-none p-0 m-0">
      <li v-for="(app, i) in apps" :key="app.id">
        <section :aria-label="app.name" class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] min-w-0">
          <div class="flex sm:flex-col gap-1">
            <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-arrow-up" :aria-label="`Move ${app.name} up`" :disabled="i === 0 || busy !== null" :loading="busy === `${app.id}:up`" @click="move(app, 'up')" />
            <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-arrow-down" :aria-label="`Move ${app.name} down`" :disabled="i === apps.length - 1 || busy !== null" :loading="busy === `${app.id}:down`" @click="move(app, 'down')" />
          </div>
          <div class="flex flex-col gap-1 min-w-0 flex-[1_1_240px]">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base font-semibold text-(--ui-text-highlighted) truncate">
                {{ app.name }}
              </h2>
              <span v-for="p in PLACEMENTS.filter(p => app.urls[p.value])" :key="p.value" class="text-xs px-2 py-0.5 rounded-full bg-(--ui-bg-accented) text-(--ui-text-toned)">{{ p.chip }}</span>
              <span v-if="app.page_for_requesters" class="text-xs px-2 py-0.5 rounded-full bg-(--ui-bg-accented) text-(--ui-text-toned)">Requesters</span>
              <span class="text-xs px-2 py-0.5 rounded-full bg-(--ui-bg-accented) text-(--ui-text-toned)">{{ ACCESS_LABEL[app.access] }} access</span>
              <span v-if="!app.enabled" class="text-xs px-2 py-0.5 rounded-full bg-(--ui-bg-accented) text-(--ui-text-muted)">Off</span>
            </div>
            <span v-for="p in PLACEMENTS.filter(p => app.urls[p.value])" :key="p.value" class="font-mono text-[13px] text-(--ui-text-toned) truncate" :title="app.urls[p.value]!">{{ app.urls[p.value] }}</span>
            <span class="text-[13px] text-(--ui-text-muted) [overflow-wrap:anywhere]">Shows on: {{ showOnText(app) }}</span>
          </div>
          <div class="flex items-center gap-3 ml-auto">
            <USwitch :model-value="app.enabled" :disabled="busy !== null" :aria-label="`${app.name} on`" @update:model-value="v => setEnabled(app, v)" />
            <UButton color="neutral" variant="outline" size="sm" class="min-h-[34px]" @click="openForm(app)">
              Edit
            </UButton>
          </div>
        </section>
      </li>
    </ol>

    <section aria-labelledby="build-h" class="flex flex-col gap-2.5 rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] text-sm text-(--ui-text)">
      <h2 id="build-h" class="text-[15px] font-semibold text-(--ui-text-highlighted)">
        How to build an app
      </h2>
      <p>An app is a normal web page. It talks to Tikki with <code class="font-mono text-[13px]">window.parent.postMessage</code>, always with Tikki's origin as the target, never <code class="font-mono text-[13px]">'*'</code>.</p>
      <ul class="flex flex-col gap-1.5 pl-5 list-disc [overflow-wrap:anywhere]">
        <li><code class="font-mono text-[13px]">tikki:fetch-context</code> (app to Tikki): ask for the context.</li>
        <li><code class="font-mono text-[13px]">tikki:context</code> (Tikki to app): the ticket, the requester, the Agent, and a signed token for your backend. It also comes when the frame loads and when the ticket changes.</li>
        <li><code class="font-mono text-[13px]">tikki:resize</code> with <code class="font-mono text-[13px]">height</code> (app to Tikki): the sidebar card height, 120 to 600 px.</li>
        <li><code class="font-mono text-[13px]">tikki:refresh</code> (app to Tikki): reload the ticket after your backend changed it.</li>
        <li><code class="font-mono text-[13px]">tikki:navigate</code> with <code class="font-mono text-[13px]">path</code> (app to Tikki): open a ticket or another app page, for example <code class="font-mono text-[13px]">/tickets/PAY-1048</code>.</li>
      </ul>
      <p>Your app must send a message within 10 seconds, or the Agent sees "The app did not answer". Check the token on your backend with the keys at <code class="font-mono text-[13px]">/api/auth/jwks</code>. With Comment or Update access, your backend sends the same token to the REST API to change this one ticket.</p>
      <p>
        <a :href="GUIDE" target="_blank" rel="noopener" class="text-(--ui-primary) hover:underline">Read the developer guide</a>
      </p>
    </section>

    <UModal v-model:open="formOpen" :title="editing ? 'Edit Ticket App' : 'Add Ticket App'">
      <template #body>
        <form id="app-form" class="flex flex-col gap-4" @submit.prevent="save">
          <UFormField label="Name" :error="problems.name" help="The card title or the tab name. Keep it short." required>
            <UInput v-model="form.name" maxlength="40" placeholder="Orders" class="w-full" />
          </UFormField>
          <fieldset class="flex flex-col gap-3 min-w-0">
            <legend class="text-sm font-medium text-(--ui-text-highlighted)">
              Where it shows
            </legend>
            <p class="-mt-1 text-[13px] text-(--ui-text-muted)">
              Set at least one URL. Each must use https. Its origin is the audience of the token for that placement.
            </p>
            <UFormField v-for="p in PLACEMENTS" :key="p.value" :label="p.label" :help="p.help" :error="problems[`${p.value}_url`]">
              <UInput v-model="form.urls[p.value]" type="url" :placeholder="p.placeholder" class="w-full font-mono" />
            </UFormField>
            <p v-if="problems.urls" class="text-sm text-(--ui-error)">
              {{ problems.urls }}
            </p>
            <USwitch v-model="form.pageForRequesters" :disabled="!form.urls.page.trim()" label="Show the page to Requesters" description="Requesters see the page in their Apps menu. The sidebar card and the tab stay for Agents and Admins." />
            <p v-if="problems.page_for_requesters" class="text-sm text-(--ui-error)">
              {{ problems.page_for_requesters }}
            </p>
          </fieldset>
          <UFormField label="Access" :error="problems.access" help="What the app's backend can do with the token, as the Agent who has the ticket open.">
            <URadioGroup v-model="form.access" :items="ACCESS" />
          </UFormField>
          <UFormField label="Show on" :error="problems.ticket_type_ids">
            <URadioGroup v-model="form.showOn" :items="[{ value: 'all', label: 'All Ticket Types', description: 'Also types that are added later.' }, { value: 'only', label: 'Only these types' }]" />
            <UCheckboxGroup v-if="form.showOn === 'only'" v-model="form.typeIds" :items="typeItems" class="mt-3 ml-6" />
          </UFormField>
          <USwitch v-model="form.enabled" label="On" description="When it is off, Agents do not see it, and Tikki makes no tokens for it." />
          <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="formError" />

          <div v-if="editing" class="flex flex-col gap-3 border-t border-(--ui-border-muted) pt-4">
            <UAlert v-if="confirmDelete" color="error" variant="subtle" icon="i-lucide-trash-2" title="Delete this app?" description="Agents stop seeing it at once." :actions="[{ label: 'Delete app', color: 'error', variant: 'solid', size: 'xs', loading: saving, onClick: remove }, { label: 'Cancel', color: 'neutral', variant: 'ghost', size: 'xs', onClick: () => (confirmDelete = false) }]" />
            <div v-else>
              <UButton color="error" variant="ghost" icon="i-lucide-trash-2" @click="confirmDelete = true">
                Delete
              </UButton>
            </div>
          </div>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="formOpen = false">
            Cancel
          </UButton>
          <UButton type="submit" form="app-form" :loading="saving" :disabled="!form.name.trim() || !hasUrl">
            {{ editing ? 'Save' : 'Add app' }}
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPage>
</template>
