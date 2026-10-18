<script setup lang="ts">
import { APP_ICON_MAX_BYTES, APP_ICON_TYPES, APP_ICONS, appIconUrl, type AppIconMode } from '~~/shared/ticket-app-icons'
import type { TicketApp } from '~/types/ticket-apps'

/**
 * The "Icon" part of the Ticket App form: a built-in icon and color, or an uploaded light and dark image.
 * It stages the choice. The parent calls `commit(appId)` after it saved the app, because an upload needs the app's ID.
 */
const props = defineProps<{ app: TicketApp | null }>()
const name = defineModel<string>('name', { required: true })
const color = defineModel<string>('color', { required: true })

interface Slot { file: File | null, preview: string | null, removed: boolean }
const MODES: { mode: AppIconMode, label: string, help: string }[] = [
  { mode: 'light', label: 'Light', help: 'Shown in light mode, and in dark mode when there is no dark image.' },
  { mode: 'dark', label: 'Dark', help: 'Optional. Shown in dark mode.' },
]
const empty = (): Slot => ({ file: null, preview: null, removed: false })

const kind = ref<'builtin' | 'image'>(props.app?.icon.kind ?? 'builtin')
const slots = reactive<Record<AppIconMode, Slot>>({ light: empty(), dark: empty() })
const problems = reactive<Record<AppIconMode | 'form', string | null>>({ light: null, dark: null, form: null })
const dragging = ref<AppIconMode | null>(null)

const stored = (mode: AppIconMode) => !!props.app?.icon[mode]
/** The image URL for a slot: the staged file, else the stored image, else nothing. */
function srcOf(mode: AppIconMode): string | null {
  const slot = slots[mode]
  if (slot.preview) return slot.preview
  return props.app && stored(mode) && !slot.removed ? appIconUrl(props.app.id, props.app.icon, mode) : null
}
const hasLight = computed(() => srcOf('light') !== null)
const lightSrc = computed(() => srcOf('light'))
const darkSrc = computed(() => srcOf('dark') ?? lightSrc.value)

function clear(mode: AppIconMode) {
  const slot = slots[mode]
  if (slot.preview) URL.revokeObjectURL(slot.preview)
  slots[mode] = { file: null, preview: null, removed: stored(mode) }
  problems[mode] = null
  // The server drops the dark image with the light one.
  if (mode === 'light') clear('dark')
}

function stage(mode: AppIconMode, file: File | undefined) {
  if (!file) return
  problems[mode] = null
  if (file.size > APP_ICON_MAX_BYTES) return void (problems[mode] = 'The image must be 256 KB or smaller.')
  // The server checks the bytes. This only saves a round trip for an obvious mistake.
  if (!(APP_ICON_TYPES as readonly string[]).includes(file.type)) return void (problems[mode] = 'The image must be a PNG, WebP or SVG file.')
  if (slots[mode].preview) URL.revokeObjectURL(slots[mode].preview!)
  slots[mode] = { file, preview: URL.createObjectURL(file), removed: false }
}

function onPick(mode: AppIconMode, event: Event) {
  const input = event.target as HTMLInputElement
  stage(mode, input.files?.[0])
  input.value = ''
}

function onDrop(mode: AppIconMode, event: DragEvent) {
  dragging.value = null
  stage(mode, event.dataTransfer?.files[0])
}

/** False, with a message in the field, when the choice cannot be saved. */
function validate(): boolean {
  problems.form = kind.value === 'image' && !hasLight.value ? 'Add a light image, or choose a built-in icon.' : null
  return problems.form === null
}

/** Uploads and removes what the Admin chose. Returns the app as the server shows it now, or null when nothing changed. */
async function commit(appId: number): Promise<TicketApp | null> {
  const base = `/api/v1/admin/ticket-apps/${appId}/icon`
  let latest: TicketApp | null = null
  const send = async (mode: AppIconMode, body?: File) => {
    latest = await $fetch<TicketApp>(`${base}?mode=${mode}`, { method: body ? 'PUT' : 'DELETE', body })
  }
  if (kind.value === 'builtin') {
    if (props.app?.icon.light) await send('light')
    return latest
  }
  // Light first: the server refuses a dark image while no light image is stored.
  for (const { mode } of MODES) {
    const slot = slots[mode]
    if (slot.file) await send(mode, slot.file)
    else if (slot.removed) await send(mode)
  }
  return latest
}

defineExpose({ validate, commit })
onBeforeUnmount(() => MODES.forEach(({ mode }) => slots[mode].preview && URL.revokeObjectURL(slots[mode].preview!)))
</script>

<template>
  <fieldset class="flex flex-col gap-3 min-w-0" data-testid="app-icon-field">
    <legend class="text-sm font-medium text-(--ui-text-highlighted)">
      Icon
    </legend>
    <div role="group" aria-label="Icon source" class="inline-flex self-start rounded-lg border border-(--ui-border) p-0.5 gap-0.5">
      <UButton size="sm" :color="kind === 'builtin' ? 'primary' : 'neutral'" :variant="kind === 'builtin' ? 'soft' : 'ghost'" :aria-pressed="kind === 'builtin'" @click="kind = 'builtin'">
        Built-in icon
      </UButton>
      <UButton size="sm" :color="kind === 'image' ? 'primary' : 'neutral'" :variant="kind === 'image' ? 'soft' : 'ghost'" :aria-pressed="kind === 'image'" @click="kind = 'image'">
        Upload image
      </UButton>
    </div>

    <div v-if="kind === 'builtin'" class="flex flex-col gap-4">
      <TypeAppearance v-model:icon="name" v-model:color="color" :icons="APP_ICONS" />
    </div>

    <div v-else class="flex flex-col gap-3">
      <p class="text-[13px] text-(--ui-text-muted)">
        PNG, WebP or SVG, 256 KB at most. Square is best: Tikki shows it in a square box.
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <div v-for="m in MODES" :key="m.mode" class="flex flex-col gap-1.5 min-w-0">
          <span class="text-sm font-medium text-(--ui-text-highlighted)">{{ m.label }} image</span>
          <label
            class="relative flex flex-col items-center justify-center gap-1.5 min-h-[104px] rounded-[10px] border border-dashed p-3 text-center text-[13px] text-(--ui-text-muted) cursor-pointer focus-within:ring-2 focus-within:ring-(--ui-primary)"
            :class="[dragging === m.mode ? 'border-(--ui-primary) bg-(--app-row-hover)' : 'border-(--ui-border)', m.mode === 'dark' && !hasLight ? 'opacity-50 cursor-not-allowed' : '']"
            @dragover.prevent="dragging = m.mode"
            @dragleave="dragging = null"
            @drop.prevent="m.mode === 'dark' && !hasLight ? (dragging = null) : onDrop(m.mode, $event)"
          >
            <img v-if="srcOf(m.mode)" :src="srcOf(m.mode)!" alt="" class="size-12 object-contain" :data-testid="`icon-preview-${m.mode}`">
            <UIcon v-else name="i-lucide-image-plus" class="size-5" aria-hidden="true" />
            <span>{{ srcOf(m.mode) ? 'Replace' : `Drop the ${m.label.toLowerCase()} image or choose a file` }}</span>
            <input
              type="file"
              class="absolute inset-0 size-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              :accept="APP_ICON_TYPES.join(',')"
              :disabled="m.mode === 'dark' && !hasLight"
              :aria-label="`${m.label} image file`"
              :data-testid="`icon-file-${m.mode}`"
              @change="onPick(m.mode, $event)"
            >
          </label>
          <span class="text-[13px] text-(--ui-text-muted)">{{ m.help }}</span>
          <UButton v-if="srcOf(m.mode)" size="xs" color="neutral" variant="ghost" icon="i-lucide-trash-2" class="self-start" :aria-label="`Remove the ${m.label.toLowerCase()} image`" @click="clear(m.mode)">
            Remove
          </UButton>
          <p v-if="problems[m.mode]" class="text-sm text-(--ui-error)" role="alert">
            {{ problems[m.mode] }}
          </p>
        </div>
      </div>
      <p v-if="problems.form" class="text-sm text-(--ui-error)" role="alert">
        {{ problems.form }}
      </p>
    </div>

    <!-- Fixed light and dark tiles, whatever the mode of Tikki, so the Admin sees both. -->
    <div class="flex flex-wrap items-center gap-3" aria-label="Preview" role="group">
      <span class="text-[13px] text-(--ui-text-muted)">Preview</span>
      <div class="flex items-center gap-2">
        <span class="flex size-12 items-center justify-center rounded-[10px] border border-neutral-200 bg-white" data-testid="icon-tile-light">
          <img v-if="kind === 'image' && lightSrc" :src="lightSrc" alt="" class="size-8 object-contain">
          <UIcon v-else-if="kind === 'builtin'" :name="name" class="size-5" :style="{ color }" />
        </span>
        <span class="flex size-12 items-center justify-center rounded-[10px] border border-neutral-700 bg-neutral-900" data-testid="icon-tile-dark">
          <img v-if="kind === 'image' && darkSrc" :src="darkSrc" alt="" class="size-8 object-contain">
          <UIcon v-else-if="kind === 'builtin'" :name="name" class="size-5" :style="{ color }" />
        </span>
      </div>
    </div>
  </fieldset>
</template>
