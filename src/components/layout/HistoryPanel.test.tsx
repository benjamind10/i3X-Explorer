import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../../api/client'
import type { HistoricalValue, ObjectInstance } from '../../api/types'
import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { HistoryPanel } from './HistoryPanel'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

const object = (elementId: string): ObjectInstance => ({
  elementId,
  displayName: elementId,
  typeId: 'type-1',
  parentId: null,
  isComposition: false,
  namespaceUri: 'urn:test'
})

const history = (elementId: string, content: string): HistoricalValue => ({
  elementId,
  value: [{ timestamp: '2026-09-02T12:00:00.000Z', value: content }],
  timestamp: '2026-09-02T12:00:00.000Z',
  parentId: null,
  namespaceUri: 'urn:test'
})

function select(elementId: string) {
  useExplorerStore.getState().selectItem({
    type: 'object',
    id: `obj:${elementId}`,
    data: object(elementId)
  })
}

describe('HistoryPanel request lifecycle', () => {
  it('rejects history from an older selection and clears its content immediately', async () => {
    const first = deferred<HistoricalValue>()
    const second = deferred<HistoricalValue>()
    const client = createClient('https://server.test')
    vi.spyOn(client, 'getHistory')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    useConnectionStore.setState({ isConnected: true })
    select('first')

    render(<HistoryPanel />)
    fireEvent.click(screen.getByText('History'))
    fireEvent.click(screen.getByRole('button', { name: 'Load History' }))

    act(() => select('second'))
    expect(screen.queryByText('stale-history')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load History' }))

    await act(async () => {
      first.resolve(history('first', 'stale-history'))
      await first.promise
    })
    expect(screen.queryByText('stale-history')).toBeNull()
    expect(screen.getByText('Loading history...')).toBeTruthy()

    await act(async () => {
      second.resolve(history('second', 'current-history'))
      await second.promise
    })
    expect(screen.getByText('current-history')).toBeTruthy()
  })

  it('keeps same-range data visible and disables duplicate reloads while updating', async () => {
    const initial = deferred<HistoricalValue>()
    const reload = deferred<HistoricalValue>()
    const client = createClient('https://server.test')
    vi.spyOn(client, 'getHistory')
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(reload.promise)
    useConnectionStore.setState({ isConnected: true })
    select('current')

    render(<HistoryPanel />)
    fireEvent.click(screen.getByText('History'))
    fireEvent.click(screen.getByRole('button', { name: 'Load History' }))
    await act(async () => {
      initial.resolve(history('current', 'existing-history'))
      await initial.promise
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(screen.getByText('existing-history')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Updating...' })).toHaveProperty('disabled', true)

    await act(async () => {
      reload.resolve(history('current', 'updated-history'))
      await reload.promise
    })
    expect(screen.getByText('updated-history')).toBeTruthy()
    expect(screen.queryByText('existing-history')).toBeNull()
  })
})
