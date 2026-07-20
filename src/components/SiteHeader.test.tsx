import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SiteHeader } from './SiteHeader'

describe('SiteHeader', () => {
  it('navigates between Family, Pets, and Dashboard and exposes logout only when authenticated', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const onLogout = vi.fn()
    const { rerender } = render(<SiteHeader title="The Lineage Archive" view="family" authenticated={false} onNavigate={onNavigate} onLogout={onLogout} />)
    expect(screen.getByRole('button', { name: /The Lineage Archive/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pets' }))
    await user.click(screen.getByRole('button', { name: 'Admin login' }))
    expect(onNavigate).toHaveBeenNthCalledWith(1, 'pets')
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'dashboard')
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
    rerender(<SiteHeader title="Custom Archive" view="dashboard" authenticated onNavigate={onNavigate} onLogout={onLogout} />)
    expect(screen.getByRole('button', { name: /Custom Archive/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogout).toHaveBeenCalledOnce()
  })
})
