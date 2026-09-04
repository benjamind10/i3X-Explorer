import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../../api/client'
import type { LastKnownValue, ObjectInstance } from '../../api/types'
import { useConnectionStore } from '../../stores/connection'
import { ObjectDetail } from './ObjectDetail'

vi.mock('./RelationshipGraph', () => ({ RelationshipGraph: () => null }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

const object = (elementId: string): ObjectInstance => ({
  elementId,
  displayName: `Object ${elementId}`,
  typeId: 'type-1',
  parentId: null,
  isComposition: false,
  namespaceUri: 'urn:test'
})

const value = (elementId: string, content: string): LastKnownValue => ({
  elementId,
  value: content as unknown as Record<string, unknown>,
  parentId: null,
  namespaceUri: 'urn:test'
})

describe('ObjectDetail value lifecycle', () => {
  it('clears switched context and accepts only the latest selected object value', async () => {
    const first = deferred<LastKnownValue | null>()
    const second = deferred<LastKnownValue | null>()
    const client = createClient('https://server.test')
    vi.spyOn(client, 'getValue')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    useConnectionStore.setState({ isConnected: true })

    const view = render(<ObjectDetail object={object('first')} />)
    expect(screen.getByText('Loading value...')).toBeTruthy()

    view.rerender(<ObjectDetail object={object('second')} />)
    expect(screen.getByText('Loading value...')).toBeTruthy()

    await act(async () => {
      first.resolve(value('first', 'stale-value'))
      await first.promise
    })
    expect(screen.queryByText('stale-value')).toBeNull()
    expect(screen.getByText('Loading value...')).toBeTruthy()

    await act(async () => {
      second.resolve(value('second', 'current-value'))
      await second.promise
    })
    expect(screen.getByText('current-value')).toBeTruthy()
  })

  it('retains current content and disables refresh while updating', async () => {
    const initial = deferred<LastKnownValue | null>()
    const refresh = deferred<LastKnownValue | null>()
    const client = createClient('https://server.test')
    vi.spyOn(client, 'getValue')
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refresh.promise)
    useConnectionStore.setState({ isConnected: true })

    render(<ObjectDetail object={object('current')} />)
    await act(async () => {
      initial.resolve(value('current', 'existing-value'))
      await initial.promise
    })

    const refreshButton = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.click(refreshButton)
    expect(screen.getByText('existing-value')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Updating...' })).toHaveProperty('disabled', true)

    await act(async () => {
      refresh.resolve(value('current', 'updated-value'))
      await refresh.promise
    })
    expect(screen.getByText('updated-value')).toBeTruthy()
    expect(screen.queryByText('existing-value')).toBeNull()
  })
})
