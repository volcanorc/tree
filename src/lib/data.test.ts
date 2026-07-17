import { describe, expect, it } from 'vitest'
import seed from '../../public/tree-data.json'
import type { TreeData } from '../types'
import {
  addChild,
  addPartner,
  addPetOffspring,
  addPetPartner,
  calculateAge,
  createBlankPet,
  deletePerson,
  deletePet,
  exportTreeData,
  sortChildren,
  validateTreeData,
} from './data'

const fresh = () => structuredClone(seed) as TreeData

describe('age and ordering', () => {
  it('calculates age from a full date before using an override', () => {
    const today = new Date('2026-07-17T12:00:00Z')
    expect(calculateAge('2000-07-17', 88, today)).toBe(26)
    expect(calculateAge('2000-07-18', 88, today)).toBe(25)
    expect(calculateAge('', 42, today)).toBe(42)
    expect(calculateAge('', null, today)).toBe('?')
  })

  it('sorts the youngest at the left by descending birth order', () => {
    const root = fresh().families.find((family) => family.id === 'root-family')!
    expect(sortChildren(root.children).map((child) => child.personId)).toEqual([
      'child-7', 'child-6', 'child-5', 'child-4', 'child-3', 'child-2', 'child-1',
    ])
  })
})

describe('seed archive', () => {
  it('contains the protected parents, seven siblings, and exact grandchild counts', () => {
    const data = fresh()
    expect(data.people.filter((person) => person.protected)).toHaveLength(9)
    expect(data.people).toHaveLength(21)
    const expectedGenders = ['male', 'female', 'female', 'female', 'male', 'female', 'male']
    expect(expectedGenders.map((gender, index) => data.people.find((person) => person.id === `child-${index + 1}`)?.gender)).toEqual(expectedGenders)
    expect([1, 2, 3, 4, 5, 6, 7].map((number) =>
      data.families.find((family) => family.id === `family-child-${number}`)?.children.length ?? 0,
    )).toEqual([4, 2, 2, 2, 2, 0, 0])
    expect(validateTreeData(data)).toEqual({ valid: true, errors: [] })
  })
})

describe('graph validation', () => {
  it('detects duplicate IDs, birth-order collisions, unsafe links, and future dates', () => {
    const data = fresh()
    data.people.push({ ...data.people[0], link: 'javascript:alert(1)' })
    data.families[0].children[1].birthOrder = 1
    data.people[1].birthDate = '2999-01-01'
    const result = validateTreeData(data)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/Duplicate person ID/)
    expect(result.errors.join(' ')).toMatch(/duplicate birth orders/)
    expect(result.errors.join(' ')).toMatch(/unsafe link/)
    expect(result.errors.join(' ')).toMatch(/future/)
  })

  it('detects human and pet ancestry cycles', () => {
    const data = fresh()
    data.families.push({
      id: 'cycle-family',
      parentIds: ['grandchild-1-1'],
      children: [{ personId: 'child-1', birthOrder: 1 }],
    })
    const petParent = createBlankPet('pet-parent', 'Pet parent')
    const petChild = createBlankPet('pet-child', 'Pet child')
    data.pets = [petParent, petChild]
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
  it('protects core records and adds a new child as the youngest', () => {
    const data = fresh()
    expect(deletePerson(data, 'child-1').deleted).toBe(false)
    const next = addChild(data, 'child-7', 'New grandchild')
    const family = next.families.find((item) => item.parentIds.includes('child-7'))!
    expect(family.children).toEqual([{ personId: 'new-grandchild', birthOrder: 1 }])
    expect(next.people.find((person) => person.id === 'new-grandchild')?.protected).toBe(false)
  })

  it('rejects imports that remove or unprotect a core person', () => {
    const missing = fresh()
    missing.people = missing.people.filter((person) => person.id !== 'father')
    expect(validateTreeData(missing).errors).toContain('Protected core person father is missing.')
    const unprotected = fresh()
    unprotected.people.find((person) => person.id === 'child-7')!.protected = false
    expect(validateTreeData(unprotected).errors).toContain('Protected core person child-7 cannot be unprotected.')
  })

  it('retains children under the remaining parent when a removable partner is deleted', () => {
    const partnered = addPartner(fresh(), 'child-1', 'Partner one')
    const familyBefore = partnered.families.find((family) => family.parentIds.includes('partner-one'))!
    expect(familyBefore.children).toHaveLength(4)
    const result = deletePerson(partnered, 'partner-one')
    expect(result.deleted).toBe(true)
    const familyAfter = result.data.families.find((family) => family.id === familyBefore.id)!
    expect(familyAfter.parentIds).toEqual(['child-1'])
    expect(familyAfter.children).toHaveLength(4)
  })

  it('blocks deletion of an only parent with descendants, then permits leaf deletion', () => {
    const withChild = addChild(fresh(), 'child-7', 'New grandchild')
    expect(deletePerson(withChild, 'child-7').deleted).toBe(false)
    const leafResult = deletePerson(withChild, 'new-grandchild')
    expect(leafResult.deleted).toBe(true)
  })

  it('supports pet ownership, lineage, deletion rules, and valid round trips', () => {
    const data = fresh()
    const pet = { ...createBlankPet('luna', 'Luna'), species: 'Dog', ownerPersonId: 'child-2' }
    const withPet = { ...data, pets: [pet] }
    const withOffspring = addPetOffspring(withPet, 'luna', 'Nova')
    expect(withOffspring.petFamilies[0].children[0]).toEqual({ petId: 'nova', birthOrder: 1 })
    const partnered = addPetPartner(withOffspring, 'luna', 'Sol')
    expect(partnered.petFamilies[0].parentPetIds).toEqual(['luna', 'sol'])
    expect(deletePet(withOffspring, 'luna').deleted).toBe(false)
    expect(deletePet(withOffspring, 'nova').deleted).toBe(true)
    const exported = exportTreeData(partnered)
    expect(validateTreeData(JSON.parse(exported) as TreeData).valid).toBe(true)
    expect(JSON.parse(exported)).toEqual(partnered)
  })
})
