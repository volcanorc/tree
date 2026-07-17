import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import seed from '../../public/tree-data.json'
import type { TreeData } from '../types'
import { Dashboard } from './Dashboard'

function DashboardHarness() {
  const published = structuredClone(seed) as TreeData
  const [data, setData] = useState(published)
  return (
    <Dashboard
      data={data}
      publishedData={published}
      authenticated
      onAuthenticated={() => undefined}
      onLogout={() => undefined}
      onChange={setData}
      onReset={() => setData(published)}
    />
  )
}

function openPeople() {
  render(<DashboardHarness />)
  fireEvent.click(screen.getByRole('button', { name: 'People' }))
  return screen.getByRole('complementary', { name: 'People' })
}

describe('Dashboard people editor', () => {
  it('deletes consecutive people without resetting selection to Father', () => {
    const list = openPeople()
    fireEvent.click(within(list).getByRole('button', { name: /second wife/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete person' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(screen.getByText(/second wife was removed/i)).toBeInTheDocument()
    expect(screen.getByText(/Editing: New child/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete person' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(screen.getByText(/New child was removed/i)).toBeInTheDocument()
  })

  it('supports bulk selection, protected locks, selected count, and confirmation', () => {
    const list = openPeople()
    fireEvent.click(within(list).getByRole('checkbox', { name: 'People' }))
    expect(within(list).getByRole('checkbox', { name: 'Select Father' })).toBeDisabled()
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Select second wife' }))
    const newChildChecks = within(list).getAllByRole('checkbox', { name: 'Select New child' })
    fireEvent.click(newChildChecks.at(-1)!)
    expect(within(list).getByText('2 selected')).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: 'Delete selected' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete 2 people?')
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(within(list).queryByRole('button', { name: /second wife/i })).not.toBeInTheDocument()
  })

  it('offers side-by-side family-unit choices when a person has multiple partners', () => {
    const list = openPeople()
    fireEvent.click(within(list).getAllByRole('button', { name: /New child/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Add partner' }))
    fireEvent.click(within(list).getAllByRole('button', { name: /New child/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }))
    const dialog = screen.getByRole('dialog', { name: /Which branch does this child belong to/i })
    expect(within(dialog).getByRole('button', { name: 'second wife' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'New partner' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Single parent' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'second wife' }))
    expect(screen.getByText(/added as the youngest child/i)).toBeInTheDocument()
  })
})
