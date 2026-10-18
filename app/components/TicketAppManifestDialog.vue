<script setup lang="ts">
import { accessAbove } from '~~/shared/ticket-app-manifest'
import type { ManifestPreview, TicketApp, TicketAppAccess } from '~/types/ticket-apps'

/** Issue 40: "Add from manifest". The Admin pastes the manifest URL, checks the preview, and chooses what to grant. */
const props = defineProps<{ types: { id: number, name: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ added: [app: TicketApp] }>()

const url = ref('')
const preview = ref<ManifestPreview | null>(null)
const loading = ref(false)
const saving = ref(false)
const urlError = ref<string | null>(null)
// Problems inside the manifest, with the key (for example `urls.tab`).
const manifestProblems = ref<{ key: string, reason: string }[]>([])
const formError = ref<string | null>(null)
const form = reactive({ access: 'read' as TicketAppAccess, showOn: 'all' as 'all' | 'only', typeIds: [] as string[], pageForRequesters: false })
const typeItems = computed(() => props.types.map(t => ({ value: String(t.id), label: t.name })))
const items = computed(() => accessItems(preview.value?.manifest.access ?? null))
const hasPage = computed(() => !!preview.value?.manifest.urls.page)

watch(open, (value) => {
  if (!value) return
  url.value = ''
  preview.value = null
  urlError.value = null
  manifestProblems.value = []
  formError.value = null
})

/** `keep`: a reload after a 409 keeps the Admin's choices, with the access at most the new requested level. */
async function load(keep = false) {
  loading.value = true
  urlError.value = null
  manifestProblems.value = []
  formError.value = null
  try {
    const p = await $fetch<ManifestPreview>('/api/v1/admin/ticket-apps/manifest/preview', { method: 'POST', body: { manifest_url: url.value } })
    preview.value = p
    if (keep) form.access = accessAbove(form.access, p.manifest.access) ? p.manifest.access : form.access
    else Object.assign(form, { access: p.manifest.access, showOn: 'all', typeIds: [], pageForRequesters: false })
  } catch (e) {
    const problem = apiProblem(e)
    urlError.value = problem.details.find(d => d.key === 'manifest_url')?.reason ?? null
    manifestProblems.value = problem.details.filter(d => d.key !== 'manifest_url')
    if (!problem.details.length) formError.value = problem.message
  } finally {
    loading.value = false
  }
}

async function add() {
  if (!preview.value) return
  saving.value = true
  formError.value = null
  try {
    const app = await $fetch<TicketApp>('/api/v1/admin/ticket-apps/manifest', {
      method: 'POST',
      body: {
        manifest_url: preview.value.manifest_url,
        hash: preview.value.hash,
        access: form.access,
        ticket_type_ids: form.showOn === 'all' ? null : form.typeIds.map(Number),
        page_for_requesters: hasPage.value && form.pageForRequesters,
      },
    })
    emit('added', app)
    open.value = false
  } catch (e) {
    const problem = apiProblem(e)
    if (problem.status === 409) {
      // The app changed its manifest: show the new one, and let the Admin approve again.
      await load(true)
      formError.value = 'The manifest changed after the preview. Check the new preview, then add the app.'
      return
    }
    formError.value = problem.details.length ? problem.details.map(d => d.reason).join(' ') : problem.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Add from manifest" description="An app can describe itself in a JSON file. Tikki reads it, and you choose what to grant.">
    <template #body>
      <form v-if="!preview" id="manifest-url-form" class="flex flex-col gap-4" @submit.prevent="load()">
        <UFormField label="Manifest URL" :error="urlError ?? undefined" help="For example https://time.example.com/tikki-app.json. Tikki fetches it and the icons on its server." required>
          <UInput v-model="url" type="url" placeholder="https://time.example.com/tikki-app.json" class="w-full font-mono" autofocus />
        </UFormField>
        <UAlert v-if="manifestProblems.length" color="error" variant="subtle" icon="i-lucide-circle-alert" title="The manifest has problems">
          <template #description>
            <ul class="flex flex-col gap-1 pl-4 list-disc [overflow-wrap:anywhere]">
              <li v-for="p in manifestProblems" :key="p.key">
                <code class="font-mono">{{ p.key }}</code>: {{ p.reason }}
              </li>
            </ul>
          </template>
        </UAlert>
        <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="formError" />
      </form>

      <form v-else-if="preview" id="manifest-add-form" class="flex flex-col gap-4" @submit.prevent="add">
        <TicketAppManifestPreview :preview="preview" />
        <UFormField label="Access" help="What the app's backend can do with the token. The requested level or lower.">
          <URadioGroup v-model="form.access" :items="items" />
        </UFormField>
        <UFormField label="Show on">
          <URadioGroup v-model="form.showOn" :items="[{ value: 'all', label: 'All Ticket Types', description: 'Also types that are added later.' }, { value: 'only', label: 'Only these types' }]" />
          <UCheckboxGroup v-if="form.showOn === 'only'" v-model="form.typeIds" :items="typeItems" class="mt-3 ml-6" />
        </UFormField>
        <USwitch v-model="form.pageForRequesters" :disabled="!hasPage" label="Show the page to Requesters" :description="hasPage ? 'Requesters see the page in their Apps menu. The sidebar card and the tab stay for Agents and Admins.' : 'The app has no page.'" />
        <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="formError" />
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton v-if="preview" color="neutral" variant="ghost" class="mr-auto" @click="preview = null">
          Back
        </UButton>
        <UButton color="neutral" variant="ghost" @click="open = false">
          Cancel
        </UButton>
        <UButton v-if="!preview" type="submit" form="manifest-url-form" :loading="loading" :disabled="!url.trim()">
          Load preview
        </UButton>
        <UButton v-else type="submit" form="manifest-add-form" :loading="saving || loading" :disabled="form.showOn === 'only' && !form.typeIds.length">
          Add app
        </UButton>
      </div>
    </template>
  </UModal>
</template>
