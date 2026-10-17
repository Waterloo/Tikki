<script setup lang="ts">
import type { Attachment } from '~/types/tickets'

definePageMeta({ layout: 'auth' })

interface LinkInfo { ticket_ref: string, ticket_title: string, expires_at: string }

const token = String(useRoute().params.token ?? '')
const endpoint = `/api/v1/upload-links/${encodeURIComponent(token)}`

const state = ref<'loading' | 'ready' | 'unusable' | 'failed'>('loading')
const info = ref<LinkInfo | null>(null)
const problem = ref('')
const uploading = ref(false)
const over = ref(false)
const uploadError = ref<string | null>(null)
const done = ref<Attachment | null>(null)

// Opening the page does not use the link. Only a successful upload does.
async function load() {
  state.value = 'loading'
  try {
    info.value = await $fetch<LinkInfo>(endpoint)
    state.value = 'ready'
  } catch (e) {
    const err = e as { status?: number, data?: { error?: { message?: string } } }
    if (err.status && err.status < 500) {
      problem.value = err.data?.error?.message ?? 'This upload link is not valid.'
      state.value = 'unusable'
    } else {
      state.value = 'failed'
    }
  }
}
onMounted(load)

async function upload(file: File | undefined) {
  if (!file || uploading.value) return
  uploadError.value = null
  uploading.value = true
  try {
    done.value = await uploadFile(file, undefined, endpoint)
  } catch (e) {
    uploadError.value = (e as Error).message
  } finally {
    uploading.value = false
  }
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  upload(input.files?.[0])
  input.value = ''
}
</script>

<template>
  <UCard :ui="{ body: 'p-6 sm:p-6' }">
    <div class="flex flex-col gap-1 mb-6">
      <h1 class="text-xl font-semibold tracking-tight">
        Upload a file
      </h1>
      <p class="text-sm text-(--ui-text-muted)">
        <template v-if="info">
          Add one file to <span class="font-medium text-(--ui-text-highlighted)">{{ info.ticket_ref }}</span>, {{ info.ticket_title }}.
        </template>
        <template v-else>
          Claude asked for a file for one of your tickets.
        </template>
      </p>
    </div>

    <div v-if="state === 'loading'" class="flex items-center gap-2 text-sm text-(--ui-text-muted)" role="status" aria-busy="true">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" aria-hidden="true" />
      Checking the link…
    </div>

    <ErrorState v-else-if="state === 'failed'" title="The link could not be checked" description="Check your connection, then try again." @retry="load" />

    <div v-else-if="state === 'unusable'" class="flex flex-col gap-4">
      <UAlert color="warning" variant="subtle" icon="i-lucide-link-2-off" title="This link cannot be used" :description="problem" />
      <UButton to="/" variant="outline" color="neutral" block size="lg">
        Go to My tickets
      </UButton>
    </div>

    <div v-else-if="done" class="flex flex-col gap-4">
      <UAlert color="success" variant="subtle" icon="i-lucide-circle-check" title="The file is on the ticket" />
      <AttachmentChip :attachment="done" />
      <UButton :to="`/tickets/${info!.ticket_ref}`" block size="lg">
        Open {{ info!.ticket_ref }}
      </UButton>
    </div>

    <div v-else class="flex flex-col gap-3">
      <label
        class="relative flex w-full items-center justify-center gap-2 min-h-[96px] rounded-[10px] border border-dashed px-3 text-center text-sm text-(--ui-text-toned) cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-(--ui-primary)"
        :class="over ? 'border-(--ui-primary) bg-(--app-row-hover)' : 'border-(--ui-border-accented) bg-(--ui-bg-muted)'"
        @dragover.prevent="over = true"
        @dragleave="over = false"
        @drop.prevent="over = false; upload($event.dataTransfer?.files[0])"
      >
        <UIcon :name="uploading ? 'i-lucide-loader-circle' : 'i-lucide-upload'" class="size-4 shrink-0" :class="uploading ? 'animate-spin' : ''" aria-hidden="true" />
        <span v-if="uploading" role="status">Uploading…</span>
        <span v-else>Drop a file or click to choose · up to 25 MB</span>
        <input type="file" aria-label="File to upload" class="absolute inset-0 size-full opacity-0 cursor-pointer" :disabled="uploading" @change="onPick">
      </label>
      <p v-if="uploadError" class="text-sm text-(--ui-error)" role="alert">
        {{ uploadError }}
      </p>
      <p class="text-xs text-(--ui-text-muted)">
        This link works once and expires 15 minutes after Claude made it.
      </p>
    </div>
  </UCard>
</template>
