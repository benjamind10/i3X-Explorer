import { describe, expect, it, vi } from 'vitest'
import { createClient, getClient } from './api/client'
import { endActiveSession, REMOTE_CLEANUP_TIMEOUT_MS } from './session'
import { useConnectionStore } from './stores/connection'
import { useExplorerStore } from './stores/explorer'
import { useSubscriptionsStore } from './stores/subscriptions'

describe('endActiveSession', () => {
  it('resets local state immediately and bounds detached cleanup', async () => {
    vi.useFakeTimers()
    let cleanupSignal: AbortSignal | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      cleanupSignal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        cleanupSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })

    const client = createClient('https://server.test')
    useConnectionStore.setState({ isConnected: true, credentials: { type: 'bearer', token: 'secret' } })
    useExplorerStore.setState({ namespaces: [{ uri: 'old', displayName: 'Old' }] })
    useSubscriptionsStore.getState().addSubscription({
      id: 'subscription-1',
      createdAt: new Date().toISOString(),
      monitoredItems: [],
      isStreaming: false
    })

    const cleanup = endActiveSession('disconnect', 'wait')

    expect(useConnectionStore.getState()).toMatchObject({
      isConnected: false,
      isConnecting: false,
      credentials: null,
      sessionGeneration: 1
    })
    expect(useExplorerStore.getState().namespaces).toEqual([])
    expect(useSubscriptionsStore.getState().subscriptions.size).toBe(0)
    expect(getClient()).toBeNull()
    expect(client.signal.aborted).toBe(true)
    expect(cleanupSignal).not.toBe(client.signal)
    expect(cleanupSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(REMOTE_CLEANUP_TIMEOUT_MS)
    await cleanup
    expect(cleanupSignal?.aborted).toBe(true)
  })
})
