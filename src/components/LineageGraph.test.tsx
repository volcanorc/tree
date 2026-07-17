import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import seed from '../../public/tree-data.json'
import type { TreeData } from '../types'
import { addPartner } from '../lib/data'
import { LineageGraph } from './LineageGraph'

const fresh = () => structuredClone(seed) as TreeData

function renderGraph(data = fresh(), mode: 'people' | 'pets' = 'people') {
  return render(<LineageGraph mode={mode} people={data.people} families={data.families} pets={data.pets} petFamilies={data.petFamilies} />)
}

describe('LineageGraph', () => {
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

  it('uses numbered PNG first, falls back by extension, and preserves manual portrait overrides', () => {
    const { unmount } = renderGraph()
    const fatherImage = screen.getByRole('button', { name: /Father details/i }).querySelector('img')!
    expect(fatherImage.getAttribute('src')).toMatch(/\/portraits\/1\.png$/)
    fireEvent.error(fatherImage)
    expect(screen.getByRole('button', { name: /Father details/i }).querySelector('img')?.getAttribute('src')).toMatch(/\/portraits\/1\.jpg$/)
    unmount()
    const data = fresh()
    data.people.find((person) => person.id === 'father')!.portrait = '/portraits/custom.webp'
    renderGraph(data)
    expect(screen.getByRole('button', { name: /Father details/i }).querySelector('img')?.getAttribute('src')).toMatch(/\/portraits\/custom\.webp$/)
  })

  it('renders multiple partner units without duplicating the primary person card', () => {
    const data = addPartner(fresh(), 'new-child', 'Another partner')
    renderGraph(data)
    expect(screen.getAllByRole('button', { name: /New child details/i })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Another partner details/i })).toBeInTheDocument()
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

  it('shows the protected Iring Brown founder and birth details', () => {
    renderGraph(fresh(), 'pets')
    const iring = screen.getByRole('button', { name: /Iring Brown details/i })
    fireEvent.pointerEnter(iring, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    const dialog = screen.getByRole('dialog', { name: /Iring Brown details/i })
    expect(dialog).toHaveTextContent('Age11')
    expect(dialog).toHaveTextContent('BornTrash can')
    expect(dialog).toHaveTextContent('StatusDead')
  })
})
