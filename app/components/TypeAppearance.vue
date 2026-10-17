<script setup lang="ts">
import { TYPE_COLORS, TYPE_ICONS } from '~~/shared/ticket-type-rules'

defineProps<{
  /** Colors that another type uses. They stay choosable and are marked for screen readers. */
  usedColors?: readonly string[]
  iconSuggested?: boolean
  colorSuggested?: boolean
  /** Show only the color (the editor has icon and color in different cards). */
  only?: 'icon' | 'color'
}>()

const icon = defineModel<string>('icon', { required: true })
const color = defineModel<string>('color', { required: true })
</script>

<template>
  <div class="contents">
    <div v-if="only !== 'color'" class="flex flex-col gap-2">
      <span class="text-sm font-medium text-(--ui-text-highlighted)">
        Icon <span v-if="iconSuggested" class="font-normal text-[13px] text-(--ui-text-muted)">· suggested from the name</span>
      </span>
      <div role="group" aria-label="Icon" class="flex flex-wrap gap-1.5">
        <button
          v-for="ic in TYPE_ICONS"
          :key="ic.icon"
          type="button"
          :aria-label="ic.label"
          :aria-pressed="icon === ic.icon"
          class="size-10 rounded-[10px] flex items-center justify-center transition-colors"
          :class="icon === ic.icon ? 'border-2' : 'border border-(--ui-border) bg-(--ui-bg) text-(--ui-text-toned) hover:bg-(--app-row-hover)'"
          :style="icon === ic.icon ? { borderColor: color, color, backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)` } : {}"
          @click="icon = ic.icon"
        >
          <UIcon :name="ic.icon" class="size-[17px]" />
        </button>
      </div>
    </div>

    <div v-if="only !== 'icon'" class="flex flex-col gap-2">
      <span class="text-sm font-medium text-(--ui-text-highlighted)">
        Color <span v-if="colorSuggested" class="font-normal text-[13px] text-(--ui-text-muted)">· not used by another type</span>
      </span>
      <div role="group" aria-label="Color" class="flex flex-wrap items-center gap-2.5 min-h-10">
        <button
          v-for="c in TYPE_COLORS"
          :key="c.color"
          type="button"
          :aria-label="c.label + (usedColors?.includes(c.color) ? ', used by another type' : '')"
          :aria-pressed="color === c.color"
          class="size-7 rounded-full border-0 transition-shadow"
          :style="{ backgroundColor: c.color, boxShadow: color === c.color ? `0 0 0 2px var(--ui-bg), 0 0 0 4px ${c.color}` : 'none' }"
          @click="color = c.color"
        />
      </div>
    </div>
  </div>
</template>
