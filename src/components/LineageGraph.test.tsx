import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import seed from '../test/fixtures/tree-data-v4.json'
import type { TreeData } from '../types'
import { addPartner, createBlankPet } from '../lib/data'
import { LineageGraph } from './LineageGraph'

const fresh = () => structuredClone(seed) as TreeData

function renderGraph(data = fresh(), mode: 'people' | 'pets' = 'people') {
  return render(<LineageGraph mode={mode} people={data.people} families={data.families} pets={data.pets} petFamilies={data.petFamilies} />)
}

afterEach(() => vi.restoreAllMocks())

describe('LineageGraph details and portraits', () => {
  it('shows missing values, status, and portrait number in the hover card', () => {
    renderGraph()
    fireEvent.pointerEnter(screen.getByRole('button', { name: /Father details/i }), { pointerType: 'mouse', clientX: 100, clientY: 100 })
    const tooltip = screen.getByRole('tooltip', { name: /Father details/i })
    expect(tooltip).toHaveTextContent('Age?')
    expect(tooltip).toHaveTextContent('Born?')
    expect(tooltip).toHaveTextContent('StatusAlive')
    expect(tooltip).not.toHaveTextContent('Died')
    expect(tooltip).toHaveTextContent('Personality?')
    expect(tooltip).toHaveTextContent('1')
  })

  it('shows death date and age at death for a dead person', () => {
    const data = fresh()
    data.people[0].birthDate = '2000-07-18'
    data.people[0].status = 'dead'
    data.people[0].deathDate = '2020-07-17'
    renderGraph(data)
    fireEvent.pointerEnter(screen.getByRole('button', { name: /Father details/i }), { pointerType: 'mouse', clientX: 100, clientY: 100 })
    const tooltip = screen.getByRole('tooltip', { name: /Father details/i })
    expect(tooltip).toHaveTextContent('Age19')
    expect(tooltip).toHaveTextContent('Born2000-july-18')
    expect(tooltip).toHaveTextContent('Died2020-july-17')
  })

  it('uses one PNG candidate, then the silhouette, while preserving custom PNG overrides', () => {
    const { unmount } = renderGraph()
    const fatherButton = screen.getByRole('button', { name: /Father details/i })
    const fatherImage = fatherButton.querySelector('img')!
    expect(fatherImage.getAttribute('src')).toMatch(/\/portraits\/1\.png$/)
    fireEvent.error(fatherImage)
    expect(fatherButton.querySelector('img')).toBeNull()
    expect(fatherButton.querySelector('.portrait-fallback')).toBeInTheDocument()

    unmount()
    const data = fresh()
    data.people.find((person) => person.id === 'father')!.portrait = '/portraits/custom.png'
    renderGraph(data)
    expect(screen.getByRole('button', { name: /Father details/i }).querySelector('img')?.getAttribute('src')).toMatch(/\/portraits\/custom\.png$/)
  })

  it('connects a new partner only to the selected wife and renders each person once', async () => {
    const data = addPartner(fresh(), 'new-partner', 'Fake')
    const fakeFamily = data.families.find((family) => family.parentIds.includes('fake'))!
    expect(fakeFamily.parentIds).toEqual(['new-partner', 'fake'])
    const firstParentData = addPartner(fresh(), 'new-child', 'First parent choice')
    expect(firstParentData.families.find((family) => family.parentIds.includes('first-parent-choice'))?.parentIds).toEqual(['new-child', 'first-parent-choice'])

    const { container } = renderGraph(data)
    expect(container.querySelectorAll('[data-entity-id="new-child"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-entity-id="new-partner"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-entity-id="fake"]')).toHaveLength(1)

    const unions = [...container.querySelectorAll<HTMLElement>('[data-family-id]')].map((element) => element.dataset.parentIds)
    expect(unions).toContain('new-child new-partner')
    expect(unions).toContain('new-partner fake')
    expect(unions).not.toContain('new-child fake')

    const partnerGroup = container.querySelector('[data-center-entity-id="new-partner"]')!
    expect([...partnerGroup.querySelector('.partner-group-row')!.querySelectorAll<HTMLElement>('[data-entity-id]')].map((card) => card.dataset.entityId)).toEqual([
      'new-child',
      'new-partner',
      'fake',
    ])
    await waitFor(() => expect(container.querySelector(`[data-family-connector="${fakeFamily.id}"][data-connector-kind="union"]`)).toHaveAttribute('data-parent-ids', 'new-partner fake'))

    const originalFamily = container.querySelector<HTMLElement>('[data-family-id="family-new-child"]')!
    const newFamily = container.querySelector<HTMLElement>(`[data-family-id="${fakeFamily.id}"]`)!
    expect(originalFamily.querySelector('[data-entity-id="new-child-2"]')).toBeInTheDocument()
    expect(newFamily.querySelector('[data-entity-id="new-child-2"]')).not.toBeInTheDocument()
  })

  it('centers Child 1 between Wife and Sarah and keeps each child branch with its exact union', async () => {
    let data = addPartner(fresh(), 'child-1', 'Wife', 'family-child-1')
    data = addPartner(data, 'child-1', 'Sarah')
    const wifeFamily = data.families.find((family) => family.parentIds.includes('wife'))!
    const sarahFamily = data.families.find((family) => family.parentIds.includes('sarah'))!

    const { container } = renderGraph(data)
    const partnerGroup = container.querySelector('[data-center-entity-id="child-1"]')!
    const cards = [...partnerGroup.querySelector('.partner-group-row')!.querySelectorAll<HTMLElement>('[data-entity-id]')]
    expect(cards.map((card) => card.dataset.entityId)).toEqual(['wife', 'child-1', 'sarah'])
    expect(cards.map((card) => card.dataset.layoutSlot)).toEqual(['-1', '0', '1'])
    expect(container.querySelectorAll('[data-entity-id="child-1"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-entity-id="wife"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-entity-id="sarah"]')).toHaveLength(1)

    const unions = [...container.querySelectorAll<HTMLElement>('[data-family-id]')].map((element) => element.dataset.parentIds)
    expect(unions).toContain('child-1 wife')
    expect(unions).toContain('child-1 sarah')
    expect(unions).not.toContain('wife sarah')
    expect(wifeFamily.children.map((child) => child.personId)).toEqual(['grandchild-1-1', 'grandchild-1-2', 'grandchild-1-3', 'grandchild-1-4'])
    expect(sarahFamily.children).toEqual([])

    await waitFor(() => {
      expect(container.querySelector(`[data-family-connector="${wifeFamily.id}"][data-connector-kind="union"]`)).toHaveAttribute('data-parent-ids', 'child-1 wife')
      expect(container.querySelector(`[data-family-connector="${sarahFamily.id}"][data-connector-kind="union"]`)).toHaveAttribute('data-parent-ids', 'child-1 sarah')
    })
  })

  it('orders three direct partners and a secondary partner chain deterministically', () => {
    let data = addPartner(fresh(), 'child-1', 'Wife', 'family-child-1')
    data = addPartner(data, 'child-1', 'Sarah')
    data = addPartner(data, 'child-1', 'Taylor')
    data = addPartner(data, 'sarah', 'Alex')

    const { container } = renderGraph(data)
    const partnerGroup = container.querySelector('[data-center-entity-id="child-1"]')!
    expect([...partnerGroup.querySelector('.partner-group-row')!.querySelectorAll<HTMLElement>('[data-entity-id]')].map((card) => card.dataset.entityId)).toEqual([
      'taylor',
      'wife',
      'child-1',
      'sarah',
      'alex',
    ])
  })

  it('keeps cat and dog families in separate species lanes across shared year rows', () => {
    const data = fresh()
    const petPartner = createBlankPet('pet-partner', 'Pet partner', 2)
    const secondPartner = createBlankPet('second-pet-partner', 'Second pet partner', 3)
    const puppy = createBlankPet('puppy', 'Puppy', 4)
    const george = createBlankPet('george', 'George', 5)
    const unknownPet = createBlankPet('unknown-pet', 'Unknown pet', 6)
    petPartner.species = 'Cat'
    secondPartner.species = 'Dog'
    puppy.species = 'Cat'
    george.species = 'Dog'
    unknownPet.species = 'Bird'
    petPartner.birthDate = '2013'
    secondPartner.birthDate = '2015-08-01'
    george.birthDate = '2015-01-01'
    puppy.birthDate = '2025'
    data.pets.push(petPartner, secondPartner, puppy, george, unknownPet)
    data.petFamilies = [
      { id: 'iring-family', parentPetIds: ['iring-brown', 'pet-partner'], children: [{ petId: 'puppy', birthOrder: 1 }] },
      { id: 'second-pet-family', parentPetIds: ['pet-partner', 'second-pet-partner'], children: [] },
    ]

    const peopleGraph = renderGraph(data)
    expect(peopleGraph.container.querySelector('[data-family-id="family-child-1"]')).toHaveAttribute('data-parent-ids', 'child-1')
    peopleGraph.unmount()

    const { container } = renderGraph(data, 'pets')
    expect(container.querySelectorAll('[data-entity-id="iring-brown"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-entity-id="pet-partner"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-entity-id="second-pet-partner"]')).toHaveLength(1)
    expect([...container.querySelectorAll<HTMLElement>('[data-pet-year]')].map((band) => band.dataset.petYear)).toEqual(['2013', '2015', '2025', 'unknown'])
    expect([...container.querySelectorAll<HTMLElement>('[data-pet-species-heading]')].map((heading) => heading.dataset.petSpeciesHeading)).toEqual(['cat', 'dog', 'bird'])
    expect([...container.querySelectorAll<HTMLElement>('[data-pet-year="2013"] [data-entity-id]')].map((card) => card.dataset.entityId)).toEqual(['iring-brown', 'pet-partner'])
    expect([...container.querySelectorAll<HTMLElement>('[data-pet-year="2015"] [data-pet-species="dog"] [data-entity-id]')].map((card) => card.dataset.entityId)).toEqual(['george', 'second-pet-partner'])
    expect([...container.querySelectorAll<HTMLElement>('[data-pet-year="2025"] [data-pet-species="cat"] [data-entity-id]')].map((card) => card.dataset.entityId)).toEqual(['puppy'])
    expect(container.querySelector('[data-pet-year="2015"] [data-pet-species="cat"] [data-entity-id]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-pet-year="2025"] [data-pet-species="dog"] [data-entity-id]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-pet-year="unknown"]')).toHaveTextContent('Unknown year')
    expect(container.querySelector('[data-family-id="iring-family"]')).toHaveAttribute('data-parent-ids', 'iring-brown pet-partner')
    expect(container.querySelector('[data-family-id="second-pet-family"]')).toHaveAttribute('data-parent-ids', 'pet-partner second-pet-partner')
  })

  it('shows the protected Iring Brown founder, portrait number, and birth details', () => {
    renderGraph(fresh(), 'pets')
    const iring = screen.getByRole('button', { name: /Iring Brown details/i })
    fireEvent.pointerEnter(iring, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    const tooltip = screen.getByRole('tooltip', { name: /Iring Brown details/i })
    expect(tooltip).toHaveTextContent(`Age${new Date().getFullYear() - 2013}`)
    expect(tooltip).toHaveTextContent('Born2013')
    expect(tooltip).toHaveTextContent('Died?')
    expect(tooltip).toHaveTextContent('StatusDead')
    expect(within(tooltip).getByLabelText('Portrait number 1')).toHaveTextContent('1')
  })
})

describe('LineageGraph multi-link activation', () => {
  it('toggles pinned details from the same portrait without navigating or using a close button', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderGraph()
    const father = screen.getByRole('button', { name: /Father details/i })
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Father details/i, { selector: 'aside' })).toHaveAttribute('role', 'dialog')
    expect(screen.queryByRole('button', { name: 'Close details' })).not.toBeInTheDocument()
    expect(father).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    expect(screen.queryByLabelText(/Father details/i, { selector: 'aside' })).not.toBeInTheDocument()
  })

  it('opens one safe link only through Visit 1 for mouse and keyboard activation', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const data = fresh()
    data.people[0].links = ['https://example.com/father']
    renderGraph(data)
    const father = screen.getByRole('button', { name: /Father details, 1 profile link available/i })
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    expect(open).not.toHaveBeenCalled()
    const dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    expect(within(dialog).getByText('Visit 1', { selector: 'a' })).toHaveAttribute('href', 'https://example.com/father')
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    fireEvent.keyDown(father, { key: 'Enter' })
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Father details/i, { selector: 'aside' })).toHaveAttribute('role', 'dialog')
  })

  it('replaces the pinned profile, ignores background activation, and keeps another hover tooltip visible', () => {
    renderGraph()
    const father = screen.getByRole('button', { name: /Father details/i })
    const mother = screen.getByRole('button', { name: /Mother details/i })
    fireEvent.pointerUp(father, { pointerType: 'touch', button: 0 })
    fireEvent.pointerEnter(mother, { pointerType: 'mouse', clientX: 120, clientY: 100 })
    expect(screen.getByLabelText(/Father details/i, { selector: 'aside' })).toHaveAttribute('role', 'dialog')
    expect(screen.getByRole('tooltip', { name: /Mother details/i })).toBeInTheDocument()
    fireEvent.pointerUp(mother, { pointerType: 'mouse', button: 0 })
    expect(screen.queryByLabelText(/Father details/i, { selector: 'aside' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Mother details/i, { selector: 'aside' })).toHaveAttribute('role', 'dialog')
    const viewport = screen.getByTestId('lineage-viewport')
    fireEvent.pointerDown(viewport, { pointerType: 'mouse', pointerId: 22, clientX: 400, clientY: 300 })
    fireEvent.pointerUp(viewport, { pointerType: 'mouse', pointerId: 22, clientX: 400, clientY: 300 })
    expect(screen.getByLabelText(/Mother details/i, { selector: 'aside' })).toHaveAttribute('role', 'dialog')
  })

  it('renders exact Visit labels with safe new-tab attributes for multiple links', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const data = fresh()
    data.people[0].links = ['https://example.com/profile', 'http://example.com/video']
    renderGraph(data)
    fireEvent.pointerUp(screen.getByRole('button', { name: /2 profile links available/i }), { pointerType: 'mouse', button: 0 })
    expect(open).not.toHaveBeenCalled()
    const dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    const first = within(dialog).getByText('Visit 1', { selector: 'a' })
    const second = within(dialog).getByText('Visit 2', { selector: 'a' })
    expect(first).toHaveAttribute('href', 'https://example.com/profile')
    expect(second).toHaveAttribute('href', 'http://example.com/video')
    expect(first).toHaveAttribute('target', '_blank')
    expect(first).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('LineageGraph viewport controls', () => {
  it('keeps a readable pinned callout anchored inside the viewport as the graph moves', async () => {
    const { container } = renderGraph()
    const viewport = screen.getByTestId('lineage-viewport')
    const father = screen.getByRole('button', { name: /Father details/i })
    const portrait = father.querySelector<HTMLElement>('.portrait-ring')!
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) })
    let portraitLeft = 300
    vi.spyOn(portrait, 'getBoundingClientRect').mockImplementation(() => ({
      left: portraitLeft,
      top: 300,
      right: portraitLeft + 106,
      bottom: 406,
      width: 106,
      height: 106,
      x: portraitLeft,
      y: 300,
      toJSON: () => ({}),
    }))

    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    Object.defineProperty(dialog, 'offsetWidth', { configurable: true, value: 266 })
    Object.defineProperty(dialog, 'offsetHeight', { configurable: true, value: 180 })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() => expect(dialog).toHaveStyle({ left: '220px', top: '103px', visibility: 'visible' }))
    expect(dialog).toHaveClass('detail-pinned', 'is-above')
    expect(viewport).toContainElement(dialog)
    const firstLeft = dialog.style.left

    portraitLeft = 500
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() => expect(dialog.style.left).not.toBe(firstLeft))
    expect(container.querySelector('.detail-pinned')).toBe(dialog)
  })

  it('zooms only through the lineage viewport wheel listener and keeps toolbar controls', () => {
    renderGraph()
    const viewport = screen.getByTestId('lineage-viewport')
    const canvas = screen.getByTestId('lineage-canvas')
    const before = canvas.style.transform
    fireEvent.wheel(viewport, { deltaY: -300, clientX: 120, clientY: 100 })
    expect(canvas.style.transform).not.toBe(before)
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset and fit graph' })).toBeInTheDocument()
  })

  it('supports two-pointer pinch scaling inside the viewport', () => {
    renderGraph()
    const viewport = screen.getByTestId('lineage-viewport')
    const canvas = screen.getByTestId('lineage-canvas')
    fireEvent.pointerDown(viewport, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    fireEvent.pointerDown(viewport, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 })
    const before = canvas.style.transform
    fireEvent.pointerMove(viewport, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 })
    expect(canvas.style.transform).not.toBe(before)
    fireEvent.pointerUp(viewport, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    fireEvent.pointerUp(viewport, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 })
  })
})
