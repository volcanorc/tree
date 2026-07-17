import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import seed from '../../public/tree-data.json'
import type { TreeData } from '../types'
import { LineageGraph } from './LineageGraph'

const data = structuredClone(seed) as TreeData

describe('LineageGraph', () => {
  it('shows missing public details as question marks in the hover card', () => {
    render(<LineageGraph mode="people" people={data.people} families={data.families} pets={data.pets} petFamilies={data.petFamilies} />)
    const father = screen.getByRole('button', { name: /Father details/i })
    fireEvent.pointerEnter(father, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    const dialog = screen.getByRole('dialog', { name: /Father details/i })
    expect(dialog).toHaveTextContent('Age?')
    expect(dialog).toHaveTextContent('Born?')
    expect(dialog).toHaveTextContent('Personality?')
  })

  it('renders an intentional empty pet state', () => {
    render(<LineageGraph mode="pets" people={data.people} families={data.families} pets={[]} petFamilies={[]} />)
    expect(screen.getByRole('heading', { name: /No pets have been added yet/i })).toBeInTheDocument()
  })
})
