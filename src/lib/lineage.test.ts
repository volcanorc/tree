import { describe, expect, it } from 'vitest'
import publishedArchive from '../../public/tree-data.json'
import type { Person, TreeData } from '../types'
import { addChild, addSibling, migrateTreeData } from './data'
import {
  classifyFamilyLine,
  familyLineOptions,
  inferLineageSurname,
  lineageSurnameAfterNameChange,
  normalizeLineageSurname,
} from './lineage'

const published = () => structuredClone(publishedArchive) as TreeData

describe('lineage surname parsing and migration', () => {
  it('handles suffixes, casing, punctuation, placeholders, and hyphenated surnames', () => {
    expect(inferLineageSurname('Mark Grad Jr.')).toBe('Grad')
    expect(inferLineageSurname('Mark Grad SR')).toBe('Grad')
    expect(inferLineageSurname('Mark Grad III')).toBe('Grad')
    expect(inferLineageSurname('Ana Cruz-Santos')).toBe('Cruz-Santos')
    expect(inferLineageSurname('New child')).toBe('')
    expect(inferLineageSurname('?')).toBe('')
    expect(inferLineageSurname('June ?')).toBe('')
    expect(inferLineageSurname('Junel')).toBe('')
    expect(normalizeLineageSurname('  SuLLano  ')).toBe('sullano')
  })

  it('updates only blank or still-automatic suggestions when a name changes', () => {
    const automatic = { displayName: 'Mark Grad Jr.', lineageSurname: 'Grad' } as Person
    const blank = { displayName: 'Unknown Person', lineageSurname: '' } as Person
    const customized = { displayName: 'Ana Married', lineageSurname: 'Birth-Line' } as Person
    expect(lineageSurnameAfterNameChange(automatic, 'Mark Santos Jr.')).toBe('Santos')
    expect(lineageSurnameAfterNameChange(blank, 'Ana Cruz-Santos')).toBe('Cruz-Santos')
    expect(lineageSurnameAfterNameChange(customized, 'Ana Santos')).toBe('Birth-Line')
  })

  it('migrates version 5 names to explicit lineage surnames and preserves version 6 custom values', () => {
    const old = published() as unknown as Record<string, unknown>
    old.version = 5
    const people = old.people as Array<Record<string, unknown>>
    people.forEach((person) => { delete person.lineageSurname })
    people[0].displayName = 'Mark Grad Jr.'
    const migrated = migrateTreeData(old)
    expect(migrated.version).toBe(6)
    expect(migrated.people[0].lineageSurname).toBe('Grad')
    expect(migrated.people.find((person) => person.displayName === 'Junel')?.lineageSurname).toBe('')

    const current = published()
    current.people[0].lineageSurname = 'Custom Compound'
    expect(migrateTreeData(current).people[0].lineageSurname).toBe('Custom Compound')
  })

  it('builds unique case-insensitive family options in alphabetical order', () => {
    const data = published()
    data.people[0].lineageSurname = 'sullano'
    expect(familyLineOptions(data.people).map((option) => option.key)).toEqual([
      'bering', 'castaneda', 'ermac', 'sullano', 'tayad',
    ])
  })
})

describe('family-line inheritance and classification', () => {
  it('keeps Sullano daughters as members but stops at differently named children', () => {
    const data = published()
    const result = classifyFamilyLine(data.people, data.families, 'SULLANO')
    expect(result.memberIds.has('child-2')).toBe(true)
    expect(result.memberIds.has('grandchild-2-1')).toBe(false)
    expect(result.continuingChildIds.has('grandchild-2-1')).toBe(false)
    expect(result.continuingFamilyIds.has('family-child-2')).toBe(false)
    expect(result.memberIds.has('grandchild-5-2')).toBe(true)
    expect(result.continuingFamilyIds.has('family-child-5')).toBe(true)
  })

  it('reverses a married branch so Bering is green and its Sullano partner is pink', () => {
    const data = published()
    const result = classifyFamilyLine(data.people, data.families, 'Bering')
    expect(result.carrierByFamilyId.get('family-child-2')).toBe('new-partner-5')
    expect(result.memberIds.has('new-partner-5')).toBe(true)
    expect(result.partnerIds.has('child-2')).toBe(true)
    expect(result.continuingChildIds.has('grandchild-2-1')).toBe(true)
    expect(result.continuingChildIds.has('grandchild-2-2')).toBe(true)
  })

  it('uses reached carriers, then a unique male, then stable parent order', () => {
    const data = published()
    const root = classifyFamilyLine(data.people, data.families, 'Sullano')
    expect(root.carrierByFamilyId.get('root-family')).toBe('father')
    expect(root.partnerIds.has('mother')).toBe(true)
    expect(root.carrierByFamilyId.get('family-child-1')).toBe('child-1')

    const ambiguous = published()
    ambiguous.people.find((person) => person.id === 'father')!.gender = 'unknown'
    expect(classifyFamilyLine(ambiguous.people, ambiguous.families, 'Sullano').carrierByFamilyId.get('root-family')).toBe('father')
  })

  it('inherits child and sibling lineages without renumbering or name parsing', () => {
    const data = published()
    const beringChild = addChild(data, 'new-partner-5', 'New child', 'family-child-2')
    expect(beringChild.people.at(-1)?.lineageSurname).toBe('Bering')
    const sibling = addSibling(data, 'grandchild-2-1')
    expect(sibling.people.at(-1)?.lineageSurname).toBe('Bering')

    const ambiguous = published()
    const emptyFamily = ambiguous.families.find((family) => family.id === 'family-grandchild-5-2')!
    emptyFamily.parentIds.push('new-partner')
    const child = addChild(ambiguous, 'grandchild-5-2', 'New child', emptyFamily.id)
    expect(child.people.at(-1)?.lineageSurname).toBe('')
  })
})
