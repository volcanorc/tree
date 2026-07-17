import { describe, expect, it } from 'vitest'
import publishedArchive from '../../public/tree-data.json'
import seed from '../test/fixtures/tree-data-v4.json'
import type { TreeData } from '../types'
import {
  addChild,
  addPartner,
  addPetOffspring,
  addPetPartner,
  applyPersonDeletePlan,
  calculateAge,
  countDescendants,
  createBlankPerson,
  createBlankPet,
  deletePerson,
  deletePet,
  exportTreeData,
  isSafePortrait,
  migrateTreeData,
  nextPetPortraitNumber,
  nextPortraitNumber,
  planPersonDeletion,
  sortChildren,
  validateTreeData,
} from './data'

const fresh = () => structuredClone(seed) as TreeData

function legacyVersion(version: 1 | 2) {
  const legacy = structuredClone(seed) as unknown as Record<string, unknown>
  legacy.version = version
  const people = legacy.people as Array<Record<string, unknown>>
  people.forEach((person) => {
    delete person.deathDate
    person.link = person.id === 'father' ? 'https://example.com/father' : ''
    delete person.links
    person.portrait = ''
    if (version === 1) {
      delete person.portraitNumber
      delete person.birthDetails
      delete person.status
    }
  })
  const pets = legacy.pets as Array<Record<string, unknown>>
  pets.forEach((pet) => {
    delete pet.deathDate
    pet.link = 'https://example.com/iring'
    pet.portrait = ''
    delete pet.links
    delete pet.portraitNumber
  })
  return legacy
}

describe('age, ordering, and migration', () => {
  it('calculates living ages, ages at death, and year-only pet ages', () => {
    const today = new Date('2026-07-17T12:00:00Z')
    expect(calculateAge('2000-07-17', 88, today)).toBe(26)
    expect(calculateAge('2000-07-18', 88, today)).toBe(25)
    expect(calculateAge('2000-07-18', 88, today, '2020-07-17', 'dead')).toBe(19)
    expect(calculateAge('2000-07-18', null, today, '', 'dead')).toBe('?')
    expect(calculateAge('2013', 11, today, '', 'dead', true)).toBe(11)
    expect(calculateAge('2013', null, today, '2024-06-01', 'dead', true)).toBe(11)
    expect(calculateAge('2013', null, today, '', 'alive', true)).toBe(13)
    expect(calculateAge('', 42, today)).toBe(42)
    expect(calculateAge('', null, today)).toBe('?')
  })

  it('sorts every current root child youngest-left by descending birth order', () => {
    const root = fresh().families.find((family) => family.id === 'root-family')!
    expect(sortChildren(root.children).map((child) => child.personId)).toEqual([
      'new-child', 'child-7', 'child-6', 'child-5', 'child-4', 'child-3', 'child-2', 'child-1',
    ])
  })

  it.each([1, 2] as const)('migrates version %s data to version 4 with links, death dates, and automatic PNG paths', (version) => {
    const migrated = migrateTreeData(legacyVersion(version))
    expect(migrated.version).toBe(4)
    expect(migrated.people.find((person) => person.id === 'father')).toEqual(expect.objectContaining({
      portraitNumber: 1,
      portrait: 'portraits/1.png',
      links: ['https://example.com/father'],
      deathDate: '',
    }))
    expect(migrated.people.find((person) => person.id === 'child-7')?.portraitNumber).toBe(3)
    expect(migrated.people.find((person) => person.id === 'new-child')?.portraitNumber).toBe(22)
    expect(migrated.pets[0]).toEqual(expect.objectContaining({
      id: 'iring-brown',
      portraitNumber: 1,
      portrait: 'portraits/pets/1.png',
      links: ['https://example.com/iring'],
      protected: true,
      deathDate: '',
    }))
    expect(validateTreeData(migrated)).toEqual({ valid: true, errors: [] })
  })

  it('migrates version-3 data with blank death dates and keeps version 4 idempotent', () => {
    const previous = structuredClone(seed) as unknown as Record<string, unknown>
    previous.version = 3
    ;(previous.people as Array<Record<string, unknown>>).forEach((person) => delete person.deathDate)
    ;(previous.pets as Array<Record<string, unknown>>).forEach((pet) => {
      delete pet.deathDate
      if (pet.id === 'iring-brown') pet.birthDate = ''
    })
    const migrated = migrateTreeData(previous)
    expect(migrated.version).toBe(4)
    expect(migrated.people.every((person) => person.deathDate === '')).toBe(true)
    expect(migrated.pets.every((pet) => pet.deathDate === '')).toBe(true)
    expect(migrated.pets.find((pet) => pet.id === 'iring-brown')?.birthDate).toBe('2013')
    expect(migrateTreeData(fresh())).toEqual(fresh())
  })
})

describe('preserved archive data', () => {
  it('keeps all family edits, core protections, numbered portraits, and the pet founder', () => {
    const data = fresh()
    expect(data.version).toBe(4)
    expect(data.people).toHaveLength(24)
    expect(data.people.filter((person) => person.protected)).toHaveLength(9)
    expect(new Set(data.people.map((person) => person.portraitNumber)).size).toBe(24)
    expect(data.people.every((person) => Array.isArray(person.links) && person.portrait.endsWith('.png'))).toBe(true)
    expect(data.people.find((person) => person.displayName === 'second wife')).toBeTruthy()
    expect([1, 2, 3, 4, 5, 6, 7].map((number) =>
      data.families.find((family) => family.id === `family-child-${number}`)?.children.length ?? 0,
    )).toEqual([4, 2, 2, 2, 2, 0, 0])
    expect(data.pets).toContainEqual(expect.objectContaining({
      id: 'iring-brown', displayName: 'Iring Brown', species: 'Cat', gender: 'female', status: 'dead',
      birthDate: '2013', deathDate: '', ageOverride: 11, birthDetails: 'Trash can', personality: 'Slow', protected: true,
      portraitNumber: 1, portrait: 'portraits/pets/1.png', links: [],
    }))
    expect(countDescendants(data)).toBe(21)
    expect(validateTreeData(data)).toEqual({ valid: true, errors: [] })
  })
})

describe('published archive data', () => {
  it('keeps the renamed records and validates the current public version-4 archive', () => {
    const data = structuredClone(publishedArchive) as TreeData
    expect(data.version).toBe(4)
    expect(data.people).toHaveLength(26)
    expect(data.pets).toHaveLength(3)
    expect(data.families).toHaveLength(9)
    expect(data.petFamilies).toHaveLength(1)
    expect(data.people.slice(0, 3).map((person) => person.displayName)).toEqual([
      'Nemisio Sullano',
      'Presentasion Sullano',
      'Jeffrey Sullano',
    ])
    expect(data.pets.find((pet) => pet.id === 'iring-brown')).toEqual(expect.objectContaining({
      displayName: 'Iring Brown',
      birthDate: '2013',
      portraitNumber: 1,
    }))
    expect(validateTreeData(data)).toEqual({ valid: true, errors: [] })
  })
})

describe('portrait and graph validation', () => {
  it('accepts repository PNG paths and explicit HTTPS PNG URLs only', () => {
    expect(isSafePortrait('portraits/25.png')).toBe(true)
    expect(isSafePortrait('/portraits/custom.png')).toBe(true)
    expect(isSafePortrait('https://images.example.com/family/member.PNG?size=2')).toBe(true)
    expect(isSafePortrait('http://images.example.com/member.png')).toBe(false)
    expect(isSafePortrait('//images.example.com/member.png')).toBe(false)
    expect(isSafePortrait('../member.png')).toBe(false)
    expect(isSafePortrait('portraits/member.webp')).toBe(false)
    expect(isSafePortrait('javascript:member.png')).toBe(false)
  })

  it('detects duplicate IDs, portrait numbers, child membership, birth orders, unsafe links, and future dates', () => {
    const data = fresh()
    data.people.push({ ...data.people[0], links: ['javascript:alert(1)'] })
    data.families[0].children[1].birthOrder = 1
    data.families[1].children.push({ personId: 'child-7', birthOrder: 99 })
    data.people[1].birthDate = '2999-01-01'
    const errors = validateTreeData(data).errors.join(' ')
    expect(errors).toMatch(/Duplicate person ID/)
    expect(errors).toMatch(/Duplicate portrait number/)
    expect(errors).toMatch(/more than one parental family/)
    expect(errors).toMatch(/duplicate birth orders/)
    expect(errors).toMatch(/unsafe link/)
    expect(errors).toMatch(/future/)
  })

  it('accepts pet birth years and rejects invalid life-date combinations', () => {
    const data = fresh()
    data.pets[0].birthDate = '2013'
    expect(validateTreeData(data)).toEqual({ valid: true, errors: [] })
    data.people[0].birthDate = '2000'
    data.people[1].birthDate = '2001-01-01'
    data.people[1].deathDate = '2000-01-01'
    data.people[2].status = 'dead'
    data.people[2].deathDate = '2999-01-01'
    data.pets[0].status = 'alive'
    data.pets[0].deathDate = '2024-01-01'
    const errors = validateTreeData(data).errors.join(' ')
    expect(errors).toMatch(/Father has an invalid birth date/)
    expect(errors).toMatch(/Mother has a death date before the birth date/)
    expect(errors).toMatch(/Child 1 has a death date in the future/)
    expect(errors).toMatch(/Iring Brown cannot have a death date while marked alive|marked alive/)
  })

  it('detects human and pet ancestry cycles', () => {
    const data = fresh()
    data.families.push({ id: 'cycle-family', parentIds: ['grandchild-1-1'], children: [{ personId: 'child-1', birthOrder: 1 }] })
    const petParent = createBlankPet('pet-parent', 'Pet parent', 2)
    const petChild = createBlankPet('pet-child', 'Pet child', 3)
    data.pets.push(petParent, petChild)
    data.petFamilies = [
      { id: 'pet-a', parentPetIds: ['pet-parent'], children: [{ petId: 'pet-child', birthOrder: 1 }] },
      { id: 'pet-b', parentPetIds: ['pet-child'], children: [{ petId: 'pet-parent', birthOrder: 1 }] },
    ]
    const result = validateTreeData(data)
    expect(result.errors).toContain('The human family graph contains an ancestry cycle.')
    expect(result.errors).toContain('The pet lineage contains an ancestry cycle.')
  })
})

describe('editing operations', () => {
  it('assigns independent next portrait numbers for people and pets', () => {
    const data = fresh()
    expect(nextPortraitNumber(data)).toBe(25)
    expect(nextPetPortraitNumber(data)).toBe(2)
    const withPet = addPetOffspring(data, 'iring-brown', 'Brown Kitten')
    expect(withPet.pets.at(-1)).toEqual(expect.objectContaining({
      portraitNumber: 2,
      portrait: 'portraits/pets/2.png',
    }))
  })

  it('protects core records and adds children to a selected partner unit with permanent numbers', () => {
    const data = fresh()
    expect(deletePerson(data, 'child-1').deleted).toBe(false)
    const withPartner = addPartner(data, 'new-child', 'Third partner')
    const unit = withPartner.families.find((family) => family.parentIds.includes('third-partner'))!
    const next = addChild(withPartner, 'new-child', 'Partner-specific child', unit.id)
    expect(unit.children).toHaveLength(0)
    expect(next.families.find((family) => family.id === unit.id)?.children).toEqual([{ personId: 'partner-specific-child', birthOrder: 1 }])
    expect(next.families.filter((family) => family.children.some((child) => child.personId === 'partner-specific-child'))).toHaveLength(1)
    expect(next.people.at(-1)?.portraitNumber).toBe(26)
  })

  it('retains children under the remaining parent', () => {
    const result = deletePerson(fresh(), 'new-partner')
    expect(result.deleted).toBe(true)
    const family = result.data.families.find((item) => item.id === 'family-new-child')!
    expect(family.parentIds).toEqual(['new-child'])
    expect(family.children.map((child) => child.personId)).toEqual(['new-child-2'])
  })

  it('plans and applies a two-parent recursive branch cascade while retaining partners', () => {
    const data = fresh()
    data.people.push(
      createBlankPerson('parent-a', 'Parent A', 25),
      createBlankPerson('parent-b', 'Parent B', 26),
      createBlankPerson('branch-child', 'Branch Child', 27),
      createBlankPerson('branch-partner', 'Branch Partner', 28),
      createBlankPerson('branch-grandchild', 'Branch Grandchild', 29),
    )
    data.families.push(
      { id: 'removable-root', parentIds: ['parent-a', 'parent-b'], children: [{ personId: 'branch-child', birthOrder: 1 }] },
      { id: 'removable-child', parentIds: ['branch-child', 'branch-partner'], children: [{ personId: 'branch-grandchild', birthOrder: 1 }] },
    )
    const plan = planPersonDeletion(data, ['parent-a', 'parent-b'])
    expect(plan.blockedReason).toBeUndefined()
    expect(plan.cascadeIds).toEqual(expect.arrayContaining(['branch-child', 'branch-grandchild']))
    const next = applyPersonDeletePlan(data, plan)
    expect(next.people.some((person) => person.id === 'branch-child')).toBe(false)
    expect(next.people.some((person) => person.id === 'branch-grandchild')).toBe(false)
    expect(next.people.some((person) => person.id === 'branch-partner')).toBe(true)
  })

  it('blocks any deletion plan that reaches a protected record', () => {
    const data = fresh()
    data.people.push(createBlankPerson('temporary-parent', 'Temporary parent', 25))
    data.families.push({ id: 'protected-cascade', parentIds: ['temporary-parent'], children: [{ personId: 'father', birthOrder: 1 }] })
    expect(planPersonDeletion(data, ['temporary-parent']).blockedReason).toMatch(/protected record Father/)
  })

  it('supports pet ownership, lineage, protections, and version-4 multi-link export round trips', () => {
    const data = fresh()
    const pet = { ...createBlankPet('luna', 'Luna', 2), species: 'Dog', ownerPersonId: 'child-2', links: ['https://example.com/luna', 'https://example.com/video'] }
    const withPet = { ...data, pets: [...data.pets, pet] }
    const withOffspring = addPetOffspring(withPet, 'luna', 'Nova')
    const partnered = addPetPartner(withOffspring, 'luna', 'Sol')
    expect(partnered.petFamilies.find((family) => family.parentPetIds.includes('luna'))?.parentPetIds).toEqual(['luna', 'sol'])
    expect(deletePet(withOffspring, 'luna').deleted).toBe(false)
    expect(deletePet(withOffspring, 'nova').deleted).toBe(true)
    expect(deletePet(withOffspring, 'iring-brown').deleted).toBe(false)
    const exported = exportTreeData(partnered)
    expect(JSON.parse(exported)).toEqual(partnered)
    expect(migrateTreeData(JSON.parse(exported))).toEqual(partnered)
  })

  it('blocks export while duplicate portrait numbers are unresolved', () => {
    const data = fresh()
    data.people[1].portraitNumber = data.people[0].portraitNumber
    expect(() => exportTreeData(data)).toThrow(/Duplicate portrait number/)
  })
})
