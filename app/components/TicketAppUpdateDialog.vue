<script setup lang="ts">
import { accessAbove, type ManifestKey } from '~~/shared/ticket-app-manifest'
import type { ManifestCheck, TicketApp, TicketAppAccess } from '~/types/ticket-apps'

/** Issue 40: "Check for updates". Tikki fetches the manifest again; nothing changes until the Admin applies the update. */
const props = defineProps<{ app: TicketApp | null }>()
const emit = defineEmits<{ close: [], applied: [app: TicketApp] }>()

const LABEL: Record<ManifestKey, string> = {
  'name': 'Name',
  'description': 'Description',
  'urls.sidebar': 'Sidebar URL',
  'urls.tab': 'Tab URL',
  'urls.page': 'Page URL',
  'icons.light': 'Light icon',
  'icons.dark': 'Dark icon',
  'access': 'Requested access',
}
const MONO = new Set<ManifestKey>(['urls.sidebar', 'urls.tab', 'urls.page', 'icons.light', 'icons.dark'])

const result = ref<ManifestCheck | null>(null)
const loading = ref(false)
const applying = ref(false)
const problems = ref<{ key: string, reason: string }[]>([])
const error = ref<string | null>(null)
const confirmed = ref(false)
const access = ref<TicketAppAccess>('read')

const open = computed({ get: () => props.app !== null, set: (v) => { if (!v) emit('close') } })
const warnings = computed(() => result.value?.changes.filter(c => c.warning) ?? [])
const requested = computed(() => result.value?.manifest.access ?? 'read')
const items = computed(() => accessItems(requested.value))
// A lower request lowers the granted access; the server does the same.
const lowered = computed(() => !!result.value && accessAbove(result.value.granted_access, requested.value))

async function check() {
  if (!props.app) return
  loading.value = true
  result.value = null
  problems.value = []
  error.value = null
  confirmed.value = false
  try {
    const r = await $fetch<ManifestCheck>(`/api/v1/admin/ticket-apps/${props.app.id}/manifest/check`, { method: 'POST' })
    result.value = r
    access.value = accessAbove(r.granted_access, r.manifest.access) ? r.manifest.access : r.granted_access
  } catch (e) {
    const p = apiProblem(e)
    problems.value = p.details
    if (!p.details.length) error.value = p.message
  } finally {
    loading.value = false
  }
}
watch(() => props.app?.id, id => id !== undefined && check(), { immediate: true })

async function apply() {
  if (!props.app || !result.value) return
  applying.value = true
  error.value = null
  try {
    const saved = await $fetch<TicketApp>(`/api/v1/admin/ticket-apps/${props.app.id}/manifest/apply`, {
      method: 'POST',
      body: { hash: result.value.hash, access: access.value, confirm_warnings: confirmed.value },
    })
    emit('applied', saved)
    emit('close')
  } catch (e) {
    const p = apiProblem(e)
    if (p.status === 409) {
      await check()
      error.value = 'The manifest changed again. Check the new changes, then apply.'
      return
    }
    error.value = p.details.length ? p.details.map(d => d.reason).join(' ') : p.message
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="app ? `Updates for ${app.name}` : 'Updates'" description="Tikki read the manifest again and compared it with the one you approved.">
    <template #body>
      <div v-if="loading" class="flex items-center gap-2 text-sm text-(--ui-text-muted)" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" aria-hidden="true" />
        Reading the manifest…
      </div>
      <UAlert v-else-if="problems.length" color="error" variant="subtle" icon="i-lucide-circle-alert" title="The manifest could not be read">
        <template #description>
          <ul class="flex flex-col gap-1 pl-4 list-disc [overflow-wrap:anywhere]">
            <li v-for="p in problems" :key="p.key">
              <code class="font-mono">{{ p.key }}</code>: {{ p.reason }}
            </li>
          </ul>
        </template>
      </UAlert>
      <UAlert v-else-if="error && !result" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />
      <EmptyState v-else-if="result && !result.changes.length" icon="i-lucide-circle-check" title="No changes" description="The app is the same as in the manifest you approved." />
      <form v-else-if="result" id="manifest-apply-form" class="flex flex-col gap-4" @submit.prevent="apply">
        <ul aria-label="Changes" class="flex flex-col gap-2 list-none p-0 m-0">
          <li v-for="c in result.changes" :key="c.key" class="flex flex-col gap-1 rounded-[10px] border p-3 min-w-0" :class="c.warning ? 'border-(--ui-warning)' : 'border-(--ui-border)'">
            <span class="text-sm font-medium text-(--ui-text-highlighted)">{{ LABEL[c.key] }}</span>
            <span v-if="c.before === c.after" class="text-[13px] text-(--ui-text-toned)">New image at the same address.</span>
            <template v-else>
              <span class="text-[13px] text-(--ui-text-muted) line-through [overflow-wrap:anywhere]" :class="{ 'font-mono': MONO.has(c.key) }">{{ c.before ?? 'Not set' }}</span>
              <span class="text-[13px] text-(--ui-text-highlighted) [overflow-wrap:anywhere]" :class="{ 'font-mono': MONO.has(c.key) }">{{ c.after ?? 'Not set' }}</span>
            </template>
            <span v-if="c.warning" class="flex items-start gap-1.5 text-[13px] text-(--ui-warning)">
              <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 mt-px" aria-hidden="true" />
              {{ c.warning }}
            </span>
          </li>
        </ul>
        <TicketAppManifestPreview :preview="result" />
        <UFormField label="Granted access" :help="lowered ? 'The app asks for less now, so the granted access goes down.' : 'An update never raises it by itself. Choose a higher level here if you agree.'">
          <URadioGroup v-model="access" :items="items" />
        </UFormField>
        <UCheckbox v-if="warnings.length" v-model="confirmed" label="I checked the warnings above" />
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <template v-if="result?.changes.length">
          <UButton color="neutral" variant="ghost" @click="open = false">
            Ignore
          </UButton>
          <UButton type="submit" form="manifest-apply-form" :loading="applying" :disabled="warnings.length > 0 && !confirmed">
            Apply update
          </UButton>
        </template>
        <UButton v-else-if="problems.length || error" color="neutral" variant="outline" :loading="loading" @click="check">
          Try again
        </UButton>
        <UButton v-if="!result?.changes.length" color="neutral" variant="ghost" @click="open = false">
          Close
        </UButton>
      </div>
    </template>
  </UModal>
</template>
