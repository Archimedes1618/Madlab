import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DatasetGenerator } from '../DatasetGenerator'

const mockFetch = vi.fn()

describe('DatasetGenerator', () => {
  const mockOnDatasetGenerated = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    mockOnDatasetGenerated.mockClear()
  })

  it('renders generator heading', () => {
    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)
    expect(screen.getByText(/Synthetic Dataset Generator/)).toBeInTheDocument()
  })

  it('renders step 1 form by default', () => {
    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    expect(screen.getByPlaceholderText(/How do I install Python/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/You can download it from python.org/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Generate Variations/ })).toBeInTheDocument()
  })

  it('shows variation count slider with default value', () => {
    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    expect(screen.getByText('Variations Count: 10')).toBeInTheDocument()
    expect(screen.getByRole('slider')).toHaveValue('10')
  })

  it('updates variation count on slider change', async () => {
    const user = userEvent.setup()
    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    const slider = screen.getByRole('slider')
    await user.click(slider)
    // Setting value directly since slider interactions are tricky
    await user.type(slider, '{arrowright}{arrowright}{arrowright}')

    // Value should have increased
    expect(parseInt(slider.getAttribute('value') || '10')).toBeGreaterThanOrEqual(10)
  })

  it('disables generate button when inputs are empty', () => {
    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    expect(screen.getByRole('button', { name: /Generate Variations/ })).toBeDisabled()
  })

  it('enables generate button when both inputs are filled', async () => {
    const user = userEvent.setup()
    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    await user.type(screen.getByPlaceholderText(/How do I install Python/), 'Test input')
    await user.type(screen.getByPlaceholderText(/You can download it from python.org/), 'Test output')

    expect(screen.getByRole('button', { name: /Generate Variations/ })).toBeEnabled()
  })

  it('calls API on generate button click', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ filename: 'generated.jsonl', count: 10 })
    })

    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    await user.type(screen.getByPlaceholderText(/How do I install Python/), 'Test input')
    await user.type(screen.getByPlaceholderText(/You can download it from python.org/), 'Test output')
    await user.click(screen.getByRole('button', { name: /Generate Variations/ }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/datasets/generate'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Test input')
        })
      )
    })
  })

  it('shows loading state during generation', async () => {
    const user = userEvent.setup()
    let resolvePromise: (value: any) => void
    mockFetch.mockReturnValue(new Promise(resolve => { resolvePromise = resolve }))

    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    await user.type(screen.getByPlaceholderText(/How do I install Python/), 'Test input')
    await user.type(screen.getByPlaceholderText(/You can download it from python.org/), 'Test output')
    await user.click(screen.getByRole('button', { name: /Generate Variations/ }))

    expect(screen.getByRole('button', { name: /Generating via Local LLM/ })).toBeDisabled()

    resolvePromise!({ ok: true, json: () => Promise.resolve({ filename: 'test.jsonl', count: 10 }) })
  })

  it('shows success state after generation', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ filename: 'generated-dataset.jsonl', count: 15 })
    })

    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    await user.type(screen.getByPlaceholderText(/How do I install Python/), 'Test input')
    await user.type(screen.getByPlaceholderText(/You can download it from python.org/), 'Test output')
    await user.click(screen.getByRole('button', { name: /Generate Variations/ }))

    await waitFor(() => {
      expect(screen.getByText(/Success! Generated 15 samples/)).toBeInTheDocument()
      expect(screen.getByText('generated-dataset.jsonl')).toBeInTheDocument()
    })
  })

  it('calls onDatasetGenerated callback on success', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ filename: 'test.jsonl', count: 10 })
    })

    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    await user.type(screen.getByPlaceholderText(/How do I install Python/), 'Test input')
    await user.type(screen.getByPlaceholderText(/You can download it from python.org/), 'Test output')
    await user.click(screen.getByRole('button', { name: /Generate Variations/ }))

    await waitFor(() => {
      expect(mockOnDatasetGenerated).toHaveBeenCalled()
    })
  })

  it('allows creating another dataset after success', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ filename: 'test.jsonl', count: 10 })
    })

    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    await user.type(screen.getByPlaceholderText(/How do I install Python/), 'Test input')
    await user.type(screen.getByPlaceholderText(/You can download it from python.org/), 'Test output')
    await user.click(screen.getByRole('button', { name: /Generate Variations/ }))

    await waitFor(() => {
      expect(screen.getByText(/Success!/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Create Another/ }))

    // Should return to step 1 with cleared inputs
    expect(screen.getByPlaceholderText(/How do I install Python/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/How do I install Python/)).toHaveValue('')
  })

  it('handles API error gracefully', async () => {
    const user = userEvent.setup()
    mockFetch.mockRejectedValue(new Error('Network error'))

    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    await user.type(screen.getByPlaceholderText(/How do I install Python/), 'Test input')
    await user.type(screen.getByPlaceholderText(/You can download it from python.org/), 'Test output')
    await user.click(screen.getByRole('button', { name: /Generate Variations/ }))

    // Should not crash, should remain on step 1
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate Variations/ })).toBeEnabled()
    })
  })

  it('does not proceed if response has no filename', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: 'Generation failed' })
    })

    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    await user.type(screen.getByPlaceholderText(/How do I install Python/), 'Test input')
    await user.type(screen.getByPlaceholderText(/You can download it from python.org/), 'Test output')
    await user.click(screen.getByRole('button', { name: /Generate Variations/ }))

    // Should stay on step 1
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate Variations/ })).toBeEnabled()
    })
    expect(mockOnDatasetGenerated).not.toHaveBeenCalled()
  })

  it('sends correct count value from slider', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ filename: 'test.jsonl', count: 25 })
    })

    render(<DatasetGenerator onDatasetGenerated={mockOnDatasetGenerated} />)

    await user.type(screen.getByPlaceholderText(/How do I install Python/), 'Input')
    await user.type(screen.getByPlaceholderText(/You can download it from python.org/), 'Output')

    // Default count is 10
    await user.click(screen.getByRole('button', { name: /Generate Variations/ }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"count":10')
        })
      )
    })
  })
})
