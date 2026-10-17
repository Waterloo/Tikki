<script setup lang="ts">
import type { AdminType, AdminTypeDetail, AdminTypeList, DraftField, FieldDef, Problem } from '~/types/ticket-types'

definePageMeta({ roles: ['admin'] })

const route = useRoute()
const toast = useToast()
const id = computed(() => String(route.params.id))

const type = ref<AdminTypeDetail | null>(null)
const others = ref<AdminType[]>([])
const teams = ref<AdminTypeList['teams']>([])
const state = ref<'loading' | 'ready' | 'error' | 'missing'>('loading')

// Edited copies. `fields` holds the Fields of the version being edited, plus the ones the Admin added.
const name = ref('')
const description = ref('')
const prefix = ref('')
const icon = ref('')
const color = ref('')
const teamId = ref<number | undefined>()
const visibleToAll = ref(false)
const fields = ref<DraftField[]>([])
const editingKey = ref<string | null>(null)
const adding = ref(false)

const busy = ref(false)
const serverProblems = ref<Problem[]>([])
const failure = ref<{ message: string, stale: boolean } | null>(null)

const usedColors = computed(() => others.value.filter(t => t.id !== type.value?.id).map(t => t.color.toUpperCase()))
const activeFields = computed(() => fields.value.filter(f => !f.archived))
const archivedFields = computed(() => fields.value.filter(f => f.archived))
const problems = computed(() => problemMap(serverProblems.value))
const fieldProblem = (key: string) => problems.value[`fields.${fields.value.findIndex(f => f.key === key)}.label`]?.reason

const prefixError = computed(() => (prefix.value && prefix.value !== type.value?.prefix ? prefixProblem(prefix.value, others.value, type.value?.id) : prefix.value.length < 2 ? { key: 'prefix', reason: 'Use 2 to 5 letters.' } : null) ?? problems.value.prefix ?? null)
const nameError = computed(() => (name.value.trim() ? nameProblem(name.value, others.value, type.value?.id) : { key: 'name', reason: 'Name is required.' }) ?? problems.value.name ?? null)

/** The Fields as the API takes them. */
function plain(list: readonly DraftField[]): FieldDef[] {
  return list.map(({ isNew: _, ...f }) => ({ ...f, ...(f.options ? { options: f.options.map(o => ({ ...o })) } : {}) }))
}

const fieldsDirty = computed(() => type.value ? JSON.stringify(plain(fields.value)) !== JSON.stringify(plain(type.value.fields)) : false)
const settingsDirty = computed(() => {
  const t = type.value
  return !!t && (name.value.trim() !== t.name || description.value.trim() !== t.description || prefix.value !== t.prefix || icon.value !== t.icon
    || color.value.toUpperCase() !== t.color.toUpperCase() || teamId.value !== t.team.id || visibleToAll.value !== t.visible_to_all)
})
const dirty = computed(() => fieldsDirty.value || settingsDirty.value)
const invalid = computed(() => !!nameError.value || !!prefixError.value || description.value.trim() === '')
const nextVersion = computed(() => (type.value?.schema_version ?? 0) + 1)

function reset(t: AdminTypeDetail) {
  type.value = t
  name.value = t.name
  description.value = t.description
  prefix.value = t.prefix
  icon.value = t.icon
  color.value = t.color
  teamId.value = t.team.id
  visibleToAll.value = t.visible_to_all
  fields.value = t.fields.map(f => ({ ...f, ...(f.options ? { options: f.options.map(o => ({ ...o })) } : {}) }))
  editingKey.value = null
  adding.value = false
  serverProblems.value = []
  failure.value = null
}

async function load() {
  state.value = 'loading'
  try {
    const [detail, list] = await Promise.all([
      $fetch<AdminTypeDetail>(`/api/v1/admin/ticket-types/${id.value}`),
      $fetch<AdminTypeList>('/api/v1/admin/ticket-types'),
    ])
    reset(detail)
    others.value = list.data
    teams.value = list.teams
    state.value = 'ready'
  } catch (e) {
    const status = apiFailure(e).status
    if (status === 401) return navigateTo('/sign-in')
    state.value = status === 404 ? 'missing' : 'error'
  }
}

function addField(field: FieldDef) {
  fields.value.push({ ...field, isNew: true })
  adding.value = false
}

function archiveField(f: DraftField) {
  if (f.isNew) fields.value = fields.value.filter(x => x !== f)
  else f.archived = true
  if (editingKey.value === f.key) editingKey.value = null
}

async function save() {
  if (!type.value) return
  busy.value = true
  serverProblems.value = []
  failure.value = null
  const body: Record<string, unknown> = {}
  if (settingsDirty.value) Object.assign(body, { name: name.value, description: description.value, prefix: prefix.value, icon: icon.value, color: color.value, team_id: teamId.value, visible_to_all: visibleToAll.value })
  if (fieldsDirty.value) Object.assign(body, { base_version: type.value.schema_version, fields: plain(fields.value) })
  try {
    const before = type.value.schema_version
    const saved = await $fetch<AdminTypeDetail>(`/api/v1/ticket-types/${type.value.id}`, { method: 'PATCH', body })
    reset(saved)
    others.value = (await $fetch<AdminTypeList>('/api/v1/admin/ticket-types')).data
    toast.add({
      title: saved.schema_version > before ? `Saved as version ${saved.schema_version}` : 'Changes saved',
      description: saved.schema_version > before ? 'New tickets use it. Old tickets keep their version.' : undefined,
      color: 'success',
    })
  } catch (e) {
    const f = apiFailure(e)
    serverProblems.value = f.problems
    failure.value = { message: f.problems.length ? f.problems.map(p => p.reason).join(' ') : f.message, stale: f.status === 409 }
  } finally {
    busy.value = false
  }
}

async function setArchived(archived: boolean) {
  if (!type.value) return
  busy.value = true
  const target = type.value
  try {
    await $fetch(`/api/v1/ticket-types/${target.id}`, { method: 'PATCH', body: { archived } })
    if (archived) {
      toast.add({
        title: `${target.name} is archived`,
        description: 'Nobody can create new tickets of this type. Old tickets keep it.',
        actions: [{ label: 'Undo', color: 'neutral', variant: 'outline', onClick: () => { $fetch(`/api/v1/ticket-types/${target.id}`, { method: 'PATCH', body: { archived: false } }).then(load).catch(() => {}) } }],
      })
    } else {
      toast.add({ title: `${target.name} is restored`, color: 'success' })
    }
    await load()
  } catch (e) {
    toast.add({ title: archived ? 'The type was not archived' : 'The type was not restored', description: apiFailure(e).message, color: 'error' })
  } finally {
    busy.value = false
  }
}

onBeforeRouteLeave(() => !dirty.value || busy.value || window.confirm('Leave this page? Your changes are not saved.'))

onMounted(load)
watch(id, load)
</script>

<template>
  <AppPage id="admin-types-edit" :title="type?.name ?? 'Ticket type'">
    <PageHeader
      :title="type?.name ?? 'Ticket type'"
      :subtitle="type?.description"
      :breadcrumb="[{ label: 'Admin' }, { label: 'Types and fields', to: '/admin/types' }, { label: type?.name ?? 'Ticket type' }]"
    >
      <template v-if="type" #eyebrow>
        <TypeTile :icon="icon" :color="color" size="lg" />
      </template>
      <template v-if="type" #actions>
        <span class="text-[13px] text-(--ui-text-toned) px-2.5 py-1 rounded-full bg-(--ui-bg) border border-(--ui-border)">Current: version {{ type.schema_version }}</span>
        <span v-if="dirty" class="text-[13px] text-[#7a3400] dark:text-[#f4b77a] px-2.5 py-1 rounded-full bg-[#ffefdd] dark:bg-[#2e1d0d] border border-[#f6cf9f] dark:border-[#5a3a14]">Unsaved changes</span>
        <UButton v-if="!type.archived_at" color="neutral" variant="outline" icon="i-lucide-archive" :loading="busy" :disabled="dirty" @click="setArchived(true)">
          Archive type
        </UButton>
      </template>
    </PageHeader>

    <ListSkeleton v-if="state === 'loading'" :rows="5" />
    <ErrorState v-else-if="state === 'error'" title="This ticket type could not be loaded." description="Check your connection, then try again." @retry="load" />
    <EmptyState v-else-if="state === 'missing'" title="This ticket type does not exist" description="It may have a different address now. Go back to the list." icon="i-lucide-search-x">
      <UButton to="/admin/types" variant="outline">
        All ticket types
      </UButton>
    </EmptyState>

    <template v-else-if="type">
      <UAlert
        v-if="type.archived_at"
        color="warning"
        variant="subtle"
        icon="i-lucide-archive"
        title="This type is archived"
        :description="`Nobody can create new tickets of it. Its ${type.ticket_count} old ${type.ticket_count === 1 ? 'ticket keeps' : 'tickets keep'} it, and its prefix ${type.prefix} stays reserved.`"
        :actions="[{ label: 'Restore', color: 'neutral', variant: 'outline', onClick: () => setArchived(false) }]"
      />

      <section aria-label="Type details" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-4 flex flex-col gap-4">
        <div class="grid gap-4 grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
          <UFormField label="Name" required>
            <UInput v-model="name" class="w-full" :color="nameError ? 'error' : undefined" />
            <p v-if="nameError" role="alert" class="mt-1.5 text-[13px] text-(--ui-error)">
              {{ nameError.reason }}
              <NuxtLink v-if="nameError.restore_type_id" to="/admin/types#archived" class="underline font-medium">
                Restore it from the list
              </NuxtLink>
            </p>
          </UFormField>
          <UFormField label="When to use it" required description="Requesters see this. Claude reads it to choose the type.">
            <UTextarea v-model="description" :rows="2" :maxlength="300" class="w-full" />
          </UFormField>
        </div>
        <TypeAppearance v-model:icon="icon" v-model:color="color" only="icon" class="!flex flex-col" />
      </section>

      <section aria-label="Type settings" class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        <div class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-4 flex flex-col gap-2">
          <label for="prefix" class="text-[13px] text-(--ui-text-muted)">Number prefix</label>
          <UInput
            id="prefix"
            :model-value="prefix"
            maxlength="5"
            class="[&_input]:font-mono [&_input]:tracking-[0.04em]"
            :color="prefixError ? 'error' : undefined"
            @update:model-value="prefix = ($event ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)"
          />
          <span class="text-xs leading-snug" :class="prefixError ? 'text-(--ui-error)' : 'text-(--ui-text-muted)'" :role="prefixError ? 'alert' : undefined">
            {{ prefixError?.reason ?? `Tickets look like ${prefix}-1048. If you change it, old numbers keep working.` }}
          </span>
        </div>
        <div class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-4 flex flex-col gap-2">
          <label for="team" class="text-[13px] text-(--ui-text-muted)">Owning team</label>
          <USelect id="team" v-model="teamId" :items="teams.map(t => ({ value: t.id, label: t.name }))" class="w-full" />
        </div>
        <div class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-4 flex flex-col gap-2">
          <TypeAppearance v-model:icon="icon" v-model:color="color" only="color" :used-colors="usedColors" class="!flex flex-col gap-2" />
        </div>
        <div class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-4 flex items-center justify-between gap-3">
          <label for="vis" class="flex flex-col gap-1 cursor-pointer">
            <span class="text-sm font-medium text-(--ui-text-highlighted)">Visible to all internal users</span>
            <span class="text-[13px] text-(--ui-text-muted)">Off: requesters see only their own tickets.</span>
          </label>
          <USwitch id="vis" v-model="visibleToAll" />
        </div>
      </section>

      <section aria-labelledby="fields-h" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-2">
        <div class="flex flex-wrap items-center justify-between gap-3 px-3 pt-2.5 pb-3">
          <h2 id="fields-h" class="text-[15px] font-semibold text-(--ui-text-highlighted)">
            Fields
          </h2>
          <UButton v-if="!adding" variant="outline" icon="i-lucide-plus" @click="adding = true">
            Add field
          </UButton>
        </div>

        <div class="px-3 pb-3">
          <TypeFieldForm v-if="adding" :taken-keys="fields.map(f => f.key)" lock-note="when you save" @add="addField" @cancel="adding = false" />
        </div>

        <p v-if="activeFields.length === 0" class="mx-3 mb-3 p-4 rounded-[10px] bg-(--app-sidebar) text-sm text-(--ui-text-toned)">
          No fields. New tickets ask only for a title, a description and a priority.
        </p>
        <div v-else class="overflow-x-auto">
          <div class="min-w-[760px]">
            <div class="grid grid-cols-[minmax(200px,1.4fr)_minmax(200px,1.2fr)_150px_100px_96px] items-center gap-3.5 px-3 min-h-[38px] text-[13px] text-(--ui-text-muted)">
              <span>Label</span><span>Key</span><span>Data type</span><span>Required</span><span />
            </div>
            <template v-for="f in activeFields" :key="f.key">
              <div
                class="grid grid-cols-[minmax(200px,1.4fr)_minmax(200px,1.2fr)_150px_100px_96px] items-center gap-3.5 px-3 min-h-[52px] border-t border-(--ui-border-muted) rounded-lg text-sm"
                :class="f.isNew ? 'bg-[#f5fbf7] dark:bg-[#12201a]' : ''"
              >
                <span class="flex items-center gap-2 min-w-0">
                  <span class="font-medium text-(--ui-text-highlighted) truncate">{{ f.label }}</span>
                  <span v-if="f.isNew" class="text-xs font-medium px-2 py-px rounded-full bg-[#e7f5ec] text-[#1b6136] dark:bg-[#12291b] dark:text-[#86d19f]">New</span>
                </span>
                <span class="flex items-center gap-1.5 font-mono text-[13px] text-(--ui-text-toned) min-w-0">
                  <UIcon name="i-lucide-lock" class="size-3.5 shrink-0 text-(--ui-text-muted)" aria-label="Locked" />
                  <span class="truncate">{{ f.key }}</span>
                </span>
                <span class="text-(--ui-text)">{{ fieldTypeLabel(f.type) }}</span>
                <span class="text-(--ui-text)">{{ f.required ? 'Yes' : 'No' }}</span>
                <span class="flex justify-end gap-1">
                  <UButton icon="i-lucide-pencil" variant="ghost" color="neutral" :aria-label="`Edit ${f.label}`" :aria-expanded="editingKey === f.key" @click="editingKey = editingKey === f.key ? null : f.key" />
                  <UButton icon="i-lucide-archive" variant="ghost" color="neutral" :aria-label="`Archive ${f.label}`" @click="archiveField(f)" />
                </span>
              </div>
              <div v-if="editingKey === f.key" class="px-3 pb-3">
                <TypeFieldEdit v-model="fields[fields.indexOf(f)]!" :error="fieldProblem(f.key)" @done="editingKey = null" />
              </div>
            </template>
          </div>
        </div>

        <div v-if="archivedFields.length" class="mx-1 mt-3 mb-1 px-3.5 py-3 rounded-[10px] bg-(--app-sidebar) flex flex-col gap-2">
          <span class="text-[13px] font-medium text-(--ui-text-toned)">Archived fields</span>
          <div v-for="f in archivedFields" :key="f.key" class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-(--ui-text-toned)">
            <span class="font-medium">{{ f.label }}</span>
            <span class="font-mono text-[13px]">{{ f.key }}</span>
            <span class="text-[13px] text-(--ui-text-muted)">Archived. New tickets do not ask for it. Old tickets still show their values.</span>
            <UButton class="ml-auto" size="sm" variant="outline" :aria-label="`Restore ${f.label}`" @click="f.archived = false">
              Restore
            </UButton>
          </div>
        </div>
      </section>

      <UAlert v-if="failure" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="failure.message" :actions="failure.stale ? [{ label: 'Reload', color: 'error', variant: 'solid', size: 'xs', onClick: load }] : undefined" />

      <div class="flex flex-wrap items-center justify-between gap-4 px-[18px] py-4 rounded-[14px] border border-(--ui-border) bg-(--ui-bg)">
        <div class="flex items-start gap-2.5 max-w-[640px]">
          <UIcon name="i-lucide-info" class="size-[18px] mt-0.5 shrink-0 text-(--ui-text-muted)" aria-hidden="true" />
          <p v-if="fieldsDirty" class="text-sm leading-normal text-(--ui-text)">
            Saving creates <strong class="font-semibold">version {{ nextVersion }}</strong>. New tickets use it. The {{ type.ticket_count }} existing {{ type.ticket_count === 1 ? 'ticket keeps' : 'tickets keep' }} their version and their values. A key and its data type never change, so filters and webhooks keep working.
          </p>
          <p v-else class="text-sm leading-normal text-(--ui-text)">
            A change to the fields saves as <strong class="font-semibold">version {{ nextVersion }}</strong>. Old tickets keep their version and their values. A change to the name, prefix, team or color makes no new version.
          </p>
        </div>
        <div class="flex gap-2">
          <UButton size="lg" variant="outline" :disabled="!dirty || busy" @click="reset(type)">
            Discard changes
          </UButton>
          <UButton size="lg" :loading="busy" :disabled="!dirty || invalid" @click="save">
            {{ fieldsDirty ? `Save as version ${nextVersion}` : 'Save changes' }}
          </UButton>
        </div>
      </div>

      <TypePreview :name="name" :description="description" :icon="icon" :color="color" :prefix="prefix" :fields="activeFields" class="lg:max-w-[420px]" />
    </template>
  </AppPage>
</template>
