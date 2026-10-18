<script setup lang="ts">
export interface Setup {
  first_ticket_exists: boolean
  connector_url: string
  allowed_domains: string[]
  ticket_types: { id: number, name: string, prefix: string, description: string, icon: string, color: string }[]
}

const props = defineProps<{ setup: Setup }>()
const emit = defineEmits<{ 'first-ticket': [] }>()

const FIRST_MESSAGE = 'Raise a bug: the export button on the Reports page fails.'
const POLL_MS = 5000

// The screen leaves as soon as the first ticket exists, so the Admin sees that it worked.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(async () => {
    try {
      const next = await $fetch<Setup>('/api/v1/setup')
      if (next.first_ticket_exists) emit('first-ticket')
    } catch {
      // A failed check is tried again at the next interval.
    }
  }, POLL_MS)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="flex flex-col gap-5 max-w-3xl">
    <SettingsSection
      title="Connect Claude"
      description="Add this address in Claude as a custom connector. Then people can raise tickets by talking to Claude."
    >
      <CopyField :value="props.setup.connector_url" label="connector URL" />
      <ol class="list-decimal pl-5 flex flex-col gap-1.5 text-sm text-(--ui-text)">
        <li>In Claude, open Settings, then Connectors, then add a custom connector.</li>
        <li>Paste the address above and sign in with your work email.</li>
        <li>Send the message below.</li>
      </ol>
    </SettingsSection>

    <SettingsSection title="Say this to Claude" description="A first message to try.">
      <CopyField :value="FIRST_MESSAGE" label="first message" />
      <p class="flex items-center gap-2 text-sm text-(--ui-text-muted)" role="status" aria-live="polite">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Waiting for your first ticket…
      </p>
      <p class="text-sm text-(--ui-text-muted)">
        No Claude yet? <NuxtLink to="/tickets/new" class="text-(--ui-primary) underline underline-offset-2">Create the first ticket here</NuxtLink>.
      </p>
    </SettingsSection>

    <SettingsSection title="Example Ticket Types" description="Your install starts with these. Edit or archive them when you are ready.">
      <ul class="flex flex-col">
        <li v-for="t in props.setup.ticket_types" :key="t.id" class="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 border-t border-(--ui-border-muted) first:border-t-0">
          <TicketTypeChip :name="t.name" :icon="t.icon" :color="t.color" />
          <span class="font-mono text-[13px] text-(--ui-text-muted)">{{ t.prefix }}</span>
          <span class="basis-full sm:basis-auto text-sm text-(--ui-text-muted)">{{ t.description }}</span>
        </li>
      </ul>
    </SettingsSection>

    <SettingsSection title="Connect another system" description="A system such as a checkout site can create tickets for its customers through the API.">
      <p class="text-sm text-(--ui-text-muted)">
        <NuxtLink to="/applications" class="text-(--ui-primary) underline underline-offset-2">Create an application and an API key</NuxtLink>, then see the
        <a href="/api/v1/openapi.json" class="text-(--ui-primary) underline underline-offset-2">OpenAPI document</a>.
      </p>
    </SettingsSection>

    <SettingsSection title="Who can sign in" description="People with an email at one of these domains.">
      <div class="flex flex-wrap gap-1.5">
        <UBadge v-for="d in props.setup.allowed_domains" :key="d" color="neutral" variant="subtle" class="font-mono">
          {{ d }}
        </UBadge>
      </div>
    </SettingsSection>
  </div>
</template>
