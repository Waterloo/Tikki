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
  <AppPage id="new-ticket" title="New ticket">
    <div class="w-full max-w-[760px] flex flex-col gap-6">
      <PageHeader
        title="New ticket"
        subtitle="Choose what kind of help you need. The form asks only for what the team needs."
        :breadcrumb="[{ label: 'Tickets', to: '/' }, { label: 'New ticket' }]"
      />

      <div v-if="state === 'loading'" class="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]" aria-busy="true" aria-label="Loading ticket types">
        <USkeleton v-for="n in 4" :key="n" class="h-28 rounded-xl" />
      </div>
      <ErrorState v-else-if="state === 'error'" title="The ticket types could not be loaded." description="Check your connection, then try again." @retry="loadTypes" />

      <form v-else class="flex flex-col gap-6" novalidate @submit.prevent="submit">
        <fieldset class="flex flex-col gap-2.5">
          <legend class="text-sm font-medium text-(--ui-text-highlighted) mb-2.5">
            What is this about?
          </legend>
          <div class="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
            <button
              v-for="t in types"
              :key="t.id"
              type="button"
              :aria-pressed="selectedId === t.id"
              class="flex flex-col items-start gap-2.5 min-h-28 rounded-xl bg-(--ui-bg) text-left transition-colors hover:bg-(--app-row-hover)"
              :class="selectedId === t.id ? 'border-2 p-[13px]' : 'border border-(--ui-border) p-3.5'"
              :style="selectedId === t.id ? { borderColor: t.color } : {}"
              @click="pick(t.id)"
            >
              <span class="flex size-[30px] items-center justify-center rounded-lg" :style="{ color: t.color, backgroundColor: `color-mix(in srgb, ${t.color} 13%, transparent)` }" aria-hidden="true">
                <UIcon :name="t.icon" class="size-[17px]" />
              </span>
              <span class="flex flex-col gap-1">
                <span class="text-sm font-semibold text-(--ui-text-highlighted)">{{ t.name }}</span>
                <span class="text-[13px] leading-snug text-(--ui-text-muted)">{{ t.description }}</span>
              </span>
            </button>
          </div>
        </fieldset>

        <template v-if="selectedId !== null">
          <div class="flex flex-col gap-5 rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-4 sm:p-[22px]">
            <UFormField label="Title" name="title" required :error="problems.title">
              <UInput v-model="title" placeholder="One line that says what is wrong or what you need" class="w-full" @update:model-value="delete problems.title" />
            </UFormField>

            <UFormField label="Description" name="description" :error="problems.description">
              <UTextarea v-model="description" :rows="4" placeholder="What happened? What did you expect?" class="w-full" @update:model-value="delete problems.description" />
            </UFormField>

            <div v-if="fieldsState === 'loading'" class="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading fields">
              <USkeleton v-for="n in 2" :key="n" class="h-16" />
            </div>
            <ErrorState v-else-if="fieldsState === 'error'" title="The fields of this type could not be loaded." @retry="reloadFields" />
            <div v-else-if="fields.length" class="grid gap-4 sm:grid-cols-2">
              <UFormField
                v-for="f in fields"
                :key="f.key"
                :label="f.label"
                :name="f.key"
                :description="f.help"
                :required="f.required"
                :error="problems[f.key]"
                :class="f.type === 'long_text' || f.type === 'multi_select' ? 'sm:col-span-2' : ''"
              >
                <FieldInput v-model="values[f.key]" :field="f" @update:model-value="delete problems[f.key]" />
              </UFormField>
            </div>

            <fieldset class="flex flex-col gap-2">
              <legend class="text-sm font-medium text-(--ui-text-highlighted) mb-2">
                Priority
              </legend>
              <div class="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-(--app-segment) self-start">
                <button
                  v-for="p in PRIORITIES"
                  :key="p.value"
                  type="button"
                  :aria-pressed="priority === p.value"
                  class="min-h-9 px-4 rounded-[9px] border text-sm font-medium transition-colors"
                  :class="priority !== p.value
                    ? 'border-transparent text-(--ui-text-toned) hover:text-(--ui-text-highlighted)'
                    : p.value === 'urgent'
                      ? 'border-[#b42318] bg-[#b42318] text-white'
                      : 'border-(--ui-border-accented) bg-(--ui-bg) text-(--ui-text-highlighted) shadow-xs'"
                  @click="priority = p.value; delete problems.priority"
                >
                  {{ p.label }}
                </button>
              </div>
              <p v-if="problems.priority" class="text-sm text-(--ui-error)">
                {{ problems.priority }}
              </p>
            </fieldset>

            <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="formError" />
          </div>

          <div class="flex flex-wrap justify-end gap-2.5">
            <UButton to="/" size="lg" variant="ghost">
              Cancel
            </UButton>
            <UButton type="submit" size="lg" :loading="busy" :disabled="fieldsState !== 'idle'">
              Create ticket
            </UButton>
          </div>
        </template>
      </form>
    </div>
  </AppPage>
</template>
