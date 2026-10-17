<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ invited: [count: number] }>()

const text = ref('')
const busy = ref(false)
const problems = ref<string[]>([])
const failure = ref<string | null>(null)

const emails = computed(() => text.value.split(/[\s,;]+/).filter(Boolean))

watch(open, (isOpen) => {
  if (isOpen) {
    text.value = ''
    problems.value = []
    failure.value = null
  }
})

async function submit() {
  busy.value = true
  problems.value = []
  failure.value = null
  try {
    const res = await $fetch<{ invited: string[] }>('/api/v1/invites', { method: 'POST', body: { emails: emails.value } })
    open.value = false
    emit('invited', res.invited.length)
  } catch (e) {
    const err = apiProblem(e)
    if (err.details.length) problems.value = err.details.map(d => d.reason)
    else failure.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Invite people" description="Invite people whose email is not on an allowed domain, for example contractors. They sign in with an email code and start as requesters.">
    <template #body>
      <form id="invite-form" class="flex flex-col gap-4" @submit.prevent="submit">
        <UFormField label="Email addresses" help="One or more, separated by a space, a comma or a new line." required>
          <UTextarea v-model="text" :rows="4" autofocus placeholder="alex@northwind-contracting.com" class="w-full" />
        </UFormField>
        <UAlert v-if="problems.length" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Nobody was invited. Fix these and try again.">
          <template #description>
            <ul class="list-disc pl-4">
              <li v-for="p in problems" :key="p">
                {{ p }}
              </li>
            </ul>
          </template>
        </UAlert>
        <UAlert v-if="failure" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="failure" />
      </form>
    </template>
    <template #footer>
      <UButton color="neutral" variant="ghost" @click="open = false">
        Cancel
      </UButton>
      <UButton type="submit" form="invite-form" :loading="busy" :disabled="emails.length === 0">
        Send {{ emails.length > 1 ? `${emails.length} invites` : 'invite' }}
      </UButton>
    </template>
  </UModal>
</template>
