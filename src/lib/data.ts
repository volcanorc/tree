import type {
  ChildLink,
  DeleteResult,
  FamilyUnit,
  Gender,
  LifeStatus,
  Person,
  PersonDeletePlan,
  Pet,
  PetDeletePlan,
  PetChildLink,
  PetFamilyUnit,
  TreeData,
  ValidationResult,
} from '../types'
import { inferLineageSurname, resolveChildLineageSurname } from './lineage'

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])
const CORE_PERSON_IDS = ['father', 'mother', 'child-1', 'child-2', 'child-3', 'child-4', 'child-5', 'child-6', 'child-7']
const LIFE_STATUSES = new Set<LifeStatus>(['alive', 'dead'])
const DEFAULT_TITLE = 'The Lineage Archive'
const OLD_DEFAULT_TITLE = 'The Family Archive'
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
  today = new Date(),
  deathDate = '',
  status: LifeStatus = 'alive',
  allowPartial = false,
): number | '?' {
  const birth = parseArchiveDate(birthDate, allowPartial)
  if (!birth || compareDateParts(birth, localDateParts(today)) > 0) return '?'
  const parsedDeath = status === 'dead' ? parseArchiveDate(deathDate, allowPartial) : null
  const end = parsedDeath ?? localDateParts(today)
  if (compareDatePartsKnown(end, birth) < 0) return '?'

  let age = end.year - birth.year
  if (birth.precision === 'year' || end.precision === 'year') return Math.max(0, age)
  if (end.month < birth.month) age -= 1
  else if (end.month === birth.month && birth.precision === 'day' && end.precision === 'day' && end.day < birth.day) age -= 1
  return Math.max(0, age)
}

export function yearFromDate(value: string): number | null {
  return parseArchiveDate(value, true)?.year ?? null
}

export type DatePrecision = 'year' | 'month' | 'day'

export interface ParsedArchiveDate {
  year: number
  month: number
  day: number
  precision: DatePrecision
  canonical: string
}

const MONTH_FULL_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const
const MONTH_SHORT_NAMES = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const
const MONTH_NAMES = new Map<string, number>()
MONTH_FULL_NAMES.forEach((name, index) => MONTH_NAMES.set(name, index + 1))
MONTH_SHORT_NAMES.forEach((name, index) => MONTH_NAMES.set(name, index + 1))
MONTH_NAMES.set('sept', 9)

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function localDateParts(date: Date): ParsedArchiveDate {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return { year, month, day, precision: 'day', canonical: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
}

function damerauLevenshtein(left: string, right: string): number {
  const rows = left.length + 1
  const columns = right.length + 1
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0))
  for (let row = 0; row < rows; row += 1) matrix[row][0] = row
  for (let column = 0; column < columns; column += 1) matrix[0][column] = column

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      )
      if (
        row > 1
        && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1)
      }
    }
  }
  return matrix[left.length][right.length]
}

function resolveMonth(value: string): number | null {
  if (/^\d{1,2}$/.test(value)) {
    const numeric = Number(value)
    return numeric >= 1 && numeric <= 12 ? numeric : null
  }
  if (!/^[a-z]+$/.test(value)) return null
  const exact = MONTH_NAMES.get(value)
  if (exact) return exact

  if (value.length === 2) {
    const prefixMatches = MONTH_FULL_NAMES
      .map((name, index) => ({ name, month: index + 1 }))
      .filter(({ name }) => name.startsWith(value))
    return prefixMatches.length === 1 ? prefixMatches[0].month : null
  }
  if (value.length < 3 || value.length > 11) return null

  const maximumDistance = value.length <= 4 ? 1 : 2
  const ranked = MONTH_FULL_NAMES
    .map((name, index) => ({ month: index + 1, distance: damerauLevenshtein(value, name) }))
    .sort((left, right) => left.distance - right.distance)
  if (ranked[0].distance > maximumDistance || ranked[0].distance === ranked[1].distance) return null
  return ranked[0].month
}

function formatParsedArchiveDate(parsed: ParsedArchiveDate, monthStyle: 'short' | 'long'): string {
  const year = String(parsed.year).padStart(4, '0')
  if (parsed.precision === 'year') return year
  const month = monthStyle === 'short' ? MONTH_SHORT_NAMES[parsed.month - 1] : MONTH_FULL_NAMES[parsed.month - 1]
  if (parsed.precision === 'month') return `${year}-${month}`
  return `${year}-${month}-${parsed.day}`
}

function formatPublicArchiveDate(parsed: ParsedArchiveDate): string {
  const year = String(parsed.year).padStart(4, '0')
  if (parsed.precision === 'year') return year
  const fullMonth = MONTH_FULL_NAMES[parsed.month - 1]
  const month = `${fullMonth[0].toUpperCase()}${fullMonth.slice(1)}`
  if (parsed.precision === 'month') return `${month} ${year}`
  return `${month} ${parsed.day} ${year}`
}

export function parseArchiveDate(value: string, allowPartial = false): ParsedArchiveDate | null {
  const parts = value.trim().toLowerCase().split('-')
  const validYear = /^\d{4}$/.test(parts[0]) || (allowPartial && /^\d{2}$/.test(parts[0]))
  if (!parts[0] || !validYear || parts.length > 3) return null
  const year = parts[0].length === 2 ? 2000 + Number(parts[0]) : Number(parts[0])
  const yearText = String(year).padStart(4, '0')
  if (year < 1) return null
  if (parts.length === 1) {
    return allowPartial ? { year, month: 1, day: 1, precision: 'year', canonical: yearText } : null
  }
  const month = allowPartial ? resolveMonth(parts[1]) : /^\d{1,2}$/.test(parts[1]) ? Number(parts[1]) : null
  if (!month || month < 1 || month > 12) return null
  if (parts.length === 2) {
    if (!allowPartial) return null
    return { year, month, day: 1, precision: 'month', canonical: `${yearText}-${String(month).padStart(2, '0')}` }
  }
  if (!/^\d{1,2}$/.test(parts[2])) return null
  const day = Number(parts[2])
  if (day < 1 || day > daysInMonth(year, month)) return null
  return {
    year,
    month,
    day,
    precision: 'day',
    canonical: `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

export function normalizeArchiveDate(value: string, allowPartial = false): string {
  const parsed = parseArchiveDate(value, allowPartial)
  if (!parsed) return value.trim()
  return allowPartial ? formatParsedArchiveDate(parsed, 'short') : parsed.canonical
}

export function displayArchiveDate(value: string): string {
  if (!value.trim()) return '?'
  const parsed = parseArchiveDate(value, true)
  return parsed ? formatPublicArchiveDate(parsed) : value.trim()
}

function compareDateParts(left: ParsedArchiveDate, right: ParsedArchiveDate): number {
  return left.year - right.year || left.month - right.month || left.day - right.day
}

function compareDatePartsKnown(left: ParsedArchiveDate, right: ParsedArchiveDate): number {
  if (left.year !== right.year) return left.year - right.year
  if (left.precision === 'year' || right.precision === 'year') return 0
  if (left.month !== right.month) return left.month - right.month
  if (left.precision === 'month' || right.precision === 'month') return 0
  return left.day - right.day
}

export function dateSortKey(value: string): string {
  const parsed = parseArchiveDate(value, true)
  if (!parsed) return '9999-99-99'
  const month = parsed.precision === 'year' ? '00' : String(parsed.month).padStart(2, '0')
  const day = parsed.precision === 'day' ? String(parsed.day).padStart(2, '0') : '00'
  return `${String(parsed.year).padStart(4, '0')}-${month}-${day}`
}

export function dateFieldError(value: string, allowPartial: boolean, today = new Date()): string {
  if (!value.trim()) return ''
  const parsed = parseArchiveDate(value, allowPartial)
  if (!parsed) return allowPartial ? 'Use YY or YYYY, optionally followed by a month and day.' : 'Use YYYY-MM-DD.'
  if (compareDateParts(parsed, localDateParts(today)) > 0) return 'Date cannot be in the future.'
  return ''
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

export function portraitNumberFromPath(value: string, kind: 'person' | 'pet'): number | null {
  const pattern = kind === 'person'
    ? /^\/?portraits\/([1-9]\d*)\.png$/
    : /^\/?portraits\/pets\/([1-9]\d*)\.png$/
  const match = value.trim().match(pattern)
  if (!match) return null
  const portraitNumber = Number(match[1])
  return Number.isSafeInteger(portraitNumber) ? portraitNumber : null
}

export function isAutomaticPortraitPath(value: string, kind: 'person' | 'pet', portraitNumber: number): boolean {
  return portraitNumberFromPath(value, kind) === portraitNumber
}

export function portraitCandidates(entity: Pick<Person | Pet, 'portrait' | 'portraitNumber'>): string[] {
  return entity.portrait.trim() ? [resolvePortrait(entity.portrait)] : []
}

export function bornValue(entity: Pick<Person | Pet, 'birthDate' | 'birthDetails'>): string {
  return entity.birthDate ? displayArchiveDate(entity.birthDate) : displayValue(entity.birthDetails)
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

function validateDate(value: string, label: string, field: 'birth' | 'death', errors: string[], allowPartial = false): void {
  if (!value) return
  const parsed = parseArchiveDate(value, allowPartial)
  if (!parsed) errors.push(`${label} has an invalid ${field} date.`)
  else if (compareDateParts(parsed, localDateParts(new Date())) > 0) errors.push(`${label} has a ${field} date in the future.`)
}

function validateLifeDates(entity: Pick<Person | Pet, 'displayName' | 'id' | 'birthDate' | 'deathDate' | 'status'>, errors: string[], allowPartial: boolean): void {
  const label = entity.displayName || entity.id
  validateDate(entity.birthDate, label, 'birth', errors, allowPartial)
  validateDate(entity.deathDate, label, 'death', errors, allowPartial)
  if (entity.status === 'alive' && entity.deathDate) errors.push(`${label} cannot have a death date while marked alive.`)
  const birth = parseArchiveDate(entity.birthDate, allowPartial)
  const death = parseArchiveDate(entity.deathDate, allowPartial)
  if (birth && death && compareDatePartsKnown(death, birth) < 0) {
    errors.push(`${label} has a death date before the birth date.`)
  }
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
    birthDate: '2013',
    birthDetails: 'Trash can',
    deathDate: '',
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
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3 && raw.version !== 4 && raw.version !== 5 && raw.version !== 6) throw new Error('Unsupported or missing data version.')
  const rawPeople = Array.isArray(raw.people) ? raw.people : []
  const hasVersionTwoFields = raw.version === 2 || raw.version === 3 || raw.version === 4 || raw.version === 5 || raw.version === 6
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
    const storedLineageSurname = stringValue(person.lineageSurname)
    return {
      id: stringValue(person.id),
      displayName: stringValue(person.displayName),
      lineageSurname: raw.version === 6
        ? storedLineageSurname.trim() === '?' ? '' : storedLineageSurname
        : inferLineageSurname(stringValue(person.displayName)),
      nickname: stringValue(person.nickname),
      gender: (person.gender ?? 'unknown') as Gender,
      birthDate: stringValue(person.birthDate),
      birthDetails: stringValue(person.birthDetails),
      deathDate: stringValue(person.deathDate),
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
  if (raw.version === 3 || raw.version === 4 || raw.version === 5 || raw.version === 6) {
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
    const portraitNumber = raw.version === 3 || raw.version === 4 || raw.version === 5 || raw.version === 6
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
      birthDate: normalizeArchiveDate(stringValue(pet.birthDate), true),
      birthDetails: stringValue(pet.birthDetails),
      deathDate: normalizeArchiveDate(stringValue(pet.deathDate), true),
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
  if (existingIring) {
    if (!existingIring.birthDate) existingIring.birthDate = '2013'
    if (raw.version === 1 || raw.version === 2) existingIring.protected = true
  } else pets.unshift(iringBrown())
  const site = raw.site ?? ({} as TreeData['site'])
  const title = stringValue(site.title)
  const subtitle = stringValue(site.subtitle)
  return {
    version: 6,
    site: {
      title: !title.trim() || title.trim() === OLD_DEFAULT_TITLE ? DEFAULT_TITLE : title,
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
  if (!data || data.version !== 6) errors.push('Unsupported or missing data version.')
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
  duplicateValues(data.petFamilies.flatMap((family) => family.children.map((child) => child.petId))).forEach((id) =>
    errors.push(`Pet ${id} belongs to more than one parental pet-family unit.`),
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
    validateLifeDates(person, errors, false)
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
    if (!pet.id.trim()) errors.push('Every pet requires an ID.')
    if (!Number.isInteger(pet.portraitNumber) || pet.portraitNumber < 1) errors.push(`${pet.displayName || pet.id} has an invalid pet portrait number.`)
    if (!LIFE_STATUSES.has(pet.status)) errors.push(`${pet.displayName || pet.id} has an invalid status.`)
    validateLifeDates(pet, errors, true)
    if (pet.ownerPersonId && !people.has(pet.ownerPersonId)) errors.push(`${pet.displayName || pet.id} references a missing owner.`)
    if (!Array.isArray(pet.links)) errors.push(`${pet.displayName || pet.id} has an invalid links list.`)
    else pet.links.forEach((link, index) => {
      if (!isSafeExternalUrl(link)) errors.push(`${pet.displayName || pet.id} has an unsafe link at position ${index + 1}.`)
    })
    if (!isSafePortrait(pet.portrait)) errors.push(`${pet.displayName || pet.id} has an unsafe portrait path.`)
  })
  data.petFamilies.forEach((family) => {
    if (family.parentPetIds.length < 1 || family.parentPetIds.length > 2) errors.push(`${family.id} must contain one or two pet parents.`)
    if (duplicateValues(family.parentPetIds).length) errors.push(`${family.id} contains the same pet parent more than once.`)
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
    lineageSurname: inferLineageSurname(label),
    nickname: '',
    gender: 'unknown',
    birthDate: '',
    birthDetails: '',
    deathDate: '',
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
    deathDate: '',
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
    person.lineageSurname = resolveChildLineageSurname(data.people, families[familyIndex])
    const nextOrder = Math.max(0, ...families[familyIndex].children.map((child) => child.birthOrder)) + 1
    families[familyIndex].children.push({ personId: id, birthOrder: nextOrder })
  } else {
    person.lineageSurname = data.people.find((candidate) => candidate.id === parentId)?.lineageSurname ?? ''
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

export function addSibling(data: TreeData, personId: string, label = 'New sibling'): TreeData {
  const familyIndex = data.families.findIndex((family) => family.children.some((child) => child.personId === personId))
  if (familyIndex < 0) return data
  const id = makeId(label, data.people.map((person) => person.id))
  const person = createBlankPerson(id, label, nextPortraitNumber(data))
  person.lineageSurname = data.people.find((candidate) => candidate.id === personId)?.lineageSurname ?? ''
  const families = data.families.map((family, index) => {
    if (index !== familyIndex) return family
    const nextOrder = Math.max(0, ...family.children.map((child) => child.birthOrder)) + 1
    return { ...family, children: [...family.children, { personId: id, birthOrder: nextOrder }] }
  })
  return { ...data, people: [...data.people, person], families }
}

export function addPetOffspring(data: TreeData, parentPetId: string, label = 'New pet', familyId?: string | 'single'): TreeData {
  const id = makeId(label, data.pets.map((pet) => pet.id))
  const pet = createBlankPet(id, label, nextPetPortraitNumber(data))
  const petFamilies = data.petFamilies.map((family) => ({ ...family, children: [...family.children] }))
  let familyIndex = familyId && familyId !== 'single'
    ? petFamilies.findIndex((family) => family.id === familyId && family.parentPetIds.includes(parentPetId))
    : -1
  if (familyId === 'single') familyIndex = petFamilies.findIndex((family) => family.parentPetIds.length === 1 && family.parentPetIds[0] === parentPetId)
  if (!familyId) {
    const applicable = petFamilies.map((family, index) => ({ family, index })).filter(({ family }) => family.parentPetIds.includes(parentPetId))
    if (applicable.length === 1) familyIndex = applicable[0].index
  }
  if (familyIndex >= 0) {
    const nextOrder = Math.max(0, ...petFamilies[familyIndex].children.map((child) => child.birthOrder)) + 1
    petFamilies[familyIndex].children.push({ petId: id, birthOrder: nextOrder })
  } else {
    petFamilies.push({ id: makeId(`pet-family-${parentPetId}`, petFamilies.map((family) => family.id)), parentPetIds: [parentPetId], children: [{ petId: id, birthOrder: 1 }] })
  }
  return { ...data, pets: [...data.pets, pet], petFamilies }
}

export function addPetPartner(data: TreeData, petId: string, label = 'New pet partner', attachFamilyId?: string): TreeData {
  const id = makeId(label, data.pets.map((pet) => pet.id))
  const partner = createBlankPet(id, label, nextPetPortraitNumber(data))
  let attached = false
  const petFamilies = data.petFamilies.map((family) => {
    if (family.id !== attachFamilyId || family.parentPetIds.length !== 1 || !family.parentPetIds.includes(petId)) return family
    attached = true
    return { ...family, parentPetIds: [...family.parentPetIds, id] }
  })
  if (!attached) {
    petFamilies.push({
      id: makeId(`pet-family-${petId}`, petFamilies.map((family) => family.id)),
      parentPetIds: [petId, id],
      children: [],
    })
  }
  return { ...data, pets: [...data.pets, partner], petFamilies }
}

export function addPetSibling(data: TreeData, petId: string, label = 'New pet sibling'): TreeData {
  const familyIndex = data.petFamilies.findIndex((family) => family.children.some((child) => child.petId === petId))
  if (familyIndex < 0) return data
  const id = makeId(label, data.pets.map((pet) => pet.id))
  const pet = createBlankPet(id, label, nextPetPortraitNumber(data))
  const petFamilies = data.petFamilies.map((family, index) => {
    if (index !== familyIndex) return family
    const nextOrder = Math.max(0, ...family.children.map((child) => child.birthOrder)) + 1
    return { ...family, children: [...family.children, { petId: id, birthOrder: nextOrder }] }
  })
  return { ...data, pets: [...data.pets, pet], petFamilies }
}

export function planPersonDeletion(data: TreeData, requestedIds: string[]): PersonDeletePlan {
  const requested = [...new Set(requestedIds)].filter((id) => data.people.some((person) => person.id === id))
  const protectedPerson = requested.map((id) => data.people.find((person) => person.id === id)).find((person) => person?.protected)
  if (protectedPerson) return { requestedIds: requested, deleteIds: [], cascadeIds: [], blockedReason: `${protectedPerson.displayName} is protected and cannot be deleted.` }
  const deleteSet = new Set(requested)
  const cascade = new Set<string>()
  let expanded = true
  while (expanded) {
    expanded = false
    data.families.forEach((family) => {
      if (family.parentIds.length === 0 || !family.parentIds.every((id) => deleteSet.has(id))) return
      family.children.forEach((child) => {
        if (deleteSet.has(child.personId)) return
        deleteSet.add(child.personId)
        cascade.add(child.personId)
        expanded = true
      })
    })
  }
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
  return {
    ...data,
    people: data.people.filter((person) => !deleteSet.has(person.id)),
    families,
    pets: data.pets.map((pet) => deleteSet.has(pet.ownerPersonId) ? { ...pet, ownerPersonId: '' } : pet),
  }
}

export function deletePerson(data: TreeData, personId: string): DeleteResult {
  const person = data.people.find((candidate) => candidate.id === personId)
  if (!person) return { data, deleted: false, reason: 'Person not found.' }
  const plan = planPersonDeletion(data, [personId])
  if (plan.blockedReason) return { data, deleted: false, reason: plan.blockedReason }
  return { data: applyPersonDeletePlan(data, plan), deleted: plan.deleteIds.length > 0 }
}

export function planPetDeletion(data: TreeData, requestedIds: string[]): PetDeletePlan {
  const requested = [...new Set(requestedIds)].filter((id) => data.pets.some((pet) => pet.id === id))
  const protectedPet = requested.map((id) => data.pets.find((pet) => pet.id === id)).find((pet) => pet?.protected)
  if (protectedPet) return { requestedIds: requested, deleteIds: [], cascadeIds: [], blockedReason: `${protectedPet.displayName} is protected and cannot be deleted.` }

  const deleteSet = new Set(requested)
  const cascade = new Set<string>()
  let expanded = true
  while (expanded) {
    expanded = false
    data.petFamilies.forEach((family) => {
      if (family.parentPetIds.length === 0 || !family.parentPetIds.every((id) => deleteSet.has(id))) return
      family.children.forEach((child) => {
        if (deleteSet.has(child.petId)) return
        deleteSet.add(child.petId)
        cascade.add(child.petId)
        expanded = true
      })
    })
  }

  const protectedCascade = [...deleteSet].map((id) => data.pets.find((pet) => pet.id === id)).find((pet) => pet?.protected)
  if (protectedCascade) {
    return {
      requestedIds: requested,
      deleteIds: [],
      cascadeIds: [...cascade],
      blockedReason: `The deletion would reach protected pet ${protectedCascade.displayName}.`,
    }
  }
  return { requestedIds: requested, deleteIds: [...deleteSet], cascadeIds: [...cascade] }
}

export function applyPetDeletePlan(data: TreeData, plan: PetDeletePlan): TreeData {
  if (plan.blockedReason || plan.deleteIds.length === 0) return data
  const deleteSet = new Set(plan.deleteIds)
  const petFamilies = data.petFamilies.flatMap((family) => {
    const removedParent = family.parentPetIds.some((id) => deleteSet.has(id))
    const parentPetIds = family.parentPetIds.filter((id) => !deleteSet.has(id))
    const children = family.children.filter((child) => !deleteSet.has(child.petId))
    if (parentPetIds.length === 0) return []
    if (removedParent && children.length === 0) return []
    return [{ ...family, parentPetIds, children }]
  })
  return { ...data, pets: data.pets.filter((pet) => !deleteSet.has(pet.id)), petFamilies }
}

export function deletePet(data: TreeData, petId: string): DeleteResult {
  const pet = data.pets.find((candidate) => candidate.id === petId)
  if (!pet) return { data, deleted: false, reason: 'Pet not found.' }
  const plan = planPetDeletion(data, [petId])
  if (plan.blockedReason) return { data, deleted: false, reason: plan.blockedReason }
  return { data: applyPetDeletePlan(data, plan), deleted: plan.deleteIds.length > 0 }
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
