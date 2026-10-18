<script setup lang="ts">
import type { PersonRow, TeamView } from '~/types/people'

/** Invites people (no `invite`), or changes the role and Teams of a pending invite. */
const props = defineProps<{ teams: TeamView[], invite: PersonRow | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ invited: [count: number], changed: [] }>()

const ROLES = [
  { label: 'Requester', value: 'requester' },
  { label: 'Agent', value: 'agent' },
  { label: 'Admin', value: 'admin' },
] as const

const text = ref('')
const role = ref<Role>('requester')
const teamIds = ref<number[]>([])
const busy = ref(false)
const problems = ref<string[]>([])
const failure = ref<string | null>(null)

const emails = computed(() => text.value.split(/[\s,;]+/).filter(Boolean))
const teamItems = computed(() => props.teams.map(t => ({ label: t.name, value: t.id })))
const withTeams = computed(() => role.value !== 'requester')

watch(open, (isOpen) => {
  if (!isOpen) return
  text.value = ''
  role.value = props.invite?.role ?? 'requester'
  teamIds.value = props.invite?.teams.map(t => t.id) ?? []
  problems.value = []
  failure.value = null
})

async function submit() {
  busy.value = true
  problems.value = []
  failure.value = null
  const team_ids = withTeams.value ? teamIds.value : []
  try {
    if (props.invite) {
      await $fetch(['/api/v1/invites', props.invite.invite_id].join('/'), { method: 'PATCH', body: { role: role.value, team_ids } })
      open.value = false
      emit('changed')
    } else {
      const res = await $fetch<{ invited: string[] }>('/api/v1/invites', { method: 'POST', body: { emails: emails.value, role: role.value, team_ids } })
      open.value = false
      emit('invited', res.invited.length)
    }
  } catch (e) {
    const err = apiProblem(e)
    if (err.details.length) problems.value = err.details.map(d => d.reason)
    else failure.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="invite ? 'Edit invite' : 'Invite people'"
    :description="invite ? `Change what ${invite.email} gets at the first sign-in.` : 'They sign in with an email code, on an allowed domain or not. The role and Teams are set when they first sign in.'"
  >
    <template #body>
      <form id="invite-form" class="flex flex-col gap-4" @submit.prevent="submit">
        <UFormField v-if="!invite" label="Email addresses" help="One or more, separated by a space, a comma or a new line." required>
          <UTextarea v-model="text" :rows="4" autofocus placeholder="alex@northwind-contracting.com" class="w-full" />
        </UFormField>
        <UFormField label="Role" :help="invite ? undefined : 'Everyone in this invite gets the same role and Teams.'">
          <USelect v-model="role" :items="[...ROLES]" class="w-full" />
        </UFormField>
        <UFormField v-if="withTeams" label="Teams" help="Optional. An Agent or Admin can be in more than one Team.">
          <USelectMenu v-model="teamIds" :items="teamItems" value-key="value" multiple placeholder="No Team" class="w-full" />
        </UFormField>
        <UAlert v-if="problems.length" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="invite ? 'The invite was not changed.' : 'Nobody was invited. Fix these and try again.'">
          <template #description>
            <ul class="list-disc pl-4">
              <li v-for="p in problems" :key="p">
                {{ p }}
              </li>
            </ul>
          </template>
        </UAlert>
        <UAlert v-if="failure" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="failure" />
      </form>
    </template>
    <template #footer>
      <UButton color="neutral" variant="ghost" @click="open = false">
        Cancel
      </UButton>
      <UButton type="submit" form="invite-form" :loading="busy" :disabled="!invite && emails.length === 0">
        {{ invite ? 'Save' : `Send ${emails.length > 1 ? `${emails.length} invites` : 'invite'}` }}
      </UButton>
    </template>
  </UModal>
</template>
