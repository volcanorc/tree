export type Gender = 'male' | 'female' | 'nonbinary' | 'prefer-not-to-say' | 'unknown'

export interface SiteConfig {
  title: string
  subtitle: string
  theme: 'celestial-lineage'
  adminUser: string
  adminPinHash: string
}

export interface Person {
  id: string
  displayName: string
  nickname: string
  gender: Gender
  birthDate: string
  ageOverride: number | null
  personality: string
  biography: string
  relationshipLabel: string
  portrait: string
  link: string
  protected: boolean
  createdAt: string
}

export interface ChildLink {
  personId: string
  birthOrder: number
}

export interface FamilyUnit {
  id: string
  parentIds: string[]
  children: ChildLink[]
}

export interface Pet {
  id: string
  displayName: string
  species: string
  breed: string
  gender: Gender
  birthDate: string
  ageOverride: number | null
  personality: string
  biography: string
  relationshipLabel: string
  portrait: string
  link: string
  ownerPersonId: string
  protected: boolean
  createdAt: string
}

export interface PetChildLink {
  petId: string
  birthOrder: number
}

export interface PetFamilyUnit {
  id: string
  parentPetIds: string[]
  children: PetChildLink[]
}

export interface TreeData {
  version: number
  site: SiteConfig
  people: Person[]
  families: FamilyUnit[]
  pets: Pet[]
  petFamilies: PetFamilyUnit[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface DeleteResult {
  data: TreeData
  deleted: boolean
  reason?: string
}
