import type { FamilyUnit, Person } from '../types'

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])
const GENERATED_NAME = /^(?:new\s+(?:child|partner|sibling)|unknown|unnamed)$/i

export function normalizeLineageSurname(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function inferLineageSurname(displayName: string): string {
  const clean = displayName.trim().replace(/\s+/g, ' ')
  if (!clean || clean === '?' || GENERATED_NAME.test(clean)) return ''
  const parts = clean.split(' ')
  while (parts.length > 0) {
    const suffix = parts[parts.length - 1].replace(/[.,]+$/g, '').toLocaleLowerCase()
    if (!NAME_SUFFIXES.has(suffix)) break
    parts.pop()
  }
  if (parts.length < 2) return ''
  const surname = parts[parts.length - 1].replace(/^[,]+|[,]+$/g, '')
  return surname === '?' ? '' : surname
}

export function lineageSurnameAfterNameChange(person: Pick<Person, 'displayName' | 'lineageSurname'>, displayName: string): string {
  const current = person.lineageSurname.trim()
  const previousSuggestion = inferLineageSurname(person.displayName)
  if (!current || normalizeLineageSurname(current) === normalizeLineageSurname(previousSuggestion)) {
    return inferLineageSurname(displayName)
  }
  return person.lineageSurname
}

export interface FamilyLineOption {
  key: string
  label: string
}

export function familyLineOptions(people: Person[]): FamilyLineOption[] {
  const options = new Map<string, string>()
  people.forEach((person) => {
    const label = person.lineageSurname.trim().replace(/\s+/g, ' ')
    const key = normalizeLineageSurname(label)
    if (key && key !== '?' && !options.has(key)) options.set(key, label)
  })
  return [...options.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
}

function uniqueKnownSurname(people: Person[]): string {
  const values = new Map<string, string>()
  people.forEach((person) => {
    const value = person.lineageSurname.trim()
    const key = normalizeLineageSurname(value)
    if (key && !values.has(key)) values.set(key, value)
  })
  return values.size === 1 ? [...values.values()][0] : ''
}

export function resolveChildLineageSurname(
  people: Person[],
  family: Pick<FamilyUnit, 'parentIds' | 'children'>,
): string {
  const byId = new Map(people.map((person) => [person.id, person]))
  const existingPattern = uniqueKnownSurname(
    family.children.map((child) => byId.get(child.personId)).filter((person): person is Person => Boolean(person)),
  )
  if (existingPattern) return existingPattern

  const parents = family.parentIds.map((id) => byId.get(id)).filter((person): person is Person => Boolean(person))
  const maleParents = parents.filter((person) => person.gender === 'male' && person.lineageSurname.trim())
  if (maleParents.length === 1) return maleParents[0].lineageSurname
  if (parents.length === 1) return parents[0].lineageSurname
  return ''
}

export interface FamilyLineClassification {
  memberIds: Set<string>
  partnerIds: Set<string>
  carrierByFamilyId: Map<string, string>
  continuingChildIds: Set<string>
  continuingFamilyIds: Set<string>
  lineageOriginIds: Set<string>
  originChildIds: Set<string>
}

export function classifyFamilyLine(
  people: Person[],
  families: FamilyUnit[],
  selectedSurname: string,
): FamilyLineClassification {
  const selectedKey = normalizeLineageSurname(selectedSurname)
  const byId = new Map(people.map((person) => [person.id, person]))
  const matchingIds = new Set(
    people.filter((person) => normalizeLineageSurname(person.lineageSurname) === selectedKey && selectedKey).map((person) => person.id),
  )
  const reachedAsChild = new Set<string>()
  families.forEach((family) => family.children.forEach((child) => {
    if (matchingIds.has(child.personId) && family.parentIds.some((parentId) => matchingIds.has(parentId))) reachedAsChild.add(child.personId)
  }))

  const carrierByFamilyId = new Map<string, string>()
  families.forEach((family) => {
    const matchingParents = family.parentIds.filter((id) => matchingIds.has(id))
    if (matchingParents.length === 0) return
    let carrier = matchingParents[0]
    if (matchingParents.length > 1) {
      const reached = matchingParents.filter((id) => reachedAsChild.has(id))
      const male = matchingParents.filter((id) => byId.get(id)?.gender === 'male')
      carrier = reached.length === 1 ? reached[0] : male.length === 1 ? male[0] : matchingParents[0]
    }
    carrierByFamilyId.set(family.id, carrier)
  })

  const continuingChildIds = new Set<string>()
  const continuingFamilyIds = new Set<string>()
  const lineageOriginIds = new Set<string>()
  const originChildIds = new Set<string>()
  const partnerCandidates = new Set<string>()
  carrierByFamilyId.forEach((carrierId, familyId) => {
    const family = families.find((candidate) => candidate.id === familyId)
    if (!family) return
    family.parentIds.forEach((id) => { if (id !== carrierId) partnerCandidates.add(id) })
    family.children.forEach((child) => {
      if (matchingIds.has(child.personId)) {
        continuingChildIds.add(child.personId)
        continuingFamilyIds.add(family.id)
      }
    })
    const matchingParents = family.parentIds.filter((id) => matchingIds.has(id))
    const isLineageOrigin = matchingParents.length === 1
      && !reachedAsChild.has(carrierId)
    if (isLineageOrigin) {
      lineageOriginIds.add(carrierId)
      family.children.forEach((child) => {
        if (matchingIds.has(child.personId)) return
        originChildIds.add(child.personId)
        continuingChildIds.add(child.personId)
        continuingFamilyIds.add(family.id)
      })
    }
  })

  const establishedCarrierIds = new Set([...carrierByFamilyId.values(), ...reachedAsChild])
  const partnerIds = new Set([...partnerCandidates].filter((id) => !establishedCarrierIds.has(id)))
  const memberIds = new Set([
    ...[...matchingIds].filter((id) => !partnerIds.has(id)),
    ...originChildIds,
  ])
  return {
    memberIds,
    partnerIds,
    carrierByFamilyId,
    continuingChildIds,
    continuingFamilyIds,
    lineageOriginIds,
    originChildIds,
  }
}
