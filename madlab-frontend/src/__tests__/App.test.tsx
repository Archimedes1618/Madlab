import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  readyState = 0

  constructor() {
    MockWebSocket.instances.push(this)
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }

  send = vi.fn()
}

// Mock child components to isolate App tests
vi.mock('../components/InstillationsPanel', () => ({
  InstillationsPanel: () => <div data-testid="instillations">Instillations</div>
}))
vi.mock('../components/TrainingPanel', () => ({
  TrainingPanel: () => <div data-testid="training">Training</div>
}))
vi.mock('../components/MonitoringPanel', () => ({
  MonitoringPanel: () => <div data-testid="monitoring">Monitoring</div>
}))
vi.mock('../components/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat">Chat</div>
}))

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    MockWebSocket.instances = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders header with title', async () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Madlab' })).toBeInTheDocument()
  })

  it('shows chat tab by default', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByTestId('chat')).toBeInTheDocument()
    })
  })

  it('switches tabs on click', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Instillations' }))
    expect(screen.getByTestId('instillations')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Training' }))
    expect(screen.getByTestId('training')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Monitoring' }))
    expect(screen.getByTestId('monitoring')).toBeInTheDocument()
  })

  it('creates WebSocket connection on mount', async () => {
    render(<App />)
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
  })

  it('logs connection status', async () => {
    render(<App />)
    await waitFor(() => {
      expect(console.log).toHaveBeenCalledWith('App: WebSocket Connected')
    })
  })
})

describe('WebSocket reconnection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    MockWebSocket.instances = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('attempts reconnect with exponential backoff after disconnect', async () => {
    render(<App />)

    // Wait for initial connection
    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    // Simulate disconnect
    MockWebSocket.instances[0].close()

    // Should schedule reconnect after 1s (2^0 * 1000)
    vi.advanceTimersByTime(1000)
    expect(MockWebSocket.instances.length).toBe(2)
  })
})
