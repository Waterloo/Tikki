<script setup lang="ts">
import type { Attachment, Priority, Status, TicketDetail } from '~/types/tickets'
import type { Field } from '~/components/FieldInput.vue'

const PRIORITIES: { value: Priority, label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]
const SOURCE: Record<TicketDetail['channel'], string> = { web: 'the web app', ai: 'Claude', api: 'an Application' }

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user, role } = useCurrentUser()

const ticket = ref<TicketDetail | null>(null)
const statuses = ref<Status[]>([])
const state = ref<'loading' | 'ready' | 'not-found' | 'error'>('loading')
const attachments = ref<Attachment[]>([])
const attachmentsState = ref<'loading' | 'ready' | 'error'>('loading')
const saving = ref<'status' | 'priority' | 'assignee' | 'type' | null>(null)
// The type picker is open when `typeChoice` is not null. Types load on first open.
const typeChoice = ref<number | null>(null)
const types = ref<{ label: string, value: number }[]>([])
const typesState = ref<'idle' | 'loading' | 'error'>('idle')
// Requester self-service (issue 09).
const editing = ref(false)
const editBusy = ref(false)
const draftDescription = ref('')
const draftFields = ref<Record<string, unknown>>({})
const problems = ref<Record<string, string>>({})
const editError = ref<string | null>(null)
const cancelOpen = ref(false)
const acting = ref<'cancel' | 'reopen' | null>(null)
// Bumped after a save, so the timeline reloads.
const activityVersion = ref(0)

const isStaff = computed(() => role.value === 'admin' || role.value === 'agent')
const back = computed(() => isStaff.value ? { label: 'All tickets', to: '/tickets' } : { label: 'My tickets', to: '/' })
const can = (action: TicketDetail['allowed_actions'][number]) => ticket.value?.allowed_actions.includes(action) ?? false
const assignedToMe = computed(() => !!ticket.value?.assignee && ticket.value.assignee.id === user.value?.id)
const canEdit = computed(() => can('edit_description') || can('edit_fields'))
const statusItems = computed(() => statuses.value.map(s => ({ label: s.name, value: s.key })))

async function load() {
  state.value = 'loading'
  try {
    const t = await $fetch<TicketDetail>(`/api/v1/tickets/${encodeURIComponent(String(route.params.ref))}`)
    if (t.allowed_actions.includes('change_status') && !statuses.value.length) {
      statuses.value = (await $fetch<{ data: Status[] }>('/api/v1/statuses')).data
    }
    ticket.value = t
    state.value = 'ready'
    loadAttachments(t.ref)
    // An old prefix or a bare number still opens the ticket (4.9a); the address then shows the current reference.
    if (route.params.ref !== t.ref) router.replace(`/tickets/${t.ref}`)
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 401) return navigateTo('/sign-in')
    state.value = status === 404 ? 'not-found' : 'error'
  }
}

async function loadAttachments(ref: string) {
  attachmentsState.value = 'loading'
  try {
    attachments.value = (await $fetch<{ data: Attachment[] }>(`/api/v1/tickets/${encodeURIComponent(ref)}/attachments`)).data
    attachmentsState.value = 'ready'
  } catch {
    attachmentsState.value = 'error'
  }
}

async function save(field: 'status' | 'priority' | 'assignee' | 'type', body: Record<string, unknown>, done: string) {
  if (!ticket.value || saving.value) return
  saving.value = field
  try {
    ticket.value = await $fetch<TicketDetail>(`/api/v1/tickets/${ticket.value.ref}`, { method: 'PATCH', body })
    activityVersion.value++
    toast.add({ title: done, color: 'success', duration: 2500 })
  } catch (e) {
    const err = e as { status?: number, data?: { error?: { message?: string } } }
    if (err.status === 401) return navigateTo('/sign-in')
    toast.add({ title: 'The change was not saved.', description: err.data?.error?.message ?? 'Check your connection, then try again.', color: 'error' })
  } finally {
    saving.value = null
  }
}

function changeStatus(key: string) {
  if (key === ticket.value?.status.key) return
  const name = statuses.value.find(s => s.key === key)?.name ?? key
  save('status', { status: key }, `Status changed to ${name}`)
}

function changePriority(value: Priority) {
  if (value === ticket.value?.priority) return
  save('priority', { priority: value }, `Priority changed to ${PRIORITIES.find(p => p.value === value)!.label}`)
}

function assignToMe() {
  if (user.value) save('assignee', { assignee_id: user.value.id }, 'Assigned to you')
}

function unassign() {
  save('assignee', { assignee_id: null }, 'Unassigned')
}

async function openTypePicker() {
  if (!ticket.value) return
  typeChoice.value = ticket.value.ticket_type.id
  if (types.value.length) return
  typesState.value = 'loading'
  try {
    types.value = (await $fetch<{ data: { id: number, name: string }[] }>('/api/v1/ticket-types')).data.map(t => ({ label: t.name, value: t.id }))
    typesState.value = 'idle'
  } catch {
    typesState.value = 'error'
  }
}

async function changeType() {
  if (!ticket.value || typeChoice.value === null || typeChoice.value === ticket.value.ticket_type.id || saving.value) return
  saving.value = 'type'
  try {
    const next = await $fetch<TicketDetail>(`/api/v1/tickets/${ticket.value.ref}/type`, { method: 'PUT', body: { ticket_type_id: typeChoice.value } })
    ticket.value = next
    typeChoice.value = null
    activityVersion.value++
    // The old reference still opens the ticket; the address shows the new one.
    router.replace(`/tickets/${next.ref}`)
    toast.add({ title: `Ticket Type changed. The reference is now ${next.ref}`, color: 'success', duration: 4000 })
  } catch (e) {
    const err = e as { status?: number, data?: { error?: { message?: string, details?: { reason: string }[] | null } } }
    if (err.status === 401) return navigateTo('/sign-in')
    toast.add({ title: 'The Ticket Type was not changed.', description: err.data?.error?.details?.[0]?.reason ?? err.data?.error?.message ?? 'Check your connection, then try again.', color: 'error' })
  } finally {
    saving.value = null
  }
}

function fileOf(id: unknown) {
  return attachments.value.find(a => a.id === id)
}

function startEdit() {
  if (!ticket.value) return
  draftDescription.value = ticket.value.description
  draftFields.value = { ...ticket.value.fields }
  problems.value = {}
  editError.value = null
  editing.value = true
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '')

async function saveEdit() {
  if (!ticket.value || editBusy.value) return
  const body: Record<string, unknown> = {}
  if (can('edit_description') && draftDescription.value !== ticket.value.description) body.description = draftDescription.value
  if (can('edit_fields')) {
    const changed = ticket.value.schema_fields.filter(f => !sameValue(draftFields.value[f.key], ticket.value!.fields[f.key]))
    // An emptied Field is sent as an empty string: the server clears it.
    if (changed.length) body.fields = Object.fromEntries(changed.map(f => [f.key, draftFields.value[f.key] ?? '']))
  }
  if (!Object.keys(body).length) {
    editing.value = false
    return
  }
  editBusy.value = true
  problems.value = {}
  editError.value = null
  try {
    ticket.value = await $fetch<TicketDetail>(`/api/v1/tickets/${ticket.value.ref}`, { method: 'PATCH', body })
    activityVersion.value++
    editing.value = false
    toast.add({ title: 'Ticket updated', color: 'success', duration: 2500 })
  } catch (e) {
    const err = e as { status?: number, data?: { error?: { message?: string, details?: { key: string, reason: string }[] } } }
    if (err.status === 401) return navigateTo('/sign-in')
    const details = err.status === 422 ? err.data?.error?.details : undefined
    if (details) problems.value = Object.fromEntries(details.map(d => [d.key, d.reason]))
    else editError.value = err.data?.error?.message ?? 'The change was not saved. Check your connection, then try again.'
    // The Status may have moved on while the form was open: reload, so the form shows what is allowed now.
    if (err.status === 403) {
      editing.value = false
      await load()
    }
  } finally {
    editBusy.value = false
  }
}

async function selfService(action: 'cancel' | 'reopen') {
  if (!ticket.value || acting.value) return
  acting.value = action
  try {
    const res = await $fetch.raw<TicketDetail>(`/api/v1/tickets/${ticket.value.ref}/${action}`, { method: 'POST' })
    cancelOpen.value = false
    editing.value = false
    if (res._data && res._data.ref !== ticket.value.ref) {
      toast.add({ title: `Created ${res._data.ref}`, description: `The old ticket was resolved more than 14 days ago, so a new ticket links to it.`, color: 'success' })
      return await navigateTo(`/tickets/${res._data.ref}`)
    }
    ticket.value = res._data!
    activityVersion.value++
    toast.add({ title: action === 'cancel' ? 'Ticket cancelled' : 'Ticket reopened', color: 'success', duration: 2500 })
  } catch (e) {
    const err = e as { status?: number, data?: { error?: { message?: string } } }
    if (err.status === 401) return navigateTo('/sign-in')
    toast.add({ title: action === 'cancel' ? 'The ticket was not cancelled.' : 'The ticket was not reopened.', description: err.data?.error?.message ?? 'Check your connection, then try again.', color: 'error' })
    cancelOpen.value = false
    await load()
  } finally {
    acting.value = null
  }
}

// Issue 22: soft delete (Admins). Restore is in Settings › Privacy.
const deleteOpen = ref(false)
const deleting = ref(false)
async function softDelete() {
  if (!ticket.value) return
  deleting.value = true
  try {
    // A plain string: the typed routes read `/tickets/${ref}` as the GET-only `/tickets/deleted`.
    const url: string = `/api/v1/tickets/${ticket.value.ref}`
    await $fetch(url, { method: 'DELETE' })
    toast.add({ title: `${ticket.value.ref} deleted`, description: 'Restore it from Settings › Privacy.', color: 'success' })
    deleteOpen.value = false
    await navigateTo(back.value.to)
  } catch (e) {
    const err = e as { data?: { error?: { message?: string } } }
    toast.add({ title: 'The ticket was not deleted.', description: err.data?.error?.message ?? 'Check your connection, then try again.', color: 'error' })
  } finally {
    deleting.value = false
  }
}

function isEmptyValue(value: unknown) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

function formatValue(type: string, value: unknown): string {
  if (type === 'checkbox') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  if (type === 'date' && typeof value === 'string') return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
  return String(value)
}

watch(() => route.params.ref, (next, previous) => {
  if (next !== previous && next !== ticket.value?.ref) load()
})
onMounted(load)
</script>

<template>
  <AppPage id="ticket" :title="ticket?.ref ?? 'Ticket'">
    <template v-if="state === 'loading'">
      <div class="flex flex-col gap-3" aria-busy="true" aria-label="Loading the ticket">
        <USkeleton class="h-6 w-40" />
        <USkeleton class="h-9 w-full max-w-xl" />
        <div class="flex flex-wrap gap-6 items-start mt-3">
          <USkeleton class="h-48 flex-[999_1_520px] rounded-[14px]" />
          <USkeleton class="h-72 flex-[1_1_300px] rounded-[14px]" />
        </div>
      </div>
    </template>

    <EmptyState
      v-else-if="state === 'not-found'"
      icon="i-lucide-search-x"
      title="No ticket with this reference"
      description="It may not exist, or it belongs to someone else. Check the reference, or go back to the list."
    >
      <UButton :to="back.to" size="lg" variant="outline">
        Back to {{ back.label }}
      </UButton>
    </EmptyState>

    <ErrorState v-else-if="state === 'error' || !ticket" title="The ticket could not be loaded." description="Check your connection, then try again." @retry="load" />

    <template v-else>
      <PageHeader
        :title="ticket.title"
        :subtitle="`Opened ${timeAgo(ticket.created_at)} by ${displayName(ticket.requester)}, from ${SOURCE[ticket.channel]}.`"
        :breadcrumb="[back, { label: ticket.ref }]"
      >
        <template v-if="(canEdit && !editing) || can('cancel') || can('reopen') || can('delete')" #actions>
          <UButton v-if="canEdit && !editing" variant="outline" color="neutral" icon="i-lucide-pencil" @click="startEdit">
            Edit
          </UButton>
          <UButton v-if="can('reopen')" icon="i-lucide-rotate-ccw" :loading="acting === 'reopen'" :disabled="acting !== null" @click="selfService('reopen')">
            Reopen
          </UButton>
          <UButton v-if="can('cancel')" variant="outline" color="error" icon="i-lucide-x" :disabled="acting !== null" @click="cancelOpen = true">
            Cancel ticket
          </UButton>
          <UButton v-if="can('delete')" variant="ghost" color="error" icon="i-lucide-trash-2" @click="deleteOpen = true">
            Delete
          </UButton>
        </template>
        <template #eyebrow>
          <TicketTypeChip :name="ticket.ticket_type.name" :icon="ticket.ticket_type.icon" :color="ticket.ticket_type.color" />
          <TicketRef :value="ticket.ref" />
          <StatusBadge :status="ticket.status" />
        </template>
      </PageHeader>

      <p v-if="ticket.reopened_from" class="text-sm text-(--ui-text-muted)">
        Reopened from <NuxtLink :to="`/tickets/${ticket.reopened_from.ref}`" class="text-(--ui-primary) hover:underline">{{ ticket.reopened_from.ref }}</NuxtLink>, which was resolved more than 14 days ago.
      </p>

      <UAlert v-if="editing && editError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="editError" />

      <div class="flex flex-wrap gap-6 items-start">
        <div class="flex-[999_1_520px] min-w-0 flex flex-col gap-5">
          <section aria-label="Description" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) px-4 py-4 sm:px-[22px] sm:py-5">
            <UFormField v-if="editing && can('edit_description')" label="Description" name="description" :error="problems.description">
              <UTextarea v-model="draftDescription" :rows="6" autoresize class="w-full" />
            </UFormField>
            <p v-else-if="ticket.description" class="text-[15px] leading-relaxed text-(--ui-text) whitespace-pre-wrap [overflow-wrap:anywhere]">
              {{ ticket.description }}
            </p>
            <p v-else class="text-sm text-(--ui-text-muted)">
              No description.
            </p>
          </section>

          <section aria-labelledby="details-heading" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) px-4 pt-4 pb-5 sm:px-[22px] flex flex-col gap-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 id="details-heading" class="text-[15px] font-semibold text-(--ui-text-highlighted)">
                Details
              </h2>
              <UTooltip text="The Fields the requester saw when the ticket was created.">
                <span class="text-xs text-(--ui-text-muted) px-2 py-0.5 rounded-full border border-(--ui-border)" tabindex="0">
                  Schema Version {{ ticket.schema_version }}
                </span>
              </UTooltip>
            </div>
            <p v-if="ticket.schema_fields.length === 0" class="text-sm text-(--ui-text-muted)">
              This Ticket Type has no Fields.
            </p>
            <div v-else-if="editing && can('edit_fields')" class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <UFormField
                v-for="f in ticket.schema_fields"
                :key="f.key"
                :label="f.label"
                :name="f.key"
                :required="f.required"
                :help="f.help"
                :error="problems[f.key]"
                :class="f.type === 'long_text' || f.type === 'multi_select' ? 'sm:col-span-2' : ''"
              >
                <FieldInput v-model="draftFields[f.key]" :field="(f as Field)" @update:model-value="delete problems[f.key]" />
              </UFormField>
            </div>
            <dl v-else class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <div
                v-for="f in ticket.schema_fields"
                :key="f.key"
                class="flex flex-col gap-1 min-w-0"
                :class="f.type === 'long_text' ? 'sm:col-span-2' : ''"
              >
                <dt class="text-[13px] text-(--ui-text-muted)">
                  {{ f.label }}
                </dt>
                <dd class="text-[15px] text-(--ui-text-highlighted) [overflow-wrap:anywhere]" :class="f.type === 'long_text' ? 'whitespace-pre-wrap' : ''">
                  <span v-if="isEmptyValue(ticket.fields[f.key])" class="text-(--ui-text-dimmed)">Not given</span>
                  <a v-else-if="f.type === 'url'" :href="String(ticket.fields[f.key])" target="_blank" rel="noopener noreferrer" class="text-(--ui-primary) hover:underline">{{ ticket.fields[f.key] }}</a>
                  <template v-else-if="f.type === 'file'">
                    <AttachmentChip v-if="fileOf(ticket.fields[f.key])" :attachment="fileOf(ticket.fields[f.key])!" />
                    <span v-else-if="attachmentsState === 'loading'" class="text-(--ui-text-dimmed)">Loading…</span>
                    <span v-else class="text-(--ui-text-dimmed)">File not available</span>
                  </template>
                  <template v-else>
                    {{ formatValue(f.type, ticket.fields[f.key]) }}
                  </template>
                </dd>
              </div>
            </dl>
          </section>

          <div v-if="editing" class="flex flex-wrap items-center gap-2">
            <UButton :loading="editBusy" :disabled="editBusy" @click="saveEdit">
              Save changes
            </UButton>
            <UButton variant="outline" color="neutral" :disabled="editBusy" @click="editing = false">
              Discard
            </UButton>
          </div>

          <TicketAttachments :ticket-ref="ticket.ref" :attachments="attachments" :state="attachmentsState" @uploaded="attachments.push($event)" @retry="loadAttachments(ticket.ref)" />
          <TicketConversation :ticket="ticket" :version="activityVersion" @reverted="ticket = $event" />
        </div>

        <aside aria-label="Ticket properties" class="flex-[1_1_300px] min-w-0 flex flex-col gap-4">
          <div class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <label v-if="can('change_status')" for="ticket-status" class="text-[13px] text-(--ui-text-muted)">Status</label>
              <span v-else class="text-[13px] text-(--ui-text-muted)">Status</span>
              <USelect
                v-if="can('change_status')"
                id="ticket-status"
                :model-value="ticket.status.key"
                :items="statusItems"
                :loading="saving === 'status'"
                :disabled="saving !== null"
                class="w-full"
                @update:model-value="changeStatus"
              />
              <span v-else><StatusBadge :status="ticket.status" /></span>
            </div>

            <div class="flex flex-col gap-1.5">
              <label v-if="can('change_priority')" for="ticket-priority" class="text-[13px] text-(--ui-text-muted)">Priority</label>
              <span v-else class="text-[13px] text-(--ui-text-muted)">Priority</span>
              <USelect
                v-if="can('change_priority')"
                id="ticket-priority"
                :model-value="ticket.priority"
                :items="PRIORITIES"
                :loading="saving === 'priority'"
                :disabled="saving !== null"
                class="w-full"
                @update:model-value="changePriority"
              />
              <span v-else><PriorityBadge :priority="ticket.priority" /></span>
            </div>

            <div class="flex flex-col gap-1.5">
              <span class="text-[13px] text-(--ui-text-muted)">Assignee</span>
              <div class="flex items-center gap-2 min-h-10">
                <template v-if="ticket.assignee">
                  <UserAvatar :person="ticket.assignee" size="sm" />
                  <span class="flex-1 min-w-0 text-sm truncate text-(--ui-text-highlighted)">{{ displayName(ticket.assignee) }}<span v-if="assignedToMe" class="text-(--ui-text-muted)"> (you)</span></span>
                </template>
                <span v-else class="flex-1 text-sm text-(--ui-text-muted)">Unassigned</span>
                <template v-if="can('assign')">
                  <UButton v-if="assignedToMe" size="sm" variant="outline" :loading="saving === 'assignee'" :disabled="saving !== null" @click="unassign">
                    Unassign
                  </UButton>
                  <UButton v-else size="sm" :variant="ticket.assignee ? 'outline' : 'solid'" :loading="saving === 'assignee'" :disabled="saving !== null" @click="assignToMe">
                    Assign to me
                  </UButton>
                </template>
              </div>
            </div>

            <div class="flex flex-col gap-1.5">
              <span class="text-[13px] text-(--ui-text-muted)">Team</span>
              <span class="text-sm text-(--ui-text-highlighted)">{{ ticket.team.name }}</span>
            </div>

            <div class="flex flex-col gap-1.5">
              <span class="text-[13px] text-(--ui-text-muted)">Ticket Type</span>
              <div v-if="typeChoice === null" class="flex items-center justify-between gap-2">
                <TicketTypeChip :name="ticket.ticket_type.name" :icon="ticket.ticket_type.icon" :color="ticket.ticket_type.color" />
                <UButton v-if="can('change_type')" size="sm" variant="outline" color="neutral" @click="openTypePicker">
                  Change type
                </UButton>
              </div>
              <form v-else class="flex flex-col gap-2.5" @submit.prevent="changeType">
                <USelect v-model="typeChoice" aria-label="New Ticket Type" :items="types" :loading="typesState === 'loading'" :disabled="saving !== null" class="w-full" />
                <p v-if="typesState === 'error'" class="text-[13px] text-(--ui-error)" role="alert">
                  The Ticket Types could not be loaded.
                </p>
                <p class="text-[13px] leading-snug text-(--ui-text-muted)">
                  The number stays and the prefix changes. Values of Fields with the same key and data type move. The other values stay in the Activity. The Team changes too. You cannot revert this.
                </p>
                <div class="flex gap-2">
                  <UButton type="submit" size="sm" :loading="saving === 'type'" :disabled="saving !== null || typeChoice === ticket.ticket_type.id">
                    Change type
                  </UButton>
                  <UButton size="sm" variant="outline" color="neutral" :disabled="saving !== null" @click="typeChoice = null">
                    Cancel
                  </UButton>
                </div>
              </form>
            </div>
          </div>

          <div class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] flex flex-col gap-3">
            <h2 class="text-sm font-semibold text-(--ui-text-highlighted)">
              Requester
            </h2>
            <div class="flex items-center gap-2.5 min-w-0">
              <UserAvatar :person="ticket.requester" size="lg" />
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-medium truncate text-(--ui-text-highlighted)">{{ displayName(ticket.requester) }}</span>
                <span v-if="displayName(ticket.requester) !== ticket.requester.email" class="text-[13px] truncate text-(--ui-text-muted)">{{ ticket.requester.email }}</span>
              </div>
            </div>
            <dl class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2.5 text-[13px]">
              <dt class="text-(--ui-text-muted)">
                Kind
              </dt>
              <dd class="text-(--ui-text)">
                User
              </dd>
              <dt class="text-(--ui-text-muted)">
                Source
              </dt>
              <dd><SourceChip :channel="ticket.channel" :application="ticket.application?.name" /></dd>
            </dl>
          </div>

          <div class="flex flex-col gap-1.5 px-1 text-[13px] text-(--ui-text-muted)">
            <span>Created <time :datetime="ticket.created_at">{{ formatDateTime(ticket.created_at) }}</time></span>
            <span>Updated <time :datetime="ticket.updated_at" :title="formatDateTime(ticket.updated_at)">{{ timeAgo(ticket.updated_at) }}</time></span>
          </div>
        </aside>
      </div>
    </template>

    <UModal v-model:open="cancelOpen" title="Cancel this ticket?" description="The team stops working on it. You can still add comments, but you cannot reopen a cancelled ticket.">
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2 w-full">
          <UButton variant="outline" color="neutral" :disabled="acting !== null" @click="cancelOpen = false">
            Keep ticket
          </UButton>
          <UButton color="error" :loading="acting === 'cancel'" :disabled="acting !== null" @click="selfService('cancel')">
            Cancel ticket
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" title="Delete this ticket?" description="It is hidden from every list, search, API and webhook. An Admin can restore it from Settings › Privacy.">
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2 w-full">
          <UButton variant="outline" color="neutral" :disabled="deleting" @click="deleteOpen = false">
            Keep ticket
          </UButton>
          <UButton color="error" :loading="deleting" @click="softDelete">
            Delete ticket
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPage>
</template>
