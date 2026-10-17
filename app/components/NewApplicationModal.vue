<script setup lang="ts">
import { PERMISSIONS, type ApplicationDetail, type Permission, type TicketTypeOption } from '~/types/applications'

const props = defineProps<{ ticketTypes: TicketTypeOption[] }>()
const emit = defineEmits<{ created: [app: ApplicationDetail] }>()
const open = defineModel<boolean>('open', { required: true })

const name = ref('')
const description = ref('')
// Most systems create tickets and follow them. The Admin adds the rest when needed.
const permissions = ref<Permission[]>(['tickets:create', 'tickets:read'])
const typeIds = ref<number[]>([])
const saving = ref(false)
const problems = ref<Record<string, string>>({})
const formError = ref<string | null>(null)

const typeItems = computed(() => props.ticketTypes.map(t => ({ label: t.name, id: t.id, icon: t.icon })))

watch(open, (isOpen) => {
  if (!isOpen) return
  name.value = ''
  description.value = ''
  permissions.value = ['tickets:create', 'tickets:read']
  typeIds.value = []
  problems.value = {}
  formError.value = null
})

function toggle(permission: Permission, on: boolean | 'indeterminate') {
  permissions.value = on === true ? [...permissions.value, permission] : permissions.value.filter(p => p !== permission)
}

async function submit() {
  saving.value = true
  problems.value = {}
  formError.value = null
  try {
    const app = await $fetch<ApplicationDetail>('/api/v1/applications', {
      method: 'POST',
      body: { name: name.value, description: description.value, permissions: permissions.value, ticket_type_ids: typeIds.value },
    })
    open.value = false
    emit('created', app)
  } catch (e) {
    const err = (e as { data?: { error?: { message?: string, details?: { key: string, reason: string }[] | null } } }).data?.error
    if (err?.details?.length) problems.value = Object.fromEntries(err.details.map(d => [d.key, d.reason]))
    else formError.value = err?.message ?? 'The application could not be created. Try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="New application" description="Another system that creates tickets for its customers with an API key.">
    <template #body>
      <form id="new-application" class="flex flex-col gap-4" @submit.prevent="submit">
        <UFormField label="Name" :error="problems.name" required>
          <UInput v-model="name" maxlength="80" size="lg" class="w-full" placeholder="Checkout" autofocus />
        </UFormField>
        <UFormField label="Description" :error="problems.description" help="What the system is, for the other Admins.">
          <UTextarea v-model="description" maxlength="500" :rows="2" class="w-full" />
        </UFormField>
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-2 text-[13px] text-(--ui-text-muted)">
            Permissions
          </legend>
          <UCheckbox
            v-for="p in PERMISSIONS"
            :key="p.value"
            :model-value="permissions.includes(p.value)"
            :label="p.label"
            :description="p.value"
            :ui="{ description: 'font-mono text-xs' }"
            @update:model-value="toggle(p.value, $event)"
          />
          <p v-if="problems.permissions" class="text-sm text-(--ui-error)">
            {{ problems.permissions }}
          </p>
        </fieldset>
        <UFormField label="Allowed ticket types" :error="problems.ticket_type_ids" help="It can create tickets of these types only.">
          <USelectMenu
            v-model="typeIds"
            :items="typeItems"
            value-key="id"
            multiple
            placeholder="Choose types"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="formError" />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="outline" @click="open = false">
          Cancel
        </UButton>
        <UButton type="submit" form="new-application" :loading="saving">
          Create application
        </UButton>
      </div>
    </template>
  </UModal>
</template>
