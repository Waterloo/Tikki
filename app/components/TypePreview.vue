<script setup lang="ts">
import type { FieldDef } from '~/types/ticket-types'

defineProps<{
  name: string
  description: string
  icon: string
  color: string
  prefix: string
  /** The Fields that a new ticket asks for. */
  fields: readonly FieldDef[]
}>()
</script>

<template>
  <aside aria-label="Preview" class="flex flex-col gap-4 min-w-0">
    <section class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] flex flex-col gap-3">
      <h2 class="text-sm font-semibold text-(--ui-text-highlighted)">
        What requesters see
      </h2>
      <div class="flex flex-col items-start gap-2.5 p-3.5 rounded-xl border-2" :style="{ borderColor: color }">
        <TypeTile :icon="icon" :color="color" size="sm" />
        <span class="flex flex-col gap-1">
          <span class="text-sm font-semibold text-(--ui-text-highlighted) [overflow-wrap:anywhere]">{{ name.trim() || 'Ticket type name' }}</span>
          <span class="text-[13px] leading-snug text-(--ui-text-muted) [overflow-wrap:anywhere]">{{ description.trim() || 'When to use it.' }}</span>
        </span>
      </div>
    </section>

    <section class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] flex flex-col gap-3">
      <h2 class="flex items-center gap-2 text-sm font-semibold text-(--ui-text-highlighted)">
        <UIcon name="i-lucide-sparkles" class="size-4 text-[#8a5a1f] dark:text-[#d9a65f]" aria-hidden="true" />
        What Claude knows
      </h2>
      <dl class="flex flex-col gap-2.5 text-[13px] leading-normal">
        <div class="flex flex-col gap-0.5">
          <dt class="text-(--ui-text-muted)">
            Type
          </dt>
          <dd class="text-(--ui-text-highlighted) [overflow-wrap:anywhere]">
            {{ name.trim() || 'Ticket type name' }}
          </dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="text-(--ui-text-muted)">
            Ticket numbers
          </dt>
          <dd class="font-mono text-xs text-(--ui-text-highlighted)">
            {{ prefix || '··' }}-1049
          </dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="text-(--ui-text-muted)">
            Chosen when
          </dt>
          <dd class="text-(--ui-text-highlighted) [overflow-wrap:anywhere]">
            {{ description.trim() || 'When to use it.' }}
          </dd>
        </div>
        <div class="flex flex-col gap-1.5">
          <dt class="text-(--ui-text-muted)">
            Asks for
          </dt>
          <dd class="flex flex-col gap-1.5">
            <span v-if="fields.length === 0" class="text-(--ui-text-toned)">Only a title and a description.</span>
            <span v-for="f in fields" :key="f.key" class="flex flex-wrap items-baseline gap-1.5 text-(--ui-text-highlighted)">
              <span class="font-mono text-xs">{{ f.key }}</span>
              <span class="text-(--ui-text-toned)">{{ f.label }} · {{ fieldTypeLabel(f.type).toLowerCase() }}{{ f.required ? ' · required' : '' }}</span>
            </span>
          </dd>
        </div>
      </dl>
    </section>
  </aside>
</template>
