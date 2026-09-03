import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../../api/client'
import type { ObjectInstance } from '../../api/types'
import { useConnectionStore } from '../../stores/connection'
import { SearchModal } from './SearchModal'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

const object = (elementId: string, displayName: string): ObjectInstance => ({
  elementId,
  displayName,
  typeId: 'type-1',
  parentId: null,
  isComposition: false,
  namespaceUri: 'urn:test'
})

describe('SearchModal request lifecycle', () => {
  it('debounces queries and lets only the latest request update results and loading', async () => {
    vi.useFakeTimers()
    const firstObjects = deferred<ObjectInstance[]>()
    const secondObjects = deferred<ObjectInstance[]>()
    const secondRoots = deferred<ObjectInstance[]>()
    const client = createClient('https://server.test')
    let objectRequestCount = 0
    const getObjects = vi.spyOn(client, 'getObjects').mockImplementation((_typeId, _metadata, root) => {
      if (root) return secondRoots.promise
      objectRequestCount++
      return objectRequestCount === 1 ? firstObjects.promise : secondObjects.promise
    })
    useConnectionStore.setState({ isConnected: true })

    render(<SearchModal onClose={vi.fn()} />)
    const input = screen.getByPlaceholderText(/Search objects/)

    fireEvent.change(input, { target: { value: 'alpha' } })
    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(getObjects).toHaveBeenCalledTimes(1)

    fireEvent.change(input, { target: { value: 'beta' } })
    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(getObjects).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Searching…')).toBeTruthy()

    await act(async () => {
      firstObjects.resolve([object('alpha-id', 'Alpha')])
      await firstObjects.promise
      await Promise.resolve()
    })
    expect(screen.getByText('Searching…')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()

    await act(async () => {
      secondObjects.resolve([object('beta-id', 'Beta')])
      await secondObjects.promise
      await Promise.resolve()
      secondRoots.resolve([])
      await secondRoots.promise
      await Promise.resolve()
    })

    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.queryByText('Searching…')).toBeNull()
  })
})
