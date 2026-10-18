import type { AppPage } from '~/types/ticket-apps'

// The sidebar and the app page both load the list on navigation; they share one request.
let inflight: Promise<void> | null = null

/** The app pages of the Apps menu (issue 39). One list for the sidebar and the app page. */
export function useAppPages() {
  const pages = useState<AppPage[]>('app-pages', () => [])

  /** Throws when the list could not be loaded; the old list stays. */
  function refresh(): Promise<void> {
    inflight ??= $fetch<{ data: AppPage[] }>('/api/v1/apps')
      .then((r) => { pages.value = r.data })
      .finally(() => { inflight = null })
    return inflight
  }
  return { pages, refresh }
}
