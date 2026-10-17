<script setup lang="ts">
import type { Attachment } from '~/types/tickets'

const props = defineProps<{
  ticketRef: string
  attachments: Attachment[]
  state: 'loading' | 'ready' | 'error'
}>()
const emit = defineEmits<{ uploaded: [Attachment], retry: [] }>()

const toast = useToast()
const picker = useTemplateRef<HTMLInputElement>('picker')
const uploading = ref(false)

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  uploading.value = true
  try {
    for (const file of files) {
      try {
        const attachment = await uploadFile(file, props.ticketRef)
        emit('uploaded', attachment)
        toast.add({ title: `Attached ${attachment.filename}`, color: 'success', duration: 2500 })
      } catch (e) {
        toast.add({ title: `${file.name} was not attached.`, description: (e as Error).message, color: 'error' })
      }
    }
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <section aria-labelledby="attachments-heading" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) px-4 pt-4 pb-5 sm:px-[22px] flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="attachments-heading" class="text-[15px] font-semibold text-(--ui-text-highlighted)">
        Attachments
      </h2>
      <UButton size="sm" variant="outline" color="neutral" icon="i-lucide-paperclip" :loading="uploading" @click="picker?.click()">
        Attach file
      </UButton>
      <input ref="picker" type="file" multiple class="sr-only" tabindex="-1" aria-label="Attach files" @change="onPick">
    </div>

    <div v-if="state === 'loading'" class="flex flex-col gap-2" aria-busy="true" aria-label="Loading attachments">
      <USkeleton class="h-9 w-64 max-w-full rounded-[10px]" />
    </div>
    <ErrorState v-else-if="state === 'error'" title="The attachments could not be loaded." @retry="emit('retry')" />
    <p v-else-if="attachments.length === 0" class="text-sm text-(--ui-text-muted)">
      No attachments yet. People who can see this ticket can download them; nobody else can.
    </p>
    <ul v-else class="flex flex-col items-start gap-2">
      <li v-for="a in attachments" :key="a.id" class="max-w-full">
        <AttachmentChip :attachment="a" />
      </li>
    </ul>
  </section>
</template>
