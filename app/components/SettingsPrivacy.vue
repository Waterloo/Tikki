<script setup lang="ts">
interface DeletedTicket {
  number: number
  ref: string
  title: string
  ticket_type: { name: string, icon: string, color: string }
  deleted_at: string
  deleted_by: { id: string, name: string } | null
}
interface ContactMatch {
  id: number
  external_id: string
  name: string
  email: string
  application: { id: number, name: string }
  ticket_count: number
  erased_at: string | null
}

const toast = useToast()
const message = (e: unknown) => (e as { data?: { error?: { message?: string } } }).data?.error?.message ?? 'Check your connection, then try again.'

// Deleted tickets
const deleted = ref<DeletedTicket[]>([])
const deletedState = ref<'loading' | 'ready' | 'error'>('loading')
const restoring = ref<number | null>(null)

async function loadDeleted() {
  deletedState.value = 'loading'
  try {
    deleted.value = (await $fetch<{ data: DeletedTicket[] }>('/api/v1/tickets/deleted')).data
    deletedState.value = 'ready'
  } catch {
    deletedState.value = 'error'
  }
}

async function restore(t: DeletedTicket) {
  restoring.value = t.number
  try {
    await $fetch(`/api/v1/tickets/${t.ref}/restore`, { method: 'POST' })
    deleted.value = deleted.value.filter(d => d.number !== t.number)
    toast.add({ title: `${t.ref} restored`, icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    toast.add({ title: 'The ticket was not restored.', description: message(e), color: 'error' })
  } finally {
    restoring.value = null
  }
}

// Erasure
const by = ref<'email' | 'external_id'>('email')
const term = ref('')
const searching = ref(false)
const searchError = ref<string | null>(null)
const result = ref<{ data: ContactMatch[], users: { id: string, name: string, email: string }[] } | null>(null)
const confirm = ref<ContactMatch | null>(null)
const erasing = ref(false)

async function find() {
  if (!term.value.trim()) return
  searching.value = true
  searchError.value = null
  try {
    result.value = await $fetch<NonNullable<typeof result.value>>('/api/v1/contacts', { query: { [by.value]: term.value.trim() } })
  } catch (e) {
    result.value = null
    searchError.value = message(e)
  } finally {
    searching.value = false
  }
}

async function erase() {
  const c = confirm.value
  if (!c) return
  erasing.value = true
  try {
    const url: string = `/api/v1/contacts/${c.id}`
    await $fetch(url, { method: 'DELETE' })
    toast.add({ title: 'Personal data erased', description: `${c.ticket_count} ticket${c.ticket_count === 1 ? '' : 's'} kept without their content.`, icon: 'i-lucide-check', color: 'success' })
    confirm.value = null
    term.value = ''
    result.value = null
  } catch (e) {
    toast.add({ title: 'Erasure did not finish.', description: `${message(e)} Run it again to finish.`, color: 'error' })
  } finally {
    erasing.value = false
  }
}

onMounted(loadDeleted)
</script>

<template>
  <SettingsSection title="Deleted tickets" description="A deleted ticket is hidden from every list, search, API and webhook. Restore it to make it visible again.">
    <ListSkeleton v-if="deletedState === 'loading'" :rows="2" />
    <ErrorState v-else-if="deletedState === 'error'" title="The deleted tickets could not be loaded." description="Check your connection, then try again." @retry="loadDeleted" />
    <p v-else-if="deleted.length === 0" class="text-sm text-(--ui-text-muted)">
      No deleted tickets.
    </p>
    <ul v-else class="flex flex-col rounded-[14px] border border-(--ui-border)" aria-label="Deleted tickets">
      <li v-for="t in deleted" :key="t.number" class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-t border-(--ui-border-muted) first:border-t-0">
        <TicketRef :value="t.ref" />
        <span class="min-w-0 flex-1 basis-40 truncate text-sm text-(--ui-text-highlighted)">{{ t.title }}</span>
        <TicketTypeChip :name="t.ticket_type.name" :icon="t.ticket_type.icon" :color="t.ticket_type.color" />
        <span class="text-xs text-(--ui-text-muted)">
          Deleted <time :datetime="t.deleted_at" :title="formatDateTime(t.deleted_at)">{{ timeAgo(t.deleted_at) }}</time><template v-if="t.deleted_by"> by {{ t.deleted_by.name }}</template>
        </span>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-rotate-ccw" :loading="restoring === t.number" :disabled="restoring !== null" @click="restore(t)">
          Restore
        </UButton>
      </li>
    </ul>
  </SettingsSection>

  <SettingsSection title="Privacy" description="How long data is kept, and Erasure of a Contact's personal data.">
    <ul class="list-disc pl-5 flex flex-col gap-2 text-sm text-(--ui-text)">
      <li>Delivered webhook payloads are deleted after 30 days.</li>
      <li>The audit log is never deleted. It keeps who did what and when. Erasure removes its values.</li>
      <li>Erasure is for Contacts, the people that Applications create tickets for. Their tickets stay with their numbers and Statuses, without title, description, Field values, comments or files.</li>
    </ul>

    <form class="flex flex-col gap-3 border-t border-(--ui-border-muted) pt-5" @submit.prevent="find">
      <p class="text-sm font-medium text-(--ui-text-highlighted)">
        Erase personal data
      </p>
      <div class="flex flex-wrap gap-2">
        <USelect v-model="by" :items="[{ label: 'Email', value: 'email' }, { label: 'External ID', value: 'external_id' }]" aria-label="Find by" class="w-36" />
        <UInput v-model="term" :placeholder="by === 'email' ? 'name@example.com' : 'cus_1042'" :aria-label="by === 'email' ? 'Email' : 'External ID'" class="min-w-0 flex-1 basis-48" />
        <UButton type="submit" color="neutral" variant="outline" icon="i-lucide-search" :loading="searching" :disabled="!term.trim()">
          Find
        </UButton>
      </div>
      <p class="text-xs text-(--ui-text-muted)">
        Exact match. Internal Users are not erased here: change or deactivate them in People.
      </p>
      <UAlert v-if="searchError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="searchError" />
      <template v-if="result">
        <UAlert
          v-if="result.users.length"
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :description="`${result.users[0]!.email} is an internal User. Erasure is for Contacts only; manage this person in People.`"
        />
        <p v-if="result.data.length === 0" class="text-sm text-(--ui-text-muted)">
          No Contact has this {{ by === 'email' ? 'email' : 'external ID' }}.
        </p>
        <ul v-else class="flex flex-col rounded-[14px] border border-(--ui-border)" aria-label="Contacts found">
          <li v-for="c in result.data" :key="c.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-t border-(--ui-border-muted) first:border-t-0">
            <div class="min-w-0 flex-1 basis-48">
              <p class="text-sm text-(--ui-text-highlighted) truncate">
                {{ c.name }} <span class="text-(--ui-text-muted)">{{ c.email }}</span>
              </p>
              <p class="text-xs text-(--ui-text-muted) truncate">
                {{ c.application.name }} · <span class="font-mono">{{ c.external_id }}</span> · {{ c.ticket_count }} ticket{{ c.ticket_count === 1 ? '' : 's' }}
              </p>
            </div>
            <UBadge v-if="c.erased_at" color="neutral" variant="subtle">
              Erased
            </UBadge>
            <UButton size="sm" color="error" variant="outline" icon="i-lucide-eraser" @click="confirm = c">
              {{ c.erased_at ? 'Erase again' : 'Erase' }}
            </UButton>
          </li>
        </ul>
      </template>
    </form>
  </SettingsSection>

  <UModal :open="confirm !== null" :title="`Erase ${confirm?.name ?? 'this Contact'}?`" description="This cannot be undone. The name and email become [erased]. The title, description, Field values, comments and files of their tickets are removed, and so are webhook payloads and notices about them. The tickets stay with their numbers and Statuses." @update:open="v => { if (!v) confirm = null }">
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <UButton variant="outline" color="neutral" :disabled="erasing" @click="confirm = null">
          Keep data
        </UButton>
        <UButton color="error" :loading="erasing" @click="erase">
          Erase
        </UButton>
      </div>
    </template>
  </UModal>
</template>
