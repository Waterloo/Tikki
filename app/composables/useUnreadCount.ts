/** The unread notice count for the sidebar badge. Shared, so the Inbox page can set it without a new request. */
export function useUnreadCount() {
  const count = useState('unread-count', () => 0)
  async function refresh() {
    try {
      count.value = (await $fetch<{ count: number }>('/api/v1/notifications/unread-count')).count
    } catch {
      // A failed badge must not break the page. The next navigation tries again.
    }
  }
  return { count, refresh }
}
