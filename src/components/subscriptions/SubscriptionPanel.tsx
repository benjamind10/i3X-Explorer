import { useCallback, useEffect, useRef, useState } from 'react'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { useConnectionStore } from '../../stores/connection'
import { getClient, type I3XClient } from '../../api/client'
import { SSESubscription, PollingSubscription, HttpStatusError, isSubscriptionGoneError } from '../../api/subscription'
import { captureSession, isAbortError, type SessionContext } from '../../session'
import { TrendView } from './TrendView'
import type { SyncResponseItem } from '../../api/types'

export function SubscriptionPanel() {
  const {
    subscriptions,
    liveValues,
    activeSubscriptionId,
    setActiveSubscription,
    addSubscription,
    removeSubscription,
    removeMonitoredItem,
    updateLiveValue,
    setStreaming,
    clearAll
  } = useSubscriptionsStore()

  const isConnected = useConnectionStore((state) => state.isConnected)

  const sseRef = useRef<SSESubscription | null>(null)
  const pollingRef = useRef<PollingSubscription | null>(null)
  const recoveryAttemptsRef = useRef(0)
  const transportRunRef = useRef(0)
  const [usePolling, setUsePolling] = useState(false) // Default to SSE streaming

  const stopTransports = useCallback(() => {
    sseRef.current?.disconnect()
    sseRef.current = null
    pollingRef.current?.stop()
    pollingRef.current = null
  }, [])

  const invalidateTransportRun = useCallback(() => {
    transportRunRef.current++
    stopTransports()
  }, [stopTransports])

  const acceptsTransportRun = (session: SessionContext, runGeneration: number) =>
    session.isCurrent() && transportRunRef.current === runGeneration

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      invalidateTransportRun()
    }
  }, [invalidateTransportRun])

  // Cleanup when disconnected from server
  useEffect(() => {
    if (!isConnected) {
      invalidateTransportRun()
      clearAll()
    }
  }, [isConnected, clearAll, invalidateTransportRun])

  const handleDataUpdate = (
    items: SyncResponseItem[],
    session: SessionContext,
    runGeneration: number
  ) => {
    if (!acceptsTransportRun(session, runGeneration)) return
    recoveryAttemptsRef.current = 0
    items.forEach((item) => {
      if (!acceptsTransportRun(session, runGeneration)) return
      updateLiveValue({
        elementId: item.elementId,
        displayName: item.elementId,
        value: item.value,
        timestamp: item.timestamp,
        quality: item.quality,
        lastUpdated: Date.now()
      })
    })
  }

  const handleRecovery = async (
    oldSubscriptionId: string,
    client: I3XClient,
    session: SessionContext,
    runGeneration: number
  ) => {
    if (!acceptsTransportRun(session, runGeneration)) return
    if (recoveryAttemptsRef.current >= 3) {
      console.warn(`Subscription ${oldSubscriptionId} recovery aborted after 3 attempts`)
      if (acceptsTransportRun(session, runGeneration)) setStreaming(oldSubscriptionId, false)
      return
    }
    recoveryAttemptsRef.current++
    console.warn(`Subscription ${oldSubscriptionId} expired on server, recovering (attempt ${recoveryAttemptsRef.current})...`)

    const { subscriptions: currentSubs } = useSubscriptionsStore.getState()
    const oldSub = currentSubs.get(oldSubscriptionId)
    const monitoredItems = oldSub?.monitoredItems ?? []

    // Best-effort delete on the server — the subscription is likely already gone (404/410)
    // but this cleans up the clientId entry from the client-side map.
    try { await client.deleteSubscription(oldSubscriptionId) } catch { /* already gone */ }
    if (!acceptsTransportRun(session, runGeneration)) return

    try {
      const { subscriptionId: newId } = await client.createSubscription()
      if (!acceptsTransportRun(session, runGeneration)) return
      if (monitoredItems.length > 0) {
        await client.registerMonitoredItems(newId, monitoredItems)
      }
      if (!acceptsTransportRun(session, runGeneration)) return
      monitoredItems.forEach((elementId) => {
        removeMonitoredItem(oldSubscriptionId, elementId)
      })
      removeSubscription(oldSubscriptionId)
      addSubscription({
        id: newId,
        createdAt: new Date().toISOString(),
        monitoredItems,
        isStreaming: false
      })
      setActiveSubscription(newId)
      startTransport(newId, client)
    } catch (err) {
      if (acceptsTransportRun(session, runGeneration) && !isAbortError(err)) {
        console.error('Subscription recovery failed:', err)
      }
    }
  }

  // 1.0 Release servers declare streaming support in /info capabilities;
  // when it's false the stream endpoint returns 501 and polling is the only transport.
  const isStreamUnsupported = (client: I3XClient): boolean =>
    client.getApiVersion() === 'v1' && client.getCapabilities()?.subscribe?.stream === false

  const startPolling = (
    subscriptionId: string,
    client: I3XClient,
    session: SessionContext,
    runGeneration: number
  ) => {
    if (!acceptsTransportRun(session, runGeneration)) return
    pollingRef.current?.stop()
    // Use polling (QoS2) - more reliable, works with CORS
    pollingRef.current = new PollingSubscription(
      (signal) => client.sync(subscriptionId, signal),
      (items) => handleDataUpdate(items, session, runGeneration),
      (error) => {
        if (!acceptsTransportRun(session, runGeneration)) return
        if (isSubscriptionGoneError(error)) {
          void handleRecovery(subscriptionId, client, session, runGeneration)
        } else {
          console.error('Polling error:', error)
          setStreaming(subscriptionId, false)
        }
      },
      2000 // Poll every 2 seconds
    )
    pollingRef.current.start()
  }

  const startTransport = (subscriptionId: string, client: I3XClient) => {
    invalidateTransportRun()
    const runGeneration = transportRunRef.current
    const session = captureSession(client)
    if (!acceptsTransportRun(session, runGeneration)) return

    const isRelease = client.getApiVersion() === 'v1'

    if (usePolling || isStreamUnsupported(client)) {
      if (!usePolling && acceptsTransportRun(session, runGeneration)) setUsePolling(true)
      startPolling(subscriptionId, client, session, runGeneration)
    } else {
      // Use SSE (QoS0) - real-time but may have CORS issues
      // v0: GET /subscriptions/{id}/stream  v1: POST /subscriptions/stream
      const streamConfig = client.getStreamConfig(subscriptionId)
      sseRef.current = new SSESubscription(
        streamConfig.url,
        (items) => handleDataUpdate(items, session, runGeneration),
        (error) => {
          if (!acceptsTransportRun(session, runGeneration)) return
          if (isSubscriptionGoneError(error)) {
            void handleRecovery(subscriptionId, client, session, runGeneration)
          } else if (isRelease && error instanceof HttpStatusError && error.status === 501) {
            // 1.0: 501 = streaming permanently unsupported — fall back to polling
            console.warn('Server does not support SSE streaming (HTTP 501), falling back to polling')
            setUsePolling(true)
            sseRef.current?.disconnect()
            sseRef.current = null
            startPolling(subscriptionId, client, session, runGeneration)
          } else {
            console.error('SSE error:', error)
            setStreaming(subscriptionId, false)
          }
        },
        client.getCredentials(),
        streamConfig.postBody,
        // 1.0: 501 is permanent; don't burn reconnect attempts on it
        isRelease ? [501] : []
      )
      sseRef.current.connect()
    }

    if (acceptsTransportRun(session, runGeneration)) setStreaming(subscriptionId, true)
  }

  const handleStartStream = (subscriptionId: string) => {
    const client = getClient()
    if (client) startTransport(subscriptionId, client)
  }

  const handleStopStream = (subscriptionId: string) => {
    const client = getClient()
    const session = client ? captureSession(client) : null
    invalidateTransportRun()
    if (session?.isCurrent()) setStreaming(subscriptionId, false)
  }

  const handleDelete = async (subscriptionId: string) => {
    const client = getClient()
    if (!client) return
    const session = captureSession(client)

    invalidateTransportRun()

    try {
      if (session.isCurrent()) removeSubscription(subscriptionId)
      await client.deleteSubscription(subscriptionId)
    } catch (err) {
      if (session.isCurrent() && !isAbortError(err)) {
        console.error('Failed to delete subscription:', err)
      }
    }
  }

  const connectedClient = getClient()
  const streamUnsupported = connectedClient ? isStreamUnsupported(connectedClient) : false

  const subscriptionList = Array.from(subscriptions.values())

  if (subscriptionList.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-i3x-text-muted text-sm">
        No active subscriptions. Select an object and click "Subscribe" to start monitoring.
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="flex gap-4">
        {/* Subscription list */}
        <div className="w-48 space-y-2">
          <h3 className="text-xs font-medium text-i3x-text-muted uppercase">Subscriptions</h3>
          {subscriptionList.map((sub) => (
            <div
              key={sub.id}
              className={`p-2 rounded cursor-pointer transition-colors ${
                activeSubscriptionId === sub.id
                  ? 'bg-i3x-primary/20 border border-i3x-primary'
                  : 'bg-i3x-bg hover:bg-i3x-border'
              }`}
              onClick={() => setActiveSubscription(sub.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-i3x-text truncate">#{sub.id}</span>
                <div className="flex items-center gap-1">
                  {sub.isStreaming && (
                    <span className="w-2 h-2 rounded-full bg-i3x-success animate-pulse" />
                  )}
                </div>
              </div>
              <div className="text-xs text-i3x-text-muted mt-1">
                {sub.monitoredItems.length} items
              </div>
            </div>
          ))}
        </div>

        {/* Active subscription details */}
        {activeSubscriptionId && subscriptions.get(activeSubscriptionId) && (
          <div className="flex-1 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-i3x-text">
                Subscription #{activeSubscriptionId}
              </h3>
              <div className="flex items-center gap-2">
                {/* Polling/SSE toggle */}
                <label
                  className="flex items-center gap-1 text-xs text-i3x-text-muted"
                  title={streamUnsupported ? 'This server does not support SSE streaming (capabilities.subscribe.stream = false)' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={usePolling || streamUnsupported}
                    onChange={(e) => setUsePolling(e.target.checked)}
                    disabled={subscriptions.get(activeSubscriptionId)?.isStreaming || streamUnsupported}
                    className="w-3 h-3"
                  />
                  Poll
                </label>
                {!subscriptions.get(activeSubscriptionId)?.isStreaming ? (
                  <button
                    onClick={() => handleStartStream(activeSubscriptionId)}
                    className="px-3 py-1 text-xs bg-i3x-success/20 text-i3x-success rounded hover:bg-i3x-success/30 transition-colors"
                  >
                    Start {usePolling || streamUnsupported ? 'Polling' : 'Stream'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleStopStream(activeSubscriptionId)}
                    className="px-3 py-1 text-xs bg-i3x-warning/20 text-i3x-warning rounded hover:bg-i3x-warning/30 transition-colors"
                  >
                    Stop
                  </button>
                )}
                <button
                  onClick={() => handleDelete(activeSubscriptionId)}
                  className="px-3 py-1 text-xs bg-i3x-error/20 text-i3x-error rounded hover:bg-i3x-error/30 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Live values */}
            <div className="grid grid-cols-2 gap-2 max-h-32 overflow-auto">
              {subscriptions.get(activeSubscriptionId)?.monitoredItems.map((elementId) => {
                const liveValue = liveValues.get(elementId)
                return (
                  <div
                    key={elementId}
                    className="p-2 bg-i3x-bg rounded text-xs"
                  >
                    <div className="text-i3x-text-muted truncate mb-1" title={elementId}>
                      {elementId}
                    </div>
                    {liveValue ? (
                      <div className="text-i3x-text">
                        <span className="font-mono">
                          {typeof liveValue.value === 'object'
                            ? JSON.stringify(liveValue.value).slice(0, 50)
                            : String(liveValue.value)}
                        </span>
                        {liveValue.timestamp && (
                          <span className="text-i3x-text-muted ml-2">
                            {new Date(liveValue.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-i3x-text-muted">Waiting...</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Trend views for numeric values */}
            <div className="flex flex-wrap gap-2 mt-2">
              {subscriptions.get(activeSubscriptionId)?.monitoredItems.map((elementId) => {
                const liveValue = liveValues.get(elementId)
                // Only show trend for numeric values
                const isNumeric = liveValue && (
                  typeof liveValue.value === 'number' ||
                  !isNaN(parseFloat(String(liveValue.value)))
                )
                if (!isNumeric) return null
                return (
                  <div key={`trend-${elementId}`} className="flex flex-col">
                    <span className="text-xs text-i3x-text-muted mb-1 truncate max-w-[400px]" title={elementId}>
                      {elementId}
                    </span>
                    <TrendView elementId={elementId} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
