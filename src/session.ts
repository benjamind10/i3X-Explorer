import {
  destroyClient,
  getClient,
  isCurrentClient,
  type I3XClient
} from './api/client'
import { useConnectionStore } from './stores/connection'
import { useExplorerStore } from './stores/explorer'
import { useSubscriptionsStore } from './stores/subscriptions'

export const REMOTE_CLEANUP_TIMEOUT_MS = 2_000

export type SessionCleanupMode = 'background' | 'wait'
export type SessionEndReason = 'disconnect' | 'settings-changed' | 'connect-failed' | 'app-quit'

export interface SessionContext {
  client: I3XClient
  generation: number
  isCurrent: () => boolean
}

export function captureSession(client: I3XClient): SessionContext {
  const generation = useConnectionStore.getState().sessionGeneration
  return {
    client,
    generation,
    isCurrent: () => (
      isCurrentClient(client)
      && useConnectionStore.getState().sessionGeneration === generation
    )
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

async function runBoundedCleanup(client: I3XClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REMOTE_CLEANUP_TIMEOUT_MS)
  try {
    await client.deleteSubscriptionsForCleanup(ids, controller.signal)
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function endActiveSession(
  _reason: SessionEndReason,
  cleanupMode: SessionCleanupMode = 'background'
): Promise<void> {
  const client = getClient()
  const subscriptionIds = Array.from(useSubscriptionsStore.getState().subscriptions.keys())

  const connection = useConnectionStore.getState()
  connection.invalidateSession()
  connection.disconnect()
  if (client) destroyClient(client)
  useExplorerStore.getState().reset()
  useSubscriptionsStore.getState().clearAll()

  if (!client || subscriptionIds.length === 0) return

  const cleanup = runBoundedCleanup(client, subscriptionIds)
  if (cleanupMode === 'wait') {
    await cleanup
  } else {
    void cleanup
  }
}
