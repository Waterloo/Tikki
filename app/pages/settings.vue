<script setup lang="ts">
interface Deployment {
  address: string
  connector_url: string
  environment: string
  sign_in: { methods: string[], allowed_domains: string[] }
  mail: { transport: string, from: string | null, last_error: { message: string, at: string } | null }
}

definePageMeta({
  // The server refuses everyone but Admins anyway. This only spares others an error page.
  middleware: async () => {
    const { data } = await authClient.getSession()
    if ((data?.user as { role?: string } | undefined)?.role !== 'admin') return navigateTo('/')
  },
})

const LOGO_MAX_BYTES = 1024 * 1024
const toast = useToast()
const org = useOrganization()

const name = ref(org.value.name)
const subtitle = ref(org.value.subtitle)
const saving = ref(false)
const problems = ref<Record<string, string>>({})
const formError = ref<string | null>(null)

const logoInput = ref<HTMLInputElement | null>(null)
const logoBusy = ref(false)
const logoError = ref<string | null>(null)

const deployment = ref<Deployment | null>(null)
const testing = ref(false)
const testError = ref<string | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')

const dirty = computed(() => name.value.trim() !== org.value.name || subtitle.value.trim() !== org.value.subtitle)

function errorOf(e: unknown): { status?: number, message: string, details: { key: string, reason: string }[] } {
  const data = (e as { data?: { error?: { message?: string, details?: { key: string, reason: string }[] | null } } }).data?.error
  return { status: (e as { status?: number }).status, message: data?.message ?? 'Something went wrong. Try again.', details: data?.details ?? [] }
}

async function load(quiet = false) {
  if (!quiet) state.value = 'loading'
  try {
    deployment.value = await $fetch<Deployment>('/api/v1/settings/deployment')
    state.value = 'ready'
  } catch (e) {
    if (errorOf(e).status === 401) return navigateTo('/sign-in')
    state.value = 'error'
  }
}

async function sendTest() {
  testing.value = true
  testError.value = null
  try {
    const { sent_to } = await $fetch<{ sent_to: string }>('/api/v1/settings/mail/test', { method: 'POST' })
    toast.add({ title: `Test email sent to ${sent_to}`, icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    testError.value = errorOf(e).message
  } finally {
    // The server stores or clears the last error, so show its state.
    await load(true)
    testing.value = false
  }
}

async function save() {
  saving.value = true
  problems.value = {}
  formError.value = null
  try {
    setOrganization(await $fetch<Organization>('/api/v1/organization', { method: 'PATCH', body: { name: name.value, subtitle: subtitle.value } }))
    name.value = org.value.name
    subtitle.value = org.value.subtitle
    toast.add({ title: 'Settings saved', icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    const err = errorOf(e)
    if (err.details.length) problems.value = Object.fromEntries(err.details.map(d => [d.key, d.reason]))
    else formError.value = err.message
  } finally {
    saving.value = false
  }
}

async function uploadLogo(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  logoError.value = null
  // The server checks again. These checks only give the answer before the upload.
  if (file.type !== 'image/png') {
    logoError.value = 'The logo must be a PNG file. SVG is not accepted.'
    return
  }
  if (file.size > LOGO_MAX_BYTES) {
    logoError.value = 'The logo must be 1 MB or smaller.'
    return
  }
  logoBusy.value = true
  try {
    setOrganization(await $fetch<Organization>('/api/v1/organization/logo', { method: 'PUT', body: file, headers: { 'content-type': 'image/png' } }))
  } catch (e) {
    logoError.value = errorOf(e).message
  } finally {
    logoBusy.value = false
  }
}

async function removeLogo() {
  logoBusy.value = true
  logoError.value = null
  try {
    setOrganization(await $fetch<Organization>('/api/v1/organization/logo', { method: 'DELETE' }))
  } catch (e) {
    logoError.value = errorOf(e).message
  } finally {
    logoBusy.value = false
  }
}

onMounted(load)
</script>

<template>
  <AppPage id="settings" title="Settings">
    <PageHeader
      title="Settings"
      subtitle="Name your organization and check how this install is set up."
      :breadcrumb="[{ label: 'Admin' }, { label: 'Settings' }]"
    />

    <div class="flex flex-col gap-5 max-w-3xl">
      <SettingsSection title="Organization" description="Everyone who signs in sees these in the sidebar and on the sign-in page.">
        <form class="flex flex-col gap-4" @submit.prevent="save">
          <UFormField label="Name" :error="problems.name" required>
            <UInput v-model="name" maxlength="60" size="lg" class="w-full" />
          </UFormField>
          <UFormField label="Subtitle" :error="problems.subtitle" help="A short line under the name, for example “Support desk”.">
            <UInput v-model="subtitle" maxlength="80" size="lg" class="w-full" />
          </UFormField>
          <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="formError" />
          <div>
            <UButton type="submit" size="lg" :loading="saving" :disabled="!dirty">
              Save
            </UButton>
          </div>
        </form>

        <div class="flex flex-col gap-3 border-t border-(--ui-border-muted) pt-5">
          <p class="text-sm font-medium text-(--ui-text-highlighted)">
            Logo
          </p>
          <div class="flex items-center gap-4">
            <img v-if="org.logoUrl" :src="org.logoUrl" alt="Current logo" class="size-14 rounded-xl border border-(--ui-border) object-contain">
            <span v-else class="size-14 rounded-xl bg-(--ui-bg-inverted) text-(--ui-bg) flex items-center justify-center text-2xl font-semibold" aria-hidden="true">{{ org.initial }}</span>
            <div class="flex flex-wrap gap-2">
              <UButton color="neutral" variant="outline" icon="i-lucide-upload" :loading="logoBusy" @click="logoInput?.click()">
                {{ org.logoUrl ? 'Replace logo' : 'Upload logo' }}
              </UButton>
              <UButton v-if="org.logoUrl" color="neutral" variant="ghost" :disabled="logoBusy" @click="removeLogo">
                Remove
              </UButton>
            </div>
            <input ref="logoInput" type="file" accept="image/png" class="sr-only" tabindex="-1" aria-label="Logo file" @change="uploadLogo">
          </div>
          <p class="text-xs text-(--ui-text-muted)">
            PNG only, 1 MB at most. Without a logo, the first letter of the name shows.
          </p>
          <p v-if="logoError" role="alert" class="text-sm text-(--ui-error)">
            {{ logoError }}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Ticket numbers" description="Every ticket gets a number from one counter that all Ticket Types share. Each Ticket Type has its own prefix, so a reference reads BUG-1047 or PAY-1048. When a ticket changes type, the number stays and only the prefix changes. Set the prefix on the Ticket Type." />

      <SettingsSection title="Deployment" description="These values come from the environment of the Worker. Change them in the deployment, not here.">
        <ListSkeleton v-if="state === 'loading'" />
        <ErrorState v-else-if="state === 'error'" title="The deployment values could not be loaded." description="Check your connection, then try again." @retry="load()" />
        <dl v-else-if="deployment" class="grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] gap-x-6 gap-y-4 text-sm">
          <dt class="text-(--ui-text-muted)">
            Address
          </dt>
          <dd class="font-mono text-[13px] break-all text-(--ui-text-highlighted)">
            {{ deployment.address }}
          </dd>

          <dt class="text-(--ui-text-muted)">
            Claude connector URL
          </dt>
          <dd class="min-w-0">
            <CopyField :value="deployment.connector_url" label="connector URL" />
          </dd>

          <dt class="text-(--ui-text-muted)">
            Sign-in methods
          </dt>
          <dd class="text-(--ui-text-highlighted)">
            {{ deployment.sign_in.methods.join(', ') }}
          </dd>

          <dt class="text-(--ui-text-muted)">
            Allowed domains
          </dt>
          <dd class="flex flex-wrap gap-1.5">
            <UBadge v-for="d in deployment.sign_in.allowed_domains" :key="d" color="neutral" variant="subtle" class="font-mono">
              {{ d }}
            </UBadge>
          </dd>

          <dt class="text-(--ui-text-muted)">
            Mail transport
          </dt>
          <dd class="text-(--ui-text-highlighted)">
            {{ deployment.mail.transport }}<template v-if="deployment.mail.from">
              , from <span class="font-mono text-[13px]">{{ deployment.mail.from }}</span>
            </template>
            <div v-if="deployment.mail.transport !== 'none'" class="mt-2 flex flex-wrap items-center gap-2">
              <UButton color="neutral" variant="outline" icon="i-lucide-send" size="sm" :loading="testing" @click="sendTest">
                Send test email
              </UButton>
              <span class="text-xs text-(--ui-text-muted)">Sends to your own address.</span>
            </div>
            <p v-else class="mt-1 text-xs text-(--ui-text-muted)">
              No email is sent. Notifications still reach the Inbox.
            </p>
            <UAlert
              v-if="testError || deployment.mail.last_error"
              class="mt-3"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="The last email did not go out"
              :description="testError ?? `${deployment.mail.last_error!.message} (${new Date(deployment.mail.last_error!.at).toLocaleString()})`"
            />
          </dd>

          <dt class="text-(--ui-text-muted)">
            Environment
          </dt>
          <dd class="text-(--ui-text-highlighted)">
            {{ deployment.environment }}
          </dd>
        </dl>
      </SettingsSection>

      <SettingsPrivacy />
    </div>
  </AppPage>
</template>
