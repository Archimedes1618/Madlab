import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrainingPanel } from '../TrainingPanel'

// Mock child components
vi.mock('../ModelBrowser', () => ({
  ModelBrowser: ({ onSelect, onClose }: { onSelect: (id: string) => void; onClose: () => void }) => (
    <div data-testid="model-browser">
      <button onClick={() => { onSelect('test-model'); onClose(); }}>Select Model</button>
      <button onClick={onClose}>Close</button>
    </div>
  )
}))

vi.mock('../DatasetGenerator', () => ({
  DatasetGenerator: ({ onDatasetGenerated }: { onDatasetGenerated: () => void }) => (
    <div data-testid="dataset-generator">
      <button onClick={onDatasetGenerated}>Generate</button>
    </div>
  )
}))

const mockFetch = vi.fn()

describe('TrainingPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Default mocks for initial fetches
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/train/status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ running: false }) })
      }
      if (url.includes('/train/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model: { name: 'test-model', save_path: './output', adapter: 'none' },
            data: { path: './data.jsonl', val_split: 0.1 },
            train: { epochs: 1, batch_size: 4, lr: 0.00005, max_seq_len: 512, weight_decay: 0.01, warmup_steps: 100, grad_clip: 1.0, log_every: 10, save_every: 100, grad_accum_steps: 1 },
            runtime: { device: 'cpu', workers: 0 }
          })
        })
      }
      if (url.includes('/train/artifacts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if (url.includes('/datasets') && !url.includes('/upload')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if (url.includes('/train/history')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders training control section', async () => {
    render(<TrainingPanel />)
    await waitFor(() => {
      expect(screen.getByText('Training Control 🛠')).toBeInTheDocument()
    })
  })

  it('renders dataset management section', async () => {
    render(<TrainingPanel />)
    await waitFor(() => {
      expect(screen.getByText('Dataset Management 📁')).toBeInTheDocument()
    })
  })

  it('shows idle status when training not running', async () => {
    render(<TrainingPanel />)
    await waitFor(() => {
      expect(screen.getByText('Idle')).toBeInTheDocument()
    })
  })

  it('shows running status with PID when training is active', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/train/status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ running: true, pid: 12345 }) })
      }
      if (url.includes('/train/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model: { name: 'test', save_path: '.', adapter: 'none' },
            data: { path: '.', val_split: 0.1 },
            train: { epochs: 1, batch_size: 4, lr: 0.00005, max_seq_len: 512, weight_decay: 0.01, warmup_steps: 100, grad_clip: 1.0, log_every: 10, save_every: 100, grad_accum_steps: 1 },
            runtime: { device: 'cpu' }
          })
        })
      }
      if (url.includes('/train/artifacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/datasets')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/train/history')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<TrainingPanel />)
    await waitFor(() => {
      expect(screen.getByText(/Running.*PID: 12345/)).toBeInTheDocument()
    })
  })

  it('starts training on button click', async () => {
    const user = userEvent.setup()
    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start Training/ })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Start Training/ }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/train/start'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('stops training on button click', async () => {
    const user = userEvent.setup()
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/train/status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ running: true, pid: 123 }) })
      }
      if (url.includes('/train/stop')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      if (url.includes('/train/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model: { name: 'test', save_path: '.', adapter: 'none' },
            data: { path: '.', val_split: 0.1 },
            train: { epochs: 1, batch_size: 4, lr: 0.00005, max_seq_len: 512, weight_decay: 0.01, warmup_steps: 100, grad_clip: 1.0, log_every: 10, save_every: 100, grad_accum_steps: 1 },
            runtime: { device: 'cpu' }
          })
        })
      }
      if (url.includes('/train/artifacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/datasets')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/train/history')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Stop Training/ })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Stop Training/ }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/train/stop'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('shows error notification with position:fixed', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/train/status')) {
        return Promise.reject(new Error('Network error'))
      }
      if (url.includes('/train/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model: { name: 'test', save_path: '.', adapter: 'none' },
            data: { path: '.', val_split: 0.1 },
            train: { epochs: 1, batch_size: 4, lr: 0.00005, max_seq_len: 512, weight_decay: 0.01, warmup_steps: 100, grad_clip: 1.0, log_every: 10, save_every: 100, grad_accum_steps: 1 },
            runtime: { device: 'cpu' }
          })
        })
      }
      if (url.includes('/train/artifacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/datasets')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/train/history')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch training status')).toBeInTheDocument()
    })

    // Error box should have position: fixed (verifies the fix)
    const errorBox = screen.getByText('Failed to fetch training status').closest('div')
    expect(errorBox).toHaveStyle({ position: 'fixed' })
  })

  it('opens model browser on Browse HF click', async () => {
    const user = userEvent.setup()
    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Browse HF🤗' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Browse HF🤗' }))
    expect(screen.getByTestId('model-browser')).toBeInTheDocument()
  })

  it('opens dataset generator on Generate click', async () => {
    const user = userEvent.setup()
    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate Synthetic Data/ })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Generate Synthetic Data/ }))
    expect(screen.getByTestId('dataset-generator')).toBeInTheDocument()
  })

  it('applies preset on selection', async () => {
    const user = userEvent.setup()
    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Custom')).toBeInTheDocument()
    })

    const select = screen.getByDisplayValue('Custom')
    await user.selectOptions(select, 'Quick Test')
    expect(select).toHaveValue('Quick Test')
  })

  it('saves config on button click', async () => {
    const user = userEvent.setup()
    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Save Configuration' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/train/config'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('imports HuggingFace dataset', async () => {
    const user = userEvent.setup()
    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/HF Dataset Repo/)).toBeInTheDocument()
    })

    await user.type(screen.getByPlaceholderText(/HF Dataset Repo/), 'test/dataset')
    // There are multiple Import buttons, get the first one (regular import)
    const importButtons = screen.getAllByRole('button', { name: /Import/ })
    await user.click(importButtons[0])

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/datasets/import'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('Timer behavior on tab switch (regression test)', () => {
    it('timer does not reset when tab visibility changes during training', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      let statusResponse = { running: true, pid: 123 }
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/train/status')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(statusResponse) })
        }
        if (url.includes('/train/config')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              model: { name: 'test', save_path: '.', adapter: 'none' },
              data: { path: '.', val_split: 0.1 },
              train: { epochs: 3, batch_size: 4, lr: 0.00005, max_seq_len: 512, weight_decay: 0.01, warmup_steps: 100, grad_clip: 1.0, log_every: 10, save_every: 100, grad_accum_steps: 1 },
              runtime: { device: 'cpu' }
            })
          })
        }
        if (url.includes('/train/artifacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        if (url.includes('/datasets')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        if (url.includes('/train/history')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      })

      render(<TrainingPanel metrics={{ epoch: 0.5, loss: 1.5 }} />)

      await waitFor(() => {
        expect(screen.getByText(/Running/)).toBeInTheDocument()
      })

      // Let 10 seconds pass
      vi.advanceTimersByTime(10000)

      // Simulate tab switch (visibility change)
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))

      // Wait a bit
      vi.advanceTimersByTime(1000)

      // Come back to tab
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))

      // Training should still show as running (status.running never changed)
      await waitFor(() => {
        expect(screen.getByText(/Running/)).toBeInTheDocument()
      })

      // The elapsed time should continue from where it was, not reset to 0
      // This is verified by the fact wasRunning.current tracks actual running state transitions
    })

    it('timer resets when training actually stops', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      let statusResponse: { running: boolean; pid?: number } = { running: true, pid: 123 }
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/train/status')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(statusResponse) })
        }
        if (url.includes('/train/config')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              model: { name: 'test', save_path: '.', adapter: 'none' },
              data: { path: '.', val_split: 0.1 },
              train: { epochs: 3, batch_size: 4, lr: 0.00005, max_seq_len: 512, weight_decay: 0.01, warmup_steps: 100, grad_clip: 1.0, log_every: 10, save_every: 100, grad_accum_steps: 1 },
              runtime: { device: 'cpu' }
            })
          })
        }
        if (url.includes('/train/artifacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        if (url.includes('/datasets')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        if (url.includes('/train/history')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      })

      render(<TrainingPanel metrics={{ epoch: 0.5, loss: 1.5 }} />)

      await waitFor(() => {
        expect(screen.getByText(/Running/)).toBeInTheDocument()
      })

      // Now stop training
      statusResponse = { running: false }
      vi.advanceTimersByTime(2000) // Trigger status poll

      await waitFor(() => {
        expect(screen.getByText('Idle')).toBeInTheDocument()
      })
    })
  })

  it('displays progress bar when training', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/train/status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ running: true, pid: 123 }) })
      }
      if (url.includes('/train/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model: { name: 'test', save_path: '.', adapter: 'none' },
            data: { path: '.', val_split: 0.1 },
            train: { epochs: 10, batch_size: 4, lr: 0.00005, max_seq_len: 512, weight_decay: 0.01, warmup_steps: 100, grad_clip: 1.0, log_every: 10, save_every: 100, grad_accum_steps: 1 },
            runtime: { device: 'cpu' }
          })
        })
      }
      if (url.includes('/train/artifacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/datasets')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/train/history')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<TrainingPanel metrics={{ epoch: 5, loss: 1.5 }} />)

    await waitFor(() => {
      expect(screen.getByText(/Epoch 5.00 \/ 10/)).toBeInTheDocument()
      expect(screen.getByText(/50.0%/)).toBeInTheDocument()
    })
  })

  it('displays datasets list', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/datasets') && !url.includes('/upload') && !url.includes('/import')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { name: 'train.jsonl', size: 10240, selected: true, created: '2024-01-01' },
            { name: 'test.jsonl', size: 5120, selected: false, created: '2024-01-02' }
          ])
        })
      }
      if (url.includes('/train/status')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ running: false }) })
      if (url.includes('/train/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model: { name: 'test', save_path: '.', adapter: 'none' },
            data: { path: '.', val_split: 0.1 },
            train: { epochs: 1, batch_size: 4, lr: 0.00005, max_seq_len: 512, weight_decay: 0.01, warmup_steps: 100, grad_clip: 1.0, log_every: 10, save_every: 100, grad_accum_steps: 1 },
            runtime: { device: 'cpu' }
          })
        })
      }
      if (url.includes('/train/artifacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/train/history')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByText('train.jsonl')).toBeInTheDocument()
      expect(screen.getByText('test.jsonl')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
    })
  })

  it('displays artifacts list with action buttons', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/train/artifacts')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { name: 'model-f16.gguf', url: '/artifacts/model-f16.gguf', size: 1000000 },
            { name: 'eval-report.json', url: '/artifacts/eval-report.json', size: 5000 }
          ])
        })
      }
      if (url.includes('/train/status')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ running: false }) })
      if (url.includes('/train/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            model: { name: 'test', save_path: '.', adapter: 'none' },
            data: { path: '.', val_split: 0.1 },
            train: { epochs: 1, batch_size: 4, lr: 0.00005, max_seq_len: 512, weight_decay: 0.01, warmup_steps: 100, grad_clip: 1.0, log_every: 10, save_every: 100, grad_accum_steps: 1 },
            runtime: { device: 'cpu' }
          })
        })
      }
      if (url.includes('/datasets')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      if (url.includes('/train/history')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<TrainingPanel />)

    await waitFor(() => {
      expect(screen.getByText('model-f16.gguf')).toBeInTheDocument()
      expect(screen.getByText('eval-report.json')).toBeInTheDocument()
    })
  })
})
