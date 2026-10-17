<script setup lang="ts">
import { firstUnusedColor, keyFromLabel, suggestIcon, suggestPrefix } from '~~/shared/ticket-type-rules'
import type { AdminType, AdminTypeDetail, AdminTypeList, DraftField, Problem } from '~/types/ticket-types'

definePageMeta({ roles: ['admin'] })

const toast = useToast()
const types = ref<AdminType[]>([])
const teams = ref<AdminTypeList['teams']>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')

const name = ref('')
const description = ref('')
// Null means "use the suggestion", until the Admin picks one.
const prefixInput = ref<string | null>(null)
const iconInput = ref<string | null>(null)
const colorInput = ref<string | null>(null)
const teamId = ref<number | undefined>()
const visibleToAll = ref(false)
const fields = ref<DraftField[]>([])
const adding = ref(false)

const busy = ref(false)
const serverProblems = ref<Record<string, Problem>>({})
const formError = ref<string | null>(null)

const usedColors = computed(() => types.value.map(t => t.color.toUpperCase()))
const prefix = computed(() => prefixInput.value ?? suggestPrefix(name.value))
const icon = computed(() => iconInput.value ?? suggestIcon(name.value))
const color = computed(() => colorInput.value ?? firstUnusedColor(usedColors.value))

const iconModel = computed({ get: () => icon.value, set: (v: string) => { iconInput.value = v } })
const colorModel = computed({ get: () => color.value, set: (v: string) => { colorInput.value = v } })

const nameError = computed(() => nameProblem(name.value, types.value) ?? serverProblems.value.name ?? null)
const prefixError = computed(() => (prefix.value ? prefixProblem(prefix.value, types.value) : null) ?? serverProblems.value.prefix ?? null)
const canCreate = computed(() => name.value.trim() !== '' && description.value.trim() !== '' && !nameError.value && !prefixError.value && teamId.value !== undefined && !busy.value)

function onPrefix(value: string | undefined) {
  prefixInput.value = (value ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)
  delete serverProblems.value.prefix
}

async function load() {
  state.value = 'loading'
  try {
    const list = await $fetch<AdminTypeList>('/api/v1/admin/ticket-types')
    types.value = list.data
    teams.value = list.teams
    teamId.value ??= list.teams[0]?.id
    state.value = 'ready'
  } catch (e) {
    if (apiFailure(e).status === 401) return navigateTo('/sign-in')
    state.value = 'error'
  }
}

function addQuick(quick: typeof QUICK_FIELDS[number]) {
  fields.value.push({
    key: keyFromLabel(quick.label),
    label: quick.label,
    type: quick.type,
    required: false,
    help: quick.help,
    ...(quick.options ? { options: quick.options.map(value => ({ value })) } : {}),
  })
}

const quickLeft = computed(() => QUICK_FIELDS.filter(q => !fields.value.some(f => f.key === keyFromLabel(q.label))))

async function create() {
  busy.value = true
  serverProblems.value = {}
  formError.value = null
  try {
    const created = await $fetch<AdminTypeDetail>('/api/v1/ticket-types', {
      method: 'POST',
      body: {
        name: name.value,
        description: description.value,
        prefix: prefix.value,
        icon: icon.value,
        color: color.value,
        team_id: teamId.value,
        visible_to_all: visibleToAll.value,
        fields: fields.value.map(({ isNew: _, ...f }) => f),
      },
    })
    toast.add({ title: `${created.name} is created`, description: 'Version 1 is live. People can create tickets of this type now.', color: 'success' })
    await navigateTo(`/admin/types/${created.id}`)
  } catch (e) {
    const failure = apiFailure(e)
    if (failure.problems.length) {
      serverProblems.value = problemMap(failure.problems)
      const shown = new Set(['name', 'prefix'])
      formError.value = failure.problems.filter(p => !shown.has(p.key)).map(p => p.reason).join(' ') || null
    } else {
      formError.value = failure.message
    }
  } finally {
    busy.value = false
  }
}

const dirty = computed(() => name.value !== '' || description.value !== '' || fields.value.length > 0)
onBeforeRouteLeave(() => !dirty.value || busy.value || window.confirm('Leave this page? Nothing is saved yet.'))

onMounted(load)
</script>

<template>
  <AppPage id="admin-types-new" title="New ticket type">
    <PageHeader
      title="New ticket type"
      subtitle="Nothing is saved until you create the type. You can change everything except field keys later. If you change the prefix later, old ticket numbers keep working."
      :breadcrumb="[{ label: 'Admin' }, { label: 'Types and fields', to: '/admin/types' }, { label: 'New ticket type' }]"
    />

    <ListSkeleton v-if="state === 'loading'" :rows="3" />
    <ErrorState v-else-if="state === 'error'" title="The form could not be loaded." description="Check your connection, then try again." @retry="load" />

    <div v-else class="flex flex-wrap items-start gap-6">
      <form class="flex-[999_1_520px] min-w-0 flex flex-col gap-4" novalidate @submit.prevent="canCreate && create()">
        <section aria-labelledby="basics-h" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-4 sm:p-[22px] flex flex-col gap-[18px]">
          <h2 id="basics-h" class="text-base font-semibold text-(--ui-text-highlighted)">
            Basics
          </h2>

          <UFormField label="Name" name="name" required>
            <UInput v-model="name" placeholder="For example: Access request" class="w-full" :color="nameError ? 'error' : undefined" :aria-invalid="!!nameError" @update:model-value="delete serverProblems.name" />
            <p v-if="nameError" role="alert" class="mt-1.5 text-[13px] text-(--ui-error)">
              {{ nameError.reason }}
              <NuxtLink v-if="nameError.restore_type_id" to="/admin/types#archived" class="underline font-medium">
                Restore it from the list
              </NuxtLink>
            </p>
          </UFormField>

          <div class="flex flex-wrap items-end gap-x-4">
            <UFormField label="Number prefix" name="prefix">
              <UInput
                :model-value="prefix"
                maxlength="5"
                class="w-[140px] [&_input]:font-mono [&_input]:tracking-[0.04em]"
                :color="prefixError ? 'error' : undefined"
                :aria-invalid="!!prefixError"
                aria-describedby="prefix-note"
                @update:model-value="onPrefix"
              />
            </UFormField>
            <p id="prefix-note" class="pb-3 text-[13px] leading-normal" :class="prefixError ? 'text-(--ui-error)' : 'text-(--ui-text-muted)'" :role="prefixError ? 'alert' : undefined">
              {{ prefixError?.reason ?? `${prefixInput === null ? 'Suggested from the name. ' : ''}Tickets look like ${prefix || '··'}-1049. The counter is shared by all types.` }}
            </p>
          </div>

          <UFormField label="When to use it" name="description" required description="Requesters see this on the form. Claude reads it to choose the correct type, so say when to use it.">
            <UTextarea v-model="description" :rows="2" placeholder="One sentence. For example: You need access to a system or a tool." class="w-full" :maxlength="300" @update:model-value="delete serverProblems.description" />
          </UFormField>

          <div class="grid gap-[18px] grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            <TypeAppearance v-model:icon="iconModel" v-model:color="colorModel" :used-colors="usedColors" :icon-suggested="iconInput === null" :color-suggested="colorInput === null" />
          </div>

          <div class="grid gap-[18px] grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start">
            <UFormField label="Owning team" name="team">
              <USelect v-model="teamId" :items="teams.map(t => ({ value: t.id, label: t.name }))" class="w-full" />
            </UFormField>
            <div class="flex items-center justify-between gap-3 min-h-11 sm:mt-[26px]">
              <label for="t-vis" class="flex flex-col gap-0.5 cursor-pointer">
                <span class="text-sm font-medium text-(--ui-text-highlighted)">Visible to all internal users</span>
                <span class="text-[13px] text-(--ui-text-muted)">{{ visibleToAll ? 'Every internal user can see these tickets.' : 'Requesters see only their own tickets.' }}</span>
              </label>
              <USwitch id="t-vis" v-model="visibleToAll" />
            </div>
          </div>
        </section>

        <section aria-labelledby="fields-h" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-4 sm:p-[22px] flex flex-col gap-3.5">
          <div class="flex flex-col gap-1">
            <h2 id="fields-h" class="text-base font-semibold text-(--ui-text-highlighted)">
              Fields
            </h2>
            <span class="text-[13px] text-(--ui-text-muted)">Title, description, priority and attachments are on every ticket. Add only what is special to this type.</span>
          </div>

          <p v-if="fields.length === 0 && !adding" class="p-4 rounded-[10px] bg-(--app-sidebar) text-sm text-(--ui-text-toned)">
            No fields yet. A type with no fields is fine for simple requests.
          </p>

          <ul v-if="fields.length" class="flex flex-col gap-3.5">
            <li v-for="(f, i) in fields" :key="f.key" class="flex items-start gap-3 px-3.5 py-3 rounded-[10px] border border-(--ui-border)">
              <div class="grow min-w-0 flex flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium text-(--ui-text-highlighted) [overflow-wrap:anywhere]">{{ f.label }}</span>
                  <span class="font-mono text-xs text-(--ui-text-toned) px-[7px] py-px rounded-md bg-(--ui-bg-accented)">{{ f.key }}</span>
                  <span class="text-[13px] text-(--ui-text-toned)">{{ fieldTypeLabel(f.type) }}</span>
                  <span v-if="f.required" class="text-xs font-medium px-2 py-px rounded-full bg-[#ffefdd] text-[#7a3400] dark:bg-[#2e1d0d] dark:text-[#f4b77a]">Required</span>
                </div>
                <span class="text-[13px] text-(--ui-text-muted) [overflow-wrap:anywhere]">{{ f.help || 'No help text.' }}</span>
              </div>
              <UButton icon="i-lucide-x" variant="ghost" color="neutral" :aria-label="`Remove ${f.label}`" @click="fields.splice(i, 1)" />
            </li>
          </ul>

          <TypeFieldForm v-if="adding" :taken-keys="fields.map(f => f.key)" lock-note="when you create the type" @add="fields.push($event); adding = false" @cancel="adding = false" />
          <div v-else class="flex flex-wrap items-center gap-2">
            <UButton type="button" variant="outline" icon="i-lucide-plus" size="lg" @click="adding = true">
              Add field
            </UButton>
            <button
              v-for="q in quickLeft"
              :key="q.label"
              type="button"
              class="min-h-[34px] px-3 rounded-full border border-dashed border-(--ui-border-accented) bg-(--ui-bg) text-[13px] text-(--ui-text-toned) hover:bg-(--app-row-hover)"
              @click="addQuick(q)"
            >
              + {{ q.label }}
            </button>
          </div>
        </section>

        <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="formError" />

        <div class="flex flex-wrap items-center justify-between gap-4 px-[18px] py-4 rounded-[14px] border border-(--ui-border) bg-(--ui-bg)">
          <p class="max-w-[520px] text-sm leading-normal text-(--ui-text)">
            Creating makes <strong class="font-semibold">version 1</strong>. Requesters, Claude and allowed apps can use the type at once. Field keys lock at this point.
          </p>
          <div class="flex gap-2">
            <UButton to="/admin/types" size="lg" variant="outline">
              Cancel
            </UButton>
            <UButton type="submit" size="lg" :loading="busy" :disabled="!canCreate">
              Create ticket type
            </UButton>
          </div>
        </div>
      </form>

      <div class="flex-[1_1_320px] min-w-0">
        <TypePreview :name="name" :description="description" :icon="icon" :color="color" :prefix="prefix" :fields="fields" />
      </div>
    </div>
  </AppPage>
</template>
