import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import seed from './test/fixtures/tree-data-v4.json'
import { addChild, addPartner } from './lib/data'
import type { TreeData } from './types'
import App from './App'

const DRAFT_KEY = 'celestial-family-archive-draft-v1'

function mockPublishedData(data: TreeData = structuredClone(seed) as TreeData) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => structuredClone(data),
  }))
}

async function openMap(kind: 'Family' | 'Pets') {
  const button = await screen.findByRole('button', { name: `Open ${kind} map` })
  fireEvent.click(button)
  await waitFor(() => expect(screen.queryByRole('button', { name: `Open ${kind} map` })).not.toBeInTheDocument())
}

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.removeItem('celestial-family-archive-admin')
  window.location.hash = ''
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
  Reflect.deleteProperty(document, 'exitFullscreen')
  Reflect.deleteProperty(document, 'fullscreenElement')
  document.body.classList.remove('archive-fullscreen-active')
})

describe('App draft recovery', () => {
  it('migrates and rewrites a valid version-2 browser draft', async () => {
    mockPublishedData()
    const legacy = structuredClone(seed) as unknown as Record<string, unknown>
    legacy.version = 2
    const legacySite = legacy.site as Record<string, unknown>
    legacySite.title = 'The Family Archive'
    legacySite.adminUser = 'outdated-admin'
    legacySite.adminPinHash = 'outdated-pin-hash'
    const people = legacy.people as Array<Record<string, unknown>>
    people.forEach((person) => {
      person.link = person.id === 'father' ? 'https://example.com/father' : ''
      delete person.links
    })
    const pets = legacy.pets as Array<Record<string, unknown>>
    pets.forEach((pet) => {
      pet.link = ''
      delete pet.links
      delete pet.portraitNumber
      pet.portrait = ''
    })
    localStorage.setItem(DRAFT_KEY, JSON.stringify(legacy))

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    expect(screen.getByText('Local draft active')).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY)!)
    expect(stored.version).toBe(6)
    expect(stored.people[0].deathDate).toBe('')
    expect(stored.people[0].links).toEqual(['https://example.com/father'])
    expect(stored.site.adminUser).toBe(seed.site.adminUser)
    expect(stored.site.adminPinHash).toBe(seed.site.adminPinHash)
    expect(stored.site.title).toBe('The Lineage Archive')
    await waitFor(() => expect(document.title).toBe('The Lineage Archive'))
    expect(stored.pets[0]).toEqual(expect.objectContaining({
      portraitNumber: 1,
      portrait: 'portraits/pets/1.png',
      links: [],
    }))
  })

  it('discards an invalid draft and uses published version-6 data with the revised family heading', async () => {
    mockPublishedData()
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 99 }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull())
    expect(screen.queryByText('Local draft active')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hermoso - Sullano' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lineage Branches' })).toBeInTheDocument()
    expect(document.title).toBe('The Lineage Archive')
  })

  it('unlocks Family and Pets independently until reload and focuses the opened viewport', async () => {
    mockPublishedData()
    const app = render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    let viewport = screen.getByTestId('lineage-viewport')
    expect(viewport).toHaveClass('is-locked')
    await openMap('Family')
    await waitFor(() => expect(viewport).toHaveFocus())
    expect(viewport).not.toHaveClass('is-locked')

    fireEvent.click(screen.getByRole('button', { name: 'Pets' }))
    expect(await screen.findByRole('heading', { name: 'The Pet Archive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Pets map' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Family' }))
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Family map' })).not.toBeInTheDocument()
    expect(screen.getByTestId('lineage-viewport')).not.toHaveClass('is-locked')

    fireEvent.click(screen.getByRole('button', { name: 'Pets' }))
    await openMap('Pets')
    expect(screen.getByTestId('lineage-viewport')).not.toHaveClass('is-locked')

    app.unmount()
    window.location.hash = 'family'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    viewport = screen.getByTestId('lineage-viewport')
    expect(viewport).toHaveClass('is-locked')
    expect(screen.getByRole('button', { name: 'Open Family map' })).toBeInTheDocument()
  })

  it('uses a stable fallback fullscreen layer, switches archives, and leaves both maps unlocked after exit', async () => {
    mockPublishedData()
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('Fullscreen unavailable')),
    })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')

    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen map' }))
    let fullscreen = await screen.findByRole('dialog', { name: 'Fullscreen Family archive' })
    expect(document.body).toHaveClass('archive-fullscreen-active')
    expect(document.querySelector('.site-page')).toHaveAttribute('inert')
    expect(within(fullscreen).queryByRole('button', { name: /Open .* map/ })).not.toBeInTheDocument()

    fireEvent.click(within(fullscreen).getByRole('button', { name: 'Pets' }))
    fullscreen = await screen.findByRole('dialog', { name: 'Fullscreen Pets archive' })
    expect(window.location.hash).toBe('#pets')
    expect(within(fullscreen).getByRole('button', { name: /Iring Brown details/i })).toBeInTheDocument()
    expect(within(fullscreen).getByRole('button', { name: 'Exit fullscreen map' })).toBeInTheDocument()

    fireEvent.click(within(fullscreen).getByRole('button', { name: 'Exit fullscreen archive' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Fullscreen .* archive/ })).not.toBeInTheDocument())
    expect(document.body).not.toHaveClass('archive-fullscreen-active')
    expect(screen.queryByRole('button', { name: 'Open Pets map' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter fullscreen map' })).toBeInTheDocument()
  })

  it('synchronizes native fullscreen exit, restores focus, and supports fallback Escape', async () => {
    mockPublishedData()
    let nativeElement: Element | null = document.documentElement
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    const exitFullscreen = vi.fn().mockImplementation(async () => { nativeElement = null })
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => nativeElement })

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')
    const expand = screen.getByRole('button', { name: 'Enter fullscreen map' })
    expand.focus()
    fireEvent.click(expand)
    expect(await screen.findByRole('dialog', { name: 'Fullscreen Family archive' })).toBeInTheDocument()
    expect(requestFullscreen).toHaveBeenCalledTimes(1)

    nativeElement = null
    fireEvent(document, new Event('fullscreenchange'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Fullscreen Family archive' })).not.toBeInTheDocument())
    await waitFor(() => expect(expand).toHaveFocus())

    fireEvent.click(expand)
    expect(await screen.findByRole('dialog', { name: 'Fullscreen Family archive' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Fullscreen Family archive' })).not.toBeInTheDocument())
  })

  it('exits fullscreen before opening authenticated profile settings', async () => {
    mockPublishedData()
    sessionStorage.setItem('celestial-family-archive-admin', 'yes')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen map' }))
    const fullscreen = await screen.findByRole('dialog', { name: 'Fullscreen Family archive' })
    fireEvent.pointerUp(within(fullscreen).getByRole('button', { name: /Child 2 details/i }), { pointerType: 'mouse', button: 0 })
    const profile = within(fullscreen).getByLabelText(/Child 2 details/i, { selector: 'aside' })
    fireEvent.click(within(profile).getByLabelText('Profile actions'))
    fireEvent.click(within(profile).getByText('Settings'))

    expect(await screen.findByText('Editing: Child 2')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /Fullscreen .* archive/ })).not.toBeInTheDocument()
    expect(window.location.hash).toBe('#dashboard')
  })

  it('leaves authenticated dashboard graph previews immediately interactive', async () => {
    mockPublishedData()
    sessionStorage.setItem('celestial-family-archive-admin', 'yes')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    expect(await screen.findByRole('heading', { name: 'Archive dashboard' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByRole('heading', { name: 'Graph preview' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Family map' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Pets map' })).not.toBeInTheDocument()
    screen.getAllByTestId('lineage-viewport').forEach((preview) => expect(preview).toHaveAttribute('tabindex', '0'))
  })

  it('navigates from a pinned pet owner to the focused family portrait', async () => {
    const data = structuredClone(seed) as TreeData
    data.pets[0].ownerPersonId = 'father'
    mockPublishedData(data)
    window.location.hash = 'pets'

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Pet Archive' })).toBeInTheDocument()
    await openMap('Pets')
    fireEvent.pointerUp(screen.getByRole('button', { name: /Iring Brown details/i }), { pointerType: 'mouse', button: 0 })
    const petDialog = screen.getByLabelText(/Iring Brown details/i, { selector: 'aside' })
    fireEvent.click(within(petDialog).getByLabelText('View Father in family tree'))

    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#family')
    await openMap('Family')
    expect(screen.getByRole('button', { name: /Father details.*navigation target/i })).toHaveClass('is-owner-target')
  })

  it('navigates from a person owned-pet button to the focused pet portrait', async () => {
    const data = structuredClone(seed) as TreeData
    data.pets[0].ownerPersonId = 'father'
    mockPublishedData(data)

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')
    fireEvent.pointerUp(screen.getByRole('button', { name: /Father details/i }), { pointerType: 'mouse', button: 0 })
    const personDialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    fireEvent.click(within(personDialog).getByLabelText('View Iring Brown in pet lineage'))

    expect(await screen.findByRole('heading', { name: 'The Pet Archive' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#pets')
    await openMap('Pets')
    expect(screen.getByRole('button', { name: /Iring Brown details.*navigation target/i })).toHaveClass('is-owner-target')
  })

  it('opens exact dashboard settings from the authenticated profile menu', async () => {
    mockPublishedData()
    sessionStorage.setItem('celestial-family-archive-admin', 'yes')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')
    fireEvent.pointerUp(screen.getByRole('button', { name: /Child 2 details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Child 2 details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByLabelText('Profile actions'))
    fireEvent.click(within(dialog).getByText('Settings'))

    expect(await screen.findByText('Editing: Child 2')).toBeInTheDocument()
    expect(window.location.hash).toBe('#dashboard')
  })

  it('deletes from the authenticated homepage confirmation without dashboard navigation', async () => {
    mockPublishedData()
    sessionStorage.setItem('celestial-family-archive-admin', 'yes')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')
    fireEvent.pointerUp(screen.getByRole('button', { name: /Grandchild 1\.1 details/i }), { pointerType: 'mouse', button: 0 })
    const profile = screen.getByLabelText(/Grandchild 1\.1 details/i, { selector: 'aside' })
    fireEvent.click(within(profile).getByLabelText('Profile actions'))
    fireEvent.click(within(profile).getByLabelText('Delete'))

    const confirmation = await screen.findByRole('alertdialog')
    expect(confirmation).toHaveTextContent('Delete 1 person?')
    expect(confirmation).toHaveTextContent('Grandchild 1.1')
    expect(window.location.hash).not.toBe('#dashboard')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete from draft' }))
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY)!) as TreeData
    expect(stored.people.some((person) => person.id === 'grandchild-1-1')).toBe(false)
  })

  it('creates an exact-parent sibling directly on the map and preserves the pinned origin', async () => {
    mockPublishedData()
    sessionStorage.setItem('celestial-family-archive-admin', 'yes')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')

    fireEvent.pointerUp(screen.getByRole('button', { name: /Child 1 details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Child 1 details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByText('+ Sibling'))

    expect(await screen.findByRole('button', { name: /New sibling details/i })).toBeInTheDocument()
    expect(window.location.hash).not.toBe('#dashboard')
    expect(screen.getByLabelText(/Child 1 details/i, { selector: 'aside' })).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY)!) as TreeData
    const sibling = stored.people.at(-1)!
    const rootChildren = stored.families.find((family) => family.id === 'root-family')?.children ?? []
    const addedLink = rootChildren.find((child) => child.personId === sibling.id)
    const priorOrders = rootChildren.filter((child) => child.personId !== sibling.id).map((child) => child.birthOrder)
    expect(addedLink).toEqual({ personId: sibling.id, birthOrder: Math.max(...priorOrders) + 1 })
  })

  it('saves authenticated popup edits to the browser draft and reveals Died after a status change', async () => {
    mockPublishedData()
    sessionStorage.setItem('celestial-family-archive-admin', 'yes')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')
    fireEvent.pointerUp(screen.getByRole('button', { name: /Father details/i }), { pointerType: 'mouse', button: 0 })
    let dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByLabelText('Edit personality'))
    const personality = within(dialog).getByLabelText('Edit personality', { selector: 'input' })
    fireEvent.change(personality, { target: { value: 'Patient and observant' } })
    fireEvent.blur(personality)
    expect((JSON.parse(localStorage.getItem(DRAFT_KEY)!) as TreeData).people.find((person) => person.id === 'father')?.personality).toBe('Patient and observant')

    dialog = screen.getByLabelText(/Father details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByLabelText('Edit status'))
    fireEvent.change(within(dialog).getByLabelText('Edit status', { selector: 'select' }), { target: { value: 'dead' } })
    dialog = await screen.findByLabelText(/Father details/i, { selector: 'aside' })
    expect(within(dialog).getByText('Died')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Edit deathDate')).toBeInTheDocument()
    expect((JSON.parse(localStorage.getItem(DRAFT_KEY)!) as TreeData).people.find((person) => person.id === 'father')?.status).toBe('dead')
  })

  it('adds pet offspring directly while keeping the original pet profile pinned', async () => {
    mockPublishedData()
    sessionStorage.setItem('celestial-family-archive-admin', 'yes')
    window.location.hash = 'pets'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Pet Archive' })).toBeInTheDocument()
    await openMap('Pets')
    fireEvent.pointerUp(screen.getByRole('button', { name: /Iring Brown details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Iring Brown details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByText('+ Offspring'))
    expect(await screen.findByRole('button', { name: /New pet details/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Iring Brown details/i, { selector: 'aside' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#pets')
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY)!) as TreeData
    expect(stored.petFamilies.some((family) => family.parentPetIds.includes('iring-brown') && family.children.some((child) => child.petId === stored.pets.at(-1)?.id))).toBe(true)
  })

  it('chooses an exact partner branch on the map when a parent has multiple unions', async () => {
    let data = addPartner(structuredClone(seed) as TreeData, 'child-1', 'Wife one', 'family-child-1')
    data = addPartner(data, 'child-1', 'Wife two')
    const wifeTwoFamily = data.families.find((family) => family.parentIds.includes('wife-two'))!
    mockPublishedData(data)
    sessionStorage.setItem('celestial-family-archive-admin', 'yes')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')
    fireEvent.pointerUp(screen.getByRole('button', { name: /Child 1 details/i }), { pointerType: 'mouse', button: 0 })
    const dialog = screen.getByLabelText(/Child 1 details/i, { selector: 'aside' })
    fireEvent.click(within(dialog).getByText('+ Child'))
    const chooser = await screen.findByRole('dialog', { name: 'Which parents belong to this new record?' })
    expect(window.location.hash).not.toBe('#dashboard')
    fireEvent.click(within(chooser).getByRole('button', { name: 'Wife two' }))
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY)!) as TreeData
    expect(stored.families.find((family) => family.id === wifeTwoFamily.id)?.children.at(-1)?.personId).toBe(stored.people.at(-1)?.id)
    expect(screen.getByLabelText(/Child 1 details/i, { selector: 'aside' })).toBeInTheDocument()
  })

  it('lists a homepage deletion cascade and keeps the map unchanged when cancelled', async () => {
    const data = addChild(structuredClone(seed) as TreeData, 'grandchild-1-1', 'Map descendant', 'single')
    mockPublishedData(data)
    sessionStorage.setItem('celestial-family-archive-admin', 'yes')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Lineage Archive' })).toBeInTheDocument()
    await openMap('Family')
    fireEvent.pointerUp(screen.getByRole('button', { name: /Grandchild 1\.1 details/i }), { pointerType: 'mouse', button: 0 })
    const profile = screen.getByLabelText(/Grandchild 1\.1 details/i, { selector: 'aside' })
    fireEvent.click(within(profile).getByLabelText('Profile actions'))
    fireEvent.click(within(profile).getByLabelText('Delete'))
    const confirmation = await screen.findByRole('alertdialog')
    expect(confirmation).toHaveTextContent('Automatic descendants: Map descendant')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Map descendant details/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Grandchild 1\.1 details/i, { selector: 'aside' })).toBeInTheDocument()
  })
})
