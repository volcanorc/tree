import type {
  ChildLink,
  DeleteResult,
  FamilyUnit,
  Gender,
  Person,
  Pet,
  PetChildLink,
  PetFamilyUnit,
  TreeData,
  ValidationResult,
} from '../types'

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])
const CORE_PERSON_IDS = ['father', 'mother', 'child-1', 'child-2', 'child-3', 'child-4', 'child-5', 'child-6', 'child-7']

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
  if (!value.trim()) return true
  if (!value.includes('://')) return !value.trim().startsWith('javascript:')
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function resolvePortrait(value: string): string {
  if (!value) return ''
  if (value.startsWith('https://')) return value
  return `${import.meta.env.BASE_URL}${value.replace(/^\//, '')}`
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
  const personFamilies: FamilyUnit[] = families.map((family) => ({
    id: family.id,
    parentIds: family.parentPetIds,
    children: family.children.map((child) => ({ personId: child.petId, birthOrder: child.birthOrder })),
  }))
  return hasCycle(personFamilies)
}

function validateOrders(children: Array<{ birthOrder: number }>, label: string, errors: string[]): void {
  if (children.some((child) => !Number.isInteger(child.birthOrder) || child.birthOrder < 1)) {
    errors.push(`${label} contains an invalid birth order.`)
  }
  if (duplicateValues(children.map((child) => String(child.birthOrder))).length) {
    errors.push(`${label} contains duplicate birth orders.`)
  }
}

export function validateTreeData(data: TreeData): ValidationResult {
  const errors: string[] = []
  if (!data || data.version !== 1) errors.push('Unsupported or missing data version.')
  if (!data.site?.title?.trim()) errors.push('The site title is required.')

  const personIds = data.people.map((person) => person.id)
  const petIds = data.pets.map((pet) => pet.id)
  duplicateValues(personIds).forEach((id) => errors.push(`Duplicate person ID: ${id}.`))
  duplicateValues(petIds).forEach((id) => errors.push(`Duplicate pet ID: ${id}.`))
  duplicateValues(data.families.map((family) => family.id)).forEach((id) =>
    errors.push(`Duplicate family ID: ${id}.`),
  )
  duplicateValues(data.petFamilies.map((family) => family.id)).forEach((id) =>
    errors.push(`Duplicate pet-family ID: ${id}.`),
  )

  const people = new Set(personIds)
  const pets = new Set(petIds)
  CORE_PERSON_IDS.forEach((id) => {
    const person = data.people.find((candidate) => candidate.id === id)
    if (!person) errors.push(`Protected core person ${id} is missing.`)
    else if (!person.protected) errors.push(`Protected core person ${id} cannot be unprotected.`)
  })
  data.people.forEach((person) => {
    if (!person.id.trim()) errors.push('Every person requires an ID.')
    validateDate(person.birthDate, person.displayName || person.id, errors)
    if (!isSafeExternalUrl(person.link)) errors.push(`${person.displayName || person.id} has an unsafe link.`)
    if (!isSafePortrait(person.portrait)) errors.push(`${person.displayName || person.id} has an unsafe portrait path.`)
  })
  data.families.forEach((family) => {
    if (family.parentIds.length < 1 || family.parentIds.length > 2) {
      errors.push(`${family.id} must contain one or two parents.`)
    }
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
    validateDate(pet.birthDate, pet.displayName || pet.id, errors)
    if (pet.ownerPersonId && !people.has(pet.ownerPersonId)) {
      errors.push(`${pet.displayName || pet.id} references a missing owner.`)
    }
    if (!isSafeExternalUrl(pet.link)) errors.push(`${pet.displayName || pet.id} has an unsafe link.`)
    if (!isSafePortrait(pet.portrait)) errors.push(`${pet.displayName || pet.id} has an unsafe portrait path.`)
  })
  data.petFamilies.forEach((family) => {
    if (family.parentPetIds.length < 1 || family.parentPetIds.length > 2) {
      errors.push(`${family.id} must contain one or two pet parents.`)
    }
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
  const data = (await response.json()) as TreeData
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
  const base = prefix
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item'
  let id = base
  let suffix = 2
  while (existing.includes(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

export function createBlankPerson(id: string, label: string): Person {
  return {
    id,
    displayName: label,
    nickname: '',
    gender: 'unknown',
    birthDate: '',
    ageOverride: null,
    personality: '',
    biography: '',
    relationshipLabel: 'Family member',
    portrait: '',
    link: '',
    protected: false,
    createdAt: new Date().toISOString(),
  }
}

export function createBlankPet(id: string, label: string): Pet {
  return {
    id,
    displayName: label,
    species: '',
    breed: '',
    gender: 'unknown',
    birthDate: '',
    ageOverride: null,
    personality: '',
    biography: '',
    relationshipLabel: 'Pet',
    portrait: '',
    link: '',
    ownerPersonId: '',
    protected: false,
    createdAt: new Date().toISOString(),
  }
}

export function addChild(data: TreeData, parentId: string, label = 'New child'): TreeData {
  const id = makeId(label, data.people.map((person) => person.id))
  const person = createBlankPerson(id, label)
  const familyIndex = data.families.findIndex((family) => family.parentIds.includes(parentId))
  const families = data.families.map((family) => ({ ...family, children: [...family.children] }))
  if (familyIndex >= 0) {
    const nextOrder = Math.max(0, ...families[familyIndex].children.map((child) => child.birthOrder)) + 1
    families[familyIndex].children.push({ personId: id, birthOrder: nextOrder })
  } else {
    families.push({ id: makeId(`family-${parentId}`, families.map((family) => family.id)), parentIds: [parentId], children: [{ personId: id, birthOrder: 1 }] })
  }
  return { ...data, people: [...data.people, person], families }
}

export function addPartner(data: TreeData, personId: string, label = 'New partner'): TreeData {
  const current = data.families.find((family) => family.parentIds.includes(personId))
  if (current?.parentIds.length === 2) return data
  const id = makeId(label, data.people.map((person) => person.id))
  const partner = createBlankPerson(id, label)
  const families = current
    ? data.families.map((family) => family.id === current.id ? { ...family, parentIds: [...family.parentIds, id] } : family)
    : [...data.families, { id: makeId(`family-${personId}`, data.families.map((family) => family.id)), parentIds: [personId, id], children: [] }]
  return { ...data, people: [...data.people, partner], families }
}

export function addPetOffspring(data: TreeData, parentPetId: string, label = 'New pet'): TreeData {
  const id = makeId(label, data.pets.map((pet) => pet.id))
  const pet = createBlankPet(id, label)
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
  const partner = createBlankPet(id, label)
  const petFamilies = current
    ? data.petFamilies.map((family) => family.id === current.id
      ? { ...family, parentPetIds: [...family.parentPetIds, id] }
      : family)
    : [...data.petFamilies, {
      id: makeId(`pet-family-${petId}`, data.petFamilies.map((family) => family.id)),
      parentPetIds: [petId, id],
      children: [],
    }]
  return { ...data, pets: [...data.pets, partner], petFamilies }
}

export function deletePerson(data: TreeData, personId: string): DeleteResult {
  const person = data.people.find((candidate) => candidate.id === personId)
  if (!person) return { data, deleted: false, reason: 'Person not found.' }
  if (person.protected) return { data, deleted: false, reason: 'This core family member cannot be deleted.' }
  const parentFamily = data.families.find((family) => family.parentIds.includes(personId))
  if (parentFamily?.children.length && parentFamily.parentIds.length === 1) {
    return { data, deleted: false, reason: 'Reassign or remove descendants before deleting their only parent.' }
  }
  const families = data.families
    .map((family) => ({
      ...family,
      parentIds: family.parentIds.filter((id) => id !== personId),
      children: family.children.filter((child) => child.personId !== personId),
    }))
    .filter((family) => family.parentIds.length > 0)
  return { data: { ...data, people: data.people.filter((candidate) => candidate.id !== personId), families }, deleted: true }
}

export function deletePet(data: TreeData, petId: string): DeleteResult {
  const pet = data.pets.find((candidate) => candidate.id === petId)
  if (!pet) return { data, deleted: false, reason: 'Pet not found.' }
  const parentFamily = data.petFamilies.find((family) => family.parentPetIds.includes(petId))
  if (parentFamily?.children.length && parentFamily.parentPetIds.length === 1) {
    return { data, deleted: false, reason: 'Reassign or remove offspring before deleting their only parent.' }
  }
  const petFamilies = data.petFamilies
    .map((family) => ({
      ...family,
      parentPetIds: family.parentPetIds.filter((id) => id !== petId),
      children: family.children.filter((child) => child.petId !== petId),
    }))
    .filter((family) => family.parentPetIds.length > 0)
  return { data: { ...data, pets: data.pets.filter((candidate) => candidate.id !== petId), petFamilies }, deleted: true }
}

export function updateBirthOrder(data: TreeData, personId: string, birthOrder: number): TreeData {
  return {
    ...data,
    families: data.families.map((family) => family.children.some((child) => child.personId === personId)
      ? { ...family, children: family.children.map((child) => child.personId === personId ? { ...child, birthOrder } : child) }
      : family),
  }
}

export function updatePetBirthOrder(data: TreeData, petId: string, birthOrder: number): TreeData {
  return {
    ...data,
    petFamilies: data.petFamilies.map((family) => family.children.some((child) => child.petId === petId)
      ? { ...family, children: family.children.map((child) => child.petId === petId ? { ...child, birthOrder } : child) }
      : family),
  }
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

export const genders: Gender[] = ['male', 'female', 'nonbinary', 'prefer-not-to-say', 'unknown']
export type AnyChildLink = ChildLink | PetChildLink
