<script setup lang="ts">
withDefaults(defineProps<{
  person: { name?: string | null, email?: string | null }
  size?: 'sm' | 'md' | 'lg'
}>(), { size: 'md' })

const SIZE = { sm: 'size-6 text-[11px]', md: 'size-8 text-xs', lg: 'size-9 text-[13px]' } as const
</script>

<template>
  <span
    class="shrink-0 rounded-full flex items-center justify-center font-semibold bg-[#dce7fb] text-[#1a4fb4] dark:bg-[#1c2a45] dark:text-[#a9c3f0]"
    :class="SIZE[size]"
    aria-hidden="true"
  >{{ initials(person) }}</span>
</template>
