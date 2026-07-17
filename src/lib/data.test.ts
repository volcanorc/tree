import { describe, expect, it } from 'vitest'
import seed from '../../public/tree-data.json'
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
  migrateTreeData,
  planPersonDeletion,
  sortChildren,
  validateTreeData,
} from './data'

const fresh = () => structuredClone(seed) as TreeData

describe('age, ordering, and migration', () => {
  it('calculates age from a full date before using an override', () => {
    const today = new Date('2026-07-17T12:00:00Z')
    expect(calculateAge('2000-07-17', 88, today)).toBe(26)
    expect(calculateAge('2000-07-18', 88, today)).toBe(25)
    expect(calculateAge('', 42, today)).toBe(42)
    expect(calculateAge('', null, today)).toBe('?')
  })

  it('sorts every current root child youngest-left by descending birth order', () => {
    const root = fresh().families.find((family) => family.id === 'root-family')!
    expect(sortChildren(root.children).map((child) => child.personId)).toEqual([
      'new-child', 'child-7', 'child-6', 'child-5', 'child-4', 'child-3', 'child-2', 'child-1',
    ])
  })

  it('migrates version-one data with stable portrait numbers and defaults', () => {
    const legacy = structuredClone(seed) as unknown as Record<string, unknown>
    legacy.version = 1
    const people = legacy.people as Array<Record<string, unknown>>
    people.forEach((person) => {
      delete person.portraitNumber
      delete person.birthDetails
      delete person.status
    })
    legacy.pets = []
    const migrated = migrateTreeData(legacy)
    expect(migrated.version).toBe(2)
    expect(migrated.people.find((person) => person.id === 'father')?.portraitNumber).toBe(1)
    expect(migrated.people.find((person) => person.id === 'child-7')?.portraitNumber).toBe(3)
    expect(migrated.people.find((person) => person.id === 'new-child')?.portraitNumber).toBe(22)
    expect(migrated.people.every((person) => person.status === 'alive')).toBe(true)
    expect(migrated.pets[0].id).toBe('iring-brown')
    expect(validateTreeData(migrated).valid).toBe(true)
  })
})

describe('preserved archive data', () => {
  it('keeps all current family edits, core protections, numbered portraits, and pet founder', () => {
    const data = fresh()
    expect(data.version).toBe(2)
    expect(data.people).toHaveLength(24)
    expect(data.people.filter((person) => person.protected)).toHaveLength(9)
    expect(new Set(data.people.map((person) => person.portraitNumber)).size).toBe(24)
    expect(data.people.find((person) => person.displayName === 'second wife')).toBeTruthy()
    expect([1, 2, 3, 4, 5, 6, 7].map((number) =>
      data.families.find((family) => family.id === `family-child-${number}`)?.children.length ?? 0,
    )).toEqual([4, 2, 2, 2, 2, 0, 0])
    expect(data.pets).toContainEqual(expect.objectContaining({
      id: 'iring-brown', displayName: 'Iring Brown', species: 'Cat', gender: 'female', status: 'dead',
      ageOverride: 11, birthDetails: 'Trash can', personality: 'Slow', protected: true,
    }))
    expect(countDescendants(data)).toBe(21)
    expect(validateTreeData(data)).toEqual({ valid: true, errors: [] })
  })
})

describe('graph validation', () => {
  it('detects duplicate IDs, portrait numbers, child membership, birth orders, unsafe links, and future dates', () => {
    const data = fresh()
    data.people.push({ ...data.people[0], link: 'javascript:alert(1)' })
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

  it('detects human and pet ancestry cycles', () => {
    const data = fresh()
    data.families.push({ id: 'cycle-family', parentIds: ['grandchild-1-1'], children: [{ personId: 'child-1', birthOrder: 1 }] })
    const petParent = createBlankPet('pet-parent', 'Pet parent')
    const petChild = createBlankPet('pet-child', 'Pet child')
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

  it('supports pet ownership, lineage, protections, and valid export round trips', () => {
    const data = fresh()
    const pet = { ...createBlankPet('luna', 'Luna'), species: 'Dog', ownerPersonId: 'child-2' }
    const withPet = { ...data, pets: [...data.pets, pet] }
    const withOffspring = addPetOffspring(withPet, 'luna', 'Nova')
    const partnered = addPetPartner(withOffspring, 'luna', 'Sol')
    expect(partnered.petFamilies.find((family) => family.parentPetIds.includes('luna'))?.parentPetIds).toEqual(['luna', 'sol'])
    expect(deletePet(withOffspring, 'luna').deleted).toBe(false)
    expect(deletePet(withOffspring, 'nova').deleted).toBe(true)
    expect(deletePet(withOffspring, 'iring-brown').deleted).toBe(false)
    const exported = exportTreeData(partnered)
    expect(validateTreeData(JSON.parse(exported) as TreeData).valid).toBe(true)
    expect(JSON.parse(exported)).toEqual(partnered)
  })
})
