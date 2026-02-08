import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InstillationsPanel } from '../InstillationsPanel'

const mockFetch = vi.fn()

const mockRules = [
  { id: '1', trigger: 'hello', match: { type: 'exact' as const }, response: 'Hi there!', enabled: true },
  { id: '2', trigger: 'bye.*', match: { type: 'regex' as const }, response: 'Goodbye!', enabled: false }
]

describe('InstillationsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/instillations') && !url.includes('/resolve')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ pairs: mockRules }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders instillations heading', async () => {
    render(<InstillationsPanel />)
    expect(screen.getByRole('heading', { name: 'Instillations' })).toBeInTheDocument()
  })

  it('fetches and displays rules on mount', async () => {
    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument()
      expect(screen.getByText('bye.*')).toBeInTheDocument()
    })
  })

  it('shows Add New Rule form', async () => {
    render(<InstillationsPanel />)
    expect(screen.getByPlaceholderText('Trigger phrase')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Response')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Rule' })).toBeInTheDocument()
  })

  it('creates new rule on form submit', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    await user.type(screen.getByPlaceholderText('Trigger phrase'), 'new trigger')
    await user.type(screen.getByPlaceholderText('Response'), 'new response')
    await user.click(screen.getByRole('button', { name: 'Add Rule' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/instillations'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('new trigger')
        })
      )
    })
  })

  it('shows error when creating rule without required fields', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    await user.click(screen.getByRole('button', { name: 'Add Rule' }))

    await waitFor(() => {
      expect(screen.getByText('Trigger and response are required.')).toBeInTheDocument()
    })
  })

  it('error notification has position: fixed (regression test)', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    await user.click(screen.getByRole('button', { name: 'Add Rule' }))

    await waitFor(() => {
      const errorBox = screen.getByText('Trigger and response are required.').closest('div')
      expect(errorBox).toHaveStyle({ position: 'fixed' })
    })
  })

  it('deletes rule on delete button click', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    await user.click(deleteButtons[0])

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/instillations/1'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  it('toggles rule enabled status', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument()
    })

    // Find toggle buttons (checkmark or circle)
    const toggleButtons = screen.getAllByRole('button').filter(btn =>
      btn.textContent === '✓' || btn.textContent === '○'
    )
    await user.click(toggleButtons[0])

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/instillations/1'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('enabled')
        })
      )
    })
  })

  it('opens edit modal on Edit button click', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument()
    })

    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    await user.click(editButtons[0])

    expect(screen.getByRole('heading', { name: 'Edit Rule' })).toBeInTheDocument()
  })

  it('closes edit modal on Cancel', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument()
    })

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(screen.getByRole('heading', { name: 'Edit Rule' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Edit Rule' })).not.toBeInTheDocument()
  })

  it('closes edit modal on Escape key', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument()
    })

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(screen.getByRole('heading', { name: 'Edit Rule' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: 'Edit Rule' })).not.toBeInTheDocument()
  })

  it('saves edited rule', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument()
    })

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/instillations/1'),
        expect.objectContaining({ method: 'PUT' })
      )
    })
  })

  it('tests resolver with input', async () => {
    const user = userEvent.setup()
    mockFetch.mockImplementation((url: string, _options?: RequestInit) => {
      if (url.includes('/instillations/resolve')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: 'Resolved response!' }) })
      }
      if (url.includes('/instillations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ pairs: mockRules }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<InstillationsPanel />)

    await user.type(screen.getByPlaceholderText('Type input...'), 'hello')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() => {
      expect(screen.getByText(/Result:/)).toBeInTheDocument()
      expect(screen.getByText('Resolved response!')).toBeInTheDocument()
    })
  })

  it('shows No match when resolver finds nothing', async () => {
    const user = userEvent.setup()
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/instillations/resolve')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: null }) })
      }
      if (url.includes('/instillations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ pairs: mockRules }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<InstillationsPanel />)

    await user.type(screen.getByPlaceholderText('Type input...'), 'unknown')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() => {
      expect(screen.getByText('No match')).toBeInTheDocument()
    })
  })

  it('displays match type in table', async () => {
    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText('exact')).toBeInTheDocument()
      expect(screen.getByText('regex')).toBeInTheDocument()
    })
  })

  it('truncates long responses in table', async () => {
    const longResponse = 'This is a very long response that should be truncated when displayed in the table view'
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/instillations')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            pairs: [{ id: '3', trigger: 'test', match: { type: 'exact' }, response: longResponse, enabled: true }]
          })
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText(/This is a very long response.*\.\.\./)).toBeInTheDocument()
    })
  })

  it('dismisses error on close button click', async () => {
    const user = userEvent.setup()
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/instillations') && !url.includes('/resolve')) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load rules/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Dismiss error' }))

    expect(screen.queryByText(/Failed to load rules/)).not.toBeInTheDocument()
  })

  it('auto-dismisses error after 5 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/instillations') && !url.includes('/resolve')) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<InstillationsPanel />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load rules/)).toBeInTheDocument()
    })

    vi.advanceTimersByTime(5000)

    await waitFor(() => {
      expect(screen.queryByText(/Failed to load rules/)).not.toBeInTheDocument()
    })

    vi.useRealTimers()
  })

  it('changes match type in form', async () => {
    const user = userEvent.setup()
    render(<InstillationsPanel />)

    const select = screen.getByDisplayValue('Exact Match')
    await user.selectOptions(select, 'regex')
    expect(select).toHaveValue('regex')
  })
})
