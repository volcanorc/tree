import type {
  ChildLink,
  DeleteResult,
  FamilyUnit,
  Gender,
  LifeStatus,
  Person,
  PersonDeletePlan,
  Pet,
  PetChildLink,
  PetFamilyUnit,
  TreeData,
  ValidationResult,
} from '../types'

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])
const CORE_PERSON_IDS = ['father', 'mother', 'child-1', 'child-2', 'child-3', 'child-4', 'child-5', 'child-6', 'child-7']
const LIFE_STATUSES = new Set<LifeStatus>(['alive', 'dead'])
const DEFAULT_SUBTITLE = 'A lasting record of the people and stories behind every generation.'
const OLD_DEFAULT_SUBTITLE = 'A living record of the people, stories, and connections that shaped us.'
const PORTRAIT_ORDER = [
  'father', 'mother',
  'child-7', 'child-6', 'child-5', 'child-4', 'child-3', 'child-2', 'child-1',
  'grandchild-5-2', 'grandchild-5-1',
  'grandchild-4-2', 'grandchild-4-1',
  'grandchild-3-2', 'grandchild-3-1',
  'grandchild-2-2', 'grandchild-2-1',
  'grandchild-1-4', 'grandchild-1-3', 'grandchild-1-2', 'grandchild-1-1',
]
const FIXED_PORTRAIT_NUMBERS = new Map(PORTRAIT_ORDER.map((id, index) => [id, index + 1]))

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') return '?'
  return String(value)
}

export function calculateAge(
  birthDate: string,
  ageOverride: number | null,
  today = new Date(),
): number | '?' {
  if (birthDate) {
    const birth = new Date(`${birthDate}T00:00:00`)
    if (!Number.isNaN(birth.getTime()) && birth <= today) {
      let age = today.getFullYear() - birth.getFullYear()
      const monthDelta = today.getMonth() - birth.getMonth()
      if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age -= 1
      return Math.max(0, age)
    }
  }
  return typeof ageOverride === 'number' && ageOverride >= 0 ? ageOverride : '?'
}

export function sortChildren<T extends { birthOrder: number }>(children: T[]): T[] {
  return [...children].sort((a, b) => b.birthOrder - a.birthOrder)
}

export function isSafeExternalUrl(value: string): boolean {
  if (!value.trim()) return true
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

export function isSafePortrait(value: string): boolean {
  if (!value.trim()) return false
  const trimmed = value.trim()

  if (/^https:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      return parsed.protocol === 'https:' && parsed.pathname.toLowerCase().endsWith('.png')
    } catch {
      return false
    }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//') || trimmed.includes('\\')) return false
  const path = trimmed.replace(/^\//, '')
  const segments = path.split('/')
  if (!path || segments.some((segment) => !segment || segment === '.' || segment === '..')) return false
  return path.toLowerCase().endsWith('.png')
}

export function resolvePortrait(value: string): string {
  const trimmed = value.trim()
  if (/^https:\/\//i.test(trimmed)) return trimmed
  return `${import.meta.env.BASE_URL}${trimmed.replace(/^\/+/, '')}`
}

export function personPortraitPath(portraitNumber: number): string {
  return `portraits/${portraitNumber}.png`
}

export function petPortraitPath(portraitNumber: number): string {
  return `portraits/pets/${portraitNumber}.png`
}

export function isAutomaticPortraitPath(value: string, kind: 'person' | 'pet', portraitNumber: number): boolean {
  const expected = kind === 'person' ? personPortraitPath(portraitNumber) : petPortraitPath(portraitNumber)
  return value.replace(/^\//, '') === expected
}

export function portraitCandidates(entity: Pick<Person | Pet, 'portrait' | 'portraitNumber'>): string[] {
  return entity.portrait.trim() ? [resolvePortrait(entity.portrait)] : []
}

export function bornValue(entity: Pick<Person | Pet, 'birthDate' | 'birthDetails'>): string {
  return displayValue(entity.birthDate || entity.birthDetails)
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  })
  return [...duplicates]
}

function validateDate(value: string, label: string, errors: string[]): void {
  if (!value) return
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) errors.push(`${label} has an invalid birth date.`)
  else if (date > new Date()) errors.push(`${label} has a birth date in the future.`)
}

function hasCycle(families: FamilyUnit[]): boolean {
  const edges = new Map<string, string[]>()
  families.forEach((family) => {
    family.parentIds.forEach((parentId) => {
      const list = edges.get(parentId) ?? []
      list.push(...family.children.map((child) => child.personId))
      edges.set(parentId, list)
    })
  })
  const active = new Set<string>()
  const done = new Set<string>()
  const visit = (id: string): boolean => {
    if (active.has(id)) return true
    if (done.has(id)) return false
    active.add(id)
    if ((edges.get(id) ?? []).some(visit)) return true
    active.delete(id)
    done.add(id)
    return false
  }
  return [...edges.keys()].some(visit)
}

function hasPetCycle(families: PetFamilyUnit[]): boolean {
  return hasCycle(families.map((family) => ({
    id: family.id,
    parentIds: family.parentPetIds,
    children: family.children.map((child) => ({ personId: child.petId, birthOrder: child.birthOrder })),
  })))
}

function validateOrders(children: Array<{ birthOrder: number }>, label: string, errors: string[]): void {
  if (children.some((child) => !Number.isInteger(child.birthOrder) || child.birthOrder < 1)) {
    errors.push(`${label} contains an invalid birth order.`)
  }
  if (duplicateValues(children.map((child) => String(child.birthOrder))).length) {
    errors.push(`${label} contains duplicate birth orders.`)
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function lifeStatus(value: unknown): LifeStatus {
  return value === 'dead' ? 'dead' : 'alive'
}

function iringBrown(): Pet {
  return {
    id: 'iring-brown',
    displayName: 'Iring Brown',
    species: 'Cat',
    breed: '',
    gender: 'female',
    birthDate: '',
    birthDetails: 'Trash can',
    ageOverride: 11,
    personality: 'Slow',
    biography: '',
    relationshipLabel: 'Pet founder',
    portrait: petPortraitPath(1),
    portraitNumber: 1,
    links: [],
    status: 'dead',
    ownerPersonId: '',
    protected: true,
    createdAt: '2026-07-17T00:00:00.000Z',
  }
}

export function migrateTreeData(input: unknown): TreeData {
  if (!input || typeof input !== 'object') throw new Error('The archive data is not an object.')
  type LegacyRecord = { link?: unknown; links?: unknown }
  type LegacyTreeData = {
    version?: unknown
    site?: Partial<TreeData['site']>
    people?: Array<Partial<Person> & LegacyRecord>
    families?: Array<Partial<FamilyUnit>>
    pets?: Array<Partial<Pet> & LegacyRecord>
    petFamilies?: Array<Partial<PetFamilyUnit>>
  }
  const raw = input as LegacyTreeData
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3) throw new Error('Unsupported or missing data version.')
  const rawPeople = Array.isArray(raw.people) ? raw.people : []
  const hasVersionTwoFields = raw.version === 2 || raw.version === 3
  const occupied = new Set<number>()
  if (hasVersionTwoFields) {
    rawPeople.forEach((person) => {
      if (Number.isInteger(person.portraitNumber) && Number(person.portraitNumber) > 0) occupied.add(Number(person.portraitNumber))
    })
  }
  let nextPortrait = 22
  const takeNextPortrait = () => {
    while (occupied.has(nextPortrait)) nextPortrait += 1
    const number = nextPortrait
    occupied.add(number)
    nextPortrait += 1
    return number
  }
  const people: Person[] = rawPeople.map((person) => {
    const fixed = FIXED_PORTRAIT_NUMBERS.get(stringValue(person.id))
    let portraitNumber = Number(person.portraitNumber)
    if (!hasVersionTwoFields) {
      portraitNumber = fixed ?? takeNextPortrait()
      occupied.add(portraitNumber)
    }
    const portrait = stringValue(person.portrait) || personPortraitPath(portraitNumber)
    const links = Array.isArray(person.links)
      ? person.links.map(stringValue)
      : stringValue(person.link) ? [stringValue(person.link)] : []
    return {
      id: stringValue(person.id),
      displayName: stringValue(person.displayName),
      nickname: stringValue(person.nickname),
      gender: (person.gender ?? 'unknown') as Gender,
      birthDate: stringValue(person.birthDate),
      birthDetails: stringValue(person.birthDetails),
      ageOverride: numberOrNull(person.ageOverride),
      personality: stringValue(person.personality),
      biography: stringValue(person.biography),
      relationshipLabel: stringValue(person.relationshipLabel),
      portrait,
      portraitNumber,
      links,
      status: hasVersionTwoFields ? person.status as LifeStatus : lifeStatus(person.status),
      protected: Boolean(person.protected),
      createdAt: stringValue(person.createdAt),
    }
  })
  const rawPets = Array.isArray(raw.pets) ? raw.pets : []
  const occupiedPetPortraits = new Set<number>()
  if (raw.version === 3) {
    rawPets.forEach((pet) => {
      if (Number.isInteger(pet.portraitNumber) && Number(pet.portraitNumber) > 0) occupiedPetPortraits.add(Number(pet.portraitNumber))
    })
  } else {
    occupiedPetPortraits.add(1)
  }
  let nextPetPortrait = 1
  const takeNextPetPortrait = () => {
    while (occupiedPetPortraits.has(nextPetPortrait)) nextPetPortrait += 1
    const number = nextPetPortrait
    occupiedPetPortraits.add(number)
    nextPetPortrait += 1
    return number
  }
  const pets: Pet[] = rawPets.map((pet) => {
    const portraitNumber = raw.version === 3
      ? Number(pet.portraitNumber)
      : stringValue(pet.id) === 'iring-brown' ? 1 : takeNextPetPortrait()
    const links = Array.isArray(pet.links)
      ? pet.links.map(stringValue)
      : stringValue(pet.link) ? [stringValue(pet.link)] : []
    return {
      id: stringValue(pet.id),
      displayName: stringValue(pet.displayName),
      species: stringValue(pet.species),
      breed: stringValue(pet.breed),
      gender: (pet.gender ?? 'unknown') as Gender,
      birthDate: stringValue(pet.birthDate),
      birthDetails: stringValue(pet.birthDetails),
      ageOverride: numberOrNull(pet.ageOverride),
      personality: stringValue(pet.personality),
      biography: stringValue(pet.biography),
      relationshipLabel: stringValue(pet.relationshipLabel),
      portrait: stringValue(pet.portrait) || petPortraitPath(portraitNumber),
      portraitNumber,
      links,
      status: hasVersionTwoFields ? pet.status as LifeStatus : lifeStatus(pet.status),
      ownerPersonId: stringValue(pet.ownerPersonId),
      protected: Boolean(pet.protected),
      createdAt: stringValue(pet.createdAt),
    }
  })
  const existingIring = pets.find((pet) => pet.id === 'iring-brown')
  if (existingIring && raw.version !== 3) existingIring.protected = true
  else if (!existingIring) pets.unshift(iringBrown())
  const site = raw.site ?? ({} as TreeData['site'])
  const subtitle = stringValue(site.subtitle)
  return {
    version: 3,
    site: {
      title: stringValue(site.title),
      subtitle: !subtitle || subtitle === OLD_DEFAULT_SUBTITLE ? DEFAULT_SUBTITLE : subtitle,
      theme: 'celestial-lineage',
      adminUser: stringValue(site.adminUser),
      adminPinHash: stringValue(site.adminPinHash),
    },
    people,
    families: Array.isArray(raw.families)
      ? raw.families.map((family) => ({
          id: stringValue(family.id),
          parentIds: Array.isArray(family.parentIds) ? [...family.parentIds] : [],
          children: Array.isArray(family.children) ? family.children.map((child) => ({ ...child })) : [],
        }))
      : [],
    pets,
    petFamilies: Array.isArray(raw.petFamilies)
      ? raw.petFamilies.map((family) => ({
          id: stringValue(family.id),
          parentPetIds: Array.isArray(family.parentPetIds) ? [...family.parentPetIds] : [],
          children: Array.isArray(family.children) ? family.children.map((child) => ({ ...child })) : [],
        }))
      : [],
  }
}

export function validateTreeData(data: TreeData): ValidationResult {
  const errors: string[] = []
  if (!data || data.version !== 3) errors.push('Unsupported or missing data version.')
  if (!data.site?.title?.trim()) errors.push('The site title is required.')

  const personIds = data.people.map((person) => person.id)
  const petIds = data.pets.map((pet) => pet.id)
  duplicateValues(personIds).forEach((id) => errors.push(`Duplicate person ID: ${id}.`))
  duplicateValues(petIds).forEach((id) => errors.push(`Duplicate pet ID: ${id}.`))
  duplicateValues(data.people.map((person) => String(person.portraitNumber))).forEach((number) =>
    errors.push(`Duplicate portrait number: ${number}.`),
  )
  duplicateValues(data.pets.map((pet) => String(pet.portraitNumber))).forEach((number) =>
    errors.push(`Duplicate pet portrait number: ${number}.`),
  )
  duplicateValues(data.families.map((family) => family.id)).forEach((id) => errors.push(`Duplicate family ID: ${id}.`))
  duplicateValues(data.petFamilies.map((family) => family.id)).forEach((id) => errors.push(`Duplicate pet-family ID: ${id}.`))
  duplicateValues(data.families.flatMap((family) => family.children.map((child) => child.personId))).forEach((id) =>
    errors.push(`Person ${id} belongs to more than one parental family unit.`),
  )

  const people = new Set(personIds)
  const pets = new Set(petIds)
  CORE_PERSON_IDS.forEach((id) => {
    const person = data.people.find((candidate) => candidate.id === id)
    if (!person) errors.push(`Protected core person ${id} is missing.`)
    else if (!person.protected) errors.push(`Protected core person ${id} cannot be unprotected.`)
  })
  const founderPet = data.pets.find((pet) => pet.id === 'iring-brown')
  if (!founderPet) errors.push('Protected pet founder iring-brown is missing.')
  else if (!founderPet.protected) errors.push('Protected pet founder iring-brown cannot be unprotected.')
  else if (founderPet.portraitNumber !== 1) errors.push('Iring Brown must retain pet portrait number 1.')
  data.people.forEach((person) => {
    if (!person.id.trim()) errors.push('Every person requires an ID.')
    if (!Number.isInteger(person.portraitNumber) || person.portraitNumber < 1) errors.push(`${person.displayName || person.id} has an invalid portrait number.`)
    if (!LIFE_STATUSES.has(person.status)) errors.push(`${person.displayName || person.id} has an invalid status.`)
    validateDate(person.birthDate, person.displayName || person.id, errors)
    if (!Array.isArray(person.links)) errors.push(`${person.displayName || person.id} has an invalid links list.`)
    else person.links.forEach((link, index) => {
      if (!isSafeExternalUrl(link)) errors.push(`${person.displayName || person.id} has an unsafe link at position ${index + 1}.`)
    })
    if (!isSafePortrait(person.portrait)) errors.push(`${person.displayName || person.id} has an unsafe portrait path.`)
  })
  data.families.forEach((family) => {
    if (family.parentIds.length < 1 || family.parentIds.length > 2) errors.push(`${family.id} must contain one or two parents.`)
    if (duplicateValues(family.parentIds).length) errors.push(`${family.id} contains the same parent more than once.`)
    family.parentIds.forEach((id) => {
      if (!people.has(id)) errors.push(`${family.id} references missing parent ${id}.`)
    })
    family.children.forEach((child) => {
      if (!people.has(child.personId)) errors.push(`${family.id} references missing child ${child.personId}.`)
    })
    validateOrders(family.children, family.id, errors)
  })
  if (hasCycle(data.families)) errors.push('The human family graph contains an ancestry cycle.')

  data.pets.forEach((pet) => {
    if (!Number.isInteger(pet.portraitNumber) || pet.portraitNumber < 1) errors.push(`${pet.displayName || pet.id} has an invalid pet portrait number.`)
    if (!LIFE_STATUSES.has(pet.status)) errors.push(`${pet.displayName || pet.id} has an invalid status.`)
    validateDate(pet.birthDate, pet.displayName || pet.id, errors)
    if (pet.ownerPersonId && !people.has(pet.ownerPersonId)) errors.push(`${pet.displayName || pet.id} references a missing owner.`)
    if (!Array.isArray(pet.links)) errors.push(`${pet.displayName || pet.id} has an invalid links list.`)
    else pet.links.forEach((link, index) => {
      if (!isSafeExternalUrl(link)) errors.push(`${pet.displayName || pet.id} has an unsafe link at position ${index + 1}.`)
    })
    if (!isSafePortrait(pet.portrait)) errors.push(`${pet.displayName || pet.id} has an unsafe portrait path.`)
  })
  data.petFamilies.forEach((family) => {
    if (family.parentPetIds.length < 1 || family.parentPetIds.length > 2) errors.push(`${family.id} must contain one or two pet parents.`)
    family.parentPetIds.forEach((id) => {
      if (!pets.has(id)) errors.push(`${family.id} references missing pet parent ${id}.`)
    })
    family.children.forEach((child) => {
      if (!pets.has(child.petId)) errors.push(`${family.id} references missing pet child ${child.petId}.`)
    })
    validateOrders(family.children, family.id, errors)
  })
  if (hasPetCycle(data.petFamilies)) errors.push('The pet lineage contains an ancestry cycle.')
  return { valid: errors.length === 0, errors }
}

export async function loadPublishedData(): Promise<TreeData> {
  const response = await fetch(`${import.meta.env.BASE_URL}tree-data.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Could not load family data (${response.status}).`)
  const data = migrateTreeData(await response.json())
  const validation = validateTreeData(data)
  if (!validation.valid) throw new Error(validation.errors.join(' '))
  return data
}

export function exportTreeData(data: TreeData): string {
  const validation = validateTreeData(data)
  if (!validation.valid) throw new Error(validation.errors.join('\n'))
  return `${JSON.stringify(data, null, 2)}\n`
}

export function makeId(prefix: string, existing: string[]): string {
  const base = prefix.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
  let id = base
  let suffix = 2
  while (existing.includes(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

export function nextPortraitNumber(data: TreeData): number {
  const used = new Set(data.people.map((person) => person.portraitNumber))
  let candidate = 1
  while (used.has(candidate)) candidate += 1
  return candidate
}

export function nextPetPortraitNumber(data: TreeData): number {
  const used = new Set(data.pets.map((pet) => pet.portraitNumber))
  let candidate = 1
  while (used.has(candidate)) candidate += 1
  return candidate
}

export function createBlankPerson(id: string, label: string, portraitNumber = 1): Person {
  return {
    id,
    displayName: label,
    nickname: '',
    gender: 'unknown',
    birthDate: '',
    birthDetails: '',
    ageOverride: null,
    personality: '',
    biography: '',
    relationshipLabel: 'Family member',
    portrait: personPortraitPath(portraitNumber),
    portraitNumber,
    links: [],
    status: 'alive',
    protected: false,
    createdAt: new Date().toISOString(),
  }
}

export function createBlankPet(id: string, label: string, portraitNumber = 1): Pet {
  return {
    id,
    displayName: label,
    species: '',
    breed: '',
    gender: 'unknown',
    birthDate: '',
    birthDetails: '',
    ageOverride: null,
    personality: '',
    biography: '',
    relationshipLabel: 'Pet',
    portrait: petPortraitPath(portraitNumber),
    portraitNumber,
    links: [],
    status: 'alive',
    ownerPersonId: '',
    protected: false,
    createdAt: new Date().toISOString(),
  }
}

export function addChild(data: TreeData, parentId: string, label = 'New child', familyId?: string | 'single'): TreeData {
  const id = makeId(label, data.people.map((person) => person.id))
  const person = createBlankPerson(id, label, nextPortraitNumber(data))
  const families = data.families.map((family) => ({ ...family, children: [...family.children] }))
  let familyIndex = familyId && familyId !== 'single'
    ? families.findIndex((family) => family.id === familyId && family.parentIds.includes(parentId))
    : -1
  if (familyId === 'single') familyIndex = families.findIndex((family) => family.parentIds.length === 1 && family.parentIds[0] === parentId)
  if (!familyId) {
    const applicable = families.map((family, index) => ({ family, index })).filter(({ family }) => family.parentIds.includes(parentId))
    if (applicable.length === 1) familyIndex = applicable[0].index
  }
  if (familyIndex >= 0) {
    const nextOrder = Math.max(0, ...families[familyIndex].children.map((child) => child.birthOrder)) + 1
    families[familyIndex].children.push({ personId: id, birthOrder: nextOrder })
  } else {
    families.push({
      id: makeId(`family-${parentId}`, families.map((family) => family.id)),
      parentIds: [parentId],
      children: [{ personId: id, birthOrder: 1 }],
    })
  }
  return { ...data, people: [...data.people, person], families }
}

export function addPartner(data: TreeData, personId: string, label = 'New partner', attachFamilyId?: string): TreeData {
  const id = makeId(label, data.people.map((person) => person.id))
  const partner = createBlankPerson(id, label, nextPortraitNumber(data))
  let attached = false
  const families = data.families.map((family) => {
    if (family.id !== attachFamilyId || family.parentIds.length !== 1 || !family.parentIds.includes(personId)) return family
    attached = true
    return { ...family, parentIds: [...family.parentIds, id] }
  })
  if (!attached) {
    families.push({
      id: makeId(`family-${personId}`, families.map((family) => family.id)),
      parentIds: [personId, id],
      children: [],
    })
  }
  return { ...data, people: [...data.people, partner], families }
}

export function addPetOffspring(data: TreeData, parentPetId: string, label = 'New pet'): TreeData {
  const id = makeId(label, data.pets.map((pet) => pet.id))
  const pet = createBlankPet(id, label, nextPetPortraitNumber(data))
  const familyIndex = data.petFamilies.findIndex((family) => family.parentPetIds.includes(parentPetId))
  const petFamilies = data.petFamilies.map((family) => ({ ...family, children: [...family.children] }))
  if (familyIndex >= 0) {
    const nextOrder = Math.max(0, ...petFamilies[familyIndex].children.map((child) => child.birthOrder)) + 1
    petFamilies[familyIndex].children.push({ petId: id, birthOrder: nextOrder })
  } else {
    petFamilies.push({ id: makeId(`pet-family-${parentPetId}`, petFamilies.map((family) => family.id)), parentPetIds: [parentPetId], children: [{ petId: id, birthOrder: 1 }] })
  }
  return { ...data, pets: [...data.pets, pet], petFamilies }
}

export function addPetPartner(data: TreeData, petId: string, label = 'New pet partner'): TreeData {
  const current = data.petFamilies.find((family) => family.parentPetIds.includes(petId))
  if (current?.parentPetIds.length === 2) return data
  const id = makeId(label, data.pets.map((pet) => pet.id))
  const partner = createBlankPet(id, label, nextPetPortraitNumber(data))
  const petFamilies = current
    ? data.petFamilies.map((family) => family.id === current.id ? { ...family, parentPetIds: [...family.parentPetIds, id] } : family)
    : [...data.petFamilies, { id: makeId(`pet-family-${petId}`, data.petFamilies.map((family) => family.id)), parentPetIds: [petId, id], children: [] }]
  return { ...data, pets: [...data.pets, partner], petFamilies }
}

export function planPersonDeletion(data: TreeData, requestedIds: string[]): PersonDeletePlan {
  const requested = [...new Set(requestedIds)].filter((id) => data.people.some((person) => person.id === id))
  const protectedPerson = requested.map((id) => data.people.find((person) => person.id === id)).find((person) => person?.protected)
  if (protectedPerson) return { requestedIds: requested, deleteIds: [], cascadeIds: [], blockedReason: `${protectedPerson.displayName} is protected and cannot be deleted.` }
  const deleteSet = new Set(requested)
  const cascade = new Set<string>()
  const collectBranch = (personId: string) => {
    if (deleteSet.has(personId)) return
    deleteSet.add(personId)
    cascade.add(personId)
    data.families.filter((family) => family.parentIds.includes(personId)).forEach((family) => {
      family.children.forEach((child) => collectBranch(child.personId))
    })
  }
  data.families.forEach((family) => {
    if (family.parentIds.length > 0 && family.parentIds.every((id) => deleteSet.has(id))) {
      family.children.forEach((child) => collectBranch(child.personId))
    }
  })
  const protectedCascade = [...deleteSet].map((id) => data.people.find((person) => person.id === id)).find((person) => person?.protected)
  if (protectedCascade) {
    return {
      requestedIds: requested,
      deleteIds: [],
      cascadeIds: [...cascade],
      blockedReason: `The deletion would reach protected record ${protectedCascade.displayName}.`,
    }
  }
  return { requestedIds: requested, deleteIds: [...deleteSet], cascadeIds: [...cascade] }
}

export function applyPersonDeletePlan(data: TreeData, plan: PersonDeletePlan): TreeData {
  if (plan.blockedReason || plan.deleteIds.length === 0) return data
  const deleteSet = new Set(plan.deleteIds)
  const families = data.families.flatMap((family) => {
    const removedParent = family.parentIds.some((id) => deleteSet.has(id))
    const parentIds = family.parentIds.filter((id) => !deleteSet.has(id))
    const children = family.children.filter((child) => !deleteSet.has(child.personId))
    if (parentIds.length === 0) return []
    if (removedParent && children.length === 0) return []
    return [{ ...family, parentIds, children }]
  })
  return { ...data, people: data.people.filter((person) => !deleteSet.has(person.id)), families }
}

export function deletePerson(data: TreeData, personId: string): DeleteResult {
  const person = data.people.find((candidate) => candidate.id === personId)
  if (!person) return { data, deleted: false, reason: 'Person not found.' }
  const plan = planPersonDeletion(data, [personId])
  if (plan.blockedReason) return { data, deleted: false, reason: plan.blockedReason }
  return { data: applyPersonDeletePlan(data, plan), deleted: plan.deleteIds.length > 0 }
}

export function deletePet(data: TreeData, petId: string): DeleteResult {
  const pet = data.pets.find((candidate) => candidate.id === petId)
  if (!pet) return { data, deleted: false, reason: 'Pet not found.' }
  if (pet.protected) return { data, deleted: false, reason: 'This pet founder cannot be deleted.' }
  const parentFamily = data.petFamilies.find((family) => family.parentPetIds.includes(petId))
  if (parentFamily?.children.length && parentFamily.parentPetIds.length === 1) return { data, deleted: false, reason: 'Reassign or remove offspring before deleting their only parent.' }
  const petFamilies = data.petFamilies
    .map((family) => ({ ...family, parentPetIds: family.parentPetIds.filter((id) => id !== petId), children: family.children.filter((child) => child.petId !== petId) }))
    .filter((family) => family.parentPetIds.length > 0)
  return { data: { ...data, pets: data.pets.filter((candidate) => candidate.id !== petId), petFamilies }, deleted: true }
}

export function updateBirthOrder(data: TreeData, personId: string, birthOrder: number): TreeData {
  return { ...data, families: data.families.map((family) => family.children.some((child) => child.personId === personId) ? { ...family, children: family.children.map((child) => child.personId === personId ? { ...child, birthOrder } : child) } : family) }
}

export function updatePetBirthOrder(data: TreeData, petId: string, birthOrder: number): TreeData {
  return { ...data, petFamilies: data.petFamilies.map((family) => family.children.some((child) => child.petId === petId) ? { ...family, children: family.children.map((child) => child.petId === petId ? { ...child, birthOrder } : child) } : family) }
}

export function getBirthOrder(data: TreeData, personId: string): number | null {
  for (const family of data.families) {
    const child = family.children.find((item) => item.personId === personId)
    if (child) return child.birthOrder
  }
  return null
}

export function getPetBirthOrder(data: TreeData, petId: string): number | null {
  for (const family of data.petFamilies) {
    const child = family.children.find((item) => item.petId === petId)
    if (child) return child.birthOrder
  }
  return null
}

export function countDescendants(data: TreeData): number {
  const root = data.families.find((family) => family.id === 'root-family')
  if (!root) return 0
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    data.families.filter((family) => family.parentIds.includes(id)).forEach((family) => family.children.forEach((child) => visit(child.personId)))
  }
  root.children.forEach((child) => visit(child.personId))
  return seen.size
}

export const genders: Gender[] = ['male', 'female', 'nonbinary', 'prefer-not-to-say', 'unknown']
export type AnyChildLink = ChildLink | PetChildLink
