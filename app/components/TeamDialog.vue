<script setup lang="ts">
import type { PersonRow, TeamView } from '~/types/people'

/** Creates a Team (no `team`), or edits one: rename, members, remove. */
const props = defineProps<{ team: TeamView | null, people: PersonRow[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()

const name = ref('')
const current = ref<TeamView | null>(null)
const busy = ref(false)
const failure = ref<string | null>(null)
const nameProblem = ref<string | null>(null)
const toAdd = ref<string | undefined>()
const confirmRemove = ref(false)

// The server answers each change with the whole Team, so the dialog shows the saved state.
watch(open, (isOpen) => {
  if (!isOpen) return
  current.value = props.team
  name.value = props.team?.name ?? ''
  failure.value = null
  nameProblem.value = null
  toAdd.value = undefined
  confirmRemove.value = false
})

const candidates = computed(() => {
  const inTeam = new Set(current.value?.members.map(m => m.id))
  return props.people
    .filter(p => p.id && p.status === 'active' && p.role !== 'requester' && !inTeam.has(p.id))
    .map(p => ({ label: p.name ? `${p.name} (${p.email})` : p.email, value: p.id! }))
})

async function run(action: () => Promise<TeamView | void>) {
  busy.value = true
  failure.value = null
  nameProblem.value = null
  try {
    const result = await action()
    if (result) current.value = result
    emit('changed')
    return true
  } catch (e) {
    const err = apiProblem(e)
    if (err.status === 422 || err.code === 'TEAM_NAME_TAKEN') nameProblem.value = err.details[0]?.reason ?? err.message
    else failure.value = err.message
    return false
  } finally {
    busy.value = false
  }
}

async function saveName() {
  const body = { name: name.value }
  const ok = await run(() => current.value
    ? $fetch<TeamView>(`/api/v1/teams/${current.value.id}`, { method: 'PATCH', body })
    : $fetch<TeamView>('/api/v1/teams', { method: 'POST', body }))
  if (ok && !props.team) open.value = false
}

async function addMember() {
  if (!current.value || !toAdd.value) return
  const id = current.value.id
  const userId = toAdd.value
  await run(() => $fetch<TeamView>(`/api/v1/teams/${id}/members/${userId}`, { method: 'PUT' }))
  toAdd.value = undefined
}

function removeMember(userId: string) {
  const id = current.value!.id
  return run(() => $fetch<TeamView>(`/api/v1/teams/${id}/members/${userId}`, { method: 'DELETE' }))
}

async function removeTeam() {
  const id = current.value!.id
  if (await run(() => $fetch<void>(`/api/v1/teams/${id}`, { method: 'DELETE' }))) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="team ? `Edit ${team.name}` : 'New team'" :description="team ? 'Rename the team and choose its members.' : 'A group of agents that owns ticket types.'">
    <template #body>
      <div class="flex flex-col gap-5">
        <form class="flex items-start gap-2" @submit.prevent="saveName">
          <UFormField label="Name" :error="nameProblem ?? undefined" class="flex-1" required>
            <UInput v-model="name" maxlength="60" autofocus class="w-full" />
          </UFormField>
          <UButton type="submit" class="mt-[26px]" :loading="busy" :disabled="!name.trim() || name.trim() === current?.name">
            {{ current ? 'Rename' : 'Create' }}
          </UButton>
        </form>

        <template v-if="current">
          <div class="flex flex-col gap-2">
            <p class="text-sm font-medium text-(--ui-text-highlighted)">
              Members
            </p>
            <p v-if="current.members.length === 0" class="text-sm text-(--ui-text-muted)">
              No members yet. Only agents and admins can join a team.
            </p>
            <ul v-else class="flex flex-col">
              <li v-for="m in current.members" :key="m.id" class="flex items-center gap-3 py-2 border-t border-(--ui-border-muted) first:border-t-0">
                <UserAvatar :person="m" />
                <span class="min-w-0 flex-1 flex flex-col">
                  <span class="text-sm font-medium truncate">{{ displayName(m) }}</span>
                  <span v-if="m.name" class="text-[13px] text-(--ui-text-muted) truncate">{{ m.email }}</span>
                </span>
                <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-x" :aria-label="`Remove ${displayName(m)} from ${current.name}`" :disabled="busy" @click="removeMember(m.id)" />
              </li>
            </ul>
            <div class="flex items-center gap-2">
              <USelect v-model="toAdd" :items="candidates" placeholder="Add an agent" aria-label="Add an agent" class="flex-1" :disabled="candidates.length === 0" />
              <UButton color="neutral" variant="outline" :disabled="!toAdd" :loading="busy" @click="addMember">
                Add
              </UButton>
            </div>
          </div>

          <div class="flex flex-col gap-2 border-t border-(--ui-border-muted) pt-4">
            <p v-if="current.owns.length" class="text-sm text-(--ui-text-muted)">
              {{ current.name }} owns {{ current.owns.length }} ticket {{ current.owns.length === 1 ? 'type' : 'types' }}, so it cannot be removed. Move them to another team first.
            </p>
            <div v-else-if="!confirmRemove">
              <UButton color="error" variant="outline" icon="i-lucide-trash-2" @click="confirmRemove = true">
                Remove team
              </UButton>
            </div>
            <div v-else class="flex flex-wrap items-center gap-2">
              <span class="text-sm">Remove {{ current.name }}? Its members stay as users.</span>
              <UButton color="error" :loading="busy" @click="removeTeam">
                Yes, remove
              </UButton>
              <UButton color="neutral" variant="ghost" @click="confirmRemove = false">
                Keep
              </UButton>
            </div>
          </div>
        </template>

        <UAlert v-if="failure" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="failure" />
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="ghost" @click="open = false">
        Close
      </UButton>
    </template>
  </UModal>
</template>
