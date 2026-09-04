import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../../api/client'
import { HttpStatusError } from '../../api/subscription'
import type { SyncResponseItem } from '../../api/types'
import { useConnectionStore } from '../../stores/connection'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { SubscriptionPanel } from './SubscriptionPanel'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function addSubscription() {
  useSubscriptionsStore.getState().addSubscription({
    id: 'sub-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    monitoredItems: ['temperature'],
    isStreaming: false
  })
}

function startPolling() {
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Start Polling' }))
}

describe('SubscriptionPanel session-bound callbacks', () => {
  it('rejects a delayed polling update after the transport is stopped', async () => {
    const poll = deferred<SyncResponseItem[]>()
    const client = createClient('https://server-a.test')
    vi.spyOn(client, 'sync').mockReturnValue(poll.promise)
    useConnectionStore.setState({ isConnected: true })
    addSubscription()
    render(<SubscriptionPanel />)

    startPolling()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await act(async () => {
      poll.resolve([{
        elementId: 'temperature',
        value: 42,
        quality: 'good',
        timestamp: '2026-01-01T00:00:00.000Z'
      }])
      await poll.promise
    })

    expect(useSubscriptionsStore.getState().liveValues.size).toBe(0)
    expect(useSubscriptionsStore.getState().subscriptions.get('sub-1')?.isStreaming).toBe(false)
  })

  it('does not recover an expired subscription through a replacement client session', async () => {
    const deletion = deferred<void>()
    const oldClient = createClient('https://server-a.test')
    vi.spyOn(oldClient, 'sync').mockRejectedValue(new HttpStatusError(410, 'Gone'))
    vi.spyOn(oldClient, 'deleteSubscription').mockReturnValue(deletion.promise)
    const createSubscription = vi.spyOn(oldClient, 'createSubscription')
    useConnectionStore.setState({ isConnected: true })
    addSubscription()
    render(<SubscriptionPanel />)

    startPolling()
    await waitFor(() => expect(oldClient.deleteSubscription).toHaveBeenCalledWith('sub-1'))

    createClient('https://server-b.test')
    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(createSubscription).not.toHaveBeenCalled()
    expect(useSubscriptionsStore.getState().subscriptions.has('sub-1')).toBe(true)
  })
})
