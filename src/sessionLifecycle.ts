import { destroyClient } from './api/client'
import { resetTreeRefreshState } from './components/tree/treeData'
import { useConnectionStore, type Credentials } from './stores/connection'
import { useExplorerStore } from './stores/explorer'
import { useSubscriptionsStore } from './stores/subscriptions'

export function normalizeServerUrl(url: string): string {
  return url.replace(/\/$/, '')
}

export function credentialsEqual(a: Credentials | null, b: Credentials | null): boolean {
  if (a?.type !== b?.type) return false
  if (!a || !b) return a === b
  if (a.type === 'basic' && b.type === 'basic') {
    return a.username === b.username && a.password === b.password
  }
  if (a.type === 'bearer' && b.type === 'bearer') return a.token === b.token
  return a.type === 'header' && b.type === 'header' &&
    a.headerName === b.headerName && a.headerValue === b.headerValue
}

export function cleanupCurrentSession(): void {
  destroyClient()
  useConnectionStore.getState().disconnect()
  useExplorerStore.getState().reset()
  useSubscriptionsStore.getState().clearAll()
  resetTreeRefreshState()
}
