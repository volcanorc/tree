import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import seed from '../test/fixtures/tree-data-v4.json'
import publishedArchive from '../../public/tree-data.json'
import type { ArchiveEditIntent, ArchiveEntityPatch, TreeData } from '../types'
import { addPartner, createBlankPet } from '../lib/data'
import { LineageGraph } from './LineageGraph'

const fresh = () => structuredClone(seed) as TreeData

function renderGraph(
  data = fresh(),
  mode: 'people' | 'pets' = 'people',
  options: {
    onOwnerNavigate?: (personId: string) => void
    onPetNavigate?: (petId: string) => void
    focusRequest?: { entityId: string; requestId: number } | null
    onFocusAcknowledge?: (requestId: number) => void
    canEdit?: boolean
    onEditAction?: (intent: ArchiveEditIntent) => void
    onEntityPatch?: (request: ArchiveEntityPatch) => string
    recentEntityId?: string | null
    interactionLocked?: boolean
    onOpenMap?: () => void
    fullscreenMode?: boolean
    onToggleFullscreen?: (trigger?: HTMLElement) => void
  } = {},
) {
  return render(
    <LineageGraph
      mode={mode}
      people={data.people}
      families={data.families}
      pets={data.pets}
      petFamilies={data.petFamilies}
      {...options}
    />,
  )
}

function highlightTrigger(label: 'Status and gender highlight' | 'Lineage path') {
  return screen.getByRole('button', { name: label })
}

function commitHighlight(label: 'Status and gender highlight' | 'Lineage path', option: string) {
  const trigger = highlightTrigger(label)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option', { name: option }))
  return trigger
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

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
    expect(tooltip).toHaveTextContent('BornJuly 18 2000')
    expect(tooltip).toHaveTextContent('DiedJuly 17 2020')
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

  it('formats partial pet birth dates and full pet death dates naturally', () => {
    const data = fresh()
    data.pets[0].birthDate = '2020-mar'
    data.pets[0].deathDate = '2024-dec-9'
    renderGraph(data, 'pets')
    fireEvent.pointerEnter(screen.getByRole('button', { name: /Iring Brown details/i }), { pointerType: 'mouse', clientX: 100, clientY: 100 })
    const tooltip = screen.getByRole('tooltip', { name: /Iring Brown details/i })
    expect(tooltip).toHaveTextContent('BornMarch 2020')
    expect(tooltip).toHaveTextContent('DiedDecember 9 2024')
  })
})

describe('LineageGraph family-line highlights', () => {
  it('offers separate alphabetical people-only lineage paths and explains the selected profile line', async () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { unmount } = renderGraph(data)
    const profileTrigger = highlightTrigger('Status and gender highlight')
    const lineageTrigger = highlightTrigger('Lineage path')
    fireEvent.click(profileTrigger)
    expect(within(screen.getByRole('listbox', { name: 'Status & gender options' })).getAllByRole('option').map((option) => option.textContent?.replace('✓', ''))).toEqual(['Set', 'Dead', 'Alive', 'Male', 'Female'])
    fireEvent.keyDown(profileTrigger, { key: 'Escape' })
    fireEvent.click(lineageTrigger)
    expect(within(screen.getByRole('listbox', { name: 'Lineage path options' })).getAllByRole('option').map((option) => option.textContent?.replace('✓', ''))).toEqual([
      'Set', 'Bering', 'Castaneda', 'Ermac', 'Sullano', 'Tayad',
    ])
    fireEvent.pointerUp(screen.getByRole('button', { name: /Nemisio Sullano details/i }), { pointerType: 'mouse', button: 0 })
    expect(screen.getByLabelText('Nemisio Sullano details', { selector: 'aside' })).toHaveTextContent('Family lineSullano')

    unmount()
    renderGraph(data, 'pets')
    expect(highlightTrigger('Status and gender highlight')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lineage path' })).not.toBeInTheDocument()
  })

  it('keeps profile and lineage filters mutually exclusive without coupling their Set choices', () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    const profileTrigger = highlightTrigger('Status and gender highlight')
    const lineageTrigger = highlightTrigger('Lineage path')

    commitHighlight('Status and gender highlight', 'Male')
    expect(profileTrigger).toHaveAttribute('data-value', 'male')
    expect(lineageTrigger).toHaveAttribute('data-value', 'set')
    commitHighlight('Lineage path', 'Set')
    expect(profileTrigger).toHaveAttribute('data-value', 'male')

    commitHighlight('Lineage path', 'Sullano')
    expect(profileTrigger).toHaveAttribute('data-value', 'set')
    expect(lineageTrigger).toHaveAttribute('data-value', 'sullano')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-lineage')
    commitHighlight('Status and gender highlight', 'Set')
    expect(lineageTrigger).toHaveAttribute('data-value', 'sullano')

    commitHighlight('Status and gender highlight', 'Female')
    expect(profileTrigger).toHaveAttribute('data-value', 'female')
    expect(lineageTrigger).toHaveAttribute('data-value', 'set')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-female')
  })

  it('keeps the latest status preview after mouse leave, restores on outside click, and commits only on option click', () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    const trigger = highlightTrigger('Status and gender highlight')

    fireEvent.click(trigger)
    const dead = screen.getByRole('option', { name: 'Dead' })
    fireEvent.mouseEnter(dead)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-dead')
    expect(trigger).toHaveAttribute('data-value', 'set')

    fireEvent.mouseLeave(trigger.closest('.highlight-filter')!)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-dead')
    expect(screen.getByRole('listbox', { name: 'Status & gender options' })).toBeInTheDocument()
    expect(trigger).toHaveAttribute('data-value', 'set')

    fireEvent.click(document.body)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-set')
    expect(screen.queryByRole('listbox', { name: 'Status & gender options' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    const alive = screen.getByRole('option', { name: 'Alive' })
    fireEvent.mouseEnter(alive)
    fireEvent.click(alive)
    expect(trigger).toHaveAttribute('data-value', 'alive')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-alive')
  })

  it('restores the previous committed status after a different persistent hover preview is dismissed', () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    const trigger = commitHighlight('Status and gender highlight', 'Female')

    fireEvent.click(trigger)
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Male' }))
    fireEvent.mouseLeave(trigger.closest('.highlight-filter')!)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-male')
    expect(trigger).toHaveAttribute('data-value', 'female')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(document.body)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-female')
    expect(trigger).toHaveAttribute('data-value', 'female')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('temporarily suspends the other filter during preview and resets it only after commit', () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    const profileTrigger = commitHighlight('Status and gender highlight', 'Male')
    const lineageTrigger = highlightTrigger('Lineage path')

    fireEvent.click(lineageTrigger)
    const sullano = screen.getByRole('option', { name: 'Sullano' })
    fireEvent.mouseEnter(sullano)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-lineage')
    expect(profileTrigger).toHaveAttribute('data-value', 'male')
    expect(lineageTrigger).toHaveAttribute('data-value', 'set')

    fireEvent.mouseLeave(lineageTrigger.closest('.highlight-filter')!)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-lineage')
    expect(screen.getByRole('listbox', { name: 'Lineage path options' })).toBeInTheDocument()
    expect(lineageTrigger).toHaveAttribute('data-value', 'set')

    fireEvent.click(document.body)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-male')
    expect(profileTrigger).toHaveAttribute('data-value', 'male')

    fireEvent.click(lineageTrigger)
    const reopenedSullano = screen.getByRole('option', { name: 'Sullano' })
    fireEvent.mouseEnter(reopenedSullano)
    fireEvent.click(reopenedSullano)
    expect(profileTrigger).toHaveAttribute('data-value', 'set')
    expect(lineageTrigger).toHaveAttribute('data-value', 'sullano')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-lineage')
  })

  it('restores a committed lineage path after previewing another path outside the menu', () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    const lineageTrigger = commitHighlight('Lineage path', 'Sullano')

    fireEvent.click(lineageTrigger)
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Bering' }))
    fireEvent.mouseLeave(lineageTrigger.closest('.highlight-filter')!)
    expect(lineageTrigger).toHaveAttribute('data-value', 'sullano')
    expect(container.querySelector('[data-entity-id="new-partner-5"]')).toHaveAttribute('data-lineage-role', 'member')

    fireEvent.click(document.body)
    expect(lineageTrigger).toHaveAttribute('data-value', 'sullano')
    expect(container.querySelector('[data-entity-id="new-partner-5"]')).toHaveAttribute('data-lineage-role', 'partner')
    expect(screen.queryByRole('listbox', { name: 'Lineage path options' })).not.toBeInTheDocument()
  })

  it('dismisses one preview before opening the other filter', () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    const profileTrigger = commitHighlight('Status and gender highlight', 'Female')
    const lineageTrigger = highlightTrigger('Lineage path')

    fireEvent.click(profileTrigger)
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Male' }))
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-male')

    fireEvent.click(lineageTrigger)
    expect(profileTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(lineageTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-female')
  })

  it('supports keyboard preview, Escape restoration, Enter commit, and outside dismissal', () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    const trigger = highlightTrigger('Status and gender highlight')
    const canvas = screen.getByTestId('lineage-canvas')
    const transformBeforeFilterKeys = canvas.style.transform

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const dead = screen.getByRole('option', { name: 'Dead' })
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-dead')
    expect(canvas.style.transform).toBe(transformBeforeFilterKeys)
    fireEvent.keyDown(dead, { key: 'Escape' })
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-set')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('option', { name: 'Dead' }), { key: 'Enter' })
    expect(trigger).toHaveAttribute('data-value', 'dead')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-dead')

    fireEvent.click(trigger)
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Alive' }))
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-alive')
    fireEvent.click(document.body)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-dead')
    expect(trigger).toHaveAttribute('data-value', 'dead')
  })

  it('restores a preview on Tab and commits touch selections without hover', () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    const trigger = highlightTrigger('Status and gender highlight')

    fireEvent.click(trigger)
    const female = screen.getByRole('option', { name: 'Female' })
    fireEvent.focus(female)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-female')
    fireEvent.blur(female, { relatedTarget: screen.getByRole('button', { name: 'Zoom in' }) })
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-set')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: 'Male' }), { pointerType: 'touch' })
    expect(trigger).toHaveAttribute('data-value', 'male')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-male')

    fireEvent.keyDown(trigger, { key: ' ' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(screen.getByRole('option', { name: 'Male' }), { key: ' ' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('data-value', 'male')
  })

  it('classifies Sullano members, introduced partners, stopped branches, and split connectors', async () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    commitHighlight('Lineage path', 'Sullano')

    expect(container.querySelector('[data-entity-id="father"]')).toHaveAttribute('data-lineage-role', 'member')
    expect(container.querySelector('[data-entity-id="mother"]')).toHaveAttribute('data-lineage-role', 'partner')
    expect(container.querySelector('[data-entity-id="child-2"]')).toHaveAttribute('data-lineage-role', 'member')
    expect(container.querySelector('[data-entity-id="new-partner-5"]')).toHaveAttribute('data-lineage-role', 'partner')
    expect(container.querySelector('[data-entity-id="grandchild-2-1"]')).toHaveAttribute('data-lineage-role', 'none')

    await waitFor(() => {
      expect(container.querySelector('[data-family-connector="root-family"][data-source-parent-id="father"]')).toHaveAttribute('data-lineage-path-role', 'carrier')
      expect(container.querySelector('[data-family-connector="root-family"][data-source-parent-id="mother"]')).toHaveAttribute('data-lineage-path-role', 'partner')
      expect(container.querySelector('[data-family-connector="root-family"][data-child-id="child-2"]')).toHaveAttribute('data-lineage-path-role', 'carrier')
      expect(container.querySelector('[data-family-connector="family-child-2"][data-child-id="grandchild-2-1"]')).toHaveAttribute('data-lineage-path-role', 'black')
      expect(container.querySelector('[data-family-connector="family-child-2"][data-connector-kind="family-stem"]')).toHaveAttribute('data-lineage-path-role', 'black')
    })
  })

  it('reverse-filters Bering with its parent green and Sullano partner pink', () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    commitHighlight('Lineage path', 'Bering')
    expect(container.querySelector('[data-entity-id="new-partner-5"]')).toHaveAttribute('data-lineage-role', 'member')
    expect(container.querySelector('[data-entity-id="child-2"]')).toHaveAttribute('data-lineage-role', 'partner')
    expect(container.querySelector('[data-entity-id="grandchild-2-1"]')).toHaveAttribute('data-lineage-role', 'member')
  })

  it('shows a gender-neutral Tayad origin path for direct children only and isolates the second-partner branch', async () => {
    const data = structuredClone(publishedArchive) as TreeData
    const { container } = renderGraph(data)
    commitHighlight('Lineage path', 'Tayad')

    expect(container.querySelector('[data-entity-id="new-partner"]')).toHaveAttribute('data-lineage-role', 'member')
    expect(container.querySelector('[data-entity-id="child-1"]')).toHaveAttribute('data-lineage-role', 'partner')
    expect(container.querySelector('[data-entity-id="grandchild-1-2"]')).toHaveAttribute('data-lineage-role', 'member')
    expect(container.querySelector('[data-entity-id="grandchild-1-3"]')).toHaveAttribute('data-lineage-role', 'member')
    expect(container.querySelector('[data-entity-id="grandchild-1-4"]')).toHaveAttribute('data-lineage-role', 'member')
    expect(container.querySelector('[data-entity-id="new-partner-2"]')).toHaveAttribute('data-lineage-role', 'none')
    expect(container.querySelector('[data-entity-id="new-child"]')).toHaveAttribute('data-lineage-role', 'none')

    await waitFor(() => {
      expect(container.querySelector('[data-family-connector="family-child-1"][data-source-parent-id="new-partner"]')).toHaveAttribute('data-lineage-path-role', 'carrier')
      expect(container.querySelector('[data-family-connector="family-child-1"][data-source-parent-id="child-1"]')).toHaveAttribute('data-lineage-path-role', 'partner')
      expect(container.querySelector('[data-family-connector="family-child-1"][data-connector-kind="family-stem"]')).toHaveAttribute('data-lineage-path-role', 'carrier')
      expect(container.querySelector('[data-family-connector="family-child-1"][data-child-id="grandchild-1-2"]')).toHaveAttribute('data-lineage-path-role', 'carrier')
      expect(container.querySelector('[data-family-connector="family-child-1-2"][data-connector-kind="family-stem"]')).toHaveAttribute('data-lineage-path-role', 'black')
      expect(container.querySelector('[data-family-connector="family-child-1-2"][data-child-id="new-child"]')).toHaveAttribute('data-lineage-path-role', 'black')
    })
  })
})

describe('LineageGraph multi-link activation', () => {
  it('toggles pinned details from the same portrait and provides a close button', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderGraph()
    const father = screen.getByRole('button', { name: /Father details/i })
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    expect(open).not.toHaveBeenCalled()
    const dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    expect(dialog).toHaveAttribute('role', 'dialog')
    expect(within(dialog).getByLabelText('Close profile details')).toBeInTheDocument()
    expect(father).toHaveClass('is-active')
    expect(father).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    expect(screen.queryByLabelText(/Father details/i, { selector: 'aside' })).not.toBeInTheDocument()
    expect(father).not.toHaveClass('is-active')
  })

  it('closes pinned details from the callout button and clears the active portrait', () => {
    renderGraph()
    const father = screen.getByRole('button', { name: /Father details/i })
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    expect(father).toHaveClass('is-active')
    const dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByLabelText('Close profile details'))
    expect(screen.queryByLabelText(/Father details/i, { selector: 'aside' })).not.toBeInTheDocument()
    expect(father).not.toHaveClass('is-active')
    expect(father).toHaveAttribute('aria-expanded', 'false')
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

describe('LineageGraph touch-hold previews', () => {
  it('waits 450 ms, closes on release, and suppresses pinned activation after a hold', () => {
    vi.useFakeTimers()
    renderGraph()
    const father = screen.getByRole('button', { name: /Father details/i })

    fireEvent.pointerEnter(father, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 120 })
    fireEvent.pointerDown(father, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 120 })
    act(() => vi.advanceTimersByTime(449))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('tooltip', { name: /Father details/i })).toBeInTheDocument()

    fireEvent.pointerUp(father, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 120 })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Father details/i, { selector: 'aside' })).not.toBeInTheDocument()
  })

  it('keeps a short touch as a pinned-profile tap', () => {
    vi.useFakeTimers()
    renderGraph()
    const father = screen.getByRole('button', { name: /Father details/i })
    fireEvent.pointerDown(father, { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 120 })
    act(() => vi.advanceTimersByTime(200))
    fireEvent.pointerUp(father, { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 120 })
    expect(screen.getByLabelText(/Father details/i, { selector: 'aside' })).toHaveAttribute('role', 'dialog')
  })

  it('cancels a hold after movement or pointer cancellation without opening a profile', () => {
    vi.useFakeTimers()
    renderGraph()
    const father = screen.getByRole('button', { name: /Father details/i })

    fireEvent.pointerDown(father, { pointerId: 3, pointerType: 'touch', clientX: 100, clientY: 120 })
    fireEvent.pointerMove(father, { pointerId: 3, pointerType: 'touch', clientX: 111, clientY: 120 })
    act(() => vi.advanceTimersByTime(450))
    fireEvent.pointerUp(father, { pointerId: 3, pointerType: 'touch', clientX: 111, clientY: 120 })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Father details/i, { selector: 'aside' })).not.toBeInTheDocument()

    fireEvent.pointerDown(father, { pointerId: 4, pointerType: 'touch', clientX: 100, clientY: 120 })
    fireEvent.pointerCancel(father, { pointerId: 4, pointerType: 'touch', clientX: 100, clientY: 120 })
    act(() => vi.advanceTimersByTime(450))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Father details/i, { selector: 'aside' })).not.toBeInTheDocument()
  })

  it('shows a held profile beside a different pinned profile and leaves the pin intact', () => {
    vi.useFakeTimers()
    renderGraph()
    const father = screen.getByRole('button', { name: /Father details/i })
    const mother = screen.getByRole('button', { name: /Mother details/i })
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })

    fireEvent.pointerDown(mother, { pointerId: 5, pointerType: 'touch', clientX: 160, clientY: 120 })
    act(() => vi.advanceTimersByTime(450))
    expect(screen.getByLabelText(/Father details/i, { selector: 'aside' })).toHaveAttribute('role', 'dialog')
    expect(screen.getByRole('tooltip', { name: /Mother details/i })).toBeInTheDocument()

    fireEvent.pointerUp(mother, { pointerId: 5, pointerType: 'touch', clientX: 160, clientY: 120 })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Father details/i, { selector: 'aside' })).toHaveAttribute('role', 'dialog')
  })
})

describe('LineageGraph highlights and archive actions', () => {
  it('keeps a fixed Set selector outside the canvas and targets exactly one chosen filter', () => {
    const data = fresh()
    data.people.find((person) => person.id === 'father')!.status = 'dead'
    data.people.find((person) => person.id === 'mother')!.gender = 'female'
    const { container } = renderGraph(data)
    const viewport = screen.getByTestId('lineage-viewport')
    const canvas = screen.getByTestId('lineage-canvas')
    const trigger = highlightTrigger('Status and gender highlight')
    const control = trigger.closest<HTMLElement>('.highlight-control')!
    expect(trigger).toHaveAttribute('data-value', 'set')
    expect(viewport).toContainElement(control)
    expect(canvas).not.toContainElement(control)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-set')

    commitHighlight('Status and gender highlight', 'Dead')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-dead')
    expect(container.querySelector('[data-entity-id="father"]')).toHaveAttribute('data-status', 'dead')
    expect(container.querySelectorAll('.highlight-dead [data-status="dead"]')).toHaveLength(1)

    commitHighlight('Status and gender highlight', 'Alive')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-alive')
    commitHighlight('Status and gender highlight', 'Male')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-male')
    commitHighlight('Status and gender highlight', 'Female')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-female')
    expect(container.querySelector('[data-entity-id="mother"]')).toHaveAttribute('data-gender', 'female')
  })

  it('keeps active gold and owner-target states separate from filter matching', async () => {
    const { container } = renderGraph(fresh(), 'people', { focusRequest: { entityId: 'father', requestId: 91 } })
    commitHighlight('Status and gender highlight', 'Alive')
    const father = screen.getByRole('button', { name: /Father details.*navigation target/i })
    expect(father).toHaveClass('is-owner-target')
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    await waitFor(() => expect(father).toHaveClass('is-active'))
    expect(father).not.toHaveClass('is-owner-target')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-alive')
  })

  it('applies the same status and gender filters to pet portraits', () => {
    const data = fresh()
    const { container } = renderGraph(data, 'pets')
    const iring = container.querySelector('[data-entity-id="iring-brown"]')
    const trigger = highlightTrigger('Status and gender highlight')

    fireEvent.click(trigger)
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Dead' }))
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-dead')
    expect(trigger).toHaveAttribute('data-value', 'set')
    fireEvent.mouseLeave(trigger.closest('.highlight-filter')!)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-dead')
    expect(screen.getByRole('listbox', { name: 'Status & gender options' })).toBeInTheDocument()
    fireEvent.click(document.body)
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-set')
    commitHighlight('Status and gender highlight', 'Dead')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-dead')
    expect(iring).toHaveAttribute('data-status', 'dead')
    commitHighlight('Status and gender highlight', 'Female')
    expect(container.querySelector('.lineage-section')).toHaveClass('highlight-female')
    expect(iring).toHaveAttribute('data-gender', 'female')
  })

  it('shows edit actions only in authenticated pinned profiles and reports exact intents', () => {
    const onEditAction = vi.fn()
    const loggedOut = renderGraph()
    fireEvent.pointerUp(screen.getByRole('button', { name: /Child 1 details/i }), { pointerType: 'mouse', button: 0 })
    expect(screen.queryByLabelText('Archive editing actions')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Profile actions')).not.toBeInTheDocument()
    loggedOut.unmount()

    renderGraph(fresh(), 'people', { canEdit: true, onEditAction })
    const child = screen.getByRole('button', { name: /Child 1 details/i })
    fireEvent.pointerEnter(child, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    expect(screen.queryByLabelText('Archive editing actions')).not.toBeInTheDocument()
    fireEvent.pointerUp(child, { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Child 1 details/i, { selector: 'aside' })
    expect(within(dialog).getByText('+ Child')).toBeInTheDocument()
    expect(within(dialog).getByText('+ Partner')).toBeInTheDocument()
    const sibling = within(dialog).getByText('+ Sibling')
    expect(sibling).toBeEnabled()
    fireEvent.click(sibling)
    expect(onEditAction).toHaveBeenCalledWith({ kind: 'person', entityId: 'child-1', action: 'sibling' })
  })

  it('shows the authenticated profile menu, protects locked deletion, and reports exact management intents', () => {
    const onEditAction = vi.fn()
    renderGraph(fresh(), 'people', { canEdit: true, onEditAction })
    const father = screen.getByRole('button', { name: /Father details/i })
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    let dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    expect(within(dialog).getByLabelText('Portrait number 1')).toHaveClass('is-admin-position')
    const menuButton = within(dialog).getByLabelText('Profile actions')
    fireEvent.click(menuButton)
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByLabelText('Delete — protected record')).toBeDisabled()
    fireEvent.click(within(dialog).getByText('Settings'))
    expect(onEditAction).toHaveBeenCalledWith({ kind: 'person', entityId: 'father', action: 'settings' })

    fireEvent.pointerUp(screen.getByRole('button', { name: /Grandchild 1\.1 details/i }), { pointerType: 'mouse', button: 0 })
    dialog = screen.getByLabelText(/Grandchild 1\.1 details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByLabelText('Profile actions'))
    fireEvent.click(within(dialog).getByLabelText('Delete'))
    expect(onEditAction).toHaveBeenCalledWith({ kind: 'person', entityId: 'grandchild-1-1', action: 'delete' })
  })

  it('closes only the authenticated profile menu on Escape or outside interaction', () => {
    renderGraph(fresh(), 'people', { canEdit: true, onEditAction: vi.fn() })
    fireEvent.pointerUp(screen.getByRole('button', { name: /Child 1 details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Child 1 details/i, { selector: 'aside' })
    const trigger = within(dialog).getByLabelText('Profile actions')
    fireEvent.click(trigger)
    expect(within(dialog).getByLabelText('Profile actions menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(dialog).queryByLabelText('Profile actions menu')).not.toBeInTheDocument()
    expect(dialog).toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(within(dialog).queryByLabelText('Profile actions menu')).not.toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
  })

  it('disables sibling creation without parents and uses pet-specific action wording', () => {
    const people = renderGraph(fresh(), 'people', { canEdit: true, onEditAction: vi.fn() })
    fireEvent.pointerUp(screen.getByRole('button', { name: /Father details/i }), { pointerType: 'mouse', button: 0 })
    expect(screen.getByTitle('No recorded parents')).toBeDisabled()
    people.unmount()

    const onEditAction = vi.fn()
    renderGraph(fresh(), 'pets', { canEdit: true, onEditAction })
    fireEvent.pointerUp(screen.getByRole('button', { name: /Iring Brown details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Iring Brown details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByText('+ Offspring'))
    expect(onEditAction).toHaveBeenCalledWith({ kind: 'pet', entityId: 'iring-brown', action: 'child' })
    expect(within(dialog).getByTitle('No recorded parents')).toBeDisabled()
  })

  it('keeps Age read-only, edits Born, and immediately recalculates a person age', async () => {
    const onEntityPatch = vi.fn<(request: ArchiveEntityPatch) => string>(() => '')
    function EditablePersonGraph() {
      const [data, setData] = useState(fresh)
      return (
        <LineageGraph
          mode="people"
          people={data.people}
          families={data.families}
          pets={data.pets}
          petFamilies={data.petFamilies}
          canEdit
          onEditAction={vi.fn()}
          onEntityPatch={(request) => {
            onEntityPatch(request)
            if (request.kind === 'person') {
              setData((current) => ({
                ...current,
                people: current.people.map((person) => person.id === request.entityId ? { ...person, ...request.patch } : person),
              }))
            }
            return ''
          }}
        />
      )
    }
    render(<EditablePersonGraph />)
    const father = screen.getByRole('button', { name: /Father details/i })
    fireEvent.pointerEnter(father, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    expect(screen.getByRole('tooltip')).not.toContainElement(screen.queryByLabelText('Edit birthDate'))
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    const ageRow = within(dialog).getByText('Age', { selector: 'dt' }).parentElement!
    const bornRow = within(dialog).getByText('Born', { selector: 'dt' }).parentElement!
    expect(within(ageRow).queryByLabelText('Edit birthDate')).not.toBeInTheDocument()
    const bornPencil = within(bornRow).getByLabelText('Edit birthDate')
    fireEvent.click(bornPencil)
    const input = within(dialog).getByLabelText('Edit birthDate', { selector: 'input' })
    expect(input).toHaveAttribute('type', 'date')
    fireEvent.change(input, { target: { value: '2000-07-18' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEntityPatch).toHaveBeenCalledWith({ kind: 'person', entityId: 'father', patch: { birthDate: '2000-07-18' } })
    const today = new Date()
    const expectedAge = today.getFullYear() - 2000 - (today.getMonth() < 6 || (today.getMonth() === 6 && today.getDate() < 18) ? 1 : 0)
    await waitFor(() => expect(ageRow).toHaveTextContent(`Age${expectedAge}`))
    expect(bornRow).toHaveTextContent('BornJuly 18 2000')
  })

  it('keeps an invalid blank name editor open and normalizes fuzzy pet dates before saving', () => {
    const personPatch = vi.fn(() => '')
    const personGraph = renderGraph(fresh(), 'people', { canEdit: true, onEditAction: vi.fn(), onEntityPatch: personPatch })
    fireEvent.pointerUp(screen.getByRole('button', { name: /Father details/i }), { pointerType: 'mouse', button: 0 })
    let dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByLabelText('Edit displayName'))
    const name = within(dialog).getByLabelText('Edit displayName', { selector: 'input' })
    fireEvent.change(name, { target: { value: '' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(within(dialog).getByText('Name is required.')).toBeInTheDocument()
    expect(personPatch).not.toHaveBeenCalled()
    personGraph.unmount()

    const petPatch = vi.fn(() => '')
    renderGraph(fresh(), 'pets', { canEdit: true, onEditAction: vi.fn(), onEntityPatch: petPatch })
    fireEvent.pointerUp(screen.getByRole('button', { name: /Iring Brown details/i }), { pointerType: 'mouse', button: 0 })
    dialog = screen.getByLabelText(/Iring Brown details/i, { selector: 'aside' })
    const petAgeRow = within(dialog).getByText('Age', { selector: 'dt' }).parentElement!
    const petBornRow = within(dialog).getByText('Born', { selector: 'dt' }).parentElement!
    expect(within(petAgeRow).queryByLabelText('Edit birthDate')).not.toBeInTheDocument()
    fireEvent.click(within(petBornRow).getByLabelText('Edit birthDate'))
    const birth = within(dialog).getByLabelText('Edit birthDate', { selector: 'input' })
    expect(birth).toHaveAttribute('type', 'text')
    fireEvent.change(birth, { target: { value: '02-decamber-9' } })
    fireEvent.blur(birth)
    expect(petPatch).toHaveBeenCalledWith({ kind: 'pet', entityId: 'iring-brown', patch: { birthDate: '2002-dec-9' } })
  })

  it('does not run map keyboard shortcuts while typing a year in the popup editor', () => {
    const onEntityPatch = vi.fn(() => '')
    renderGraph(fresh(), 'pets', { canEdit: true, onEditAction: vi.fn(), onEntityPatch })
    fireEvent.pointerUp(screen.getByRole('button', { name: /Iring Brown details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Iring Brown details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByLabelText('Edit birthDate'))
    const birth = within(dialog).getByLabelText('Edit birthDate', { selector: 'input' })
    const canvas = screen.getByTestId('lineage-canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const zoomedTransform = canvas.style.transform

    fireEvent.keyDown(birth, { key: '2' })
    fireEvent.keyDown(birth, { key: '0' })
    fireEvent.keyDown(birth, { key: '0' })
    fireEvent.keyDown(birth, { key: '2' })
    fireEvent.keyDown(birth, { key: 'ArrowLeft' })
    expect(canvas.style.transform).toBe(zoomedTransform)

    fireEvent.change(birth, { target: { value: '2002' } })
    fireEvent.blur(birth)
    expect(onEntityPatch).toHaveBeenCalledWith({ kind: 'pet', entityId: 'iring-brown', patch: { birthDate: '2002' } })
  })
})

describe('LineageGraph owner navigation', () => {
  it('makes a resolved owner actionable only in the pinned pet profile', () => {
    const data = fresh()
    data.pets[0].ownerPersonId = 'father'
    const onOwnerNavigate = vi.fn()
    renderGraph(data, 'pets', { onOwnerNavigate })
    const pet = screen.getByRole('button', { name: /Iring Brown details/i })

    fireEvent.pointerEnter(pet, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    const tooltip = screen.getByRole('tooltip', { name: /Iring Brown details/i })
    expect(tooltip).toHaveTextContent('OwnerFather')
    expect(within(tooltip).queryByRole('button', { name: /View Father in family tree/i })).not.toBeInTheDocument()

    fireEvent.pointerUp(pet, { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Iring Brown details/i, { selector: 'aside' })
    const ownerButton = within(dialog).getByLabelText('View Father in family tree')
    fireEvent.click(ownerButton)
    expect(onOwnerNavigate).toHaveBeenCalledOnce()
    expect(onOwnerNavigate).toHaveBeenCalledWith('father')
  })

  it('keeps an unresolved owner as a non-interactive fallback', () => {
    const data = fresh()
    data.pets[0].ownerPersonId = 'missing-owner'
    renderGraph(data, 'pets', { onOwnerNavigate: vi.fn() })
    fireEvent.pointerUp(screen.getByRole('button', { name: /Iring Brown details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Iring Brown details/i, { selector: 'aside' })
    expect(dialog).toHaveTextContent('Owner?')
    expect(within(dialog).queryByRole('button', { name: /family tree/i })).not.toBeInTheDocument()
  })

  it('shows owned pets as hover text and pinned navigation buttons', () => {
    const data = fresh()
    data.pets[0].ownerPersonId = 'father'
    data.pets.push({ ...createBlankPet('brownie', 'Brownie', 2), species: 'Dog', ownerPersonId: 'father' })
    const onPetNavigate = vi.fn()
    renderGraph(data, 'people', { onPetNavigate })
    const father = screen.getByRole('button', { name: /Father details/i })

    fireEvent.pointerEnter(father, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    const tooltip = screen.getByRole('tooltip', { name: /Father details/i })
    expect(tooltip).toHaveTextContent('Owned petsIring Brown, Brownie')
    expect(within(tooltip).queryByRole('button', { name: /pet lineage/i })).not.toBeInTheDocument()

    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByLabelText('View Brownie in pet lineage'))
    expect(onPetNavigate).toHaveBeenCalledWith('brownie')
    expect(within(dialog).getByLabelText('View Iring Brown in pet lineage')).toBeInTheDocument()
  })

  it('omits the owned-pets row when no pet is assigned', () => {
    renderGraph(fresh(), 'people', { onPetNavigate: vi.fn() })
    fireEvent.pointerUp(screen.getByRole('button', { name: /Father details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    expect(dialog).not.toHaveTextContent('Owned pets')
  })
})

describe('LineageGraph viewport controls', () => {
  it('gates public interaction without intercepting page wheel input', () => {
    const onOpenMap = vi.fn()
    const { container } = renderGraph(structuredClone(publishedArchive) as TreeData, 'people', { interactionLocked: true, onOpenMap })
    const viewport = screen.getByTestId('lineage-viewport')
    const canvas = screen.getByTestId('lineage-canvas')
    const before = canvas.style.transform

    expect(viewport).toHaveClass('is-locked')
    expect(viewport).toHaveAttribute('tabindex', '-1')
    expect(canvas).toHaveAttribute('inert')
    expect(canvas).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset and fit graph' })).toBeDisabled()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Status and gender highlight"]')).toBeDisabled()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Lineage path"]')).toBeDisabled()

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -300, clientX: 120, clientY: 100 })
    viewport.dispatchEvent(wheel)
    fireEvent.keyDown(viewport, { key: '+' })
    expect(wheel.defaultPrevented).toBe(false)
    expect(canvas.style.transform).toBe(before)

    fireEvent.click(screen.getByRole('button', { name: 'Open Family map' }))
    expect(onOpenMap).toHaveBeenCalledTimes(1)
  })

  it('keeps shared graphs immediately interactive unless a public gate is supplied', () => {
    renderGraph()
    expect(screen.queryByRole('button', { name: 'Open Family map' })).not.toBeInTheDocument()
    expect(screen.getByTestId('lineage-viewport')).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled()
  })

  it('shows the expand control only for an opened map and switches to a collapse control in fullscreen', () => {
    const onToggleFullscreen = vi.fn()
    const graph = renderGraph(fresh(), 'people', { interactionLocked: true, onOpenMap: vi.fn(), onToggleFullscreen })
    expect(screen.queryByRole('button', { name: 'Enter fullscreen map' })).not.toBeInTheDocument()

    graph.rerender(
      <LineageGraph
        mode="people"
        people={fresh().people}
        families={fresh().families}
        pets={fresh().pets}
        petFamilies={fresh().petFamilies}
        interactionLocked={false}
        onToggleFullscreen={onToggleFullscreen}
      />,
    )
    const enter = screen.getByRole('button', { name: 'Enter fullscreen map' })
    fireEvent.click(enter)
    expect(onToggleFullscreen).toHaveBeenCalledWith(enter)

    graph.rerender(
      <LineageGraph
        mode="people"
        people={fresh().people}
        families={fresh().families}
        pets={fresh().pets}
        petFamilies={fresh().petFamilies}
        fullscreenMode
        onToggleFullscreen={onToggleFullscreen}
      />,
    )
    expect(screen.getByRole('button', { name: 'Exit fullscreen map' })).toBeInTheDocument()
  })

  it('centers a requested owner, keeps the green target through other selections, and acknowledges the owner selection', async () => {
    const onFocusAcknowledge = vi.fn()
    const { rerender } = renderGraph(fresh(), 'people', {
      focusRequest: { entityId: 'father', requestId: 11 },
      onFocusAcknowledge,
    })
    const viewport = screen.getByTestId('lineage-viewport')
    const canvas = screen.getByTestId('lineage-canvas')
    const father = screen.getByRole('button', { name: /Father details.*navigation target/i })
    const mother = screen.getByRole('button', { name: /Mother details/i })
    const portrait = father.querySelector<HTMLElement>('.portrait-ring')!
    const scrollIntoView = vi.fn()

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(viewport, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    Object.defineProperty(portrait, 'offsetLeft', { configurable: true, value: 200 })
    Object.defineProperty(portrait, 'offsetTop', { configurable: true, value: 100 })
    Object.defineProperty(portrait, 'offsetWidth', { configurable: true, value: 106 })
    Object.defineProperty(portrait, 'offsetHeight', { configurable: true, value: 106 })
    Object.defineProperty(portrait, 'offsetParent', { configurable: true, value: canvas })

    await waitFor(() => expect(canvas.style.transform).toBe('translate(20.5px, 70.5px) scale(1.5)'))
    expect(viewport).toHaveClass('is-owner-focusing')
    expect(father).toHaveClass('is-owner-target')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })

    fireEvent.pointerUp(mother, { pointerType: 'mouse', button: 0 })
    expect(father).toHaveClass('is-owner-target')
    fireEvent.pointerUp(father, { pointerType: 'mouse', button: 0 })
    expect(onFocusAcknowledge).toHaveBeenCalledWith(11)
    expect(father).not.toHaveClass('is-owner-target')
    expect(father).toHaveClass('is-active')

    const data = fresh()
    rerender(
      <LineageGraph
        mode="people"
        people={data.people}
        families={data.families}
        pets={data.pets}
        petFamilies={data.petFamilies}
        focusRequest={{ entityId: 'father', requestId: 12 }}
        onFocusAcknowledge={onFocusAcknowledge}
      />,
    )
    await waitFor(() => expect(father).toHaveClass('is-owner-target'))
  })

  it('uses the smaller mobile owner-focus zoom', async () => {
    renderGraph(fresh(), 'people', { focusRequest: { entityId: 'father', requestId: 21 } })
    const viewport = screen.getByTestId('lineage-viewport')
    const canvas = screen.getByTestId('lineage-canvas')
    const father = screen.getByRole('button', { name: /Father details.*navigation target/i })
    const portrait = father.querySelector<HTMLElement>('.portrait-ring')!
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 390 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(viewport, 'scrollIntoView', { configurable: true, value: vi.fn() })
    Object.defineProperty(portrait, 'offsetLeft', { configurable: true, value: 100 })
    Object.defineProperty(portrait, 'offsetTop', { configurable: true, value: 100 })
    Object.defineProperty(portrait, 'offsetWidth', { configurable: true, value: 106 })
    Object.defineProperty(portrait, 'offsetHeight', { configurable: true, value: 106 })
    Object.defineProperty(portrait, 'offsetParent', { configurable: true, value: canvas })

    await waitFor(() => expect(canvas.style.transform).toContain('scale(1.25)'))
  })

  it('applies and acknowledges the same persistent focus behavior for a pet target', async () => {
    const onFocusAcknowledge = vi.fn()
    renderGraph(fresh(), 'pets', {
      focusRequest: { entityId: 'iring-brown', requestId: 22 },
      onFocusAcknowledge,
    })
    const pet = screen.getByRole('button', { name: /Iring Brown details.*navigation target/i })
    expect(pet).toHaveClass('is-owner-target')
    fireEvent.pointerUp(pet, { pointerType: 'mouse', button: 0 })
    await waitFor(() => expect(onFocusAcknowledge).toHaveBeenCalledWith(22))
    expect(pet).not.toHaveClass('is-owner-target')
    expect(pet).toHaveClass('is-active')
  })

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
