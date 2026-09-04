import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createClient, getClient } from '../../api/client'
import { useConnectionStore } from '../../stores/connection'
import { ConnectionDialog } from './ConnectionDialog'

describe('ConnectionDialog session behavior', () => {
  it('keeps the active session when normalized settings are equivalent', () => {
    useConnectionStore.setState({
      serverUrl: 'https://server.test/',
      isConnected: true,
      showConnectionDialog: true
    })
    const client = createClient('https://server.test')

    render(<ConnectionDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(getClient()).toBe(client)
    expect(client.isActive()).toBe(true)
    expect(useConnectionStore.getState()).toMatchObject({
      serverUrl: 'https://server.test',
      isConnected: true,
      sessionGeneration: 0
    })
  })

  it('ends the active session when effective settings change and preserves the profile', () => {
    useConnectionStore.setState({
      serverUrl: 'https://server.test',
      isConnected: true,
      showConnectionDialog: true
    })
    const client = createClient('https://server.test')

    render(<ConnectionDialog />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bearer' } })
    fireEvent.change(screen.getByPlaceholderText('paste your bearer token'), { target: { value: 'new-token' } })
    fireEvent.click(screen.getByLabelText('Ignore certificate errors (eg: self-signed)'))
    fireEvent.change(screen.getByPlaceholderText('https://i3x.example.com'), {
      target: { value: 'https://other.test/' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const state = useConnectionStore.getState()
    expect(getClient()).toBeNull()
    expect(client.isActive()).toBe(false)
    expect(state).toMatchObject({
      serverUrl: 'https://other.test',
      credentials: { type: 'bearer', token: 'new-token' },
      isConnected: false,
      ignoreCertErrors: true,
      sessionGeneration: 1,
      showConnectionDialog: false
    })
    expect(state.savedCredentials['https://other.test']).toEqual({ type: 'bearer', token: 'new-token' })
  })
})
