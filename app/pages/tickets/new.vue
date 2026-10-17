<script setup lang="ts">
import type { Field } from '~/components/FieldInput.vue'

interface TicketType {
  id: number
  name: string
  description: string
  icon: string
  color: string
  prefix: string
}

interface Problem {
  key: string
  label: string
  reason: string
  options?: string[]
}

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const

const toast = useToast()

const types = ref<TicketType[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const selectedId = ref<number | null>(null)
const fields = ref<Field[]>([])
const fieldsState = ref<'idle' | 'loading' | 'error'>('idle')

const title = ref('')
const description = ref('')
const priority = ref<typeof PRIORITIES[number]['value']>('normal')
const values = ref<Record<string, unknown>>({})
const problems = ref<Record<string, string>>({})
const formError = ref<string | null>(null)
const busy = ref(false)

function isUnauthenticated(e: unknown) {
  return (e as { status?: number }).status === 401
}

async function loadTypes() {
  state.value = 'loading'
  try {
    types.value = (await $fetch<{ data: TicketType[] }>('/api/v1/ticket-types')).data
    state.value = 'ready'
  } catch (e) {
    if (isUnauthenticated(e)) return navigateTo('/sign-in')
    state.value = 'error'
  }
}

async function pick(id: number) {
  if (selectedId.value === id) return
  selectedId.value = id
  // Each type has its own Fields, so values of the previous type do not carry over.
  values.value = {}
  problems.value = {}
  fieldsState.value = 'loading'
  try {
    const type = await $fetch<{ fields: Field[] }>(`/api/v1/ticket-types/${id}`)
    // The user may have picked another type while this one loaded.
    if (selectedId.value !== id) return
    fields.value = type.fields
    fieldsState.value = 'idle'
  } catch (e) {
    if (isUnauthenticated(e)) return navigateTo('/sign-in')
    fieldsState.value = 'error'
  }
}

function reloadFields() {
  const id = selectedId.value
  selectedId.value = null
  if (id !== null) pick(id)
}

async function submit() {
  if (selectedId.value === null) return
  busy.value = true
  problems.value = {}
  formError.value = null
  try {
    const created = await $fetch<{ ref: string }>('/api/v1/tickets', {
      method: 'POST',
      body: { ticket_type_id: selectedId.value, title: title.value, description: description.value, priority: priority.value, fields: values.value },
    })
    toast.add({ title: `Created ${created.ref}`, description: title.value.trim(), color: 'success' })
    await navigateTo('/')
  } catch (e) {
    const err = e as { status?: number, data?: { error?: { details?: Problem[] } } }
    if (err.status === 401) return navigateTo('/sign-in')
    const details = err.status === 422 ? err.data?.error?.details : undefined
    if (!details) {
      formError.value = 'The ticket could not be created. Try again.'
      return
    }
    problems.value = Object.fromEntries(details.map(d => [d.key, d.options ? `${d.reason} Options: ${d.options.join(', ')}.` : d.reason]))
    const shown = new Set(['title', 'description', 'priority', ...fields.value.map(f => f.key)])
    const other = details.filter(d => !shown.has(d.key))
    if (other.length) formError.value = other.map(d => `${d.label}: ${d.reason}`).join(' ')
  } finally {
    busy.value = false
  }
}

onMounted(loadTypes)
</script>

<template>
  <div class="max-w-3xl mx-auto p-4 sm:p-8">
    <header class="mb-6">
      <ULink to="/" class="text-sm text-(--ui-text-muted)">
        ← My tickets
      </ULink>
      <h1 class="text-xl font-semibold mt-2">
        New ticket
      </h1>
      <p class="text-sm text-(--ui-text-muted) mt-1">
        Choose what kind of help you need. The form asks only for what the team needs.
      </p>
    </header>

    <p v-if="state === 'loading'" class="text-(--ui-text-muted)">
      Loading ticket types…
    </p>
    <UAlert v-else-if="state === 'error'" color="error" variant="subtle" title="The ticket types could not be loaded.">
      <template #actions>
        <UButton size="xs" @click="loadTypes">
          Try again
        </UButton>
      </template>
    </UAlert>

    <form v-else class="space-y-6" novalidate @submit.prevent="submit">
      <fieldset>
        <legend class="text-sm font-medium mb-2">
          What is this about?
        </legend>
        <div class="grid gap-3 sm:grid-cols-2">
          <button
            v-for="t in types"
            :key="t.id"
            type="button"
            :aria-pressed="selectedId === t.id"
            class="flex items-start gap-3 text-left rounded-lg border bg-(--ui-bg) p-3 transition-colors hover:bg-(--ui-bg-elevated)"
            :style="selectedId === t.id ? { borderColor: t.color, boxShadow: `0 0 0 1px ${t.color}` } : {}"
            :class="selectedId === t.id ? '' : 'border-(--ui-border)'"
            @click="pick(t.id)"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-md" :style="{ color: t.color, backgroundColor: `color-mix(in srgb, ${t.color} 14%, transparent)` }">
              <UIcon :name="t.icon" class="size-5" />
            </span>
            <span>
              <span class="block font-medium">{{ t.name }}</span>
              <span class="block text-sm text-(--ui-text-muted)">{{ t.description }}</span>
            </span>
          </button>
        </div>
      </fieldset>

      <template v-if="selectedId !== null">
        <UFormField label="Title" name="title" required :error="problems.title">
          <UInput v-model="title" @update:model-value="delete problems.title" placeholder="One line that says what is wrong or what you need" class="w-full" />
        </UFormField>

        <UFormField label="Description" name="description" :error="problems.description">
          <UTextarea v-model="description" @update:model-value="delete problems.description" :rows="4" placeholder="What happened? What did you expect?" class="w-full" />
        </UFormField>

        <p v-if="fieldsState === 'loading'" class="text-sm text-(--ui-text-muted)">
          Loading fields…
        </p>
        <UAlert v-else-if="fieldsState === 'error'" color="error" variant="subtle" title="The fields of this type could not be loaded.">
          <template #actions>
            <UButton size="xs" @click="reloadFields">
              Try again
            </UButton>
          </template>
        </UAlert>
        <template v-else>
          <UFormField
            v-for="f in fields"
            :key="f.key"
            :label="f.label"
            :name="f.key"
            :description="f.help"
            :required="f.required"
            :error="problems[f.key]"
          >
            <FieldInput v-model="values[f.key]" :field="f" @update:model-value="delete problems[f.key]" />
          </UFormField>
        </template>

        <fieldset>
          <legend class="text-sm font-medium mb-2">
            Priority
          </legend>
          <div class="inline-flex rounded-md border border-(--ui-border) p-0.5 gap-0.5">
            <UButton
              v-for="p in PRIORITIES"
              :key="p.value"
              type="button"
              size="sm"
              :aria-pressed="priority === p.value"
              :color="priority === p.value && p.value === 'urgent' ? 'error' : 'neutral'"
              :variant="priority === p.value ? (p.value === 'urgent' ? 'solid' : 'outline') : 'ghost'"
              @click="priority = p.value; delete problems.priority"
            >
              {{ p.label }}
            </UButton>
          </div>
          <p v-if="problems.priority" class="text-sm text-(--ui-error) mt-1">
            {{ problems.priority }}
          </p>
        </fieldset>

        <UAlert v-if="formError" color="error" variant="subtle" :description="formError" />

        <div class="flex justify-end gap-2 border-t border-(--ui-border) pt-4">
          <UButton to="/" color="neutral" variant="ghost">
            Cancel
          </UButton>
          <UButton type="submit" :loading="busy" :disabled="fieldsState !== 'idle'">
            Create ticket
          </UButton>
        </div>
      </template>
    </form>
  </div>
</template>
