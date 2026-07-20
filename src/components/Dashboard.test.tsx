import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import seed from '../test/fixtures/tree-data-v4.json'
import type { ArchiveEditIntent, ArchiveEditRequest, TreeData } from '../types'
import { addPartner, createBlankPet } from '../lib/data'
import { Dashboard } from './Dashboard'

function DashboardHarness({
  initial = structuredClone(seed) as TreeData,
  onDataChange,
  onNavigateToOwner,
  onNavigateToPet,
  editRequest,
  onEditRequestHandled,
  onEditIntent,
}: {
  initial?: TreeData
  onDataChange?: (data: TreeData) => void
  onNavigateToOwner?: (personId: string) => void
  onNavigateToPet?: (petId: string) => void
  editRequest?: ArchiveEditRequest | null
  onEditRequestHandled?: (requestId: number) => void
  onEditIntent?: (intent: ArchiveEditIntent) => void
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
      onNavigateToOwner={onNavigateToOwner}
      onNavigateToPet={onNavigateToPet}
      editRequest={editRequest}
      onEditRequestHandled={onEditRequestHandled}
      onEditIntent={onEditIntent}
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

  it('uses the shared owner navigation action from the pet graph preview', () => {
    const initial = structuredClone(seed) as TreeData
    initial.pets[0].ownerPersonId = 'father'
    const onNavigateToOwner = vi.fn()
    render(<DashboardHarness initial={initial} onNavigateToOwner={onNavigateToOwner} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    fireEvent.pointerUp(screen.getByRole('button', { name: /Iring Brown details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Iring Brown details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByLabelText('View Father in family tree'))
    expect(onNavigateToOwner).toHaveBeenCalledWith('father')
  })

  it('keeps incomplete existing person fields visible until each one is acknowledged', () => {
    const list = openPeople()
    for (const label of ['Nickname', 'Born / origin details', 'Personality', 'Short biography', 'Profile link 1']) {
      expect(screen.getByLabelText(label).closest('label')).toHaveClass('new-record-field-attention')
    }
    for (const label of ['Display name', 'Birth date', 'Gender', 'Status', 'Portrait path or HTTPS PNG URL']) {
      expect(screen.getByLabelText(label).closest('label')).not.toHaveClass('new-record-field-attention')
    }

    fireEvent.focus(screen.getByLabelText('Nickname'))
    expect(screen.getByLabelText('Nickname').closest('label')).not.toHaveClass('new-record-field-attention')
    fireEvent.click(within(list).getByRole('button', { name: /^Child 1/i }))
    fireEvent.click(within(list).getByRole('button', { name: /^Father/i }))
    expect(screen.getByLabelText('Nickname').closest('label')).not.toHaveClass('new-record-field-attention')

    fireEvent.click(within(list).getByRole('button', { name: /Grandchild 1\.1/i }))
    expect(screen.getByLabelText('Gender').closest('label')).toHaveClass('new-record-field-attention')
    fireEvent.focus(screen.getByLabelText('Gender'))
    expect(screen.getByLabelText('Gender').closest('label')).not.toHaveClass('new-record-field-attention')
  })

  it('restores incomplete-field cues after reload and clears acknowledgements on reset', () => {
    const view = render(<DashboardHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    fireEvent.focus(screen.getByLabelText('Nickname'))
    expect(screen.getByLabelText('Nickname').closest('label')).not.toHaveClass('new-record-field-attention')

    fireEvent.click(screen.getByRole('button', { name: 'Archive & export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset to published' }))
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    expect(screen.getByLabelText('Nickname').closest('label')).toHaveClass('new-record-field-attention')

    view.unmount()
    render(<DashboardHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    expect(screen.getByLabelText('Nickname').closest('label')).toHaveClass('new-record-field-attention')
  })

  it('highlights only the requested fields for newly added children and partners until focus', () => {
    const list = openPeople()
    expect(screen.getByLabelText('Nickname').closest('label')).toHaveClass('new-record-field-attention')

    fireEvent.click(within(list).getByRole('button', { name: /^Child 2/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }))
    const displayName = screen.getByLabelText('Display name')
    expect(displayName).toHaveValue('New child')
    for (const label of ['Display name', 'Nickname', 'Birth date', 'Born / origin details', 'Personality', 'Short biography', 'Profile link 1', 'Gender']) {
      expect(screen.getByLabelText(label).closest('label')).toHaveClass('new-record-field-attention')
    }
    for (const label of ['Relationship label', 'Portrait path or HTTPS PNG URL', 'Status']) {
      expect(screen.getByLabelText(label).closest('label')).not.toHaveClass('new-record-field-attention')
    }
    for (const label of [/Calculated age/, /Portrait number/, /Birth order/]) {
      expect(screen.getByLabelText(label).closest('label')).not.toHaveClass('new-record-field-attention')
    }

    fireEvent.focus(displayName)
    expect(displayName.closest('label')).not.toHaveClass('new-record-field-attention')
    expect(screen.getByLabelText('Nickname').closest('label')).toHaveClass('new-record-field-attention')

    fireEvent.click(within(list).getByRole('button', { name: /Father/i }))
    const addedChildren = within(list).getAllByRole('button', { name: /New child/i })
    fireEvent.click(addedChildren.at(-1)!)
    expect(screen.getByLabelText('Display name').closest('label')).not.toHaveClass('new-record-field-attention')
    expect(screen.getByLabelText('Nickname').closest('label')).toHaveClass('new-record-field-attention')

    fireEvent.click(screen.getByRole('button', { name: 'Add partner' }))
    expect(screen.getByLabelText('Display name')).toHaveValue('New partner')
    expect(screen.getByLabelText('Display name').closest('label')).toHaveClass('new-record-field-attention')
    expect(screen.getByLabelText('Gender').closest('label')).toHaveClass('new-record-field-attention')
    expect(screen.getByLabelText('Status').closest('label')).not.toHaveClass('new-record-field-attention')
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

  it('synchronizes person portrait numbers and canonical paths in both directions', () => {
    openPeople()
    const numberInput = screen.getByLabelText(/Portrait number/i)
    const pathInput = screen.getByLabelText('Portrait path or HTTPS PNG URL')

    fireEvent.change(numberInput, { target: { value: '25' } })
    expect(pathInput).toHaveValue('portraits/25.png')
    fireEvent.change(pathInput, { target: { value: '/portraits/26.png' } })
    expect(numberInput).toHaveValue(26)
    fireEvent.change(pathInput, { target: { value: 'portraits/pets/4.png' } })
    expect(numberInput).toHaveValue(26)
    fireEvent.change(pathInput, { target: { value: 'portraits/27' } })
    expect(numberInput).toHaveValue(26)
    fireEvent.change(pathInput, { target: { value: 'https://example.com/portraits/26.png' } })
    expect(numberInput).toHaveValue(26)
    fireEvent.change(pathInput, { target: { value: 'portraits/custom.png' } })
    fireEvent.change(numberInput, { target: { value: '27' } })
    expect(pathInput).toHaveValue('portraits/custom.png')
    fireEvent.change(pathInput, { target: { value: 'portraits/2.png' } })
    expect(numberInput).toHaveValue(2)
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
    fireEvent.focus(deathDate)
    expect(deathDate.closest('label')).not.toHaveClass('death-date-reveal')
    fireEvent.change(deathDate, { target: { value: '2020-03-04' } })
    expect(deathDate).toHaveValue('2020-03-04')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'alive' } })
    expect(screen.queryByLabelText('Death date')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'dead' } })
    expect(screen.getByLabelText('Death date')).toHaveValue('')
    expect(screen.getByLabelText('Death date').closest('label')).toHaveClass('death-date-reveal')
  })

  it('shows partner and child shortcuts with exact branch context and exits bulk mode', () => {
    let initial = addPartner(structuredClone(seed) as TreeData, 'child-1', 'Wife', 'family-child-1')
    initial = addPartner(initial, 'child-1', 'Sarah')
    render(<DashboardHarness initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    const list = screen.getByRole('complementary', { name: 'People' })
    fireEvent.click(within(list).getByRole('button', { name: /^Child 1/i }))

    const partners = screen.getByRole('region', { name: 'Partners' })
    expect(within(partners).getByRole('button', { name: 'Open partner Wife' })).toBeInTheDocument()
    expect(within(partners).getByRole('button', { name: 'Open partner Sarah' })).toBeInTheDocument()
    const children = screen.getByRole('region', { name: 'Children' })
    expect(within(children).getAllByText('with Wife')).toHaveLength(4)

    fireEvent.click(within(list).getByRole('checkbox', { name: 'People' }))
    fireEvent.click(within(partners).getByRole('button', { name: 'Open partner Sarah' }))
    expect(within(list).getByRole('checkbox', { name: 'People' })).not.toBeChecked()
    expect(screen.getByText('Editing: Sarah')).toBeInTheDocument()
  })

  it('shows only resolved parents and navigates to the exact parent editor', () => {
    const initial = structuredClone(seed) as TreeData
    render(<DashboardHarness initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    const list = screen.getByRole('complementary', { name: 'People' })

    expect(screen.queryByRole('region', { name: 'Parents' })).not.toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: /^Child 1/i }))
    const parents = screen.getByRole('region', { name: 'Parents' })
    expect(within(parents).getByRole('button', { name: 'Open father Father' })).toHaveTextContent('Father')
    expect(within(parents).getByRole('button', { name: 'Open mother Mother' })).toHaveTextContent('Mother')
    fireEvent.click(within(parents).getByRole('button', { name: 'Open mother Mother' }))
    expect(screen.getByText('Editing: Mother')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Parents' })).not.toBeInTheDocument()
  })

  it('supports one-parent and unresolved-parent relationship data without rendering broken links', () => {
    const initial = structuredClone(seed) as TreeData
    initial.families.find((family) => family.id === 'root-family')!.parentIds = ['father', 'missing-parent']
    render(<DashboardHarness initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    const list = screen.getByRole('complementary', { name: 'People' })
    fireEvent.click(within(list).getByRole('button', { name: /^Child 1/i }))
    const parents = screen.getByRole('region', { name: 'Parents' })
    expect(within(parents).getByRole('button', { name: 'Open father Father' })).toBeInTheDocument()
    expect(within(parents).getAllByRole('button')).toHaveLength(1)
  })

  it('consumes settings and delete requests once through the existing safe workflow', async () => {
    const onHandled = vi.fn()
    const settings = render(
      <DashboardHarness
        editRequest={{ requestId: 61, kind: 'person', entityId: 'child-2', action: 'settings' }}
        onEditRequestHandled={onHandled}
      />,
    )
    expect(await screen.findByText('Editing: Child 2')).toBeInTheDocument()
    expect(onHandled).toHaveBeenCalledWith(61)
    settings.unmount()

    render(
      <DashboardHarness
        editRequest={{ requestId: 62, kind: 'person', entityId: 'grandchild-1-1', action: 'delete' }}
        onEditRequestHandled={onHandled}
      />,
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete 1 person?')
    expect(dialog).toHaveTextContent('Grandchild 1.1')
    expect(onHandled).toHaveBeenCalledWith(62)
  })

  it('consumes an exact-parent sibling request once and selects the new record', async () => {
    let latest = structuredClone(seed) as TreeData
    const onHandled = vi.fn()
    render(
      <DashboardHarness
        initial={latest}
        editRequest={{ requestId: 41, kind: 'person', entityId: 'grandchild-1-1', action: 'sibling' }}
        onEditRequestHandled={onHandled}
        onDataChange={(next) => { latest = next }}
      />,
    )

    expect(await screen.findByText('Editing: New sibling')).toBeInTheDocument()
    expect(onHandled).toHaveBeenCalledOnce()
    expect(onHandled).toHaveBeenCalledWith(41)
    const sibling = latest.people.at(-1)!
    expect(latest.families.find((family) => family.id === 'family-child-1')?.children.at(-1)).toEqual({ personId: sibling.id, birthOrder: 5 })
    expect(screen.getByLabelText('Display name').closest('label')).toHaveClass('new-record-field-attention')
  })

  it('opens the dashboard union chooser for a quick child request with multiple partners', async () => {
    let initial = addPartner(structuredClone(seed) as TreeData, 'child-1', 'Wife', 'family-child-1')
    initial = addPartner(initial, 'child-1', 'Sarah')
    let latest = initial
    render(
      <DashboardHarness
        initial={initial}
        editRequest={{ requestId: 42, kind: 'person', entityId: 'child-1', action: 'child' }}
        onDataChange={(next) => { latest = next }}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: /Which branch does this child belong to/i })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sarah' }))
    const newChildId = latest.people.at(-1)!.id
    expect(latest.families.find((family) => family.parentIds.includes('sarah'))?.children).toContainEqual({ personId: newChildId, birthOrder: 1 })
    expect(screen.getByText('Editing: New child')).toBeInTheDocument()
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

  it('guides every new pet route and acknowledges each field independently', () => {
    const list = openPets()
    expect(screen.getByLabelText('Breed').closest('label')).toHaveClass('new-record-field-attention')
    fireEvent.click(within(list).getByRole('button', { name: 'Add' }))

    expect(screen.getByLabelText('Name')).toHaveValue('New pet')
    for (const label of ['Name', 'Species', 'Breed', 'Birth date', 'Born / origin details', 'Personality', 'Short biography', 'Profile link 1', 'Gender', 'Human owner']) {
      expect(screen.getByLabelText(label).closest('label')).toHaveClass('new-record-field-attention')
    }
    for (const label of ['Portrait path or HTTPS PNG URL', 'Status']) {
      expect(screen.getByLabelText(label).closest('label')).not.toHaveClass('new-record-field-attention')
    }
    for (const label of [/Calculated age/, /Portrait number/]) {
      expect(screen.getByLabelText(label).closest('label')).not.toHaveClass('new-record-field-attention')
    }

    fireEvent.focus(screen.getByLabelText('Breed'))
    expect(screen.getByLabelText('Breed').closest('label')).not.toHaveClass('new-record-field-attention')
    expect(screen.getByLabelText('Species').closest('label')).toHaveClass('new-record-field-attention')
    fireEvent.focus(screen.getByLabelText('Human owner'))
    expect(screen.getByLabelText('Human owner').closest('label')).not.toHaveClass('new-record-field-attention')

    fireEvent.click(screen.getByRole('button', { name: 'Add another profile link' }))
    const profileLinks = screen.getAllByPlaceholderText('https://…')
    expect(profileLinks).toHaveLength(2)
    expect(profileLinks[0].closest('label')).toHaveClass('new-record-field-attention')
    expect(profileLinks[1].closest('label')).not.toHaveClass('new-record-field-attention')

    fireEvent.click(screen.getByRole('button', { name: 'Add offspring' }))
    expect(screen.getByLabelText('Name')).toHaveValue('New pet')
    expect(screen.getByLabelText('Name').closest('label')).toHaveClass('new-record-field-attention')

    fireEvent.click(screen.getByRole('button', { name: 'Add pet partner' }))
    expect(screen.getByLabelText('Name')).toHaveValue('New pet partner')
    expect(screen.getByLabelText('Name').closest('label')).toHaveClass('new-record-field-attention')
    expect(screen.getByLabelText('Human owner').closest('label')).toHaveClass('new-record-field-attention')
  })

  it('keeps only incomplete existing pet fields highlighted until focus', () => {
    const list = openPets()
    for (const label of ['Breed', 'Short biography', 'Profile link 1']) {
      expect(screen.getByLabelText(label).closest('label')).toHaveClass('new-record-field-attention')
    }
    for (const label of ['Name', 'Species', 'Born / origin details', 'Personality', 'Gender', 'Status', 'Human owner']) {
      expect(screen.getByLabelText(label).closest('label')).not.toHaveClass('new-record-field-attention')
    }
    fireEvent.focus(screen.getByLabelText('Breed'))
    expect(screen.getByLabelText('Breed').closest('label')).not.toHaveClass('new-record-field-attention')
    fireEvent.click(within(list).getByRole('button', { name: 'Add' }))
    fireEvent.click(within(list).getByRole('button', { name: /Iring Brown/i }))
    expect(screen.getByLabelText('Breed').closest('label')).not.toHaveClass('new-record-field-attention')
    expect(screen.getByLabelText('Short biography').closest('label')).toHaveClass('new-record-field-attention')
  })

  it('shows the exact pet field guidance and calculated-age explanation', () => {
    openPets()
    expect(screen.getByPlaceholderText('e.g. Puspin, Aspin, Chihuahua')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Year, year-month, or year-month-day')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Where the pet was born or found')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Personality of the pet')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Short description or story of the pet')).toBeInTheDocument()
    expect(screen.getByText('Adding a birth date automatically calculates the pet’s age.')).toBeInTheDocument()
  })

  it('detects duplicate pet portrait numbers within the pet namespace', () => {
    const list = openPets()
    fireEvent.click(within(list).getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText(/Portrait number/i), { target: { value: '1' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Pet portrait 1 is already assigned')
  })

  it('synchronizes pet portrait numbers and canonical pet paths in both directions', () => {
    const list = openPets()
    fireEvent.click(within(list).getByRole('button', { name: 'Add' }))
    const numberInput = screen.getByLabelText(/Portrait number/i)
    const pathInput = screen.getByLabelText('Portrait path or HTTPS PNG URL')

    fireEvent.change(pathInput, { target: { value: '/portraits/pets/3.png' } })
    expect(numberInput).toHaveValue(3)
    fireEvent.change(pathInput, { target: { value: 'portraits/3.png' } })
    expect(numberInput).toHaveValue(3)
    fireEvent.change(pathInput, { target: { value: 'https://example.com/pets/3.png' } })
    expect(numberInput).toHaveValue(3)
    fireEvent.change(numberInput, { target: { value: '4' } })
    expect(pathInput).toHaveValue('https://example.com/pets/3.png')
    fireEvent.change(pathInput, { target: { value: 'portraits/pets/1.png' } })
    expect(numberInput).toHaveValue(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Pet portrait 1 is already assigned')
    fireEvent.click(screen.getByRole('button', { name: 'Archive & export' }))
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled()
  })

  it('navigates between an owner and owned pets while exiting both bulk modes', () => {
    const initial = structuredClone(seed) as TreeData
    initial.pets[0].ownerPersonId = 'father'
    initial.pets.push({ ...createBlankPet('brownie', 'Brownie', 2), species: 'Dog', ownerPersonId: 'father' })
    render(<DashboardHarness initial={initial} />)

    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    let peopleList = screen.getByRole('complementary', { name: 'People' })
    fireEvent.click(within(peopleList).getByRole('checkbox', { name: 'People' }))
    expect(within(peopleList).getByRole('checkbox', { name: 'People' })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Pets' }))
    let petsList = screen.getByRole('complementary', { name: 'Pets' })
    fireEvent.click(within(petsList).getByRole('checkbox', { name: 'Pets' }))
    expect(within(petsList).getByRole('checkbox', { name: 'Pets' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Open owner' }))

    peopleList = screen.getByRole('complementary', { name: 'People' })
    expect(within(peopleList).getByRole('checkbox', { name: 'People' })).not.toBeChecked()
    expect(screen.getByText('Editing: Father')).toBeInTheDocument()
    expect(screen.getByText('Owned pets').parentElement).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: 'Open Iring Brown in Pets editor' })).toHaveTextContent('Cat')
    fireEvent.click(screen.getByRole('button', { name: 'Open Brownie in Pets editor' }))

    petsList = screen.getByRole('complementary', { name: 'Pets' })
    expect(within(petsList).getByRole('checkbox', { name: 'Pets' })).not.toBeChecked()
    expect(screen.getByText('Editing: Brownie')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Human owner'), { target: { value: 'mother' } })
    expect(screen.getByText('Owned by').parentElement).toHaveTextContent('Mother')
    fireEvent.click(screen.getByRole('button', { name: 'Open owner' }))
    expect(screen.getByText('Editing: Mother')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Brownie in Pets editor' })).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('complementary', { name: 'People' })).getByRole('button', { name: /^Child 7/i }))
    expect(screen.getByText('No pets are assigned to this person.')).toBeInTheDocument()
  })

  it('keeps a missing pet owner non-interactive', () => {
    const initial = structuredClone(seed) as TreeData
    initial.pets[0].ownerPersonId = 'missing-person'
    render(<DashboardHarness initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pets' }))
    expect(screen.queryByRole('button', { name: 'Open owner' })).not.toBeInTheDocument()
  })

  it('shows pet partner and offspring shortcuts and navigates to the exact record', () => {
    const initial = structuredClone(seed) as TreeData
    initial.pets.push(
      { ...createBlankPet('pet-partner', 'Pet Partner', 2), species: 'Cat' },
      { ...createBlankPet('pet-offspring', 'Pet Offspring', 3), species: 'Cat' },
    )
    initial.petFamilies.push({ id: 'iring-family', parentPetIds: ['iring-brown', 'pet-partner'], children: [{ petId: 'pet-offspring', birthOrder: 1 }] })
    render(<DashboardHarness initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pets' }))
    const partners = screen.getByRole('region', { name: 'Partners' })
    const offspring = screen.getByRole('region', { name: 'Offspring' })
    expect(within(partners).getByRole('button', { name: 'Open pet partner Pet Partner' })).toBeInTheDocument()
    expect(within(offspring).getByRole('button', { name: 'Open offspring Pet Offspring, with Pet Partner' })).toBeInTheDocument()
    fireEvent.click(within(offspring).getByRole('button', { name: 'Open offspring Pet Offspring, with Pet Partner' }))
    expect(screen.getByText('Editing: Pet Offspring')).toBeInTheDocument()
  })

  it('uses a partner chooser for multiple pet unions and creates offspring in the selected branch', async () => {
    const initial = structuredClone(seed) as TreeData
    initial.pets.push(createBlankPet('pet-one', 'Pet One', 2), createBlankPet('pet-two', 'Pet Two', 3))
    initial.petFamilies.push(
      { id: 'iring-one', parentPetIds: ['iring-brown', 'pet-one'], children: [] },
      { id: 'iring-two', parentPetIds: ['iring-brown', 'pet-two'], children: [] },
    )
    let latest = initial
    render(
      <DashboardHarness
        initial={initial}
        editRequest={{ requestId: 51, kind: 'pet', entityId: 'iring-brown', action: 'child' }}
        onDataChange={(next) => { latest = next }}
      />,
    )
    const dialog = await screen.findByRole('dialog', { name: /Which branch does this offspring belong to/i })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pet Two' }))
    const newPetId = latest.pets.at(-1)!.id
    expect(latest.petFamilies.find((family) => family.id === 'iring-two')?.children).toContainEqual({ petId: newPetId, birthOrder: 1 })
    expect(latest.petFamilies.find((family) => family.id === 'iring-one')?.children).toEqual([])
    await waitFor(() => expect(screen.getByText('Editing: New pet')).toBeInTheDocument())
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
    expect(birthDate).toHaveValue('2020-mar')
    const deathDate = screen.getByLabelText('Death date')
    expect(deathDate.closest('label')).toHaveClass('death-date-reveal')
    fireEvent.focus(deathDate)
    expect(deathDate.closest('label')).not.toHaveClass('death-date-reveal')
    fireEvent.change(deathDate, { target: { value: '2024-May' } })
    fireEvent.blur(deathDate)
    expect(deathDate).toHaveValue('2024-may')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'alive' } })
    expect(screen.queryByLabelText('Death date')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'dead' } })
    expect(screen.getByLabelText('Death date')).toHaveValue('')
    expect(screen.getByLabelText('Death date').closest('label')).toHaveClass('death-date-reveal')
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
