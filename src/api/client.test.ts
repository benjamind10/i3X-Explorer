import { describe, expect, it, vi } from 'vitest'
import { createClient, destroyClient, getClient, isCurrentClient } from './client'

describe('I3XClient session lifecycle', () => {
  it('aborts ordinary requests when the singleton is replaced', async () => {
    let requestSignal: AbortSignal | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestSignal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })

    const first = createClient('https://first.test/')
    const request = first.getNamespaces()
    const second = createClient('https://second.test')

    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.isActive()).toBe(false)
    expect(requestSignal?.aborted).toBe(true)
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not let an old client destroy its replacement', () => {
    const first = createClient('https://first.test')
    const second = createClient('https://second.test')

    destroyClient(first)

    expect(getClient()).toBe(second)
    expect(isCurrentClient(second)).toBe(true)
  })
})
