import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPanel } from '../ChatPanel'

// Mock uuid
vi.mock('../../utils/uuid', () => ({
  uuid: () => `test-${Math.random().toString(36).slice(2)}`
}))

const mockFetch = vi.fn()

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders chat heading', () => {
    render(<ChatPanel />)
    expect(screen.getByRole('heading', { name: 'Chat Playground' })).toBeInTheDocument()
  })

  it('renders input and send button', () => {
    render(<ChatPanel />)
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('shows system message by default', () => {
    render(<ChatPanel />)
    expect(screen.getByText(/You are a helpful AI assistant/)).toBeInTheDocument()
    expect(screen.getByText('SYSTEM')).toBeInTheDocument()
  })

  it('sends message on Enter key', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: 'Hello!' } }]
      })
    })

    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'Hi{Enter}')

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/chat/completions'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Hi')
        })
      )
    })
  })

  it('sends message on Send button click', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: 'Hello!' } }]
      })
    })

    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  it('displays user message after sending', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: 'Response' } }]
      })
    })

    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'Test message')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(screen.getByText('Test message')).toBeInTheDocument()
    expect(screen.getByText('USER')).toBeInTheDocument()
  })

  it('displays assistant response', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: 'I am here to help!' } }]
      })
    })

    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'Help')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText('I am here to help!')).toBeInTheDocument()
      expect(screen.getAllByText('ASSISTANT').length).toBeGreaterThan(0)
    })
  })

  it('clears input after sending', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: 'Ok' } }]
      })
    })

    render(<ChatPanel />)

    const input = screen.getByPlaceholderText('Type a message...')
    await user.type(input, 'Test')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(input).toHaveValue('')
  })

  it('shows loading state while waiting for response', async () => {
    const user = userEvent.setup()
    let resolvePromise: (value: any) => void
    mockFetch.mockReturnValue(new Promise(resolve => { resolvePromise = resolve }))

    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'Wait')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(screen.getByText('Typing...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    resolvePromise!({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: 'Done' } }]
      })
    })

    await waitFor(() => {
      expect(screen.queryByText('Typing...')).not.toBeInTheDocument()
    })
  })

  it('does not send empty message', async () => {
    const user = userEvent.setup()
    render(<ChatPanel />)

    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not send whitespace-only message', async () => {
    const user = userEvent.setup()
    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), '   ')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('handles API error response', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}) // No choices
    })

    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'Test')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText(/Error: No response from model/)).toBeInTheDocument()
    })
  })

  it('handles network error', async () => {
    const user = userEvent.setup()
    mockFetch.mockRejectedValue(new Error('Network failed'))

    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'Test')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText(/Error: Network failed/)).toBeInTheDocument()
    })
  })

  it('handles unknown error type', async () => {
    const user = userEvent.setup()
    mockFetch.mockRejectedValue('String error')

    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'Test')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText(/Error: Unknown error/)).toBeInTheDocument()
    })
  })

  it('sends full message history with each request', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: 'Reply' } }]
      })
    })

    render(<ChatPanel />)

    // Send first message
    await user.type(screen.getByPlaceholderText('Type a message...'), 'First')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText('First')).toBeInTheDocument()
    })

    // Send second message
    await user.type(screen.getByPlaceholderText('Type a message...'), 'Second')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      // Last call should include both user messages
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      const body = JSON.parse(lastCall[1].body)
      expect(body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'First' }),
          expect.objectContaining({ role: 'assistant' }),
          expect.objectContaining({ role: 'user', content: 'Second' })
        ])
      )
    })
  })

  it('scrolls to bottom when new message added', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: 'Hi' } }]
      })
    })

    render(<ChatPanel />)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'Test')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    })
  })
})
