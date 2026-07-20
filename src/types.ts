export type Gender = 'male' | 'female' | 'nonbinary' | 'prefer-not-to-say' | 'unknown'
export type LifeStatus = 'alive' | 'dead'
export type ArchiveEntityKind = 'person' | 'pet'
export type ArchiveEditAction = 'child' | 'partner' | 'sibling' | 'settings' | 'delete'

export interface ArchiveEditIntent {
  kind: ArchiveEntityKind
  entityId: string
  action: ArchiveEditAction
}

export interface ArchiveEditRequest extends ArchiveEditIntent {
  requestId: number
}

export type ArchiveEntityPatch =
  | { kind: 'person'; entityId: string; patch: Partial<Person> }
  | { kind: 'pet'; entityId: string; patch: Partial<Pet> }

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
  birthDetails: string
  deathDate: string
  personality: string
  biography: string
  relationshipLabel: string
  portrait: string
  portraitNumber: number
  links: string[]
  status: LifeStatus
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
  birthDetails: string
  deathDate: string
  personality: string
  biography: string
  relationshipLabel: string
  portrait: string
  portraitNumber: number
  links: string[]
  status: LifeStatus
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
  version: 5
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

export interface PersonDeletePlan {
  requestedIds: string[]
  deleteIds: string[]
  cascadeIds: string[]
  blockedReason?: string
}

export interface PetDeletePlan {
  requestedIds: string[]
  deleteIds: string[]
  cascadeIds: string[]
  blockedReason?: string
}
