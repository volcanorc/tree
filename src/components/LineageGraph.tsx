import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from 'react'
import {
  bornValue,
  calculateAge,
  dateFieldError,
  dateSortKey,
  displayArchiveDate,
  displayValue,
  isSafeExternalUrl,
  normalizeArchiveDate,
  portraitCandidates,
  sortChildren,
  yearFromDate,
} from '../lib/data'
import { useCurrentDate } from '../hooks/useCurrentDate'
import { classifyFamilyLine, familyLineOptions, type FamilyLineClassification } from '../lib/lineage'
import type { ArchiveEditIntent, ArchiveEntityPatch, FamilyUnit, Gender, LifeStatus, Person, Pet, PetFamilyUnit } from '../types'

type Entity = Person | Pet
type ViewState = { x: number; y: number; scale: number }

interface NormalizedFamily {
  id: string
  parentIds: string[]
  children: Array<{ entityId: string; birthOrder: number }>
}

interface PartnerGroup {
  id: string
  entityIds: string[]
  families: NormalizedFamily[]
  entryEntityId: string
  centerEntityId: string
  layoutSlots: Record<string, number>
  railDepth: number
}

interface ConnectorPath {
  id: string
  familyId: string
  kind: 'union' | 'family-stem' | 'child'
  parentIds: string[]
  sourceParentId?: string
  childId?: string
  d: string
}

interface PetYearBand {
  key: string
  label: string
  year: number | null
  pets: Pet[]
}

interface PetSpeciesColumn {
  key: string
  label: string
  width: number
}

export interface LineageFocusRequest {
  entityId: string
  requestId: number
}

interface LineageGraphProps {
  mode: 'people' | 'pets'
  people: Person[]
  families: FamilyUnit[]
  pets: Pet[]
  petFamilies: PetFamilyUnit[]
  onOwnerNavigate?: (personId: string) => void
  onPetNavigate?: (petId: string) => void
  focusRequest?: LineageFocusRequest | null
  onFocusAcknowledge?: (requestId: number) => void
  canEdit?: boolean
  onEditAction?: (intent: ArchiveEditIntent) => void
  onEntityPatch?: (request: ArchiveEntityPatch) => string
  recentEntityId?: string | null
  interactionLocked?: boolean
  onOpenMap?: () => void
  fullscreenMode?: boolean
  onToggleFullscreen?: (trigger?: HTMLElement) => void
}

type ProfileHighlightFilter = 'set' | 'dead' | 'alive' | 'male' | 'female'
type FamilyLineProfileRole = 'member' | 'partner' | 'none'
type HighlightPreview =
  | { kind: 'profile'; value: ProfileHighlightFilter }
  | { kind: 'lineage'; value: string }

interface HighlightOption<Value extends string> {
  value: Value
  label: string
}

interface HighlightDropdownProps<Value extends string> {
  label: string
  ariaLabel?: string
  value: Value
  options: HighlightOption<Value>[]
  disabled?: boolean
  onPreview: (value: Value | null) => void
  onCommit: (value: Value) => void
}

interface HoverState {
  entity: Entity
  x: number
  y: number
}

interface PinnedPosition {
  left: number
  top: number
  arrowLeft: number
  placement: 'above' | 'below'
}

type Gesture =
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'pinch'; startDistance: number; startScale: number; worldX: number; worldY: number }

const MIN_SCALE = 0.25
const MAX_SCALE = 2.5
const TOUCH_HOLD_DELAY = 450
const TOUCH_HOLD_MOVE_TOLERANCE = 10
const PROFILE_HIGHLIGHT_OPTIONS: HighlightOption<ProfileHighlightFilter>[] = [
  { value: 'set', label: 'Set' },
  { value: 'dead', label: 'Dead' },
  { value: 'alive', label: 'Alive' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
]

function HighlightDropdown<Value extends string>({
  label,
  ariaLabel = label,
  value,
  options,
  disabled = false,
  onPreview,
  onCommit,
}: HighlightDropdownProps<Value>) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)))
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selectedLabel = options[selectedIndex]?.label ?? options[0]?.label ?? 'Set'

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false)
    setActiveIndex(selectedIndex)
    onPreview(null)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [onPreview, selectedIndex])

  useEffect(() => {
    if (!open) return
    const closeFromOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu()
    }
    document.addEventListener('click', closeFromOutside)
    return () => document.removeEventListener('click', closeFromOutside)
  }, [closeMenu, open])

  const previewOption = useCallback((index: number, focus = false) => {
    const option = options[index]
    if (!option) return
    setActiveIndex(index)
    onPreview(option.value)
    if (focus) requestAnimationFrame(() => optionRefs.current[index]?.focus())
  }, [onPreview, options])

  const openForKeyboard = (index: number) => {
    if (disabled) return
    setOpen(true)
    previewOption(index, true)
  }

  const commitOption = (option: HighlightOption<Value>) => {
    onCommit(option.value)
    setOpen(false)
    setActiveIndex(options.findIndex((candidate) => candidate.value === option.value))
    onPreview(null)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const moveOptionFocus = (index: number, direction: 1 | -1) => {
    const next = (index + direction + options.length) % options.length
    previewOption(next, true)
  }

  return (
    <div
      className="highlight-filter"
      ref={rootRef}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenu()
      }}
    >
      <span className="highlight-filter-label" id={`${id}-label`}>{label}</span>
      <button
        type="button"
        className="highlight-filter-trigger"
        ref={triggerRef}
        data-value={value}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        disabled={disabled}
        onClick={() => {
          if (open) closeMenu()
          else {
            setActiveIndex(selectedIndex)
            setOpen(true)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            closeMenu()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            openForKeyboard(open ? (activeIndex + 1) % options.length : (selectedIndex + 1) % options.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            openForKeyboard(open ? (activeIndex - 1 + options.length) % options.length : (selectedIndex - 1 + options.length) % options.length)
          } else if ((event.key === 'Enter' || event.key === ' ') && !open) {
            event.preventDefault()
            openForKeyboard(selectedIndex)
          }
        }}
      >
        <span id={`${id}-value`}>{selectedLabel}</span>
        <svg aria-hidden="true" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" /></svg>
      </button>
      {open && (
        <div className="highlight-filter-list" id={`${id}-listbox`} role="listbox" aria-label={`${label} options`}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              ref={(element) => { optionRefs.current[index] = element }}
              className={`highlight-filter-option ${index === activeIndex ? 'is-previewed' : ''}`}
              aria-selected={option.value === value}
              key={option.value}
              tabIndex={-1}
              onMouseEnter={() => previewOption(index)}
              onFocus={() => previewOption(index)}
              onClick={() => commitOption(option)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveOptionFocus(index, 1)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  moveOptionFocus(index, -1)
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  previewOption(0, true)
                } else if (event.key === 'End') {
                  event.preventDefault()
                  previewOption(options.length - 1, true)
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  commitOption(option)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  closeMenu(true)
                }
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <span className="highlight-filter-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

function elementCenterInAncestor(element: HTMLElement, ancestor: HTMLElement) {
  let x = element.offsetLeft + element.offsetWidth / 2
  let y = element.offsetTop + element.offsetHeight / 2
  let parent = element.offsetParent as HTMLElement | null
  while (parent && parent !== ancestor) {
    x += parent.offsetLeft
    y += parent.offsetTop
    parent = parent.offsetParent as HTMLElement | null
  }
  return { x, y }
}

function isPet(entity: Entity): entity is Pet {
  return 'species' in entity
}

function buildPartnerGroups(families: NormalizedFamily[]) {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const current = parent.get(id)
    if (!current) {
      parent.set(id, id)
      return id
    }
    if (current === id) return id
    const root = find(current)
    parent.set(id, root)
    return root
  }
  const union = (left: string, right: string) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
  }

  families.forEach((family) => {
    family.parentIds.forEach((id) => find(id))
    if (family.parentIds.length === 2) union(family.parentIds[0], family.parentIds[1])
  })

  const groupIds = new Map<string, string>()
  const entityIdsByGroup = new Map<string, string[]>()
  families.forEach((family) => {
    family.parentIds.forEach((entityId) => {
      const root = find(entityId)
      const groupId = groupIds.get(root) ?? `partner-group-${groupIds.size + 1}`
      groupIds.set(root, groupId)
      const entityIds = entityIdsByGroup.get(groupId) ?? []
      if (!entityIds.includes(entityId)) entityIds.push(entityId)
      entityIdsByGroup.set(groupId, entityIds)
    })
  })

  const familiesByGroup = new Map<string, NormalizedFamily[]>()
  families.forEach((family) => {
    const firstParent = family.parentIds[0]
    if (!firstParent) return
    const groupId = groupIds.get(find(firstParent))
    if (!groupId) return
    familiesByGroup.set(groupId, [...(familiesByGroup.get(groupId) ?? []), family])
  })

  const childOrder = new Map<string, number>()
  families.forEach((family) => family.children.forEach((child) => {
    if (!childOrder.has(child.entityId)) childOrder.set(child.entityId, childOrder.size)
  }))

  const groups: PartnerGroup[] = [...entityIdsByGroup.entries()].map(([id, entityIds]) => {
    const groupFamilies = familiesByGroup.get(id) ?? []
    const entryEntityId = [...entityIds]
      .filter((entityId) => childOrder.has(entityId))
      .sort((left, right) => childOrder.get(left)! - childOrder.get(right)!)[0] ?? entityIds[0]
    const familyOrder = new Map(groupFamilies.map((family, index) => [family.id, index]))
    const adjacency = new Map(entityIds.map((entityId) => [entityId, [] as Array<{ entityId: string; familyId: string }>]))
    groupFamilies.forEach((family) => {
      if (family.parentIds.length !== 2) return
      const [left, right] = family.parentIds
      adjacency.get(left)?.push({ entityId: right, familyId: family.id })
      adjacency.get(right)?.push({ entityId: left, familyId: family.id })
    })
    adjacency.forEach((neighbors) => neighbors.sort((left, right) => (familyOrder.get(left.familyId) ?? 0) - (familyOrder.get(right.familyId) ?? 0)))

    const centerEntityId = [...entityIds].sort((left, right) => {
      const degreeDifference = (adjacency.get(right)?.length ?? 0) - (adjacency.get(left)?.length ?? 0)
      if (degreeDifference) return degreeDifference
      if (left === entryEntityId) return -1
      if (right === entryEntityId) return 1
      return entityIds.indexOf(left) - entityIds.indexOf(right)
    })[0]
    const layoutSlots = new Map<string, number>([[centerEntityId, 0]])
    const queue = [centerEntityId]
    let nextLeft = -1
    let nextRight = 1
    let centerNeighborIndex = 0
    while (queue.length) {
      const current = queue.shift()!
      const currentSlot = layoutSlots.get(current) ?? 0
      for (const neighbor of adjacency.get(current) ?? []) {
        if (layoutSlots.has(neighbor.entityId)) continue
        let slot: number
        if (current === centerEntityId) {
          slot = centerNeighborIndex % 2 === 0 ? nextLeft-- : nextRight++
          centerNeighborIndex += 1
        } else if (currentSlot < 0) slot = nextLeft--
        else if (currentSlot > 0) slot = nextRight++
        else slot = centerNeighborIndex++ % 2 === 0 ? nextLeft-- : nextRight++
        layoutSlots.set(neighbor.entityId, slot)
        queue.push(neighbor.entityId)
      }
    }
    entityIds.forEach((entityId) => {
      if (!layoutSlots.has(entityId)) layoutSlots.set(entityId, nextRight++)
    })
    const orderedEntityIds = [...entityIds].sort((left, right) => layoutSlots.get(left)! - layoutSlots.get(right)!)
    const railDepth = Math.max(0, ...groupFamilies.map((family) => {
      if (family.parentIds.length !== 2) return 0
      return Math.max(0, Math.abs(layoutSlots.get(family.parentIds[0])! - layoutSlots.get(family.parentIds[1])!) - 1)
    }))
    return {
      id,
      entityIds: orderedEntityIds,
      families: groupFamilies,
      entryEntityId,
      centerEntityId,
      layoutSlots: Object.fromEntries(layoutSlots),
      railDepth,
    }
  })
  const groupByEntity = new Map(groups.flatMap((group) => group.entityIds.map((entityId) => [entityId, group] as const)))
  return { groups, groupByEntity }
}

function buildPetYearBands(pets: Pet[]): PetYearBand[] {
  const petsByYear = new Map<number | null, Array<{ pet: Pet; index: number }>>()
  pets.forEach((pet, index) => {
    const year = yearFromDate(pet.birthDate)
    petsByYear.set(year, [...(petsByYear.get(year) ?? []), { pet, index }])
  })
  return [...petsByYear.entries()]
    .sort(([left], [right]) => left === null ? 1 : right === null ? -1 : left - right)
    .map(([year, entries]) => ({
      key: year === null ? 'unknown' : String(year),
      label: year === null ? 'Unknown year' : String(year),
      year,
      pets: entries
        .sort((left, right) => {
          const leftKey = dateSortKey(left.pet.birthDate)
          const rightKey = dateSortKey(right.pet.birthDate)
          return leftKey.localeCompare(rightKey) || left.index - right.index
        })
        .map(({ pet }) => pet),
    }))
}

function petSpeciesKey(pet: Pet): string {
  return pet.species.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'unknown-species'
}

function buildPetSpeciesColumns(pets: Pet[], bands: PetYearBand[]): PetSpeciesColumn[] {
  const labels = new Map<string, string>()
  pets.forEach((pet) => {
    const key = petSpeciesKey(pet)
    if (!labels.has(key)) labels.set(key, pet.species.trim() || 'Unknown species')
  })
  return [...labels.entries()].map(([key, label]) => {
    const largestYearGroup = Math.max(1, ...bands.map((band) => band.pets.filter((pet) => petSpeciesKey(pet) === key).length))
    return { key, label, width: largestYearGroup * 174 }
  })
}

function PortraitFallback({ entity }: { entity: Entity }) {
  return (
    <span className="portrait-fallback" aria-hidden="true">
      <span className="portrait-head" />
      <span className="portrait-body" />
      <span className="portrait-initial">{entity.displayName.trim().charAt(0) || '?'}</span>
    </span>
  )
}

function EntityPortrait({ entity }: { entity: Entity }) {
  const candidates = useMemo(
    () => portraitCandidates(entity),
    [entity],
  )
  const [candidateIndex, setCandidateIndex] = useState(0)
  if (candidateIndex >= candidates.length) return <PortraitFallback entity={entity} />
  return (
    <img
      src={candidates[candidateIndex]}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  )
}

function EntityCard({
  entity,
  owner,
  layoutSlot,
  pinnedEntityId,
  focusedEntityId,
  recentEntityId,
  familyLineRole = 'none',
  onHover,
  onLeave,
  onActivate,
}: {
  entity: Entity
  owner?: Person
  layoutSlot?: number
  pinnedEntityId: string | null
  focusedEntityId: string | null
  recentEntityId?: string | null
  familyLineRole?: FamilyLineProfileRole
  onHover: (entity: Entity, x: number, y: number) => void
  onLeave: () => void
  onActivate: (entity: Entity) => void
}) {
  const safeLinks = entity.links.filter((link) => link.trim() && isSafeExternalUrl(link))
  const touchHoldTimer = useRef<number | null>(null)
  const touchStart = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const touchPreviewActive = useRef(false)
  const touchGestureCancelled = useRef(false)

  const clearTouchHoldTimer = () => {
    if (touchHoldTimer.current !== null) {
      window.clearTimeout(touchHoldTimer.current)
      touchHoldTimer.current = null
    }
  }
  const cancelTouchGesture = () => {
    clearTouchHoldTimer()
    if (touchPreviewActive.current) onLeave()
    touchPreviewActive.current = false
    touchGestureCancelled.current = true
    touchStart.current = null
  }
  useEffect(() => () => {
    if (touchHoldTimer.current !== null) window.clearTimeout(touchHoldTimer.current)
  }, [])

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'touch') return
    clearTouchHoldTimer()
    touchStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    touchPreviewActive.current = false
    touchGestureCancelled.current = false
    touchHoldTimer.current = window.setTimeout(() => {
      const start = touchStart.current
      if (!start || start.pointerId !== event.pointerId || touchGestureCancelled.current) return
      touchPreviewActive.current = true
      touchHoldTimer.current = null
      onHover(entity, start.x, start.y)
    }, TOUCH_HOLD_DELAY)
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'touch') {
      onHover(entity, event.clientX, event.clientY)
      return
    }
    const start = touchStart.current
    if (!start || start.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TOUCH_HOLD_MOVE_TOLERANCE) {
      cancelTouchGesture()
      return
    }
    if (touchPreviewActive.current) onHover(entity, event.clientX, event.clientY)
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.pointerType === 'touch') {
      const previewed = touchPreviewActive.current
      const cancelled = touchGestureCancelled.current
      clearTouchHoldTimer()
      touchStart.current = null
      touchPreviewActive.current = false
      touchGestureCancelled.current = false
      if (previewed) onLeave()
      if (previewed || cancelled) return
    }
    onActivate(entity)
  }
  return (
    <button
      className={`entity-card ${isPet(entity) ? 'pet-card ' : ''}${focusedEntityId === entity.id ? 'is-owner-target ' : ''}${pinnedEntityId === entity.id ? 'is-active ' : ''}${recentEntityId === entity.id ? 'is-newly-created' : ''}`}
      type="button"
      data-entity-id={entity.id}
      data-status={entity.status}
      data-gender={entity.gender}
      data-lineage-role={familyLineRole}
      data-layout-slot={layoutSlot}
      aria-label={`${displayValue(entity.displayName)} details${safeLinks.length > 0 ? `, ${safeLinks.length} profile ${safeLinks.length === 1 ? 'link' : 'links'} available` : ''}${focusedEntityId === entity.id ? ', navigation target' : ''}`}
      aria-expanded={pinnedEntityId === entity.id}
      onPointerDown={handlePointerDown}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') onHover(entity, event.clientX, event.clientY)
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={(event) => {
        if (event.pointerType === 'touch') cancelTouchGesture()
        else onLeave()
      }}
      onPointerUp={handlePointerUp}
      onPointerCancel={(event) => {
        if (event.pointerType === 'touch') cancelTouchGesture()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivate(entity)
        }
      }}
    >
      <span className="portrait-ring">
        <EntityPortrait key={`${entity.portrait}:${entity.portraitNumber}`} entity={entity} />
      </span>
      <span className="entity-name">{displayValue(entity.displayName)}</span>
      <span className="entity-role">
        {isPet(entity) ? displayValue(entity.species || entity.relationshipLabel) : displayValue(entity.relationshipLabel)}
      </span>
      {owner && <span className="entity-owner">with {owner.displayName}</span>}
    </button>
  )
}

type QuickEditField =
  | 'displayName'
  | 'nickname'
  | 'birthDate'
  | 'deathDate'
  | 'gender'
  | 'status'
  | 'personality'
  | 'biography'
  | 'species'
  | 'breed'
  | 'ownerPersonId'

interface QuickEditState {
  field: QuickEditField
  value: string
  error: string
}

interface DetailRow {
  label: string
  value: ReactNode
  field?: QuickEditField
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Zm12-13.8 1.8-1.8a1.4 1.4 0 0 1 2 0l.8.8a1.4 1.4 0 0 1 0 2L18.8 9 16 6.2Z" />
    </svg>
  )
}

function DetailPopover({
  entity,
  people,
  pets,
  today,
  hover,
  pinnedPosition,
  popoverRef,
  onClose,
  onOwnerNavigate,
  onPetNavigate,
  canEdit = false,
  hasRecordedParents = false,
  onEditAction,
  onEntityPatch,
}: {
  entity: Entity
  people: Person[]
  pets: Pet[]
  today: Date
  hover?: HoverState
  pinnedPosition?: PinnedPosition | null
  popoverRef?: RefObject<HTMLElement | null>
  onClose?: () => void
  onOwnerNavigate?: (personId: string) => void
  onPetNavigate?: (petId: string) => void
  canEdit?: boolean
  hasRecordedParents?: boolean
  onEditAction?: (intent: ArchiveEditIntent) => void
  onEntityPatch?: (request: ArchiveEntityPatch) => string
}) {
  const pinned = !hover
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState<QuickEditState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
  const ownedPets = isPet(entity) ? [] : pets.filter((pet) => pet.ownerPersonId === entity.id)
  const left = hover ? Math.min(window.innerWidth - 254, Math.max(16, hover.x + 18)) : pinnedPosition?.left ?? 0
  const top = hover ? Math.min(window.innerHeight - 300, Math.max(82, hover.y + 18)) : pinnedPosition?.top ?? 0
  const style = pinned
    ? ({
        left,
        top,
        visibility: pinnedPosition ? 'visible' : 'hidden',
        '--popover-arrow-left': `${pinnedPosition?.arrowLeft ?? 32}px`,
      } as CSSProperties)
    : ({ left, top } as CSSProperties)
  const safeLinks = entity.links.filter((link) => link.trim() && isSafeExternalUrl(link))
  const age = calculateAge(entity.birthDate, today, entity.deathDate, entity.status, isPet(entity))
  const editable = pinned && canEdit && Boolean(onEntityPatch)

  function currentFieldValue(field: QuickEditField): string {
    if (field === 'ownerPersonId') return isPet(entity) ? entity.ownerPersonId : ''
    if (field === 'species' || field === 'breed') return isPet(entity) ? entity[field] : ''
    if (field === 'nickname') return isPet(entity) ? '' : entity.nickname
    return String(entity[field as keyof Entity] ?? '')
  }

  function commitValue(field: QuickEditField, rawValue: string): boolean {
    if (!onEntityPatch) return false
    let value = rawValue
    if (field === 'displayName') {
      value = rawValue.trim()
      if (!value) {
        setEditing({ field, value: rawValue, error: 'Name is required.' })
        return false
      }
    }
    if (field === 'birthDate' || field === 'deathDate') {
      const error = dateFieldError(rawValue, isPet(entity), today)
      if (error) {
        setEditing({ field, value: rawValue, error })
        return false
      }
      value = normalizeArchiveDate(rawValue, isPet(entity))
    }

    let error: string
    if (isPet(entity)) {
      const patch: Partial<Pet> = {}
      if (field === 'displayName') patch.displayName = value
      else if (field === 'birthDate') patch.birthDate = value
      else if (field === 'deathDate') patch.deathDate = value
      else if (field === 'gender') patch.gender = value as Gender
      else if (field === 'status') patch.status = value as LifeStatus
      else if (field === 'personality') patch.personality = value
      else if (field === 'biography') patch.biography = value
      else if (field === 'species') patch.species = value
      else if (field === 'breed') patch.breed = value
      else if (field === 'ownerPersonId') patch.ownerPersonId = value
      error = onEntityPatch({ kind: 'pet', entityId: entity.id, patch })
    } else {
      const patch: Partial<Person> = {}
      if (field === 'displayName') patch.displayName = value
      else if (field === 'nickname') patch.nickname = value
      else if (field === 'birthDate') patch.birthDate = value
      else if (field === 'deathDate') patch.deathDate = value
      else if (field === 'gender') patch.gender = value as Gender
      else if (field === 'status') patch.status = value as LifeStatus
      else if (field === 'personality') patch.personality = value
      else if (field === 'biography') patch.biography = value
      error = onEntityPatch({ kind: 'person', entityId: entity.id, patch })
    }
    if (error) {
      setEditing({ field, value: rawValue, error })
      return false
    }
    setEditing(null)
    return true
  }

  function beginEdit(field: QuickEditField) {
    if (!editable) return
    if (editing && editing.field !== field && !commitValue(editing.field, editing.value)) return
    setEditing({ field, value: currentFieldValue(field), error: '' })
  }

  function editorFor(field: QuickEditField) {
    if (!editing || editing.field !== field) return null
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setEditing(null)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        commitValue(field, editing.value)
      }
    }
    const shared = {
      autoFocus: true,
      value: editing.value,
      'aria-label': `Edit ${field}`,
      'aria-invalid': Boolean(editing.error),
      onBlur: () => commitValue(field, editing.value),
      onKeyDown: handleKeyDown,
    }
    let control: ReactNode
    if (field === 'gender') {
      control = (
        <select {...shared} onChange={(event) => commitValue(field, event.target.value)}>
          <option value="unknown">Unknown</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="nonbinary">Nonbinary</option>
          <option value="prefer-not-to-say">Prefer not to say</option>
        </select>
      )
    } else if (field === 'status') {
      control = (
        <select {...shared} onChange={(event) => commitValue(field, event.target.value)}>
          <option value="alive">Alive</option>
          <option value="dead">Dead</option>
        </select>
      )
    } else if (field === 'ownerPersonId') {
      control = (
        <select {...shared} onChange={(event) => commitValue(field, event.target.value)}>
          <option value="">No owner</option>
          {people.map((person) => <option value={person.id} key={person.id}>{person.displayName}</option>)}
        </select>
      )
    } else if (field === 'biography') {
      control = <textarea {...shared} rows={3} onChange={(event) => setEditing({ field, value: event.target.value, error: '' })} />
    } else {
      const isDate = field === 'birthDate' || field === 'deathDate'
      control = (
        <input
          {...shared}
          type={isDate && !isPet(entity) ? 'date' : 'text'}
          placeholder={isDate && isPet(entity) ? 'Year, year-month, or year-month-day' : undefined}
          onChange={(event) => setEditing({ field, value: event.target.value, error: '' })}
        />
      )
    }
    return (
      <span className="quick-edit-control">
        {control}
        {editing.error && <span className="quick-edit-error" role="alert">{editing.error}</span>}
      </span>
    )
  }

  function editableValue(value: ReactNode, field?: QuickEditField) {
    if (!field || !editable) return value
    if (editing?.field === field) return editorFor(field)
    return (
      <span className="quick-edit-value">
        <span>{value}</span>
        <button className="quick-edit-pencil" type="button" onClick={() => beginEdit(field)} aria-label={`Edit ${field}`} title={`Edit ${field}`}>
          <PencilIcon />
        </button>
      </span>
    )
  }

  const diedRows: DetailRow[] = entity.status === 'dead'
    ? [{ label: 'Died', value: displayArchiveDate(entity.deathDate), field: 'deathDate' }]
    : []
  useEffect(() => {
    if (!menuOpen) return
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])
  const rows: DetailRow[] = isPet(entity)
    ? [
        { label: 'Species', value: displayValue(entity.species), field: 'species' },
        { label: 'Breed', value: displayValue(entity.breed), field: 'breed' },
        { label: 'Age', value: age },
        { label: 'Born', value: bornValue(entity), field: 'birthDate' },
        ...diedRows,
        { label: 'Gender', value: displayValue(entity.gender), field: 'gender' },
        { label: 'Status', value: entity.status === 'dead' ? 'Dead' : 'Alive', field: 'status' },
        {
          label: 'Owner',
          field: 'ownerPersonId',
          value: owner && pinned && onOwnerNavigate
            ? (
                <button
                  className="owner-navigation-button"
                  type="button"
                  onClick={() => onOwnerNavigate(owner.id)}
                  aria-label={`View ${owner.displayName} in family tree`}
                >
                  {owner.displayName}
                </button>
              )
            : displayValue(owner?.displayName),
        },
        { label: 'Personality', value: displayValue(entity.personality), field: 'personality' },
      ]
    : [
        { label: 'Family line', value: displayValue(entity.lineageSurname) },
        { label: 'Age', value: age },
        { label: 'Born', value: bornValue(entity), field: 'birthDate' },
        ...diedRows,
        { label: 'Gender', value: displayValue(entity.gender), field: 'gender' },
        { label: 'Status', value: entity.status === 'dead' ? 'Dead' : 'Alive', field: 'status' },
        ...(ownedPets.length > 0
          ? [{
              label: 'Owned pets',
              value: pinned && onPetNavigate
                ? (
                    <span className="related-navigation-list">
                      {ownedPets.map((pet) => (
                        <button
                          className="owner-navigation-button"
                          type="button"
                          key={pet.id}
                          onClick={() => onPetNavigate(pet.id)}
                          aria-label={`View ${pet.displayName} in pet lineage`}
                        >
                          {pet.displayName}
                        </button>
                      ))}
                    </span>
                  )
                : ownedPets.map((pet) => pet.displayName).join(', '),
            }]
          : []),
        { label: 'Personality', value: displayValue(entity.personality), field: 'personality' },
      ]

  return (
    <aside
      className={`detail-popover ${pinned ? `detail-pinned is-${pinnedPosition?.placement ?? 'above'}${canEdit ? ' has-admin-controls' : ''}` : 'detail-hover'}`}
      style={style}
      role={pinned ? 'dialog' : 'tooltip'}
      aria-label={`${entity.displayName} details`}
      ref={popoverRef}
    >
      <span className={`portrait-number ${pinned && canEdit ? 'is-admin-position' : ''}`} aria-label={`Portrait number ${entity.portraitNumber}`}>{entity.portraitNumber}</span>
      {pinned && canEdit && onEditAction && (
        <div className="profile-menu" ref={menuRef}>
          <button
            className="profile-menu-trigger"
            type="button"
            aria-label="Profile actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            ▾
          </button>
          {menuOpen && (
            <div className="profile-menu-panel" role="menu" aria-label="Profile actions menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onEditAction({ kind: isPet(entity) ? 'pet' : 'person', entityId: entity.id, action: 'settings' })
                }}
              >
                Settings
              </button>
              <button
                type="button"
                role="menuitem"
                className="profile-menu-delete"
                disabled={entity.protected}
                title={entity.protected ? 'Protected record' : undefined}
                aria-label={entity.protected ? 'Delete — protected record' : 'Delete'}
                onClick={() => {
                  setMenuOpen(false)
                  onEditAction({ kind: isPet(entity) ? 'pet' : 'person', entityId: entity.id, action: 'delete' })
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      <span className="popover-kicker">{displayValue(entity.relationshipLabel)}</span>
      <h3>{editableValue(displayValue(entity.displayName), 'displayName')}</h3>
      {!isPet(entity) && entity.nickname && <p className="nickname">“{editableValue(entity.nickname, 'nickname')}”</p>}
      <dl>
        {rows.map(({ label, value, field }) => (
          <div key={label}><dt>{label}</dt><dd>{editableValue(value, field)}</dd></div>
        ))}
      </dl>
      {entity.biography && <p className="popover-bio">{editableValue(entity.biography, 'biography')}</p>}
      {pinned && (
        <div className="popover-actions">
          {safeLinks.length > 0 && (
            <div className="story-links" aria-label="Profile links">
              {safeLinks.map((link, index) => (
                <a className="story-link" href={link} target="_blank" rel="noopener noreferrer" key={`${link}-${index}`}>Visit {index + 1}</a>
              ))}
            </div>
          )}
          {canEdit && onEditAction && (
            <div className="popover-edit-actions" aria-label="Archive editing actions">
              <button type="button" onClick={() => onEditAction({ kind: isPet(entity) ? 'pet' : 'person', entityId: entity.id, action: 'child' })}>
                {isPet(entity) ? '+ Offspring' : '+ Child'}
              </button>
              <button type="button" onClick={() => onEditAction({ kind: isPet(entity) ? 'pet' : 'person', entityId: entity.id, action: 'partner' })}>+ Partner</button>
              <button
                type="button"
                disabled={!hasRecordedParents}
                title={hasRecordedParents ? undefined : 'No recorded parents'}
                aria-label={hasRecordedParents ? '+ Sibling' : '+ Sibling — no recorded parents'}
                onClick={() => onEditAction({ kind: isPet(entity) ? 'pet' : 'person', entityId: entity.id, action: 'sibling' })}
              >
                + Sibling
              </button>
            </div>
          )}
          <button className="popover-close" type="button" onClick={onClose} aria-label="Close profile details">Close</button>
        </div>
      )}
    </aside>
  )
}

function LineageBranch({
  entityId,
  entities,
  groupByEntity,
  people,
  path,
  pinnedEntityId,
  focusedEntityId,
  recentEntityId,
  familyLineRoles,
  onHover,
  onLeave,
  onActivate,
}: {
  entityId: string
  entities: Map<string, Entity>
  groupByEntity: Map<string, PartnerGroup>
  people: Person[]
  path: Set<string>
  pinnedEntityId: string | null
  focusedEntityId: string | null
  recentEntityId?: string | null
  familyLineRoles: Map<string, FamilyLineProfileRole>
  onHover: (entity: Entity, x: number, y: number) => void
  onLeave: () => void
  onActivate: (entity: Entity) => void
}) {
  const entity = entities.get(entityId)
  if (!entity) return null
  const group = groupByEntity.get(entityId)
  if (!group) {
    const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
    return (
      <div className="lineage-branch">
        <div className="partner-group-row">
          <EntityCard entity={entity} owner={owner} familyLineRole={familyLineRoles.get(entity.id)} pinnedEntityId={pinnedEntityId} focusedEntityId={focusedEntityId} recentEntityId={recentEntityId} onHover={onHover} onLeave={onLeave} onActivate={onActivate} />
        </div>
      </div>
    )
  }
  if (path.has(group.id)) return null
  if (entityId !== group.entryEntityId) return null
  const nextPath = new Set(path).add(group.id)
  const orderedFamilies = [...group.families].sort((left, right) => {
    const position = (family: NormalizedFamily) => family.parentIds.reduce((total, id) => total + (group.layoutSlots[id] ?? 0), 0) / family.parentIds.length
    return position(left) - position(right) || group.families.indexOf(left) - group.families.indexOf(right)
  })
  return (
    <div
      className={`lineage-branch ${group.families.length > 1 ? 'has-multiple-unions' : ''}`}
      data-partner-group={group.id}
      data-center-entity-id={group.centerEntityId}
    >
      <div className="partner-group-row">
        {group.entityIds.map((groupEntityId) => {
          const groupEntity = entities.get(groupEntityId)
          if (!groupEntity) return null
          const owner = isPet(groupEntity) ? people.find((person) => person.id === groupEntity.ownerPersonId) : undefined
          return <EntityCard key={groupEntityId} entity={groupEntity} owner={owner} familyLineRole={familyLineRoles.get(groupEntity.id)} layoutSlot={group.layoutSlots[groupEntityId]} pinnedEntityId={pinnedEntityId} focusedEntityId={focusedEntityId} recentEntityId={recentEntityId} onHover={onHover} onLeave={onLeave} onActivate={onActivate} />
        })}
      </div>
      {group.families.length > 0 && (
        <div className="family-units-row" style={{ paddingTop: group.railDepth * 10 }}>
          {orderedFamilies.map((family) => (
            <div className="family-unit-branch" key={family.id} data-family-id={family.id} data-parent-ids={family.parentIds.join(' ')}>
              <span className="family-anchor" data-family-anchor={family.id} aria-hidden="true" />
              {family.children.length > 0 && (
                <div className="children-row">
                  {sortChildren(family.children).map((child) => (
                    <LineageBranch
                      key={child.entityId}
                      entityId={child.entityId}
                      entities={entities}
                      groupByEntity={groupByEntity}
                      people={people}
                      path={nextPath}
                      pinnedEntityId={pinnedEntityId}
                      focusedEntityId={focusedEntityId}
                      recentEntityId={recentEntityId}
                      familyLineRoles={familyLineRoles}
                      onHover={onHover}
                      onLeave={onLeave}
                      onActivate={onActivate}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PetYearTimeline({
  bands,
  speciesColumns,
  families,
  people,
  pinnedEntityId,
  focusedEntityId,
  recentEntityId,
  onHover,
  onLeave,
  onActivate,
}: {
  bands: PetYearBand[]
  speciesColumns: PetSpeciesColumn[]
  families: NormalizedFamily[]
  people: Person[]
  pinnedEntityId: string | null
  focusedEntityId: string | null
  recentEntityId?: string | null
  onHover: (entity: Entity, x: number, y: number) => void
  onLeave: () => void
  onActivate: (entity: Entity) => void
}) {
  const gridStyle = { gridTemplateColumns: `96px ${speciesColumns.map((column) => `${column.width}px`).join(' ')}` } as CSSProperties
  return (
    <div className="pet-year-timeline" data-testid="pet-year-timeline" style={gridStyle}>
      <span className="pet-timeline-corner" aria-hidden="true" />
      {speciesColumns.map((column) => <h3 className="pet-species-label" data-pet-species-heading={column.key} key={column.key}>{column.label}</h3>)}
      {bands.map((band) => (
        <section className="pet-year-band" data-pet-year={band.key} key={band.key}>
          <h3 className="pet-year-label">{band.label}</h3>
          {speciesColumns.map((column) => (
            <div className="pet-species-year-cell" data-pet-species={column.key} key={column.key}>
              {band.pets.filter((pet) => petSpeciesKey(pet) === column.key).map((pet) => {
                const owner = people.find((person) => person.id === pet.ownerPersonId)
                return <EntityCard key={pet.id} entity={pet} owner={owner} pinnedEntityId={pinnedEntityId} focusedEntityId={focusedEntityId} recentEntityId={recentEntityId} onHover={onHover} onLeave={onLeave} onActivate={onActivate} />
              })}
            </div>
          ))}
        </section>
      ))}
      <div className="pet-family-markers" aria-hidden="true">
        {families.map((family) => <span key={family.id} data-family-id={family.id} data-parent-ids={family.parentIds.join(' ')} />)}
      </div>
    </div>
  )
}

export function LineageGraph({
  mode,
  people,
  families,
  pets,
  petFamilies,
  onOwnerNavigate,
  onPetNavigate,
  focusRequest = null,
  onFocusAcknowledge,
  canEdit = false,
  onEditAction,
  onEntityPatch,
  recentEntityId = null,
  interactionLocked = false,
  onOpenMap,
  fullscreenMode = false,
  onToggleFullscreen,
}: LineageGraphProps) {
  const currentDate = useCurrentDate()
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const pinnedPopoverRef = useRef<HTMLElement>(null)
  const activePointers = useRef(new Map<number, { x: number; y: number }>())
  const gestureRef = useRef<Gesture | null>(null)
  const wheelTimer = useRef<number | null>(null)
  const focusTimer = useRef<number | null>(null)
  const focusRequestRef = useRef<LineageFocusRequest | null>(focusRequest)
  const previousInteractionLocked = useRef(interactionLocked)
  const initialFitComplete = useRef(false)
  const viewportSizeRef = useRef({ width: 0, height: 0 })
  const [view, setView] = useState<ViewState>({ x: 24, y: 24, scale: 0.82 })
  const viewRef = useRef(view)
  const [paths, setPaths] = useState<ConnectorPath[]>([])
  const [hover, setHover] = useState<HoverState | null>(null)
  const [pinnedEntityId, setPinnedEntityId] = useState<string | null>(null)
  const [pinnedPosition, setPinnedPosition] = useState<PinnedPosition | null>(null)
  const [interacting, setInteracting] = useState(false)
  const [programmaticFocus, setProgrammaticFocus] = useState(false)
  const [dismissedFocusRequestId, setDismissedFocusRequestId] = useState<number | null>(null)
  const [profileHighlightFilter, setProfileHighlightFilter] = useState<ProfileHighlightFilter>('set')
  const [lineagePathFilter, setLineagePathFilter] = useState('set')
  const [highlightPreview, setHighlightPreview] = useState<HighlightPreview | null>(null)
  useEffect(() => { viewRef.current = view }, [view])

  useEffect(() => {
    const wasLocked = previousInteractionLocked.current
    previousInteractionLocked.current = interactionLocked
    if (!wasLocked || interactionLocked) return
    const frame = requestAnimationFrame(() => viewportRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [interactionLocked])

  const entities = useMemo<Map<string, Entity>>(
    () => new Map((mode === 'people' ? people : pets).map((entity) => [entity.id, entity])),
    [mode, people, pets],
  )
  const focusedEntityId = focusRequest
    && focusRequest.requestId !== dismissedFocusRequestId
    && entities.has(focusRequest.entityId)
    ? focusRequest.entityId
    : null
  focusRequestRef.current = focusedEntityId && focusRequest ? focusRequest : null
  const pinnedEntity = pinnedEntityId ? entities.get(pinnedEntityId) : undefined
  const normalizedFamilies = useMemo<NormalizedFamily[]>(
    () => mode === 'people'
      ? families.map((family) => ({ id: family.id, parentIds: family.parentIds, children: family.children.map((child) => ({ entityId: child.personId, birthOrder: child.birthOrder })) }))
      : petFamilies.map((family) => ({ id: family.id, parentIds: family.parentPetIds, children: family.children.map((child) => ({ entityId: child.petId, birthOrder: child.birthOrder })) })),
    [mode, families, petFamilies],
  )
  const availableFamilyLines = useMemo(() => mode === 'people' ? familyLineOptions(people) : [], [mode, people])
  const lineageHighlightOptions = useMemo<HighlightOption<string>[]>(() => [
    { value: 'set', label: 'Set' },
    ...availableFamilyLines.map((option) => ({ value: option.key, label: option.label })),
  ], [availableFamilyLines])
  const effectiveProfileHighlight = highlightPreview?.kind === 'profile'
    ? highlightPreview.value
    : highlightPreview?.kind === 'lineage' ? 'set' : profileHighlightFilter
  const effectiveLineagePath = highlightPreview?.kind === 'lineage'
    ? highlightPreview.value
    : highlightPreview?.kind === 'profile' ? 'set' : lineagePathFilter
  const selectedFamilyLine = effectiveLineagePath === 'set' ? '' : effectiveLineagePath
  const familyLineClassification = useMemo<FamilyLineClassification | null>(
    () => mode === 'people' && selectedFamilyLine
      ? classifyFamilyLine(people, families, selectedFamilyLine)
      : null,
    [families, mode, people, selectedFamilyLine],
  )
  const familyLineRoles = useMemo(() => {
    const roles = new Map<string, FamilyLineProfileRole>()
    if (!familyLineClassification) return roles
    people.forEach((person) => {
      roles.set(person.id, familyLineClassification.memberIds.has(person.id)
        ? 'member'
        : familyLineClassification.partnerIds.has(person.id) ? 'partner' : 'none')
    })
    return roles
  }, [familyLineClassification, people])
  const { groups: partnerGroups, groupByEntity } = useMemo(() => buildPartnerGroups(normalizedFamilies), [normalizedFamilies])
  const petYearBands = useMemo(() => buildPetYearBands(pets), [pets])
  const petSpeciesColumns = useMemo(() => buildPetSpeciesColumns(pets, petYearBands), [petYearBands, pets])
  const childIds = useMemo(() => new Set(normalizedFamilies.flatMap((family) => family.children.map((child) => child.entityId))), [normalizedFamilies])
  const pinnedHasRecordedParents = pinnedEntity ? childIds.has(pinnedEntity.id) : false
  const childGroupIds = useMemo(() => new Set([...childIds].map((id) => groupByEntity.get(id)?.id).filter((id): id is string => Boolean(id))), [childIds, groupByEntity])
  const rootGroups = useMemo(() => {
    const roots = partnerGroups.filter((group) => !childGroupIds.has(group.id))
    return roots.length ? roots : partnerGroups.slice(0, 1)
  }, [childGroupIds, partnerGroups])
  const usedIds = useMemo(() => new Set(normalizedFamilies.flatMap((family) => [...family.parentIds, ...family.children.map((child) => child.entityId)])), [normalizedFamilies])
  const standalone = useMemo(() => [...entities.keys()].filter((id) => !usedIds.has(id)), [entities, usedIds])
  const branchUnits = useMemo(() => {
    const countBranch = (group: PartnerGroup, path: Set<string>): number => {
      if (path.has(group.id)) return 1
      const nextPath = new Set(path).add(group.id)
      const childUnits = group.families.reduce((unitTotal, family) => unitTotal + family.children.reduce((total, child) => {
        const childGroup = groupByEntity.get(child.entityId)
        return total + (childGroup ? countBranch(childGroup, nextPath) : 1)
      }, 0), 0)
      return Math.max(group.entityIds.length, childUnits, 1)
    }
    return Math.max(1, rootGroups.reduce((total, group) => total + countBranch(group, new Set()), standalone.length))
  }, [groupByEntity, rootGroups, standalone.length])
  const petTimelineWidth = 96 + petSpeciesColumns.reduce((total, column) => total + column.width, 0) + petSpeciesColumns.length * 48 + 160
  const canvasWidth = mode === 'pets'
    ? Math.max(1160, petTimelineWidth)
    : Math.max(1160, branchUnits * 174 + Math.max(0, rootGroups.length - 1) * 32)

  const focusEntityInView = useCallback((entityId: string, animate = true, scroll = true) => {
    const viewport = viewportRef.current
    const canvas = canvasRef.current
    if (!viewport || !canvas) return false
    const card = [...canvas.querySelectorAll<HTMLElement>('[data-entity-id]')]
      .find((candidate) => candidate.dataset.entityId === entityId)
    if (!card) return false
    const portrait = card.querySelector<HTMLElement>('.portrait-ring') ?? card
    const center = elementCenterInAncestor(portrait, canvas)
    const scale = clampScale(viewport.clientWidth <= 640 ? 1.25 : 1.5)
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const shouldAnimate = animate && !reduceMotion

    if (focusTimer.current) window.clearTimeout(focusTimer.current)
    setInteracting(false)
    setProgrammaticFocus(shouldAnimate)
    setView({
      x: viewport.clientWidth / 2 - center.x * scale,
      y: viewport.clientHeight / 2 - center.y * scale,
      scale,
    })
    if (scroll) viewport.scrollIntoView?.({ behavior: shouldAnimate ? 'smooth' : 'auto', block: 'center' })
    if (shouldAnimate) {
      focusTimer.current = window.setTimeout(() => setProgrammaticFocus(false), 560)
    }
    return true
  }, [])

  const measurePinnedPopover = useCallback(() => {
    const viewport = viewportRef.current
    const canvas = canvasRef.current
    const popover = pinnedPopoverRef.current
    if (!viewport || !canvas || !popover || !pinnedEntityId) return
    const card = [...canvas.querySelectorAll<HTMLElement>('[data-entity-id]')]
      .find((candidate) => candidate.dataset.entityId === pinnedEntityId)
    if (!card) return
    const portrait = card.querySelector<HTMLElement>('.portrait-ring') ?? card
    const viewportRect = viewport.getBoundingClientRect()
    const portraitRect = portrait.getBoundingClientRect()
    const width = popover.offsetWidth
    const height = popover.offsetHeight
    if (!width || !height) return

    const anchorX = portraitRect.left - viewportRect.left + portraitRect.width / 2
    const anchorTop = portraitRect.top - viewportRect.top
    const anchorBottom = portraitRect.bottom - viewportRect.top
    const gap = 17
    const placement: PinnedPosition['placement'] = anchorTop >= height + gap + 8 ? 'above' : 'below'
    const maximumLeft = Math.max(8, viewport.clientWidth - width - 8)
    const left = Math.min(maximumLeft, Math.max(8, anchorX - width / 2))
    const maximumTop = Math.max(8, viewport.clientHeight - height - 8)
    const desiredTop = placement === 'above' ? anchorTop - height - gap : anchorBottom + gap
    const top = Math.min(maximumTop, Math.max(8, desiredTop))
    const arrowLeft = Math.min(width - 22, Math.max(22, anchorX - left))
    const next = { left, top, arrowLeft, placement }
    setPinnedPosition((current) => current
      && Math.abs(current.left - next.left) < 0.5
      && Math.abs(current.top - next.top) < 0.5
      && Math.abs(current.arrowLeft - next.arrowLeft) < 0.5
      && current.placement === next.placement
      ? current
      : next)
  }, [pinnedEntityId])

  const measureConnectors = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const entityMap = new Map([...canvas.querySelectorAll<HTMLElement>('[data-entity-id]')].map((element) => [element.dataset.entityId ?? '', element]))
    const pointInCanvas = (element: HTMLElement, vertical: 'center' | 'top' | 'bottom') => {
      let x = element.offsetLeft + element.offsetWidth / 2
      let y = element.offsetTop + (vertical === 'center' ? element.offsetHeight / 2 : vertical === 'bottom' ? element.offsetHeight : 0)
      let parent = element.offsetParent as HTMLElement | null
      while (parent && parent !== canvas) {
        x += parent.offsetLeft
        y += parent.offsetTop
        parent = parent.offsetParent as HTMLElement | null
      }
      return { x, y }
    }
    const next: ConnectorPath[] = []
    if (mode === 'pets') {
      normalizedFamilies.forEach((family) => {
        const parentPoints = family.parentIds
          .map((id) => entityMap.get(id))
          .filter((element): element is HTMLElement => Boolean(element))
          .map((element) => pointInCanvas(element, 'center'))
        if (!parentPoints.length) return
        const start = parentPoints.length === 1
          ? parentPoints[0]
          : { x: (parentPoints[0].x + parentPoints[1].x) / 2, y: (parentPoints[0].y + parentPoints[1].y) / 2 }
        if (parentPoints.length === 2) next.push({
          id: `${family.id}-union`,
          familyId: family.id,
          kind: 'union',
          parentIds: family.parentIds,
          d: `M ${parentPoints[0].x} ${parentPoints[0].y} L ${parentPoints[1].x} ${parentPoints[1].y}`,
        })
        family.children.forEach((child) => {
          const target = entityMap.get(child.entityId)
          if (!target) return
          const end = pointInCanvas(target, 'top')
          const midY = start.y + (end.y - start.y) / 2
          next.push({
            id: `${family.id}-child-${child.entityId}`,
            familyId: family.id,
            kind: 'child',
            parentIds: family.parentIds,
            childId: child.entityId,
            d: `M ${start.x} ${start.y} V ${midY} H ${end.x} V ${end.y}`,
          })
        })
      })
      setPaths(next)
      return
    }
    const anchors = [...canvas.querySelectorAll<HTMLElement>('[data-family-anchor]')]
    anchors.forEach((anchor) => {
      const family = normalizedFamilies.find((item) => item.id === anchor.dataset.familyAnchor)
      if (!family) return
      const parentElements = family.parentIds.map((id) => entityMap.get(id)).filter((element): element is HTMLElement => Boolean(element))
      const parentPoints = parentElements.map((element) => pointInCanvas(element, 'center'))
      if (!parentPoints.length) return
      let start = parentPoints.length === 1
        ? parentPoints[0]
        : { x: (parentPoints[0].x + parentPoints[1].x) / 2, y: (parentPoints[0].y + parentPoints[1].y) / 2 }
      if (parentPoints.length === 2) {
        const row = parentElements[0].closest('.partner-group-row')
        const sameRow = row && row === parentElements[1].closest('.partner-group-row')
        const leftX = Math.min(parentPoints[0].x, parentPoints[1].x)
        const rightX = Math.max(parentPoints[0].x, parentPoints[1].x)
        const blockers = sameRow
          ? [...row.querySelectorAll<HTMLElement>(':scope > [data-entity-id]')]
              .filter((element) => !parentElements.includes(element))
              .map((element) => pointInCanvas(element, 'center'))
              .filter((point) => point.x > leftX && point.x < rightX)
          : []
        const midpointX = (parentPoints[0].x + parentPoints[1].x) / 2
        let firstHalf = `M ${parentPoints[0].x} ${parentPoints[0].y} H ${midpointX}`
        let secondHalf = `M ${midpointX} ${parentPoints[1].y} H ${parentPoints[1].x}`
        if (blockers.length) {
          const bottomPoints = parentElements.map((element) => pointInCanvas(element, 'bottom'))
          const railY = Math.max(bottomPoints[0].y, bottomPoints[1].y) + 10 + blockers.length * 10
          firstHalf = `M ${bottomPoints[0].x} ${bottomPoints[0].y} V ${railY} H ${midpointX}`
          secondHalf = `M ${midpointX} ${railY} H ${bottomPoints[1].x} V ${bottomPoints[1].y}`
          start = { x: (bottomPoints[0].x + bottomPoints[1].x) / 2, y: railY }
        }
        next.push(
          { id: `${family.id}-union-1`, familyId: family.id, kind: 'union', parentIds: family.parentIds, sourceParentId: family.parentIds[0], d: firstHalf },
          { id: `${family.id}-union-2`, familyId: family.id, kind: 'union', parentIds: family.parentIds, sourceParentId: family.parentIds[1], d: secondHalf },
        )
      }
      const anchorPoint = pointInCanvas(anchor, 'center')
      if (family.children.length > 0) next.push({
        id: `${family.id}-stem`,
        familyId: family.id,
        kind: 'family-stem',
        parentIds: family.parentIds,
        d: `M ${start.x} ${start.y} V ${anchorPoint.y} H ${anchorPoint.x}`,
      })
      family.children.forEach((child) => {
        const target = entityMap.get(child.entityId)
        if (!target) return
        const end = pointInCanvas(target, 'top')
        const midY = anchorPoint.y + Math.max(34, (end.y - anchorPoint.y) * 0.42)
        next.push({
          id: `${family.id}-child-${child.entityId}`,
          familyId: family.id,
          kind: 'child',
          parentIds: family.parentIds,
          childId: child.entityId,
          d: `M ${anchorPoint.x} ${anchorPoint.y} V ${midY} H ${end.x} V ${end.y}`,
        })
      })
    })
    setPaths(next)
  }, [mode, normalizedFamilies])

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measureConnectors)
    const observer = new ResizeObserver(() => requestAnimationFrame(measureConnectors))
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [measureConnectors, entities])

  useLayoutEffect(() => {
    if (!pinnedEntityId) return
    const frame = requestAnimationFrame(measurePinnedPopover)
    const observer = new ResizeObserver(() => requestAnimationFrame(measurePinnedPopover))
    if (viewportRef.current) observer.observe(viewportRef.current)
    if (pinnedPopoverRef.current) observer.observe(pinnedPopoverRef.current)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [entities, measurePinnedPopover, paths, pinnedEntityId, view])

  useLayoutEffect(() => {
    if (!focusedEntityId || interactionLocked) return
    const frame = requestAnimationFrame(() => focusEntityInView(focusedEntityId))
    return () => cancelAnimationFrame(frame)
  }, [focusEntityInView, focusRequest?.requestId, focusedEntityId, interactionLocked])

  useEffect(() => () => {
    if (focusTimer.current) window.clearTimeout(focusTimer.current)
  }, [])

  const resetView = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const scale = Math.min(1, Math.max(MIN_SCALE, (viewport.clientWidth - 36) / canvasWidth))
    const renderedWidth = canvasWidth * scale
    const x = renderedWidth <= viewport.clientWidth - 36 ? 18 : (viewport.clientWidth - renderedWidth) / 2
    setView({ x, y: 20, scale })
  }, [canvasWidth])

  useLayoutEffect(() => {
    if (initialFitComplete.current || focusRequestRef.current) return
    resetView()
    initialFitComplete.current = true
    const viewport = viewportRef.current
    if (viewport) viewportSizeRef.current = { width: viewport.clientWidth, height: viewport.clientHeight }
  }, [resetView])

  useEffect(() => {
    const onResize = () => {
      const viewport = viewportRef.current
      if (!viewport) return
      const activeFocus = focusRequestRef.current
      if (activeFocus) focusEntityInView(activeFocus.entityId, false, false)
      else {
        const previous = viewportSizeRef.current
        if (previous.width && previous.height) {
          setView((current) => ({
            ...current,
            x: current.x + (viewport.clientWidth - previous.width) / 2,
            y: current.y + (viewport.clientHeight - previous.height) / 2,
          }))
        }
      }
      viewportSizeRef.current = { width: viewport.clientWidth, height: viewport.clientHeight }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [focusEntityInView])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (interactionLocked) return
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const pointX = event.clientX - rect.left
      const pointY = event.clientY - rect.top
      setInteracting(true)
      setView((current) => {
        const scale = clampScale(current.scale * Math.exp(-event.deltaY * 0.0015))
        const worldX = (pointX - current.x) / current.scale
        const worldY = (pointY - current.y) / current.scale
        return { x: pointX - worldX * scale, y: pointY - worldY * scale, scale }
      })
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => setInteracting(false), 120)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      viewport.removeEventListener('wheel', onWheel)
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current)
    }
  }, [interactionLocked])

  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const pointX = viewport.clientWidth / 2
    const pointY = viewport.clientHeight / 2
    setView((current) => {
      const scale = clampScale(current.scale * factor)
      const worldX = (pointX - current.x) / current.scale
      const worldY = (pointY - current.y) / current.scale
      return { x: pointX - worldX * scale, y: pointY - worldY * scale, scale }
    })
  }

  const beginPinch = () => {
    const viewport = viewportRef.current
    const points = [...activePointers.current.values()]
    if (!viewport || points.length < 2) return
    const [a, b] = points
    const rect = viewport.getBoundingClientRect()
    const midX = (a.x + b.x) / 2 - rect.left
    const midY = (a.y + b.y) / 2 - rect.top
    const current = viewRef.current
    gestureRef.current = {
      kind: 'pinch',
      startDistance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      startScale: current.scale,
      worldX: (midX - current.x) / current.scale,
      worldY: (midY - current.y) / current.scale,
    }
  }

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setInteracting(true)
    if (activePointers.current.size >= 2) beginPinch()
    else {
      const current = viewRef.current
      gestureRef.current = { kind: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: current.x, originY: current.y }
    }
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activePointers.current.has(event.pointerId)) return
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const gesture = gestureRef.current
    if (activePointers.current.size >= 2 && gesture?.kind !== 'pinch') beginPinch()
    if (gestureRef.current?.kind === 'pinch') {
      const viewport = viewportRef.current
      const points = [...activePointers.current.values()]
      if (!viewport || points.length < 2) return
      const [a, b] = points
      const rect = viewport.getBoundingClientRect()
      const midX = (a.x + b.x) / 2 - rect.left
      const midY = (a.y + b.y) / 2 - rect.top
      const pinch = gestureRef.current
      const scale = clampScale(pinch.startScale * Math.hypot(b.x - a.x, b.y - a.y) / pinch.startDistance)
      setView({ x: midX - pinch.worldX * scale, y: midY - pinch.worldY * scale, scale })
    } else if (gestureRef.current?.kind === 'pan' && gestureRef.current.pointerId === event.pointerId) {
      const pan = gestureRef.current
      setView((current) => ({ ...current, x: pan.originX + event.clientX - pan.startX, y: pan.originY + event.clientY - pan.startY }))
    }
  }
  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(event.pointerId)
    if (activePointers.current.size === 1) {
      const [remaining] = [...activePointers.current.entries()]
      const current = viewRef.current
      gestureRef.current = { kind: 'pan', pointerId: remaining[0], startX: remaining[1].x, startY: remaining[1].y, originX: current.x, originY: current.y }
    } else if (activePointers.current.size === 0) {
      gestureRef.current = null
      setInteracting(false)
    }
  }
  const onHover = (entity: Entity, x: number, y: number) => setHover({ entity, x, y })
  const onLeave = () => setHover(null)
  const onActivate = (entity: Entity) => {
    if (focusRequest && focusedEntityId === entity.id) {
      setDismissedFocusRequestId(focusRequest.requestId)
      onFocusAcknowledge?.(focusRequest.requestId)
    }
    setPinnedPosition(null)
    setPinnedEntityId((current) => current === entity.id ? null : entity.id)
  }

  const connectorFamilyLineRole = (path: ConnectorPath): 'carrier' | 'partner' | 'black' | undefined => {
    if (!familyLineClassification) return undefined
    const carrierId = familyLineClassification.carrierByFamilyId.get(path.familyId)
    if (path.kind === 'union') {
      if (!carrierId || !path.sourceParentId) return 'black'
      return path.sourceParentId === carrierId ? 'carrier' : 'partner'
    }
    if (path.kind === 'family-stem') {
      return familyLineClassification.continuingFamilyIds.has(path.familyId) ? 'carrier' : 'black'
    }
    return path.childId && familyLineClassification.continuingChildIds.has(path.childId) ? 'carrier' : 'black'
  }

  if (entities.size === 0) {
    return <div className="empty-lineage"><span className="empty-orbit" aria-hidden="true">✦</span><h2>No pets have been added yet</h2><p>Log in to the dashboard to add pets, owners, and lineage connections.</p></div>
  }

  return (
    <section className={`lineage-section ${selectedFamilyLine ? 'highlight-lineage' : `highlight-${effectiveProfileHighlight}`}`} aria-label={mode === 'people' ? 'Interactive family tree' : 'Interactive pet lineage'}>
      <div className="graph-toolbar">
        <span>{mode === 'people' ? 'Family' : 'Pets'} · drag, scroll, or pinch to explore</span>
        <div>
          <button type="button" onClick={() => zoomBy(1 / 1.15)} aria-label="Zoom out" disabled={interactionLocked}>−</button>
          <button type="button" onClick={() => zoomBy(1.15)} aria-label="Zoom in" disabled={interactionLocked}>+</button>
          <button type="button" onClick={resetView} aria-label="Reset and fit graph" disabled={interactionLocked}>⌂</button>
        </div>
      </div>
      <div
        className={`lineage-viewport ${interactionLocked ? 'is-locked ' : ''}${interacting ? 'is-interacting ' : ''}${programmaticFocus ? 'is-owner-focusing' : ''}`}
        data-testid="lineage-viewport"
        ref={viewportRef}
        role="group"
        tabIndex={interactionLocked ? -1 : 0}
        aria-label={interactionLocked ? 'Lineage map preview. Open the map to explore.' : 'Lineage canvas. Use arrow keys, drag, mouse wheel, or pinch to explore.'}
        onPointerDown={interactionLocked ? undefined : startDrag}
        onPointerMove={interactionLocked ? undefined : moveDrag}
        onPointerUp={interactionLocked ? undefined : stopDrag}
        onPointerCancel={interactionLocked ? undefined : stopDrag}
        onKeyDown={(event) => {
          if (interactionLocked) return
          const target = event.target as HTMLElement
          if (target.closest('.highlight-control, input, select, textarea, [contenteditable="true"]')) return
          const movements: Record<string, { x: number; y: number }> = { ArrowLeft: { x: 44, y: 0 }, ArrowRight: { x: -44, y: 0 }, ArrowUp: { x: 0, y: 44 }, ArrowDown: { x: 0, y: -44 } }
          if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.15); return }
          if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.15); return }
          if (event.key === '0') { event.preventDefault(); resetView(); return }
          const movement = movements[event.key]
          if (!movement) return
          event.preventDefault()
          setView((current) => ({ ...current, x: current.x + movement.x, y: current.y + movement.y }))
        }}
      >
        <div
          className="highlight-control"
          aria-hidden={interactionLocked || undefined}
          inert={interactionLocked || undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span className="highlight-control-title">Highlight</span>
          <HighlightDropdown
            label="Status & gender"
            ariaLabel="Status and gender highlight"
            value={profileHighlightFilter}
            options={PROFILE_HIGHLIGHT_OPTIONS}
            disabled={interactionLocked}
            onPreview={(value) => setHighlightPreview(value === null ? null : { kind: 'profile', value })}
            onCommit={(value) => {
              setProfileHighlightFilter(value)
              if (value !== 'set') setLineagePathFilter('set')
            }}
          />
          {mode === 'people' && availableFamilyLines.length > 0 && (
            <HighlightDropdown
              label="Lineage path"
              value={lineagePathFilter}
              options={lineageHighlightOptions}
              disabled={interactionLocked}
              onPreview={(value) => setHighlightPreview(value === null ? null : { kind: 'lineage', value })}
              onCommit={(value) => {
                setLineagePathFilter(value)
                if (value !== 'set') setProfileHighlightFilter('set')
              }}
            />
          )}
        </div>
        <div className="lineage-canvas" data-testid="lineage-canvas" ref={canvasRef} inert={interactionLocked || undefined} aria-hidden={interactionLocked || undefined} style={{ width: canvasWidth, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg className="connector-layer" aria-hidden="true">
            {paths.map((path) => (
              <path
                key={path.id}
                d={path.d}
                data-family-connector={path.familyId}
                data-connector-kind={path.kind}
                data-parent-ids={path.parentIds.join(' ')}
                data-source-parent-id={path.sourceParentId}
                data-child-id={path.childId}
                data-lineage-path-role={connectorFamilyLineRole(path)}
              />
            ))}
          </svg>
          {mode === 'pets' ? (
            <PetYearTimeline bands={petYearBands} speciesColumns={petSpeciesColumns} families={normalizedFamilies} people={people} pinnedEntityId={pinnedEntityId} focusedEntityId={focusedEntityId} recentEntityId={recentEntityId} onHover={onHover} onLeave={onLeave} onActivate={onActivate} />
          ) : (
            <div className="root-forest">
              {rootGroups.map((group) => <LineageBranch key={group.id} entityId={group.entryEntityId} entities={entities} groupByEntity={groupByEntity} people={people} path={new Set()} familyLineRoles={familyLineRoles} pinnedEntityId={pinnedEntityId} focusedEntityId={focusedEntityId} recentEntityId={recentEntityId} onHover={onHover} onLeave={onLeave} onActivate={onActivate} />)}
            </div>
          )}
          {mode === 'people' && standalone.length > 0 && (
            <div className="standalone-row">
              {standalone.map((id) => {
                const entity = entities.get(id)
                if (!entity) return null
                const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
                return <EntityCard key={id} entity={entity} owner={owner} familyLineRole={familyLineRoles.get(entity.id)} pinnedEntityId={pinnedEntityId} focusedEntityId={focusedEntityId} recentEntityId={recentEntityId} onHover={onHover} onLeave={onLeave} onActivate={onActivate} />
              })}
            </div>
          )}
        </div>
        {pinnedEntity && (
          <DetailPopover
            key={pinnedEntity.id}
            entity={pinnedEntity}
            people={people}
            pets={pets}
            today={currentDate}
            pinnedPosition={pinnedPosition}
            popoverRef={pinnedPopoverRef}
            onClose={() => {
              setPinnedEntityId(null)
              setPinnedPosition(null)
            }}
            onOwnerNavigate={onOwnerNavigate}
            onPetNavigate={onPetNavigate}
            canEdit={canEdit}
            hasRecordedParents={pinnedHasRecordedParents}
            onEditAction={onEditAction}
            onEntityPatch={onEntityPatch}
          />
        )}
        {onOpenMap && (
          <div className="map-access-gate" inert={!interactionLocked || undefined} aria-hidden={!interactionLocked || undefined}>
            <button type="button" onClick={onOpenMap} aria-label={`Open ${mode === 'people' ? 'Family' : 'Pets'} map`} disabled={!interactionLocked}>
              <span>Open map</span>
              <small>Explore {mode === 'people' ? 'the family branches' : 'the pet lineage'}</small>
            </button>
          </div>
        )}
        {onToggleFullscreen && !interactionLocked && (
          <button
            type="button"
            className="fullscreen-map-control"
            aria-label={fullscreenMode ? 'Exit fullscreen map' : 'Enter fullscreen map'}
            title={fullscreenMode ? 'Exit fullscreen' : 'Enter fullscreen'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => onToggleFullscreen(event.currentTarget)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {fullscreenMode ? (
                <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
              ) : (
                <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
              )}
            </svg>
          </button>
        )}
      </div>
      <p className="graph-help">{interactionLocked ? 'Open the map when you are ready to explore' : 'Hover for quick details · Select a portrait for its full profile and links'}</p>
      {hover && hover.entity.id !== pinnedEntityId && (
        <DetailPopover key={hover.entity.id} entity={hover.entity} people={people} pets={pets} today={currentDate} hover={hover} />
      )}
    </section>
  )
}
