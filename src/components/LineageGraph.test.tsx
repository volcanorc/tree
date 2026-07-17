import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import seed from '../../public/tree-data.json'
import type { TreeData } from '../types'
import { addPartner } from '../lib/data'
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
    const dialog = screen.getByRole('dialog', { name: /Father details/i })
    expect(dialog).toHaveTextContent('Age?')
    expect(dialog).toHaveTextContent('Born?')
    expect(dialog).toHaveTextContent('StatusAlive')
    expect(dialog).toHaveTextContent('Personality?')
    expect(dialog).toHaveTextContent('1')
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

  it('renders multiple partner units and their partner cards', () => {
    const data = addPartner(fresh(), 'new-child', 'Another partner')
    renderGraph(data)
    expect(screen.getAllByRole('button', { name: /New child details/i })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Another partner details/i })).toBeInTheDocument()
  })

  it('shows the protected Iring Brown founder, portrait number, and birth details', () => {
    renderGraph(fresh(), 'pets')
    const iring = screen.getByRole('button', { name: /Iring Brown details/i })
    fireEvent.pointerEnter(iring, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    const dialog = screen.getByRole('dialog', { name: /Iring Brown details/i })
    expect(dialog).toHaveTextContent('Age11')
    expect(dialog).toHaveTextContent('BornTrash can')
    expect(dialog).toHaveTextContent('StatusDead')
    expect(within(dialog).getByLabelText('Portrait number 1')).toHaveTextContent('1')
  })
})

describe('LineageGraph multi-link activation', () => {
  it('opens pinned details without navigation when there are no links and closes the modal', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderGraph()
    fireEvent.pointerUp(screen.getByRole('button', { name: /Father details/i }), { pointerType: 'mouse' })
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /Father details/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog', { name: /Father details/i })).not.toBeInTheDocument()
  })

  it('opens one safe link directly for desktop mouse and keyboard activation', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const data = fresh()
    data.people[0].links = ['https://example.com/father']
    const { unmount } = renderGraph(data)
    fireEvent.pointerUp(screen.getByRole('button', { name: /Father details, opens story link/i }), { pointerType: 'mouse' })
    expect(open).toHaveBeenCalledWith('https://example.com/father', '_blank', 'noopener,noreferrer')

    unmount()
    renderGraph(data)
    fireEvent.keyDown(screen.getByRole('button', { name: /Father details, opens story link/i }), { key: 'Enter' })
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('opens pinned details first for a one-link touch activation', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const data = fresh()
    data.people[0].links = ['https://example.com/father']
    renderGraph(data)
    fireEvent.pointerUp(screen.getByRole('button', { name: /Father details, opens story link/i }), { pointerType: 'touch' })
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /Father details/i })).toBeInTheDocument()
  })

  it('renders exact Visit labels with safe new-tab attributes for multiple links', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const data = fresh()
    data.people[0].links = ['https://example.com/profile', 'http://example.com/video']
    renderGraph(data)
    fireEvent.pointerUp(screen.getByRole('button', { name: /2 story links available/i }), { pointerType: 'mouse' })
    expect(open).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: /Father details/i })
    const first = within(dialog).getByRole('link', { name: 'Visit 1' })
    const second = within(dialog).getByRole('link', { name: 'Visit 2' })
    expect(first).toHaveAttribute('href', 'https://example.com/profile')
    expect(second).toHaveAttribute('href', 'http://example.com/video')
    expect(first).toHaveAttribute('target', '_blank')
    expect(first).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('LineageGraph viewport controls', () => {
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
