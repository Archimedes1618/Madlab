import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelBrowser } from '../ModelBrowser'

const mockFetch = vi.fn()

const mockModels = [
  { id: 'meta-llama/Llama-2-7b', likes: 1000, downloads: 50000, tags: ['text-generation'], pipeline_tag: 'text-generation' },
  { id: 'mistralai/Mistral-7B-v0.1', likes: 800, downloads: 40000, tags: ['text-generation'], pipeline_tag: 'text-generation' }
]

describe('ModelBrowser', () => {
  const mockOnSelect = vi.fn()
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockModels)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    mockOnSelect.mockClear()
    mockOnClose.mockClear()
  })

  it('renders dialog with title', async () => {
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Hugging Face Model Browser')).toBeInTheDocument()
  })

  it('has proper accessibility attributes', () => {
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'model-browser-title')
  })

  it('performs default search on mount', async () => {
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/models/search?q=llama')
      )
    })
  })

  it('displays models after search', async () => {
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    await waitFor(() => {
      expect(screen.getByText('meta-llama/Llama-2-7b')).toBeInTheDocument()
      expect(screen.getByText('mistralai/Mistral-7B-v0.1')).toBeInTheDocument()
    })
  })

  it('displays model stats (likes, downloads, pipeline tag)', async () => {
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    await waitFor(() => {
      expect(screen.getByText(/1000/)).toBeInTheDocument() // likes
      expect(screen.getByText(/50000/)).toBeInTheDocument() // downloads
      expect(screen.getAllByText('text-generation').length).toBeGreaterThan(0)
    })
  })

  it('searches on Enter key', async () => {
    const user = userEvent.setup()
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    const input = screen.getByPlaceholderText(/Search models/)
    await user.clear(input)
    await user.type(input, 'mistral{Enter}')

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/models/search?q=mistral')
      )
    })
  })

  it('searches on Search button click', async () => {
    const user = userEvent.setup()
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    const input = screen.getByPlaceholderText(/Search models/)
    await user.clear(input)
    await user.type(input, 'phi')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/models/search?q=phi')
      )
    })
  })

  it('shows loading state during search', async () => {
    let resolvePromise: (value: any) => void
    mockFetch.mockReturnValue(new Promise(resolve => { resolvePromise = resolve }))

    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    expect(screen.getByText('Searching Hugging Face...')).toBeInTheDocument()

    resolvePromise!({ ok: true, json: () => Promise.resolve(mockModels) })

    await waitFor(() => {
      expect(screen.queryByText('Searching Hugging Face...')).not.toBeInTheDocument()
    })
  })

  it('shows "No models found" when search returns empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([])
    })

    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    await waitFor(() => {
      expect(screen.getByText('No models found')).toBeInTheDocument()
    })
  })

  it('calls onSelect and onClose when model is selected', async () => {
    const user = userEvent.setup()
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    await waitFor(() => {
      expect(screen.getByText('meta-llama/Llama-2-7b')).toBeInTheDocument()
    })

    const selectButtons = screen.getAllByRole('button', { name: 'Select' })
    await user.click(selectButtons[0])

    expect(mockOnSelect).toHaveBeenCalledWith('meta-llama/Llama-2-7b')
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('closes on close button click', async () => {
    const user = userEvent.setup()
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    await user.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('closes on Escape key', async () => {
    const user = userEvent.setup()
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    await user.keyboard('{Escape}')

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('handles fetch error gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    // Should not crash, will show no models
    await waitFor(() => {
      expect(screen.getByText('No models found')).toBeInTheDocument()
    })
  })

  it('handles non-array response gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: 'Invalid response' })
    })

    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    // Should show no models, not crash
    await waitFor(() => {
      expect(screen.getByText('No models found')).toBeInTheDocument()
    })
  })

  it('updates query state on input change', async () => {
    const user = userEvent.setup()
    render(<ModelBrowser onSelect={mockOnSelect} onClose={mockOnClose} />)

    const input = screen.getByPlaceholderText(/Search models/)
    await user.clear(input)
    await user.type(input, 'test-query')

    expect(input).toHaveValue('test-query')
  })
})
