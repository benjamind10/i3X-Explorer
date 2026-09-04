import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../../api/client'
import type { ObjectInstance } from '../../api/types'
import { useExplorerStore } from '../../stores/explorer'
import { refreshAllObjects, resolveCompositionFlags } from './treeData'

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

describe('tree data session isolation', () => {
  it('coalesces full-object refreshes only within one client', async () => {
    const request = deferred<ObjectInstance[]>()
    const client = createClient('https://server.test')
    const getObjects = vi.spyOn(client, 'getObjects').mockReturnValue(request.promise)

    const firstRefresh = refreshAllObjects(client, true)
    const secondRefresh = refreshAllObjects(client, true)

    expect(getObjects).toHaveBeenCalledTimes(1)
    request.resolve([object('shared-result')])
    await Promise.all([firstRefresh, secondRefresh])

    expect(useExplorerStore.getState().allObjects.map(item => item.elementId)).toEqual(['shared-result'])
  })

  it('does not share or commit a full-object request across replaced clients', async () => {
    const firstRequest = deferred<ObjectInstance[]>()
    const secondRequest = deferred<ObjectInstance[]>()
    const firstClient = createClient('https://first.test')
    const firstGetObjects = vi.spyOn(firstClient, 'getObjects').mockReturnValue(firstRequest.promise)
    const firstRefresh = refreshAllObjects(firstClient, true)

    const secondClient = createClient('https://second.test')
    const secondGetObjects = vi.spyOn(secondClient, 'getObjects').mockReturnValue(secondRequest.promise)
    const secondRefresh = refreshAllObjects(secondClient, true)

    expect(firstGetObjects).toHaveBeenCalledTimes(1)
    expect(secondGetObjects).toHaveBeenCalledTimes(1)

    secondRequest.resolve([object('second-object')])
    await secondRefresh
    firstRequest.resolve([object('first-object')])
    await firstRefresh

    expect(useExplorerStore.getState().allObjects.map(item => item.elementId)).toEqual(['second-object'])
  })

  it('rejects composition counts resolved by a replaced client', async () => {
    const relatedRequest = deferred<Map<string, ObjectInstance[]>>()
    const firstClient = createClient('https://first.test')
    vi.spyOn(firstClient, 'getRelatedObjectsBatch').mockReturnValue(relatedRequest.promise)
    const parent = { ...object('parent'), isComposition: true }
    const resolution = resolveCompositionFlags(firstClient, [parent])

    createClient('https://second.test')
    useExplorerStore.setState({ compositionCache: new Map([['second-parent', 2]]) })
    relatedRequest.resolve(new Map([['parent', [{
      ...object('child'),
      parentId: 'parent',
      isComposition: true
    }]]]))
    await resolution

    expect(Array.from(useExplorerStore.getState().compositionCache.entries())).toEqual([['second-parent', 2]])
  })
})
