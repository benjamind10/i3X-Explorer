import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClient, getClient, I3XClient } from '../../api/client'
import type { ObjectInstance } from '../../api/types'
import { endActiveSession } from '../../session'
import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { Toolbar } from './Toolbar'

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

describe('Toolbar connection lifecycle', () => {
  it('rejects completion from a replaced connection attempt', async () => {
    const connectionResult = deferred<boolean>()
    vi.spyOn(I3XClient.prototype, 'testConnection').mockReturnValue(connectionResult.promise)
    useConnectionStore.setState({ serverUrl: 'https://first.test' })

    render(<Toolbar />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const first = getClient()
    expect(first).not.toBeNull()

    await endActiveSession('disconnect')
    const second = createClient('https://second.test')
    connectionResult.resolve(true)

    await waitFor(() => expect(useConnectionStore.getState().isConnecting).toBe(false))
    expect(getClient()).toBe(second)
    expect(useConnectionStore.getState().isConnected).toBe(false)
    expect(useExplorerStore.getState().namespaces).toEqual([])
    expect(screen.getByText('Disconnected')).toBeTruthy()
  })

  it('rejects stale object prefetches after the session ends', async () => {
    const allObjects = deferred<ObjectInstance[]>()
    const roots = deferred<ObjectInstance[]>()
    vi.spyOn(I3XClient.prototype, 'testConnection').mockResolvedValue(true)
    vi.spyOn(I3XClient.prototype, 'getApiVersion').mockReturnValue('v1')
    vi.spyOn(I3XClient.prototype, 'getNamespaces').mockResolvedValue([{ uri: 'urn:first', displayName: 'First' }])
    vi.spyOn(I3XClient.prototype, 'getObjectTypes').mockResolvedValue([{
      elementId: 'type-1',
      displayName: 'Type',
      namespaceUri: 'urn:first',
      schema: {}
    }])
    vi.spyOn(I3XClient.prototype, 'getObjects').mockImplementation((_typeId, _metadata, root) => (
      root ? roots.promise : allObjects.promise
    ))
    useConnectionStore.setState({ serverUrl: 'https://first.test' })

    render(<Toolbar />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(useConnectionStore.getState().isConnected).toBe(true))
    await waitFor(() => expect(useExplorerStore.getState().namespaces).toHaveLength(1))

    await endActiveSession('disconnect')
    createClient('https://second.test')
    useExplorerStore.getState().setAllObjects([object('second-object')])
    useExplorerStore.getState().setHierarchicalRoots([object('second-root')])

    allObjects.resolve([object('first-object')])
    roots.resolve([object('first-root')])
    await Promise.resolve()
    await Promise.resolve()

    expect(useExplorerStore.getState().allObjects.map(item => item.elementId)).toEqual(['second-object'])
    expect(useExplorerStore.getState().hierarchicalRoots.map(item => item.elementId)).toEqual(['second-root'])
  })
})
