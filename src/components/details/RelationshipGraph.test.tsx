import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../../api/client'
import type { ObjectInstance } from '../../api/types'
import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { RelationshipGraph } from './RelationshipGraph'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

const object = (elementId: string, displayName = elementId): ObjectInstance => ({
  elementId,
  displayName,
  typeId: 'type-1',
  parentId: null,
  isComposition: false,
  namespaceUri: 'urn:test'
})

describe('RelationshipGraph request lifecycle', () => {
  it('rejects relationships from an older selected object', async () => {
    const first = deferred<ObjectInstance[]>()
    const second = deferred<ObjectInstance[]>()
    const client = createClient('https://server.test')
    vi.spyOn(client, 'getRelatedObjects')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    useConnectionStore.setState({ isConnected: true })

    const view = render(<RelationshipGraph object={object('first')} />)
    view.rerender(<RelationshipGraph object={object('second')} />)

    await act(async () => {
      first.resolve([object('stale-related', 'Stale Related')])
      await first.promise
    })
    expect(screen.queryByText('Stale Related')).toBeNull()
    expect(screen.getByText('Loading relationships...')).toBeTruthy()

    await act(async () => {
      second.resolve([object('current-related', 'Current Related')])
      await second.promise
    })
    expect(screen.getByText('Current Related')).toBeTruthy()
  })

  it('lets only the latest graph navigation expand and select', async () => {
    const firstTarget = deferred<ObjectInstance>()
    const secondTarget = deferred<ObjectInstance>()
    const client = createClient('https://server.test')
    vi.spyOn(client, 'getRelatedObjects').mockResolvedValue([
      object('target-a', 'Target A'),
      object('target-b', 'Target B')
    ])
    vi.spyOn(client, 'getObject')
      .mockReturnValueOnce(firstTarget.promise)
      .mockReturnValueOnce(secondTarget.promise)
    useConnectionStore.setState({ isConnected: true })
    useExplorerStore.setState({
      allObjects: [object('unrelated')],
      hierarchicalRoots: [object('root')]
    })

    render(<RelationshipGraph object={object('source', 'Source')} />)
    await screen.findByText('Target A')
    fireEvent.click(screen.getByText('Target A'))
    fireEvent.click(screen.getByText('Target B'))

    await act(async () => {
      secondTarget.resolve(object('target-b', 'Target B'))
      await secondTarget.promise
    })
    expect(useExplorerStore.getState().selectedItem?.id).toBe('hier:target-b')

    await act(async () => {
      firstTarget.resolve(object('target-a', 'Target A'))
      await firstTarget.promise
    })
    expect(useExplorerStore.getState().selectedItem?.id).toBe('hier:target-b')
  })
})
