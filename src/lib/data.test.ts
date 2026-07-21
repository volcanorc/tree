import { describe, expect, it } from 'vitest'
import publishedArchive from '../../public/tree-data.json'
import seed from '../test/fixtures/tree-data-v4.json'
import type { TreeData } from '../types'
import {
  addChild,
  addPartner,
  addPetOffspring,
  addPetPartner,
  addPetSibling,
  addSibling,
  applyPetDeletePlan,
  applyPersonDeletePlan,
  calculateAge,
  countDescendants,
  createBlankPerson,
  createBlankPet,
  dateFieldError,
  deletePerson,
  deletePet,
  displayArchiveDate,
  exportTreeData,
  isSafePortrait,
  migrateTreeData,
  nextPetPortraitNumber,
  nextPortraitNumber,
  normalizeArchiveDate,
  parseArchiveDate,
  portraitNumberFromPath,
  planPetDeletion,
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
  it('calculates living and deceased ages at year, month, and full-date boundaries', () => {
    const julyFirst = new Date(2026, 6, 1, 12)
    expect(calculateAge('2000-07-01', julyFirst)).toBe(26)
    expect(calculateAge('2000-07-02', julyFirst)).toBe(25)
    expect(calculateAge('2000-07-18', julyFirst, '2020-07-17', 'dead')).toBe(19)
    expect(calculateAge('2000-07-18', julyFirst, '', 'dead')).toBe(25)
    expect(calculateAge('2013', julyFirst, '', 'alive', true)).toBe(13)
    expect(calculateAge('2020-07', new Date(2026, 5, 30, 12), '', 'alive', true)).toBe(5)
    expect(calculateAge('2020-07', julyFirst, '', 'alive', true)).toBe(6)
    expect(calculateAge('2020-07-02', julyFirst, '', 'alive', true)).toBe(5)
    expect(calculateAge('2013', julyFirst, '2024', 'dead', true)).toBe(11)
    expect(calculateAge('', julyFirst)).toBe('?')
  })

  it('parses fuzzy pet month names and normalizes readable two- or four-digit-year dates', () => {
    expect(parseArchiveDate('2020-March', true)?.canonical).toBe('2020-03')
    expect(parseArchiveDate('2020-Mar', true)?.canonical).toBe('2020-03')
    expect(parseArchiveDate('2020-March-15', true)?.canonical).toBe('2020-03-15')
    expect(normalizeArchiveDate('2002-12-9', true)).toBe('2002-dec-9')
    expect(normalizeArchiveDate('02-december-9', true)).toBe('2002-dec-9')
    expect(normalizeArchiveDate('12-jue-9', true)).toBe('2012-jun-9')
    expect(normalizeArchiveDate('12-juy-9', true)).toBe('2012-jul-9')
    expect(normalizeArchiveDate('12-ap-9', true)).toBe('2012-apr-9')
    expect(normalizeArchiveDate('12-aprl-9', true)).toBe('2012-apr-9')
    expect(normalizeArchiveDate('12-aril-9', true)).toBe('2012-apr-9')
    expect(normalizeArchiveDate('12-aug-9', true)).toBe('2012-aug-9')
    expect(normalizeArchiveDate('12-decamber-9', true)).toBe('2012-dec-9')
    expect(normalizeArchiveDate('59', true)).toBe('2059')
    expect(normalizeArchiveDate('2020-JULY', true)).toBe('2020-jul')
    expect(parseArchiveDate('12-ma-9', true)).toBeNull()
    expect(parseArchiveDate('12-ju-9', true)).toBeNull()
    expect(parseArchiveDate('2020-02-30', true)).toBeNull()
    expect(parseArchiveDate('2024-02-29', true)).not.toBeNull()
    expect(parseArchiveDate('2023-02-29', true)).toBeNull()
    expect(parseArchiveDate('2020-03', false)).toBeNull()
    expect(parseArchiveDate('20-03-09', false)).toBeNull()
    expect(dateFieldError('59', true, new Date(2026, 6, 1))).toBe('Date cannot be in the future.')
  })

  it('formats public people and pet dates with full English month names', () => {
    expect(displayArchiveDate('1998-12-09')).toBe('December 9 1998')
    expect(displayArchiveDate('2020-mar')).toBe('March 2020')
    expect(displayArchiveDate('2013')).toBe('2013')
    expect(displayArchiveDate('')).toBe('?')
  })

  it('normalizes valid existing pet dates during migration and preserves invalid text', () => {
    const data = fresh()
    data.pets[0].birthDate = '2002-12-09'
    data.pets[0].deathDate = '12-decamber-9'
    data.pets.push({ ...createBlankPet('invalid-date-pet', 'Invalid date pet', 99), birthDate: '12-ma-9' })
    const migrated = migrateTreeData(data)
    expect(migrated.pets[0].birthDate).toBe('2002-dec-9')
    expect(migrated.pets[0].deathDate).toBe('2012-dec-9')
    expect(migrated.pets.find((pet) => pet.id === 'invalid-date-pet')?.birthDate).toBe('12-ma-9')
  })

  it('sorts every current root child youngest-left by descending birth order', () => {
    const root = fresh().families.find((family) => family.id === 'root-family')!
    expect(sortChildren(root.children).map((child) => child.personId)).toEqual([
      'new-child', 'child-7', 'child-6', 'child-5', 'child-4', 'child-3', 'child-2', 'child-1',
    ])
  })

  it.each([1, 2] as const)('migrates version %s data to version 6 with links, death dates, and automatic PNG paths', (version) => {
    const migrated = migrateTreeData(legacyVersion(version))
    expect(migrated.version).toBe(6)
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

  it.each([3, 4, 5] as const)('migrates version-%s data, removes age overrides, and keeps version 6 idempotent', (version) => {
    const previous = structuredClone(seed) as unknown as Record<string, unknown>
    previous.version = version
    ;(previous.people as Array<Record<string, unknown>>).forEach((person) => {
      delete person.deathDate
      person.ageOverride = 99
    })
    ;(previous.pets as Array<Record<string, unknown>>).forEach((pet) => {
      delete pet.deathDate
      pet.ageOverride = 11
      if (pet.id === 'iring-brown') pet.birthDate = ''
    })
    const migrated = migrateTreeData(previous)
    expect(migrated.version).toBe(6)
    expect(migrated.people.every((person) => person.deathDate === '')).toBe(true)
    expect(migrated.pets.every((pet) => pet.deathDate === '')).toBe(true)
    expect(migrated.pets.find((pet) => pet.id === 'iring-brown')?.birthDate).toBe('2013')
    expect('ageOverride' in migrated.people[0]).toBe(false)
    expect('ageOverride' in migrated.pets[0]).toBe(false)
    expect(migrateTreeData(fresh())).toEqual(fresh())
  })

  it('migrates only blank and old-default titles while preserving custom titles', () => {
    const oldDefault = fresh()
    oldDefault.site.title = 'The Family Archive'
    expect(migrateTreeData(oldDefault).site.title).toBe('The Lineage Archive')

    const blank = fresh()
    blank.site.title = '   '
    expect(migrateTreeData(blank).site.title).toBe('The Lineage Archive')

    const custom = fresh()
    custom.site.title = 'Hermoso Family History'
    expect(migrateTreeData(custom).site.title).toBe('Hermoso Family History')
  })

  it('parses only canonical portrait paths in the correct namespace', () => {
    expect(portraitNumberFromPath('portraits/25.png', 'person')).toBe(25)
    expect(portraitNumberFromPath('/portraits/25.png', 'person')).toBe(25)
    expect(portraitNumberFromPath('portraits/pets/4.png', 'pet')).toBe(4)
    expect(portraitNumberFromPath('/portraits/pets/4.png', 'pet')).toBe(4)
    expect(portraitNumberFromPath('portraits/pets/4.png', 'person')).toBeNull()
    expect(portraitNumberFromPath('portraits/4.png', 'pet')).toBeNull()
    expect(portraitNumberFromPath('portraits/custom.png', 'person')).toBeNull()
    expect(portraitNumberFromPath('portraits/25', 'person')).toBeNull()
    expect(portraitNumberFromPath('https://example.com/portraits/25.png', 'person')).toBeNull()
    expect(portraitNumberFromPath('portraits/0.png', 'person')).toBeNull()
  })
})

describe('preserved archive data', () => {
  it('keeps all family edits, core protections, numbered portraits, and the pet founder', () => {
    const data = fresh()
    expect(data.version).toBe(6)
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
      birthDate: '2013', deathDate: '', birthDetails: 'Trash can', personality: 'Slow', protected: true,
      portraitNumber: 1, portrait: 'portraits/pets/1.png', links: [],
    }))
    expect(countDescendants(data)).toBe(21)
    expect(validateTreeData(data)).toEqual({ valid: true, errors: [] })
  })
})

describe('published archive data', () => {
  it('keeps the renamed records and validates the current public version-6 archive', () => {
    const data = structuredClone(publishedArchive) as TreeData
    expect(data.version).toBe(6)
    expect(data.people).toHaveLength(28)
    expect(data.pets).toHaveLength(2)
    expect(data.families).toHaveLength(12)
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
    data.pets[0].birthDate = '2013-March'
    data.pets[0].deathDate = '2024-May'
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

  it('rejects invalid and future partial pet dates without rejecting the record shape', () => {
    const data = fresh()
    data.pets[0].birthDate = '2020-Smudgemarch'
    expect(validateTreeData(data).errors.join(' ')).toMatch(/Iring Brown has an invalid birth date/)
    data.pets[0].birthDate = `${new Date().getFullYear() + 1}`
    expect(validateTreeData(data).errors.join(' ')).toMatch(/Iring Brown has a birth date in the future/)
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

  it('adds human siblings to the exact two-parent or single-parent family unit', () => {
    const data = fresh()
    data.people.push(
      createBlankPerson('parent-a', 'Parent A', 25),
      createBlankPerson('partner-one', 'Partner One', 26),
      createBlankPerson('partner-two', 'Partner Two', 27),
      createBlankPerson('first-child', 'First Child', 28),
      createBlankPerson('other-child', 'Other Child', 29),
      createBlankPerson('solo-child', 'Solo Child', 30),
    )
    data.families.push(
      { id: 'first-union', parentIds: ['parent-a', 'partner-one'], children: [{ personId: 'first-child', birthOrder: 2 }] },
      { id: 'second-union', parentIds: ['parent-a', 'partner-two'], children: [{ personId: 'other-child', birthOrder: 1 }] },
      { id: 'solo-union', parentIds: ['partner-two'], children: [{ personId: 'solo-child', birthOrder: 4 }] },
    )

    const partnered = addSibling(data, 'first-child')
    const partneredId = partnered.people.at(-1)!.id
    expect(partnered.families.find((family) => family.id === 'first-union')?.children).toContainEqual({ personId: partneredId, birthOrder: 3 })
    expect(partnered.families.find((family) => family.id === 'second-union')?.children.some((child) => child.personId === partneredId)).toBe(false)

    const solo = addSibling(partnered, 'solo-child')
    expect(solo.families.find((family) => family.id === 'solo-union')?.children).toContainEqual({ personId: solo.people.at(-1)!.id, birthOrder: 5 })
    expect(addSibling(data, 'parent-a')).toBe(data)
  })

  it('retains children under the remaining parent', () => {
    const data = fresh()
    data.pets[0].ownerPersonId = 'new-partner'
    const result = deletePerson(data, 'new-partner')
    expect(result.deleted).toBe(true)
    const family = result.data.families.find((item) => item.id === 'family-new-child')!
    expect(family.parentIds).toEqual(['new-child'])
    expect(family.children.map((child) => child.personId)).toEqual(['new-child-2'])
    expect(result.data.pets[0].ownerPersonId).toBe('')
  })

  it('cascades an orphaned branch but preserves descendants under an unselected partner', () => {
    const data = fresh()
    data.people.push(
      createBlankPerson('parent-a', 'Parent A', 25),
      createBlankPerson('parent-b', 'Parent B', 26),
      createBlankPerson('branch-child', 'Branch Child', 27),
      createBlankPerson('branch-partner', 'Branch Partner', 28),
      createBlankPerson('branch-grandchild', 'Branch Grandchild', 29),
      createBlankPerson('solo-grandchild', 'Solo Grandchild', 30),
    )
    data.families.push(
      { id: 'removable-root', parentIds: ['parent-a', 'parent-b'], children: [{ personId: 'branch-child', birthOrder: 1 }] },
      { id: 'removable-child', parentIds: ['branch-child', 'branch-partner'], children: [{ personId: 'branch-grandchild', birthOrder: 1 }] },
      { id: 'removable-solo', parentIds: ['branch-child'], children: [{ personId: 'solo-grandchild', birthOrder: 1 }] },
    )
    const plan = planPersonDeletion(data, ['parent-a', 'parent-b'])
    expect(plan.blockedReason).toBeUndefined()
    expect(plan.cascadeIds).toEqual(expect.arrayContaining(['branch-child', 'solo-grandchild']))
    expect(plan.cascadeIds).not.toContain('branch-grandchild')
    const next = applyPersonDeletePlan(data, plan)
    expect(next.people.some((person) => person.id === 'branch-child')).toBe(false)
    expect(next.people.some((person) => person.id === 'solo-grandchild')).toBe(false)
    expect(next.people.some((person) => person.id === 'branch-grandchild')).toBe(true)
    expect(next.people.some((person) => person.id === 'branch-partner')).toBe(true)
    expect(next.families.find((family) => family.id === 'removable-child')?.parentIds).toEqual(['branch-partner'])
  })

  it('blocks any deletion plan that reaches a protected record', () => {
    const data = fresh()
    data.people.push(createBlankPerson('temporary-parent', 'Temporary parent', 25))
    data.families.push({ id: 'protected-cascade', parentIds: ['temporary-parent'], children: [{ personId: 'father', birthOrder: 1 }] })
    expect(planPersonDeletion(data, ['temporary-parent']).blockedReason).toMatch(/protected record Father/)
  })

  it('supports pet ownership, lineage, protections, and version-6 multi-link export round trips', () => {
    const data = fresh()
    const pet = { ...createBlankPet('luna', 'Luna', 2), species: 'Dog', ownerPersonId: 'child-2', links: ['https://example.com/luna', 'https://example.com/video'] }
    const withPet = { ...data, pets: [...data.pets, pet] }
    const withOffspring = addPetOffspring(withPet, 'luna', 'Nova')
    const lunaFamily = withOffspring.petFamilies.find((family) => family.parentPetIds.includes('luna'))!
    const partnered = addPetPartner(withOffspring, 'luna', 'Sol', lunaFamily.id)
    expect(partnered.petFamilies.find((family) => family.parentPetIds.includes('luna'))?.parentPetIds).toEqual(['luna', 'sol'])
    const singleParentPlan = planPetDeletion(withOffspring, ['luna'])
    expect(singleParentPlan.cascadeIds).toEqual(['nova'])
    expect(deletePet(withOffspring, 'luna').data.pets.some((candidate) => candidate.id === 'nova')).toBe(false)
    expect(deletePet(withOffspring, 'nova').deleted).toBe(true)
    expect(deletePet(withOffspring, 'iring-brown').deleted).toBe(false)
    const exported = exportTreeData(partnered)
    expect(JSON.parse(exported)).toEqual(partnered)
    expect(migrateTreeData(JSON.parse(exported))).toEqual(partnered)
  })

  it('supports multiple pet unions, partner-specific offspring, and exact-parent pet siblings', () => {
    let data = fresh()
    data = addPetPartner(data, 'iring-brown', 'First Pet Partner')
    data = addPetPartner(data, 'iring-brown', 'Second Pet Partner')
    const iringFamilies = data.petFamilies.filter((family) => family.parentPetIds.includes('iring-brown'))
    expect(iringFamilies).toHaveLength(2)
    expect(iringFamilies.map((family) => family.parentPetIds[1])).toEqual(['first-pet-partner', 'second-pet-partner'])

    data = addPetOffspring(data, 'iring-brown', 'Second Union Kitten', iringFamilies[1].id)
    const kittenId = data.pets.at(-1)!.id
    expect(data.petFamilies.find((family) => family.id === iringFamilies[1].id)?.children).toEqual([{ petId: kittenId, birthOrder: 1 }])
    expect(data.petFamilies.find((family) => family.id === iringFamilies[0].id)?.children).toEqual([])

    const withSibling = addPetSibling(data, kittenId)
    const siblingId = withSibling.pets.at(-1)!.id
    expect(withSibling.petFamilies.find((family) => family.id === iringFamilies[1].id)?.children).toContainEqual({ petId: siblingId, birthOrder: 2 })
    expect(addPetSibling(data, 'iring-brown')).toBe(data)
    expect(validateTreeData(withSibling)).toEqual({ valid: true, errors: [] })
  })

  it('plans individual and bulk pet deletion with surviving parents, recursive cascades, and protected blocking', () => {
    const data = fresh()
    const parentA = createBlankPet('parent-a', 'Parent A', 2)
    const parentB = createBlankPet('parent-b', 'Parent B', 3)
    const kitten = createBlankPet('kitten', 'Kitten', 4)
    const kittenPartner = createBlankPet('kitten-partner', 'Kitten Partner', 5)
    const grandkitten = createBlankPet('grandkitten', 'Grandkitten', 6)
    const soloOffspring = createBlankPet('solo-offspring', 'Solo Offspring', 7)
    data.pets.push(parentA, parentB, kitten, kittenPartner, grandkitten, soloOffspring)
    data.petFamilies.push(
      { id: 'pet-root', parentPetIds: ['parent-a', 'parent-b'], children: [{ petId: 'kitten', birthOrder: 1 }] },
      { id: 'pet-partnered-child', parentPetIds: ['kitten', 'kitten-partner'], children: [{ petId: 'grandkitten', birthOrder: 1 }] },
      { id: 'pet-solo-child', parentPetIds: ['kitten'], children: [{ petId: 'solo-offspring', birthOrder: 1 }] },
    )

    const survivingParentPlan = planPetDeletion(data, ['parent-a'])
    expect(survivingParentPlan.deleteIds).toEqual(['parent-a'])
    expect(applyPetDeletePlan(data, survivingParentPlan).petFamilies.find((family) => family.id === 'pet-root')?.parentPetIds).toEqual(['parent-b'])

    const bulkPlan = planPetDeletion(data, ['parent-a', 'parent-b'])
    expect(bulkPlan.cascadeIds).toEqual(expect.arrayContaining(['kitten', 'solo-offspring']))
    expect(bulkPlan.cascadeIds).not.toContain('grandkitten')
    const next = applyPetDeletePlan(data, bulkPlan)
    expect(next.pets.some((pet) => pet.id === 'solo-offspring')).toBe(false)
    expect(next.pets.some((pet) => pet.id === 'grandkitten')).toBe(true)
    expect(next.petFamilies.find((family) => family.id === 'pet-partnered-child')?.parentPetIds).toEqual(['kitten-partner'])

    const protectedData = fresh()
    protectedData.pets.push(createBlankPet('temporary-pet-parent', 'Temporary Pet Parent', 2))
    protectedData.petFamilies.push({ id: 'protected-pet-cascade', parentPetIds: ['temporary-pet-parent'], children: [{ petId: 'iring-brown', birthOrder: 1 }] })
    expect(planPetDeletion(protectedData, ['temporary-pet-parent']).blockedReason).toMatch(/protected pet Iring Brown/)
  })

  it('blocks export while duplicate portrait numbers are unresolved', () => {
    const data = fresh()
    data.people[1].portraitNumber = data.people[0].portraitNumber
    expect(() => exportTreeData(data)).toThrow(/Duplicate portrait number/)
  })
})
