import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Badge, Button, EmptyState, StatusPill } from './ui'

describe('UI primitives', () => {
  it('renders a disabled loading button and keeps the control labelled', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Run backtest</Button>)
    const button = screen.getByRole('button', { name: /Run backtest/i })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders status pills with human-readable text', () => {
    render(<StatusPill status="succeeded" />)
    expect(screen.getByText('succeeded')).toBeInTheDocument()
  })

  it('shows empty state copy and action', () => {
    render(<EmptyState title="No positions" description="Add a manual holding first." action={<button>Add position</button>} />)
    expect(screen.getByText('No positions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add position' })).toBeInTheDocument()
  })

  it('renders badges', () => {
    render(<Badge tone="warn">paper only</Badge>)
    expect(screen.getByText('paper only')).toBeInTheDocument()
  })
})
