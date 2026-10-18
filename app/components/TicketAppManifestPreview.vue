<script setup lang="ts">
import type { ManifestPreview, TicketAppPlacement } from '~/types/ticket-apps'

/** Issue 40: what a manifest describes, for the Admin to check before "Add app" or "Apply update". */
defineProps<{ preview: ManifestPreview }>()

const PLACEMENTS: { value: TicketAppPlacement, chip: string }[] = [
  { value: 'sidebar', chip: 'Sidebar' },
  { value: 'tab', chip: 'Tab' },
  { value: 'page', chip: 'Page' },
]
const ACCESS_LABEL = { read: 'Read', comment: 'Comment', update: 'Update' } as const
</script>

<template>
  <section aria-label="Manifest preview" class="flex flex-col gap-3 rounded-[12px] border border-(--ui-border) p-4 min-w-0" data-testid="manifest-preview">
    <div class="flex items-start gap-3 min-w-0">
      <!-- Fixed light and dark tiles, whatever the mode of Tikki, so the Admin sees both. -->
      <div role="group" aria-label="Icon on light and dark" class="flex shrink-0 gap-1.5">
        <span class="flex size-12 items-center justify-center rounded-[10px] border border-neutral-200 bg-white" data-testid="manifest-icon-light">
          <img v-if="preview.icons" :src="preview.icons.light" alt="Icon on a light background" class="size-8 object-contain">
          <UIcon v-else name="i-lucide-app-window" class="size-5 text-neutral-600" />
        </span>
        <span class="flex size-12 items-center justify-center rounded-[10px] border border-neutral-700 bg-neutral-900" data-testid="manifest-icon-dark">
          <img v-if="preview.icons" :src="preview.icons.dark ?? preview.icons.light" alt="Icon on a dark background" class="size-8 object-contain">
          <UIcon v-else name="i-lucide-app-window" class="size-5 text-neutral-300" />
        </span>
      </div>
      <div class="flex flex-col gap-1 min-w-0">
        <h3 class="text-base font-semibold text-(--ui-text-highlighted) [overflow-wrap:anywhere]">
          {{ preview.manifest.name }}
        </h3>
        <p v-if="preview.manifest.description" class="text-sm text-(--ui-text-toned) [overflow-wrap:anywhere]">
          {{ preview.manifest.description }}
        </p>
        <p v-if="!preview.icons" class="text-[13px] text-(--ui-text-muted)">
          No icons in the manifest. The built-in app icon shows.
        </p>
      </div>
    </div>
    <dl class="flex flex-col gap-2 m-0 text-sm">
      <div v-for="p in PLACEMENTS.filter(p => preview.manifest.urls[p.value])" :key="p.value" class="flex flex-col gap-0.5 min-w-0">
        <dt class="text-xs px-2 py-0.5 self-start rounded-full bg-(--ui-bg-accented) text-(--ui-text-toned)">
          {{ p.chip }}
        </dt>
        <dd class="m-0 font-mono text-[13px] text-(--ui-text-toned) [overflow-wrap:anywhere]">
          {{ preview.manifest.urls[p.value] }}
        </dd>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <dt class="text-(--ui-text-muted)">
          Asks for
        </dt>
        <dd class="m-0 font-medium text-(--ui-text-highlighted)" data-testid="requested-access">
          {{ ACCESS_LABEL[preview.manifest.access] }} access
        </dd>
      </div>
    </dl>
  </section>
</template>
