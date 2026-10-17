// Awaited before the app mounts, so the sidebar and the sign-in page never flash the default name.
export default defineNuxtPlugin(async () => {
  try {
    await refreshOrganization()
  } catch {
    // The default name stays. A network error here must not block sign-in.
  }
})
