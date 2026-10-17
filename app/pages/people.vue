<script setup lang="ts">
import type { PersonRow, TeamView } from '~/types/people'

interface Deployment {
  sign_in: { methods: string[], allowed_domains: string[] }
}

definePageMeta({
  // The server refuses everyone but Admins anyway. This only spares others an error page.
  middleware: async () => {
    const { data } = await authClient.getSession()
    if ((data?.user as { role?: string } | undefined)?.role !== 'admin') return navigateTo('/')
  },
})

const ROLES: { label: string, value: Role }[] = [
  { label: 'Admin', value: 'admin' },
  { label: 'Agent', value: 'agent' },
  { label: 'Requester', value: 'requester' },
]
// One grid for the header and the rows. Below `lg` each row becomes a card.
const COLUMNS = 'lg:grid-cols-[minmax(220px,1.6fr)_150px_minmax(120px,1fr)_110px_110px_150px]'

const toast = useToast()
const { user: me } = useCurrentUser()

const people = ref<PersonRow[]>([])
const teams = ref<TeamView[]>([])
const deployment = ref<Deployment | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const busyId = ref<string | null>(null)

const inviteOpen = ref(false)
const teamOpen = ref(false)
const editing = ref<TeamView | null>(null)
const deactivating = ref<PersonRow | null>(null)
const deactivateOpen = computed({ get: () => deactivating.value !== null, set: (v) => { if (!v) deactivating.value = null } })

const STATUS = {
  active: { label: 'Active', color: 'success' },
  invited: { label: 'Invited', color: 'warning' },
  expired: { label: 'Expired', color: 'neutral' },
  deactivated: { label: 'Deactivated', color: 'neutral' },
} as const

const rowKey = (p: PersonRow) => p.id ?? `invite-${p.invite_id}`

async function load() {
  state.value = 'loading'
  try {
    const [p, t, d] = await Promise.all([
      $fetch<{ data: PersonRow[] }>('/api/v1/users'),
      $fetch<{ data: TeamView[] }>('/api/v1/teams'),
      $fetch<Deployment>('/api/v1/settings/deployment'),
    ])
    people.value = p.data
    teams.value = t.data
    deployment.value = d
    state.value = 'ready'
  } catch (e) {
    if (apiProblem(e).status === 401) return navigateTo('/sign-in')
    state.value = 'error'
  }
}

/** Reloads without the skeleton, so the page does not jump after a change. */
async function refresh() {
  try {
    const [p, t] = await Promise.all([$fetch<{ data: PersonRow[] }>('/api/v1/users'), $fetch<{ data: TeamView[] }>('/api/v1/teams')])
    people.value = p.data
    teams.value = t.data
  } catch {
    state.value = 'error'
  }
}

async function act(p: PersonRow, request: () => Promise<unknown>, done: string) {
  busyId.value = rowKey(p)
  try {
    await request()
    toast.add({ title: done, icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Not changed', description: apiProblem(e).message, icon: 'i-lucide-circle-alert', color: 'error' })
  } finally {
    busyId.value = null
    await refresh()
  }
}

// URLs are typed as plain strings: the typed-route check of `$fetch` is too deep for a dynamic path.
const userUrl = (p: PersonRow): string => ['/api/v1/users', p.id].join('/')
const changeRole = (p: PersonRow, role: Role) =>
  act(p, () => $fetch<unknown>(userUrl(p), { method: 'PATCH', body: { role } }), `${displayName(p)} is now ${role === 'admin' ? 'an Admin' : `a${role === 'agent' ? 'n' : ''} ${role}`}`)

const setActive = (p: PersonRow, active: boolean) =>
  act(p, () => $fetch<unknown>(userUrl(p), { method: 'PATCH', body: { active } }), `${displayName(p)} is ${active ? 'active again' : 'deactivated'}`)

const inviteUrl = (p: PersonRow, ...rest: string[]): string => ['/api/v1/invites', p.invite_id, ...rest].join('/')
const resend = (p: PersonRow) => act(p, () => $fetch<unknown>(inviteUrl(p, 'resend'), { method: 'POST' }), `Invite sent again to ${p.email}`)
const revoke = (p: PersonRow) => act(p, () => $fetch<unknown>(inviteUrl(p), { method: 'DELETE' }), `Invite to ${p.email} removed`)

async function confirmDeactivate() {
  const p = deactivating.value
  deactivating.value = null
  if (p) await setActive(p, false)
}

function onInvited(count: number) {
  toast.add({ title: count === 1 ? 'Invite sent' : `${count} invites sent`, icon: 'i-lucide-check', color: 'success' })
  refresh()
}

function openTeam(t: TeamView | null) {
  editing.value = t
  teamOpen.value = true
}

onMounted(load)
</script>

<template>
  <AppPage id="people" title="Teams and users">
    <PageHeader
      title="Teams and users"
      subtitle="People sign in with their work account. New people start as requesters. Give agents a team so they get its tickets."
      :breadcrumb="[{ label: 'Admin' }, { label: 'Teams and users' }]"
    >
      <template #actions>
        <UButton icon="i-lucide-user-plus" size="lg" color="neutral" @click="inviteOpen = true">
          Invite people
        </UButton>
      </template>
    </PageHeader>

    <ListSkeleton v-if="state === 'loading'" :rows="6" />
    <ErrorState v-else-if="state === 'error'" title="Teams and users could not be loaded." description="Check your connection, then try again." @retry="load" />

    <template v-else>
      <section aria-label="Sign-in" class="flex flex-wrap items-center gap-x-6 gap-y-3 px-[18px] py-3.5 rounded-[14px] border border-(--ui-border) bg-(--ui-bg) text-sm">
        <span class="flex flex-wrap items-center gap-2">
          <span class="text-(--ui-text-muted)">Who can sign in</span>
          <UBadge v-for="d in deployment?.sign_in.allowed_domains" :key="d" color="neutral" variant="subtle" class="font-mono">
            {{ d }}
          </UBadge>
          <span class="text-(--ui-text-muted)">and invited people</span>
        </span>
        <span class="flex items-center gap-2">
          <span class="text-(--ui-text-muted)">Sign-in methods</span>
          <span>{{ deployment?.sign_in.methods.join(' · ') }}</span>
        </span>
        <span class="text-[13px] text-(--ui-text-muted)">Set in the deployment settings.</span>
      </section>

      <section aria-labelledby="users-h" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-2">
        <h2 id="users-h" class="px-3.5 pt-2.5 pb-1.5 text-[15px] font-semibold text-(--ui-text-highlighted)">
          Users
        </h2>
        <div class="hidden lg:grid items-center gap-4 px-3.5 min-h-10 text-[13px] text-(--ui-text-muted)" :class="COLUMNS" aria-hidden="true">
          <span>Person</span><span>Role</span><span>Teams</span><span>Status</span><span>Last active</span><span />
        </div>
        <ul>
          <li
            v-for="p in people"
            :key="rowKey(p)"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-3.5 py-3 lg:py-2 lg:min-h-[60px] border-t border-(--ui-border-muted) text-sm"
            :class="COLUMNS"
          >
            <span class="flex items-center gap-2.5 min-w-0">
              <UserAvatar :person="p" />
              <span class="flex flex-col min-w-0">
                <span class="font-medium truncate">
                  {{ displayName(p) }}
                  <span v-if="p.id && p.id === me?.id" class="font-normal text-(--ui-text-muted)">(you)</span>
                </span>
                <span v-if="p.name" class="text-[13px] text-(--ui-text-muted) truncate">{{ p.email }}</span>
              </span>
            </span>
            <span class="col-start-2 row-start-1 lg:col-start-auto lg:row-start-auto justify-self-end lg:justify-self-start">
              <USelect
                v-if="p.id"
                :model-value="p.role"
                :items="ROLES"
                :aria-label="`Role of ${displayName(p)}`"
                :disabled="busyId === rowKey(p)"
                class="w-[130px]"
                @update:model-value="changeRole(p, $event as Role)"
              />
              <span v-else class="text-(--ui-text-muted)">Requester</span>
            </span>
            <span class="col-span-2 lg:col-span-1 flex flex-wrap gap-1">
              <template v-if="p.teams.length">
                <UBadge v-for="t in p.teams" :key="t.id" color="primary" variant="subtle">
                  {{ t.name }}
                </UBadge>
              </template>
              <span v-else class="text-[13px] text-(--ui-text-muted)">—</span>
            </span>
            <span><UBadge :color="STATUS[p.status].color" variant="subtle">{{ STATUS[p.status].label }}</UBadge></span>
            <span class="text-[13px] text-(--ui-text-muted)">
              <time v-if="p.last_active_at" :datetime="p.last_active_at">{{ timeAgo(p.last_active_at) }}</time>
              <template v-else>{{ p.status === 'active' ? 'Not yet' : '—' }}</template>
            </span>
            <span class="col-span-2 lg:col-span-1 flex justify-end gap-2">
              <template v-if="p.id">
                <UButton v-if="p.status === 'deactivated'" color="neutral" variant="outline" size="sm" :loading="busyId === rowKey(p)" @click="setActive(p, true)">
                  Reactivate
                </UButton>
                <UButton
                  v-else
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :disabled="p.id === me?.id || busyId === rowKey(p)"
                  :title="p.id === me?.id ? 'You cannot deactivate yourself.' : undefined"
                  @click="deactivating = p"
                >
                  Deactivate
                </UButton>
              </template>
              <template v-else>
                <UButton color="neutral" variant="outline" size="sm" :loading="busyId === rowKey(p)" @click="resend(p)">
                  Resend
                </UButton>
                <UButton color="neutral" variant="ghost" size="sm" :disabled="busyId === rowKey(p)" :aria-label="`Remove invite to ${p.email}`" @click="revoke(p)">
                  Remove
                </UButton>
              </template>
            </span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="teams-h" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-col gap-1">
            <h2 id="teams-h" class="text-[15px] font-semibold text-(--ui-text-highlighted)">
              Teams
            </h2>
            <span class="text-[13px] text-(--ui-text-muted)">Every ticket type has one owning team. A team that owns types cannot be removed.</span>
          </div>
          <UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="openTeam(null)">
            New team
          </UButton>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-3">
          <article v-for="t in teams" :key="t.id" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] flex flex-col gap-3.5">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-base font-semibold text-(--ui-text-highlighted) truncate">
                {{ t.name }}
              </h3>
              <UButton color="neutral" variant="outline" size="sm" :aria-label="`Edit ${t.name}`" @click="openTeam(t)">
                Edit
              </UButton>
            </div>
            <div class="flex flex-col gap-1.5">
              <span class="text-[13px] text-(--ui-text-muted)">Members</span>
              <div v-if="t.members.length" class="flex items-center gap-2">
                <span class="flex gap-1"><UserAvatar v-for="m in t.members.slice(0, 3)" :key="m.id" :person="m" size="sm" /></span>
                <span class="text-sm min-w-0 truncate">{{ t.members.map(displayName).join(', ') }}</span>
              </div>
              <span v-else class="text-sm text-(--ui-text-muted)">No members yet</span>
            </div>
            <div class="flex flex-col gap-1.5">
              <span class="text-[13px] text-(--ui-text-muted)">Owns</span>
              <div v-if="t.owns.length" class="flex flex-wrap gap-2">
                <TicketTypeChip v-for="o in t.owns" :key="o.id" :name="o.name" :icon="o.icon" :color="o.color" />
              </div>
              <span v-else class="text-sm text-(--ui-text-muted)">No ticket types</span>
            </div>
          </article>
          <div v-if="teams.length <= 1" class="rounded-[14px] border border-dashed border-(--ui-border-accented) p-[18px] flex flex-col justify-center gap-1.5 min-h-[140px]">
            <span class="text-sm font-medium">One team is enough for now</span>
            <span class="text-[13px] leading-normal text-(--ui-text-muted)">Add a team when a group of agents, for example Finance, should own its own ticket types.</span>
          </div>
        </div>
      </section>
    </template>

    <InviteDialog v-model:open="inviteOpen" @invited="onInvited" />
    <TeamDialog v-model:open="teamOpen" :team="editing" :people="people" @changed="refresh" />
    <UModal v-model:open="deactivateOpen" :title="`Deactivate ${deactivating ? displayName(deactivating) : ''}?`" description="They are signed out at once, cannot sign in, and their Claude connections stop. Their tickets stay. You can reactivate them later.">
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="deactivating = null">
          Cancel
        </UButton>
        <UButton color="error" @click="confirmDeactivate">
          Deactivate
        </UButton>
      </template>
    </UModal>
  </AppPage>
</template>
