import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import seed from '../test/fixtures/tree-data-v4.json'
import type { TreeData } from '../types'
import { addPartner, createBlankPet } from '../lib/data'
import { Dashboard } from './Dashboard'

function DashboardHarness({
  initial = structuredClone(seed) as TreeData,
  onDataChange,
}: {
  initial?: TreeData
  onDataChange?: (data: TreeData) => void
}) {
  const published = structuredClone(initial)
  const [data, setData] = useState(published)
  const updateData = (next: TreeData) => {
    setData(next)
    onDataChange?.(next)
  }
  return (
    <Dashboard
      data={data}
      publishedData={published}
      authenticated
      onAuthenticated={() => undefined}
      onLogout={() => undefined}
      onChange={updateData}
      onReset={() => updateData(published)}
    />
  )
}

function openPeople() {
  render(<DashboardHarness />)
  fireEvent.click(screen.getByRole('button', { name: 'People' }))
  return screen.getByRole('complementary', { name: 'People' })
}

function openPets() {
  render(<DashboardHarness />)
  fireEvent.click(screen.getByRole('button', { name: 'Pets' }))
  return screen.getByRole('complementary', { name: 'Pets' })
}

describe('Dashboard layout and people editor', () => {
  it('uses the required heading copy', () => {
    render(<DashboardHarness />)
    expect(screen.getByText('Every detail preserved.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Archive dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Modify the current family history.')).toBeInTheDocument()
  })

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

  it('offers family-unit choices when a person has multiple partners', () => {
    const list = openPeople()
    fireEvent.click(within(list).getAllByRole('button', { name: /New child/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Add partner' }))
    fireEvent.click(within(list).getAllByRole('button', { name: /New child/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }))
    const dialog = screen.getByRole('dialog', { name: /Which branch does this child belong to/i })
    expect(within(dialog).getByRole('button', { name: 'second wife' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'New partner' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Single parent' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'second wife' }))
    expect(screen.getByText(/added as the youngest child/i)).toBeInTheDocument()
  })

  it('assigns children to the chosen Child 1 partner and auto-assigns from each partner', () => {
    let initial = addPartner(structuredClone(seed) as TreeData, 'child-1', 'Wife', 'family-child-1')
    initial = addPartner(initial, 'child-1', 'Sarah')
    let latest = initial
    render(<DashboardHarness initial={initial} onDataChange={(data) => { latest = data }} />)
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    const list = screen.getByRole('complementary', { name: 'People' })

    fireEvent.click(within(list).getByRole('button', { name: /^Child 1/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }))
    const dialog = screen.getByRole('dialog', { name: /Which branch does this child belong to/i })
    expect(within(dialog).getByRole('button', { name: 'Wife' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Sarah' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /single parent/i })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wife' }))
    const wifeChildId = latest.people.at(-1)!.id
    expect(latest.families.find((family) => family.parentIds.includes('wife'))?.children.some((child) => child.personId === wifeChildId)).toBe(true)
    expect(latest.families.find((family) => family.parentIds.includes('sarah'))?.children.some((child) => child.personId === wifeChildId)).toBe(false)

    fireEvent.click(within(list).getByRole('button', { name: /^Sarah/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }))
    expect(screen.queryByRole('dialog', { name: /Which branch does this child belong to/i })).not.toBeInTheDocument()
    const sarahChildId = latest.people.at(-1)!.id
    expect(latest.families.find((family) => family.parentIds.includes('sarah'))?.children.some((child) => child.personId === sarahChildId)).toBe(true)
    expect(latest.families.find((family) => family.parentIds.includes('wife'))?.children.some((child) => child.personId === sarahChildId)).toBe(false)
  })

  it('adds immediately for zero partners and prefers the only partnership over a solo branch', () => {
    const initial = addPartner(structuredClone(seed) as TreeData, 'child-1', 'Wife')
    let latest = initial
    render(<DashboardHarness initial={initial} onDataChange={(data) => { latest = data }} />)
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    const list = screen.getByRole('complementary', { name: 'People' })

    fireEvent.click(within(list).getByRole('button', { name: /^Child 2/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }))
    expect(screen.queryByRole('dialog', { name: /Which branch does this child belong to/i })).not.toBeInTheDocument()
    const soloChildId = latest.people.at(-1)!.id
    expect(latest.families.find((family) => family.id === 'family-child-2')?.children.some((child) => child.personId === soloChildId)).toBe(true)

    fireEvent.click(within(list).getByRole('button', { name: /^Child 1/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }))
    expect(screen.queryByRole('dialog', { name: /Which branch does this child belong to/i })).not.toBeInTheDocument()
    const partnerChildId = latest.people.at(-1)!.id
    expect(latest.families.find((family) => family.parentIds.includes('wife'))?.children.some((child) => child.personId === partnerChildId)).toBe(true)
    expect(latest.families.find((family) => family.id === 'family-child-1')?.children.some((child) => child.personId === partnerChildId)).toBe(false)
  })

  it('disambiguates duplicate partner names with portrait numbers', () => {
    let initial = addPartner(structuredClone(seed) as TreeData, 'child-1', 'Wife', 'family-child-1')
    initial = addPartner(initial, 'child-1', 'Wife')
    render(<DashboardHarness initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    const list = screen.getByRole('complementary', { name: 'People' })
    fireEvent.click(within(list).getByRole('button', { name: /^Child 1/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }))
    const dialog = screen.getByRole('dialog', { name: /Which branch does this child belong to/i })
    expect(within(dialog).getAllByRole('button', { name: /Wife · Portrait \d+/ })).toHaveLength(2)
  })

  it('synchronizes automatic portrait paths, preserves custom paths, and detects duplicates', () => {
    openPeople()
    const numberInput = screen.getByLabelText(/Portrait number/i)
    const pathInput = screen.getByLabelText('Portrait path or HTTPS PNG URL')

    fireEvent.change(numberInput, { target: { value: '25' } })
    expect(pathInput).toHaveValue('portraits/25.png')
    fireEvent.change(pathInput, { target: { value: 'portraits/custom.png' } })
    fireEvent.change(numberInput, { target: { value: '26' } })
    expect(pathInput).toHaveValue('portraits/custom.png')
    fireEvent.change(numberInput, { target: { value: '2' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Portrait 2 is already assigned')

    fireEvent.click(screen.getByRole('button', { name: 'Archive & export' }))
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled()
  })

  it('adds and removes link rows and blocks export for an invalid non-empty link', () => {
    openPeople()
    expect(screen.getAllByPlaceholderText('https://…')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add another profile link' }))
    const rows = screen.getAllByPlaceholderText('https://…')
    expect(rows).toHaveLength(2)
    fireEvent.change(rows[0], { target: { value: 'ftp://example.com/profile' } })
    expect(screen.getByText('Use an HTTP or HTTPS link.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove profile link 2' }))
    expect(screen.getAllByPlaceholderText('https://…')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Archive & export' }))
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled()
  })

  it('shows death date only for dead people and clears it when restored to alive', () => {
    openPeople()
    expect(screen.queryByLabelText('Death date')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'dead' } })
    const deathDate = screen.getByLabelText('Death date')
    expect(deathDate.closest('label')).toHaveClass('death-date-reveal')
    fireEvent.change(deathDate, { target: { value: '2020-03-04' } })
    expect(deathDate).toHaveValue('2020-03-04')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'alive' } })
    expect(screen.queryByLabelText('Death date')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'dead' } })
    expect(screen.getByLabelText('Death date')).toHaveValue('')
  })
})

describe('Dashboard pets editor', () => {
  it('matches the selectable People layout and creates pets with independent numbering', () => {
    const list = openPets()
    expect(within(list).getByText('1')).toBeInTheDocument()
    const iringButton = within(list).getByRole('button', { name: /Iring Brown/i })
    expect(iringButton.closest('.record-row')).toHaveClass('active')
    expect(screen.getByText('Editing: Iring Brown')).toBeInTheDocument()
    expect(screen.getByText('Stable ID · iring-brown')).toBeInTheDocument()

    fireEvent.click(within(list).getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Editing: New pet')).toBeInTheDocument()
    expect(screen.getByLabelText(/Portrait number/i)).toHaveValue(2)
    expect(screen.getByLabelText('Portrait path or HTTPS PNG URL')).toHaveValue('portraits/pets/2.png')
  })

  it('detects duplicate pet portrait numbers within the pet namespace', () => {
    const list = openPets()
    fireEvent.click(within(list).getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText(/Portrait number/i), { target: { value: '1' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Pet portrait 1 is already assigned')
  })

  it('accepts a pet birth year and conditionally clears the death date', () => {
    openPets()
    const birthDate = screen.getByLabelText('Birth date')
    expect(birthDate).toHaveValue('2013')
    expect(birthDate).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText(/Calculated age/)).toHaveValue(String(new Date().getFullYear() - 2013))
    expect(screen.getByLabelText(/Calculated age/)).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Death date')).toHaveValue('')
    fireEvent.change(birthDate, { target: { value: '2020-March' } })
    fireEvent.blur(birthDate)
    expect(birthDate).toHaveValue('2020-03')
    const deathDate = screen.getByLabelText('Death date')
    expect(deathDate.closest('label')).toHaveClass('death-date-reveal')
    fireEvent.change(deathDate, { target: { value: '2024-May' } })
    fireEvent.blur(deathDate)
    expect(deathDate).toHaveValue('2024-05')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'alive' } })
    expect(screen.queryByLabelText('Death date')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'dead' } })
    expect(screen.getByLabelText('Death date')).toHaveValue('')
  })

  it('bulk-selects deletable pets, warns about offspring, and supports immediate consecutive deletion', () => {
    const initial = structuredClone(seed) as TreeData
    initial.pets.push(
      createBlankPet('parent-cat', 'Parent Cat', 2),
      createBlankPet('kitten', 'Kitten', 3),
      createBlankPet('leaf-cat', 'Leaf Cat', 4),
    )
    initial.petFamilies.push({
      id: 'parent-cat-family',
      parentPetIds: ['parent-cat'],
      children: [{ petId: 'kitten', birthOrder: 1 }],
    })
    render(<DashboardHarness initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pets' }))
    const list = screen.getByRole('complementary', { name: 'Pets' })
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Pets' }))
    expect(within(list).getByRole('checkbox', { name: 'Select Iring Brown' })).toBeDisabled()
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Select Parent Cat' }))
    expect(within(list).getByText('1 selected')).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: 'Delete selected' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete 2 pets?')
    expect(dialog).toHaveTextContent('offspring branch: Kitten')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))
    expect(within(list).queryByRole('button', { name: /Parent Cat/i })).not.toBeInTheDocument()
    expect(screen.getByText('Editing: Leaf Cat')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete pet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(within(list).queryByRole('button', { name: /Leaf Cat/i })).not.toBeInTheDocument()
  })
})
