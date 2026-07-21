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
    people[1].displayName = 'Junel'
    const migrated = migrateTreeData(old)
    expect(migrated.version).toBe(6)
    expect(migrated.people[0].lineageSurname).toBe('Grad')
    expect(migrated.people[1].lineageSurname).toBe('')

    const current = published()
    current.people[0].lineageSurname = 'Custom Compound'
    expect(migrateTreeData(current).people[0].lineageSurname).toBe('Custom Compound')
  })

  it('builds unique case-insensitive family options in alphabetical order', () => {
    const data = published()
    data.people[0].lineageSurname = 'sullano'
    expect(familyLineOptions(data.people).map((option) => option.key)).toEqual([
      'bering', 'castaneda', 'enares', 'ermac', 'sullano', 'tayad', 'vidal',
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
    expect(result.memberIds.has('new-sibling')).toBe(true)
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

  it.each(['female', 'male', 'unknown'] as const)('shows a %s lineage origin through direct children without transmitting to grandchildren or another partner', (gender) => {
    const data = published()
    data.people.find((person) => person.id === 'new-partner')!.gender = gender
    const directChild = data.people.find((person) => person.id === 'grandchild-1-2')!
    data.people.push({
      ...directChild,
      id: 'tayad-grandchild-probe',
      displayName: 'Probe Sullano',
      lineageSurname: 'Sullano',
      portraitNumber: 999,
      portrait: 'portraits/999.png',
    })
    data.families.push({
      id: 'tayad-descendant-family',
      parentIds: ['grandchild-1-2'],
      children: [{ personId: 'tayad-grandchild-probe', birthOrder: 1 }],
    })

    const result = classifyFamilyLine(data.people, data.families, 'Tayad')
    expect(result.lineageOriginIds).toEqual(new Set(['new-partner']))
    expect(result.memberIds.has('new-partner')).toBe(true)
    expect(result.partnerIds.has('child-1')).toBe(true)
    expect(result.originChildIds).toEqual(new Set(['grandchild-1-2', 'grandchild-1-3', 'grandchild-1-4']))
    expect(result.continuingFamilyIds.has('family-child-1')).toBe(true)
    expect(result.memberIds.has('tayad-grandchild-probe')).toBe(false)
    expect(result.continuingFamilyIds.has('tayad-descendant-family')).toBe(false)
    expect(result.memberIds.has('new-child')).toBe(false)
    expect(result.continuingFamilyIds.has('family-child-1-2')).toBe(false)
  })

  it('handles a same-gender lineage origin for one generation without surname-specific logic', () => {
    const data = published()
    const sullanoParent = data.people.find((person) => person.id === 'child-1')!
    const templatePartner = data.people.find((person) => person.id === 'new-partner')!
    const templateChild = data.people.find((person) => person.id === 'grandchild-1-2')!
    data.people.push(
      {
        ...templatePartner,
        id: 'vidal-origin',
        displayName: 'Marco Vidal',
        lineageSurname: 'Vidal-Probe',
        gender: 'male',
        portraitNumber: 996,
        portrait: 'portraits/996.png',
      },
      {
        ...templateChild,
        id: 'vidal-display-child',
        displayName: 'Alex Sullano',
        lineageSurname: 'Sullano',
        gender: 'unknown',
        portraitNumber: 997,
        portrait: 'portraits/997.png',
      },
      {
        ...templateChild,
        id: 'vidal-grandchild',
        displayName: 'Sam Santos',
        lineageSurname: 'Santos',
        gender: 'unknown',
        portraitNumber: 998,
        portrait: 'portraits/998.png',
      },
      {
        ...templateChild,
        id: 'vidal-line-child',
        displayName: 'Jordan Vidal',
        lineageSurname: 'Vidal-Probe',
        gender: 'unknown',
        portraitNumber: 991,
        portrait: 'portraits/991.png',
      },
      {
        ...templateChild,
        id: 'vidal-line-grandchild',
        displayName: 'Morgan Vidal',
        lineageSurname: 'Vidal-Probe',
        gender: 'unknown',
        portraitNumber: 992,
        portrait: 'portraits/992.png',
      },
    )
    data.families.push(
      {
        id: 'vidal-origin-family',
        parentIds: [sullanoParent.id, 'vidal-origin'],
        children: [
          { personId: 'vidal-display-child', birthOrder: 1 },
          { personId: 'vidal-line-child', birthOrder: 2 },
        ],
      },
      {
        id: 'vidal-descendant-family',
        parentIds: ['vidal-display-child'],
        children: [{ personId: 'vidal-grandchild', birthOrder: 1 }],
      },
      {
        id: 'vidal-line-descendant-family',
        parentIds: ['vidal-line-child'],
        children: [{ personId: 'vidal-line-grandchild', birthOrder: 1 }],
      },
    )

    const result = classifyFamilyLine(data.people, data.families, 'Vidal-Probe')
    expect(result.lineageOriginIds).toEqual(new Set(['vidal-origin']))
    expect(result.memberIds.has('vidal-origin')).toBe(true)
    expect(result.partnerIds.has(sullanoParent.id)).toBe(true)
    expect(result.originChildIds).toEqual(new Set(['vidal-display-child']))
    expect(result.memberIds.has('vidal-display-child')).toBe(true)
    expect(result.continuingFamilyIds.has('vidal-origin-family')).toBe(true)
    expect(result.memberIds.has('vidal-grandchild')).toBe(false)
    expect(result.continuingFamilyIds.has('vidal-descendant-family')).toBe(false)
    expect(result.originChildIds.has('vidal-line-child')).toBe(false)
    expect(result.memberIds.has('vidal-line-child')).toBe(true)
    expect(result.memberIds.has('vidal-line-grandchild')).toBe(true)
    expect(result.continuingFamilyIds.has('vidal-line-descendant-family')).toBe(true)
  })

  it('applies the same one-generation rule to a standalone single-parent origin', () => {
    const data = published()
    const templateParent = data.people.find((person) => person.id === 'new-partner')!
    const templateChild = data.people.find((person) => person.id === 'grandchild-1-2')!
    data.people.push(
      {
        ...templateParent,
        id: 'ortiz-origin',
        displayName: 'Robin Ortiz',
        lineageSurname: 'Ortiz',
        gender: 'unknown',
        portraitNumber: 993,
        portrait: 'portraits/993.png',
      },
      {
        ...templateChild,
        id: 'ortiz-display-child',
        displayName: 'Casey Sullano',
        lineageSurname: 'Sullano',
        portraitNumber: 994,
        portrait: 'portraits/994.png',
      },
      {
        ...templateChild,
        id: 'ortiz-grandchild',
        displayName: 'Taylor Santos',
        lineageSurname: 'Santos',
        portraitNumber: 995,
        portrait: 'portraits/995.png',
      },
    )
    data.families.push(
      {
        id: 'ortiz-origin-family',
        parentIds: ['ortiz-origin'],
        children: [{ personId: 'ortiz-display-child', birthOrder: 1 }],
      },
      {
        id: 'ortiz-descendant-family',
        parentIds: ['ortiz-display-child'],
        children: [{ personId: 'ortiz-grandchild', birthOrder: 1 }],
      },
    )

    const result = classifyFamilyLine(data.people, data.families, 'Ortiz')
    expect(result.lineageOriginIds).toEqual(new Set(['ortiz-origin']))
    expect(result.originChildIds).toEqual(new Set(['ortiz-display-child']))
    expect(result.continuingFamilyIds.has('ortiz-origin-family')).toBe(true)
    expect(result.memberIds.has('ortiz-grandchild')).toBe(false)
    expect(result.continuingFamilyIds.has('ortiz-descendant-family')).toBe(false)
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
    const emptyFamily = ambiguous.families.find((family) => family.id === 'family-grandchild-5-1')!
    emptyFamily.parentIds.push('new-partner')
    const child = addChild(ambiguous, 'grandchild-5-1', 'New child', emptyFamily.id)
    expect(child.people.at(-1)?.lineageSurname).toBe('')
  })
})
