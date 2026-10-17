<template>
  <div class="min-h-dvh flex flex-col items-center justify-center gap-6 p-4 bg-(--ui-bg-muted)">
    <OrgMark />
    <main class="w-full max-w-sm">
      <slot />
    </main>
  </div>
</template>
