import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { destroyClient } from '../api/client'
import { useConnectionStore } from '../stores/connection'
import { useExplorerStore } from '../stores/explorer'
import { useSubscriptionsStore } from '../stores/subscriptions'

window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true
})

window.electronAPI = {
  platform: 'linux',
  versions: { node: '', chrome: '', electron: '' },
  encryptString: vi.fn(async () => null),
  decryptString: vi.fn(async () => null),
  openDevTools: vi.fn(async () => undefined),
  setIgnoreCertErrors: vi.fn(),
  onAppBeforeQuit: vi.fn(() => () => undefined),
  notifyCleanupDone: vi.fn()
}

afterEach(() => {
  cleanup()
  destroyClient()
  useConnectionStore.setState({
    serverUrl: 'https://api.i3x.dev/v1',
    credentials: null,
    savedCredentials: {},
    isConnected: false,
    isConnecting: false,
    error: null,
    showConnectionDialog: false,
    recentUrls: ['https://api.i3x.dev/v1', 'http://localhost:8080'],
    ignoreCertErrors: false,
    sessionGeneration: 0
  })
  useExplorerStore.getState().reset()
  useSubscriptionsStore.getState().clearAll()
  localStorage.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
