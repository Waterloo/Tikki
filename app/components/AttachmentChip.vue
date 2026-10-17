<script setup lang="ts">
import type { Attachment } from '~/types/tickets'

defineProps<{ attachment: Pick<Attachment, 'filename' | 'size' | 'url'> }>()
</script>

<template>
  <a
    :href="attachment.url"
    download
    class="inline-flex max-w-full items-center gap-2 min-h-9 px-3 rounded-[10px] border border-(--ui-border) bg-(--ui-bg) text-sm text-(--ui-text-highlighted) transition-colors hover:bg-(--app-row-hover)"
  >
    <UIcon name="i-lucide-paperclip" class="size-4 shrink-0" aria-hidden="true" />
    <span class="truncate">{{ attachment.filename }}</span>
    <span class="shrink-0 text-[13px] text-(--ui-text-muted)">{{ formatBytes(attachment.size) }}</span>
  </a>
</template>
