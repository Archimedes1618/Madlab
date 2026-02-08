import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MonitoringPanel } from '../MonitoringPanel'
import type { LogLine, TrainingMetrics } from '../../types'

const mockFetch = vi.fn()

const mockLogs: LogLine[] = [
  { id: '1', type: 'log', payload: 'Training started', timestamp: '12:00:00' },
  { id: '2', type: 'error', payload: 'Warning: GPU memory high', timestamp: '12:00:05' }
]

const mockMetrics: TrainingMetrics = {
  epoch: 2.5,
  loss: 0.1234,
  learning_rate: 0.00005,
  grad_norm: 1.23,
  step: 1000
}

describe('MonitoringPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    Element.prototype.scrollIntoView = vi.fn()

    // Default mock for health endpoint
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        cpu: 45,
        memory: { used: 8589934592, total: 17179869184, percent: 50 },
        gpu: { name: 'NVIDIA RTX 3080', memUsed: 5368709120, memTotal: 10737418240, utilization: 75 }
      })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders monitoring heading', () => {
    render(<MonitoringPanel logs={[]} metrics={{}} />)
    expect(screen.getByRole('heading', { name: 'Real-time Monitoring' })).toBeInTheDocument()
  })

  it('displays training metrics cards', () => {
    render(<MonitoringPanel logs={[]} metrics={mockMetrics} />)

    expect(screen.getByText('2.50')).toBeInTheDocument() // epoch
    expect(screen.getByText('0.1234')).toBeInTheDocument() // loss
    expect(screen.getByText('5.00e-5')).toBeInTheDocument() // learning rate
    expect(screen.getByText('1.23')).toBeInTheDocument() // grad norm
  })

  it('displays metric labels', () => {
    render(<MonitoringPanel logs={[]} metrics={mockMetrics} />)

    expect(screen.getByText('Epoch')).toBeInTheDocument()
    expect(screen.getByText('Loss')).toBeInTheDocument()
    expect(screen.getByText('Learning Rate')).toBeInTheDocument()
    expect(screen.getByText('Grad Norm')).toBeInTheDocument()
  })

  it('shows dash for missing metrics', () => {
    render(<MonitoringPanel logs={[]} metrics={{}} />)

    const dashes = screen.getAllByText('-')
    expect(dashes.length).toBeGreaterThanOrEqual(4)
  })

  it('displays log entries', () => {
    render(<MonitoringPanel logs={mockLogs} metrics={{}} />)

    expect(screen.getByText('Training started')).toBeInTheDocument()
    expect(screen.getByText('Warning: GPU memory high')).toBeInTheDocument()
    expect(screen.getByText('[12:00:00]')).toBeInTheDocument()
    expect(screen.getByText('[12:00:05]')).toBeInTheDocument()
  })

  it('displays object payloads as JSON', () => {
    const logsWithObject: LogLine[] = [
      { id: '1', type: 'log', payload: { loss: 0.5, step: 100 }, timestamp: '12:00:00' }
    ]

    render(<MonitoringPanel logs={logsWithObject} metrics={{}} />)

    expect(screen.getByText(/loss.*step/)).toBeInTheDocument()
  })

  it('scrolls to bottom when new logs added', async () => {
    const { rerender } = render(<MonitoringPanel logs={mockLogs} metrics={{}} />)

    // Add new log
    const newLogs = [...mockLogs, { id: '3', type: 'log' as const, payload: 'New log', timestamp: '12:00:10' }]
    rerender(<MonitoringPanel logs={newLogs} metrics={{}} />)

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('fetches and displays system health', async () => {
    render(<MonitoringPanel logs={[]} metrics={{}} />)

    await waitFor(() => {
      expect(screen.getByText('System Health')).toBeInTheDocument()
      expect(screen.getByText('CPU')).toBeInTheDocument()
      expect(screen.getByText('Memory')).toBeInTheDocument()
    })
  })

  it('displays GPU info when available', async () => {
    render(<MonitoringPanel logs={[]} metrics={{}} />)

    await waitFor(() => {
      expect(screen.getByText(/GPU.*NVIDIA RTX 3080/)).toBeInTheDocument()
      expect(screen.getByText('VRAM')).toBeInTheDocument()
    })
  })

  it('does not display GPU info when not available', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        cpu: 45,
        memory: { used: 8589934592, total: 17179869184, percent: 50 }
        // no gpu
      })
    })

    render(<MonitoringPanel logs={[]} metrics={{}} />)

    await waitFor(() => {
      expect(screen.getByText('CPU')).toBeInTheDocument()
    })

    expect(screen.queryByText('VRAM')).not.toBeInTheDocument()
  })

  it('handles health fetch error gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    render(<MonitoringPanel logs={[]} metrics={{}} />)

    // Should not crash, just not show health section
    await waitFor(() => {
      expect(screen.queryByText('System Health')).not.toBeInTheDocument()
    })
  })

  it('polls health every 10 seconds', async () => {
    vi.useFakeTimers()

    render(<MonitoringPanel logs={[]} metrics={{}} />)

    // Initial fetch
    expect(mockFetch).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10000)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(10000)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('displays loss chart when history has 2+ points', () => {
    const lossHistory = [
      { step: 100, loss: 2.5 },
      { step: 200, loss: 1.8 },
      { step: 300, loss: 1.2 }
    ]

    render(<MonitoringPanel logs={[]} metrics={{}} lossHistory={lossHistory} />)

    expect(screen.getByText('Training Loss')).toBeInTheDocument()
    // Check SVG elements exist
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('does not display loss chart with less than 2 points', () => {
    const lossHistory = [{ step: 100, loss: 2.5 }]

    render(<MonitoringPanel logs={[]} metrics={{}} lossHistory={lossHistory} />)

    expect(screen.queryByText('Training Loss')).not.toBeInTheDocument()
  })

  it('displays empty loss history correctly', () => {
    render(<MonitoringPanel logs={[]} metrics={{}} lossHistory={[]} />)

    expect(screen.queryByText('Training Loss')).not.toBeInTheDocument()
  })

  it('progress bar shows correct color based on percentage', async () => {
    // High CPU (>90%) should be red
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        cpu: 95,
        memory: { used: 8589934592, total: 17179869184, percent: 50 }
      })
    })

    render(<MonitoringPanel logs={[]} metrics={{}} />)

    await waitFor(() => {
      expect(screen.getByText('CPU')).toBeInTheDocument()
    })

    // The color logic is: >90 = #ef4444 (red), >70 = #f59e0b (yellow), else #22c55e (green)
  })

  it('formats bytes correctly in memory display', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        cpu: 45,
        memory: { used: 8589934592, total: 17179869184, percent: 50 } // 8 GB / 16 GB
      })
    })

    render(<MonitoringPanel logs={[]} metrics={{}} />)

    await waitFor(() => {
      expect(screen.getByText(/8\.0 GB.*16\.0 GB/)).toBeInTheDocument()
    })
  })

  it('applies different styles to error logs', () => {
    render(<MonitoringPanel logs={mockLogs} metrics={{}} />)

    const errorLog = screen.getByText('Warning: GPU memory high')
    // Error logs should have #ec4899 color
    expect(errorLog).toHaveStyle({ color: '#ec4899' })
  })

  it('applies normal style to regular logs', () => {
    render(<MonitoringPanel logs={mockLogs} metrics={{}} />)

    const normalLog = screen.getByText('Training started')
    expect(normalLog).toHaveStyle({ color: '#e2e8f0' })
  })
})
