import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SyncResponseItem } from './types'
import { PollingSubscription, SSESubscription } from './subscription'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const item: SyncResponseItem = {
  elementId: 'temperature',
  value: 21,
  quality: 'good',
  timestamp: '2026-01-01T00:00:00.000Z'
}

describe('SSESubscription terminal runs', () => {
  it('clears a pending reconnect when disconnected', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }) })
      }
    } as unknown as Response)
    const subscription = new SSESubscription('https://server.test/stream', vi.fn(), vi.fn())

    subscription.connect()
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    subscription.disconnect()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('drops stream data that resolves after disconnect', async () => {
    const read = deferred<ReadableStreamReadResult<Uint8Array>>()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: () => read.promise }) }
    } as unknown as Response)
    const onData = vi.fn()
    const subscription = new SSESubscription('https://server.test/stream', onData, vi.fn())

    subscription.connect()
    await act(async () => { await Promise.resolve() })
    subscription.disconnect()
    await act(async () => {
      read.resolve({
        done: false,
        value: new TextEncoder().encode(`data: ${JSON.stringify([item])}\n`)
      })
      await read.promise
    })

    expect(onData).not.toHaveBeenCalled()
  })
})

describe('PollingSubscription terminal runs', () => {
  it('does not overlap slow polls', async () => {
    vi.useFakeTimers()
    const firstPoll = deferred<SyncResponseItem[]>()
    const sync = vi.fn(() => firstPoll.promise)
    const subscription = new PollingSubscription(sync, vi.fn(), vi.fn(), 1_000)

    subscription.start()
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(sync).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstPoll.resolve([])
      await firstPoll.promise
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(sync).toHaveBeenCalledTimes(2)
    subscription.stop()
  })

  it('aborts and suppresses data and errors from a stopped poll', async () => {
    const poll = deferred<SyncResponseItem[]>()
    let operationSignal: AbortSignal | undefined
    const onData = vi.fn()
    const onError = vi.fn()
    const subscription = new PollingSubscription(
      (signal) => {
        operationSignal = signal
        return poll.promise
      },
      onData,
      onError
    )

    subscription.start()
    subscription.stop()
    expect(operationSignal?.aborted).toBe(true)

    await act(async () => {
      poll.resolve([item])
      await poll.promise
    })
    expect(onData).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
