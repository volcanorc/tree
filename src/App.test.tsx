import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import seed from './test/fixtures/tree-data-v4.json'
import App from './App'

const DRAFT_KEY = 'celestial-family-archive-draft-v1'

function mockPublishedData() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => structuredClone(seed),
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('App draft recovery', () => {
  it('migrates and rewrites a valid version-2 browser draft', async () => {
    mockPublishedData()
    const legacy = structuredClone(seed) as unknown as Record<string, unknown>
    legacy.version = 2
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
    expect(await screen.findByRole('heading', { name: 'The Family Archive' })).toBeInTheDocument()
    expect(screen.getByText('Local draft active')).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY)!)
    expect(stored.version).toBe(4)
    expect(stored.people[0].deathDate).toBe('')
    expect(stored.people[0].links).toEqual(['https://example.com/father'])
    expect(stored.pets[0]).toEqual(expect.objectContaining({
      portraitNumber: 1,
      portrait: 'portraits/pets/1.png',
      links: [],
    }))
  })

  it('discards an invalid draft and uses published version-4 data', async () => {
    mockPublishedData()
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 99 }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The Family Archive' })).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull())
    expect(screen.queryByText('Local draft active')).not.toBeInTheDocument()
  })
})
