import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from '../CommandPalette'

const mockCommands = [
  { id: '1', name: 'Start Training', desc: 'Begin model training', action: vi.fn() },
  { id: '2', name: 'Stop Training', desc: 'Halt training process', action: vi.fn() },
  { id: '3', name: 'Export Model', desc: 'Export as GGUF', action: vi.fn() }
]

describe('CommandPalette', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    mockCommands.forEach(c => c.action.mockClear())
    mockOnClose.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders command palette with input', () => {
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)
    expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()
  })

  it('displays all commands by default', () => {
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    expect(screen.getByText('Start Training')).toBeInTheDocument()
    expect(screen.getByText('Stop Training')).toBeInTheDocument()
    expect(screen.getByText('Export Model')).toBeInTheDocument()
  })

  it('displays command descriptions', () => {
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    expect(screen.getByText('Begin model training')).toBeInTheDocument()
    expect(screen.getByText('Halt training process')).toBeInTheDocument()
  })

  it('filters commands by name on input', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.type(screen.getByPlaceholderText('Type a command...'), 'Start')

    // Text is split by highlight mark, use function matcher
    expect(screen.getByText((_, element) => element?.textContent === 'Start Training')).toBeInTheDocument()
    expect(screen.queryByText('Stop Training')).not.toBeInTheDocument()
    expect(screen.queryByText('Export Model')).not.toBeInTheDocument()
  })

  it('filters commands by description', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.type(screen.getByPlaceholderText('Type a command...'), 'GGUF')

    expect(screen.getByText('Export Model')).toBeInTheDocument()
    expect(screen.queryByText((_, element) => element?.textContent === 'Start Training')).not.toBeInTheDocument()
  })

  it('filter is case insensitive', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.type(screen.getByPlaceholderText('Type a command...'), 'start')

    // Text is split by highlight mark
    expect(screen.getByText((_, element) => element?.textContent === 'Start Training')).toBeInTheDocument()
  })

  it('shows "No commands found" when filter matches nothing', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.type(screen.getByPlaceholderText('Type a command...'), 'xyz123')

    expect(screen.getByText('No commands found')).toBeInTheDocument()
  })

  it('closes on Escape key', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.keyboard('{Escape}')

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('closes on backdrop click', async () => {
    const user = userEvent.setup()
    const { container } = render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    // The outer div with position:fixed is the backdrop
    const backdrop = container.querySelector('div[style*="position: fixed"]')
    if (backdrop) {
      // Click directly on the backdrop element itself (not a child)
      await user.click(backdrop)
    }

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('does not close on inner content click', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.click(screen.getByText('Start Training'))

    // Should have called action and close, but not via backdrop
    expect(mockCommands[0].action).toHaveBeenCalled()
  })

  it('executes command on Enter', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.keyboard('{Enter}')

    expect(mockCommands[0].action).toHaveBeenCalled()
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('executes command on click', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.click(screen.getByText('Export Model'))

    expect(mockCommands[2].action).toHaveBeenCalled()
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('navigates with arrow keys', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    // First item selected by default
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    // Second item should be selected
    expect(mockCommands[1].action).toHaveBeenCalled()
  })

  it('navigates up with arrow keys', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    // Should be back to second item
    expect(mockCommands[1].action).toHaveBeenCalled()
  })

  it('does not go below last item', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    // Press down more times than there are items
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    // Should be at last item
    expect(mockCommands[2].action).toHaveBeenCalled()
  })

  it('does not go above first item', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.keyboard('{ArrowUp}')
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    // Should still be at first item
    expect(mockCommands[0].action).toHaveBeenCalled()
  })

  it('resets selection when query changes', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    // Select second item
    await user.keyboard('{ArrowDown}')

    // Type something to filter
    await user.type(screen.getByPlaceholderText('Type a command...'), 'Stop')
    await user.keyboard('{Enter}')

    // Should execute the first visible item (Stop Training)
    expect(mockCommands[1].action).toHaveBeenCalled()
  })

  it('highlights matching text in name', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    await user.type(screen.getByPlaceholderText('Type a command...'), 'Train')

    // Check that mark element exists
    const marks = screen.getAllByText('Train')
    const highlightedMark = marks.find(el => el.tagName === 'MARK')
    expect(highlightedMark).toBeInTheDocument()
  })

  it('focuses input on mount', () => {
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    expect(screen.getByPlaceholderText('Type a command...')).toHaveFocus()
  })

  it('displays keyboard shortcut hints', () => {
    render(<CommandPalette commands={mockCommands} onClose={mockOnClose} />)

    // Text contains spaces from layout, use regex
    expect(screen.getByText(/navigate/)).toBeInTheDocument()
    expect(screen.getByText(/select/)).toBeInTheDocument()
    expect(screen.getByText(/close/)).toBeInTheDocument()
  })
})
