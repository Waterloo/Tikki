<script setup lang="ts">
import type { Attachment, Priority, Status, TicketDetail } from '~/types/tickets'

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
const saving = ref<'status' | 'priority' | 'assignee' | null>(null)

const isStaff = computed(() => role.value === 'admin' || role.value === 'agent')
const back = computed(() => isStaff.value ? { label: 'All tickets', to: '/tickets' } : { label: 'My tickets', to: '/' })
const can = (action: TicketDetail['allowed_actions'][number]) => ticket.value?.allowed_actions.includes(action) ?? false
const assignedToMe = computed(() => !!ticket.value?.assignee && ticket.value.assignee.id === user.value?.id)
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

async function save(field: 'status' | 'priority' | 'assignee', body: Record<string, unknown>, done: string) {
  if (!ticket.value || saving.value) return
  saving.value = field
  try {
    ticket.value = await $fetch<TicketDetail>(`/api/v1/tickets/${ticket.value.ref}`, { method: 'PATCH', body })
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

function fileOf(id: unknown) {
  return attachments.value.find(a => a.id === id)
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
        <template #eyebrow>
          <TicketTypeChip :name="ticket.ticket_type.name" :icon="ticket.ticket_type.icon" :color="ticket.ticket_type.color" />
          <TicketRef :value="ticket.ref" />
          <StatusBadge :status="ticket.status" />
        </template>
      </PageHeader>

      <div class="flex flex-wrap gap-6 items-start">
        <div class="flex-[999_1_520px] min-w-0 flex flex-col gap-5">
          <section aria-label="Description" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) px-4 py-4 sm:px-[22px] sm:py-5">
            <p v-if="ticket.description" class="text-[15px] leading-relaxed text-(--ui-text) whitespace-pre-wrap [overflow-wrap:anywhere]">
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

          <TicketAttachments :ticket-ref="ticket.ref" :attachments="attachments" :state="attachmentsState" @uploaded="attachments.push($event)" @retry="loadAttachments(ticket.ref)" />
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
              <TicketTypeChip :name="ticket.ticket_type.name" :icon="ticket.ticket_type.icon" :color="ticket.ticket_type.color" />
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
              <dd><SourceChip :channel="ticket.channel" /></dd>
            </dl>
          </div>

          <div class="flex flex-col gap-1.5 px-1 text-[13px] text-(--ui-text-muted)">
            <span>Created <time :datetime="ticket.created_at">{{ formatDateTime(ticket.created_at) }}</time></span>
            <span>Updated <time :datetime="ticket.updated_at" :title="formatDateTime(ticket.updated_at)">{{ timeAgo(ticket.updated_at) }}</time></span>
          </div>
        </aside>
      </div>
    </template>
  </AppPage>
</template>
