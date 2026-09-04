import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../../api/client'
import type { Namespace } from '../../api/types'
import { endActiveSession } from '../../session'
import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { TreeView } from './TreeView'

vi.mock('./TreeNode', () => ({
  TreeNode: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('./VirtualObjectRows', () => ({
  VirtualObjectRows: () => null
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

describe('TreeView refresh lifecycle', () => {
  it('rejects catalog writes from a refresh owned by an ended session', async () => {
    const namespaces = deferred<Namespace[]>()
    const firstClient = createClient('https://first.test')
    vi.spyOn(firstClient, 'getNamespaces').mockReturnValue(namespaces.promise)
    vi.spyOn(firstClient, 'getObjectTypes').mockResolvedValue([])
    useConnectionStore.setState({ isConnected: true })

    render(<TreeView />)
    act(() => useExplorerStore.getState().triggerManualRefresh())
    await waitFor(() => expect(firstClient.getNamespaces).toHaveBeenCalledTimes(1))

    await endActiveSession('disconnect')
    createClient('https://second.test')
    useExplorerStore.setState({
      namespaces: [{ uri: 'urn:second', displayName: 'Second' }],
      objectTypes: [{
        elementId: 'second-type',
        displayName: 'Second Type',
        namespaceUri: 'urn:second',
        schema: {}
      }]
    })

    await act(async () => {
      namespaces.resolve([{ uri: 'urn:first', displayName: 'First' }])
      await namespaces.promise
      await Promise.resolve()
    })

    expect(useExplorerStore.getState().namespaces.map(item => item.uri)).toEqual(['urn:second'])
    expect(useExplorerStore.getState().objectTypes.map(item => item.elementId)).toEqual(['second-type'])
  })
})
