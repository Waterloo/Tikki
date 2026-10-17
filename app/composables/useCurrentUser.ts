/** The signed-in User from the Better-Auth session, with the role checked. */
export function useCurrentUser() {
  const session = authClient.useSession()
  const user = computed(() => session.value.data?.user)
  const role = computed(() => {
    const value = (user.value as { role?: unknown } | undefined)?.role
    return isRole(value) ? value : undefined
  })
  return { user, role }
}
