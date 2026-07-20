import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  bornValue,
  calculateAge,
  dateSortKey,
  displayValue,
  isSafeExternalUrl,
  portraitCandidates,
  sortChildren,
  yearFromDate,
} from '../lib/data'
import { useCurrentDate } from '../hooks/useCurrentDate'
import type { FamilyUnit, Person, Pet, PetFamilyUnit } from '../types'

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

interface LineageGraphProps {
  mode: 'people' | 'pets'
  people: Person[]
  families: FamilyUnit[]
  pets: Pet[]
  petFamilies: PetFamilyUnit[]
}

interface TooltipState {
  entity: Entity
  x: number
  y: number
  pinned: boolean
}

type Gesture =
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'pinch'; startDistance: number; startScale: number; worldX: number; worldY: number }

const MIN_SCALE = 0.25
const MAX_SCALE = 2.5

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
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
  onHover,
  onLeave,
  onTouch,
}: {
  entity: Entity
  owner?: Person
  layoutSlot?: number
  onHover: (entity: Entity, x: number, y: number) => void
  onLeave: () => void
  onTouch: (entity: Entity) => void
}) {
  const safeLinks = entity.links.filter((link) => link.trim() && isSafeExternalUrl(link))
  const openLink = (link: string) => {
    window.open(link, '_blank', 'noopener,noreferrer')
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen' || safeLinks.length !== 1) onTouch(entity)
    else openLink(safeLinks[0])
  }
  return (
    <button
      className={`entity-card ${isPet(entity) ? 'pet-card' : ''}`}
      type="button"
      data-entity-id={entity.id}
      data-layout-slot={layoutSlot}
      aria-label={`${displayValue(entity.displayName)} details${safeLinks.length === 1 ? ', opens story link' : safeLinks.length > 1 ? `, ${safeLinks.length} story links available` : ''}`}
      onPointerEnter={(event) => onHover(entity, event.clientX, event.clientY)}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') onHover(entity, event.clientX, event.clientY)
      }}
      onPointerLeave={onLeave}
      onPointerUp={handlePointerUp}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (safeLinks.length === 1) openLink(safeLinks[0])
          else onTouch(entity)
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

function DetailPopover({ tooltip, people, today, onClose }: { tooltip: TooltipState; people: Person[]; today: Date; onClose: () => void }) {
  const { entity, pinned } = tooltip
  const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
  const left = Math.min(window.innerWidth - 254, Math.max(16, tooltip.x + 18))
  const top = Math.min(window.innerHeight - 300, Math.max(82, tooltip.y + 18))
  const style = pinned ? undefined : ({ left, top } as CSSProperties)
  const safeLinks = entity.links.filter((link) => link.trim() && isSafeExternalUrl(link))
  const age = calculateAge(entity.birthDate, today, entity.deathDate, entity.status, isPet(entity))
  const diedRows = entity.status === 'dead' ? [['Died', displayValue(entity.deathDate)]] : []
  const rows = isPet(entity)
    ? [
        ['Species', displayValue(entity.species)],
        ['Breed', displayValue(entity.breed)],
        ['Age', age],
        ['Born', bornValue(entity)],
        ...diedRows,
        ['Gender', displayValue(entity.gender)],
        ['Status', entity.status === 'dead' ? 'Dead' : 'Alive'],
        ['Owner', displayValue(owner?.displayName)],
        ['Personality', displayValue(entity.personality)],
      ]
    : [
        ['Age', age],
        ['Born', bornValue(entity)],
        ...diedRows,
        ['Gender', displayValue(entity.gender)],
        ['Status', entity.status === 'dead' ? 'Dead' : 'Alive'],
        ['Personality', displayValue(entity.personality)],
      ]

  return (
    <aside className={`detail-popover ${pinned ? 'detail-pinned' : ''}`} style={style} role="dialog" aria-label={`${entity.displayName} details`}>
      {pinned && <button className="popover-close" type="button" onClick={onClose} aria-label="Close details">×</button>}
      <span className="portrait-number" aria-label={`Portrait number ${entity.portraitNumber}`}>{entity.portraitNumber}</span>
      <span className="popover-kicker">{displayValue(entity.relationshipLabel)}</span>
      <h3>{displayValue(entity.displayName)}</h3>
      {!isPet(entity) && entity.nickname && <p className="nickname">“{entity.nickname}”</p>}
      <dl>
        {rows.map(([label, value]) => (
          <div key={String(label)}><dt>{label}</dt><dd>{String(value)}</dd></div>
        ))}
      </dl>
      {entity.biography && <p className="popover-bio">{entity.biography}</p>}
      {pinned && safeLinks.length > 0 && (
        <div className="story-links" aria-label="Profile links">
          {safeLinks.map((link, index) => (
            <a className="story-link" href={link} target="_blank" rel="noopener noreferrer" key={`${link}-${index}`}>Visit {index + 1}</a>
          ))}
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
  onHover,
  onLeave,
  onTouch,
}: {
  entityId: string
  entities: Map<string, Entity>
  groupByEntity: Map<string, PartnerGroup>
  people: Person[]
  path: Set<string>
  onHover: (entity: Entity, x: number, y: number) => void
  onLeave: () => void
  onTouch: (entity: Entity) => void
}) {
  const entity = entities.get(entityId)
  if (!entity) return null
  const group = groupByEntity.get(entityId)
  if (!group) {
    const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
    return (
      <div className="lineage-branch">
        <div className="partner-group-row">
          <EntityCard entity={entity} owner={owner} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />
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
          return <EntityCard key={groupEntityId} entity={groupEntity} owner={owner} layoutSlot={group.layoutSlots[groupEntityId]} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />
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
                      onHover={onHover}
                      onLeave={onLeave}
                      onTouch={onTouch}
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
  onHover,
  onLeave,
  onTouch,
}: {
  bands: PetYearBand[]
  speciesColumns: PetSpeciesColumn[]
  families: NormalizedFamily[]
  people: Person[]
  onHover: (entity: Entity, x: number, y: number) => void
  onLeave: () => void
  onTouch: (entity: Entity) => void
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
                return <EntityCard key={pet.id} entity={pet} owner={owner} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />
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

export function LineageGraph({ mode, people, families, pets, petFamilies }: LineageGraphProps) {
  const currentDate = useCurrentDate()
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const activePointers = useRef(new Map<number, { x: number; y: number }>())
  const gestureRef = useRef<Gesture | null>(null)
  const wheelTimer = useRef<number | null>(null)
  const [view, setView] = useState<ViewState>({ x: 24, y: 24, scale: 0.82 })
  const viewRef = useRef(view)
  const [paths, setPaths] = useState<ConnectorPath[]>([])
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [interacting, setInteracting] = useState(false)
  useEffect(() => { viewRef.current = view }, [view])

  const entities = useMemo<Map<string, Entity>>(
    () => new Map((mode === 'people' ? people : pets).map((entity) => [entity.id, entity])),
    [mode, people, pets],
  )
  const normalizedFamilies = useMemo<NormalizedFamily[]>(
    () => mode === 'people'
      ? families.map((family) => ({ id: family.id, parentIds: family.parentIds, children: family.children.map((child) => ({ entityId: child.personId, birthOrder: child.birthOrder })) }))
      : petFamilies.map((family) => ({ id: family.id, parentIds: family.parentPetIds, children: family.children.map((child) => ({ entityId: child.petId, birthOrder: child.birthOrder })) })),
    [mode, families, petFamilies],
  )
  const { groups: partnerGroups, groupByEntity } = useMemo(() => buildPartnerGroups(normalizedFamilies), [normalizedFamilies])
  const petYearBands = useMemo(() => buildPetYearBands(pets), [pets])
  const petSpeciesColumns = useMemo(() => buildPetSpeciesColumns(pets, petYearBands), [petYearBands, pets])
  const childIds = useMemo(() => new Set(normalizedFamilies.flatMap((family) => family.children.map((child) => child.entityId))), [normalizedFamilies])
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
        let d = `M ${parentPoints[0].x} ${parentPoints[0].y} H ${parentPoints[1].x}`
        if (blockers.length) {
          const bottomPoints = parentElements.map((element) => pointInCanvas(element, 'bottom'))
          const railY = Math.max(bottomPoints[0].y, bottomPoints[1].y) + 10 + blockers.length * 10
          d = `M ${bottomPoints[0].x} ${bottomPoints[0].y} V ${railY} H ${bottomPoints[1].x} V ${bottomPoints[1].y}`
          start = { x: (bottomPoints[0].x + bottomPoints[1].x) / 2, y: railY }
        }
        next.push({ id: `${family.id}-union`, familyId: family.id, kind: 'union', parentIds: family.parentIds, d })
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

  const resetView = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const scale = Math.min(1, Math.max(MIN_SCALE, (viewport.clientWidth - 36) / canvasWidth))
    const renderedWidth = canvasWidth * scale
    const x = renderedWidth <= viewport.clientWidth - 36 ? 18 : (viewport.clientWidth - renderedWidth) / 2
    setView({ x, y: 20, scale })
  }, [canvasWidth])

  useEffect(() => {
    resetView()
    const onResize = () => resetView()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [resetView, mode])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
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
  }, [])

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
  const onHover = (entity: Entity, x: number, y: number) => setTooltip((current) => current?.pinned ? current : { entity, x, y, pinned: false })
  const onLeave = () => setTooltip((current) => current?.pinned ? current : null)
  const onTouch = (entity: Entity) => setTooltip({ entity, x: window.innerWidth / 2, y: window.innerHeight / 2, pinned: true })

  if (entities.size === 0) {
    return <div className="empty-lineage"><span className="empty-orbit" aria-hidden="true">✦</span><h2>No pets have been added yet</h2><p>Log in to the dashboard to add pets, owners, and lineage connections.</p></div>
  }

  return (
    <section className="lineage-section" aria-label={mode === 'people' ? 'Interactive family tree' : 'Interactive pet lineage'}>
      <div className="graph-toolbar">
        <span>{mode === 'people' ? 'Family' : 'Pets'} · drag, scroll, or pinch to explore</span>
        <div>
          <button type="button" onClick={() => zoomBy(1 / 1.15)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => zoomBy(1.15)} aria-label="Zoom in">+</button>
          <button type="button" onClick={resetView} aria-label="Reset and fit graph">⌂</button>
        </div>
      </div>
      <div
        className={`lineage-viewport ${interacting ? 'is-interacting' : ''}`}
        data-testid="lineage-viewport"
        ref={viewportRef}
        role="group"
        tabIndex={0}
        aria-label="Lineage canvas. Use arrow keys, drag, mouse wheel, or pinch to explore."
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onKeyDown={(event) => {
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
        <div className="lineage-canvas" data-testid="lineage-canvas" ref={canvasRef} style={{ width: canvasWidth, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg className="connector-layer" aria-hidden="true">
            {paths.map((path) => (
              <path
                key={path.id}
                d={path.d}
                data-family-connector={path.familyId}
                data-connector-kind={path.kind}
                data-parent-ids={path.parentIds.join(' ')}
              />
            ))}
          </svg>
          {mode === 'pets' ? (
            <PetYearTimeline bands={petYearBands} speciesColumns={petSpeciesColumns} families={normalizedFamilies} people={people} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />
          ) : (
            <div className="root-forest">
              {rootGroups.map((group) => <LineageBranch key={group.id} entityId={group.entryEntityId} entities={entities} groupByEntity={groupByEntity} people={people} path={new Set()} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />)}
            </div>
          )}
          {mode === 'people' && standalone.length > 0 && (
            <div className="standalone-row">
              {standalone.map((id) => {
                const entity = entities.get(id)
                if (!entity) return null
                const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
                return <EntityCard key={id} entity={entity} owner={owner} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />
              })}
            </div>
          )}
        </div>
      </div>
      <p className="graph-help">Hover for details · Select a portrait to open its story when a link exists</p>
      {tooltip && <DetailPopover tooltip={tooltip} people={people} today={currentDate} onClose={() => setTooltip(null)} />}
    </section>
  )
}
