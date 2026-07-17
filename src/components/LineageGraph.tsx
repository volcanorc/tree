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
import { calculateAge, displayValue, isSafeExternalUrl, resolvePortrait, sortChildren } from '../lib/data'
import type { FamilyUnit, Person, Pet, PetFamilyUnit } from '../types'

type Entity = Person | Pet

interface NormalizedFamily {
  id: string
  parentIds: string[]
  children: Array<{ entityId: string; birthOrder: number }>
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

function isPet(entity: Entity): entity is Pet {
  return 'species' in entity
}

function EntityCard({
  entity,
  owner,
  onHover,
  onLeave,
  onTouch,
}: {
  entity: Entity
  owner?: Person
  onHover: (entity: Entity, x: number, y: number) => void
  onLeave: () => void
  onTouch: (entity: Entity) => void
}) {
  const portrait = resolvePortrait(entity.portrait)
  const openLink = () => {
    if (entity.link && isSafeExternalUrl(entity.link)) {
      window.open(entity.link, '_blank', 'noopener,noreferrer')
    }
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') onTouch(entity)
    else openLink()
  }

  return (
    <button
      className={`entity-card ${isPet(entity) ? 'pet-card' : ''}`}
      type="button"
      data-entity-id={entity.id}
      aria-label={`${displayValue(entity.displayName)} details${entity.link ? ', opens story link' : ''}`}
      onPointerEnter={(event) => onHover(entity, event.clientX, event.clientY)}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') onHover(entity, event.clientX, event.clientY)
      }}
      onPointerLeave={onLeave}
      onPointerUp={handlePointerUp}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && entity.link) {
          event.preventDefault()
          openLink()
        }
      }}
    >
      <span className="portrait-ring">
        {portrait ? (
          <img src={portrait} alt="" loading="lazy" />
        ) : (
          <span className="portrait-fallback" aria-hidden="true">
            <span className="portrait-head" />
            <span className="portrait-body" />
            <span className="portrait-initial">{entity.displayName.trim().charAt(0) || '?'}</span>
          </span>
        )}
      </span>
      <span className="entity-name">{displayValue(entity.displayName)}</span>
      <span className="entity-role">
        {isPet(entity)
          ? displayValue(entity.species || entity.relationshipLabel)
          : displayValue(entity.relationshipLabel)}
      </span>
      {owner && <span className="entity-owner">with {owner.displayName}</span>}
    </button>
  )
}

function DetailPopover({ tooltip, people, onClose }: { tooltip: TooltipState; people: Person[]; onClose: () => void }) {
  const { entity, pinned } = tooltip
  const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
  const left = Math.min(window.innerWidth - 254, Math.max(16, tooltip.x + 18))
  const top = Math.min(window.innerHeight - 300, Math.max(82, tooltip.y + 18))
  const style = pinned ? undefined : ({ left, top } as CSSProperties)
  const rows = isPet(entity)
    ? [
        ['Species', displayValue(entity.species)],
        ['Breed', displayValue(entity.breed)],
        ['Age', calculateAge(entity.birthDate, entity.ageOverride)],
        ['Born', displayValue(entity.birthDate)],
        ['Gender', displayValue(entity.gender)],
        ['Owner', displayValue(owner?.displayName)],
        ['Personality', displayValue(entity.personality)],
      ]
    : [
        ['Age', calculateAge(entity.birthDate, entity.ageOverride)],
        ['Born', displayValue(entity.birthDate)],
        ['Gender', displayValue(entity.gender)],
        ['Personality', displayValue(entity.personality)],
      ]

  return (
    <aside className={`detail-popover ${pinned ? 'detail-pinned' : ''}`} style={style} role="dialog" aria-label={`${entity.displayName} details`}>
      {pinned && <button className="popover-close" type="button" onClick={onClose} aria-label="Close details">×</button>}
      <span className="popover-kicker">{displayValue(entity.relationshipLabel)}</span>
      <h3>{displayValue(entity.displayName)}</h3>
      {!isPet(entity) && entity.nickname && <p className="nickname">“{entity.nickname}”</p>}
      <dl>
        {rows.map(([label, value]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
      {entity.biography && <p className="popover-bio">{entity.biography}</p>}
      {pinned && entity.link && isSafeExternalUrl(entity.link) && (
        <a className="story-link" href={entity.link} target="_blank" rel="noreferrer">Open story ↗</a>
      )}
    </aside>
  )
}

function LineageBranch({
  entityId,
  entities,
  families,
  people,
  path,
  onHover,
  onLeave,
  onTouch,
}: {
  entityId: string
  entities: Map<string, Entity>
  families: NormalizedFamily[]
  people: Person[]
  path: Set<string>
  onHover: (entity: Entity, x: number, y: number) => void
  onLeave: () => void
  onTouch: (entity: Entity) => void
}) {
  const entity = entities.get(entityId)
  if (!entity || path.has(entityId)) return null
  const nextPath = new Set(path).add(entityId)
  const family = families.find((candidate) => candidate.parentIds.includes(entityId))
  const partnerIds = family?.parentIds.filter((id) => id !== entityId) ?? []
  const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
  return (
    <div className="lineage-branch">
      <div className="parent-unit">
        <EntityCard entity={entity} owner={owner} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />
        {partnerIds.map((partnerId) => {
          const partner = entities.get(partnerId)
          if (!partner) return null
          const partnerOwner = isPet(partner) ? people.find((person) => person.id === partner.ownerPersonId) : undefined
          return <EntityCard key={partnerId} entity={partner} owner={partnerOwner} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />
        })}
        {family && <span className="family-anchor" data-family-anchor={family.id} aria-hidden="true" />}
      </div>
      {family && family.children.length > 0 && (
        <div className="children-row">
          {sortChildren(family.children).map((child) => (
            <LineageBranch
              key={child.entityId}
              entityId={child.entityId}
              entities={entities}
              families={families}
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
  )
}

export function LineageGraph({ mode, people, families, pets, petFamilies }: LineageGraphProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null)
  const [view, setView] = useState({ x: 24, y: 24, scale: 0.82 })
  const [paths, setPaths] = useState<string[]>([])
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

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

  const childIds = useMemo(() => new Set(normalizedFamilies.flatMap((family) => family.children.map((child) => child.entityId))), [normalizedFamilies])
  const roots = useMemo(() => {
    const rootFamilies = normalizedFamilies.filter((family) => family.parentIds.every((id) => !childIds.has(id)))
    const rootIds = rootFamilies.map((family) => family.parentIds[0]).filter(Boolean)
    if (rootIds.length) return rootIds
    return [...entities.keys()].filter((id) => !childIds.has(id)).slice(0, 1)
  }, [childIds, entities, normalizedFamilies])
  const usedIds = useMemo(() => new Set(normalizedFamilies.flatMap((family) => [...family.parentIds, ...family.children.map((child) => child.entityId)])), [normalizedFamilies])
  const standalone = useMemo(() => [...entities.keys()].filter((id) => !usedIds.has(id)), [entities, usedIds])
  const branchUnits = useMemo(() => {
    const countBranch = (entityId: string, path: Set<string>): number => {
      if (path.has(entityId)) return 1
      const family = normalizedFamilies.find((candidate) => candidate.parentIds.includes(entityId))
      if (!family?.children.length) return 1
      const nextPath = new Set(path).add(entityId)
      return Math.max(1, family.children.reduce((total, child) => total + countBranch(child.entityId, nextPath), 0))
    }
    return Math.max(1, roots.reduce((total, rootId) => total + countBranch(rootId, new Set()), standalone.length))
  }, [normalizedFamilies, roots, standalone.length])
  const canvasWidth = Math.max(1160, branchUnits * 174 + Math.max(0, roots.length - 1) * 32)

  const measureConnectors = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const anchorElements = [...canvas.querySelectorAll<HTMLElement>('[data-family-anchor]')]
    const entityElements = [...canvas.querySelectorAll<HTMLElement>('[data-entity-id]')]
    const entityMap = new Map(entityElements.map((element) => [element.dataset.entityId ?? '', element]))
    const pointInCanvas = (element: HTMLElement, vertical: 'center' | 'top') => {
      let x = element.offsetLeft + element.offsetWidth / 2
      let y = element.offsetTop + (vertical === 'center' ? element.offsetHeight / 2 : 0)
      let parent = element.offsetParent as HTMLElement | null
      while (parent && parent !== canvas) {
        x += parent.offsetLeft
        y += parent.offsetTop
        parent = parent.offsetParent as HTMLElement | null
      }
      return { x, y }
    }
    const next: string[] = []
    anchorElements.forEach((anchor) => {
      const family = normalizedFamilies.find((item) => item.id === anchor.dataset.familyAnchor)
      if (!family) return
      const start = pointInCanvas(anchor, 'center')
      family.children.forEach((child) => {
        const target = entityMap.get(child.entityId)
        if (!target) return
        const end = pointInCanvas(target, 'top')
        const midY = start.y + Math.max(34, (end.y - start.y) * 0.42)
        next.push(`M ${start.x} ${start.y} V ${midY} H ${end.x} V ${end.y}`)
      })
    })
    setPaths(next)
  }, [normalizedFamilies])

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measureConnectors)
    const observer = new ResizeObserver(() => requestAnimationFrame(measureConnectors))
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [measureConnectors, entities])

  const resetView = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const scale = Math.min(1, Math.max(0.34, (viewport.clientWidth - 36) / canvasWidth))
    const renderedWidth = canvasWidth * scale
    const x = renderedWidth <= viewport.clientWidth - 36
      ? 18
      : (viewport.clientWidth - renderedWidth) / 2
    setView({ x, y: 20, scale })
  }, [canvasWidth])

  useEffect(() => {
    resetView()
    const onResize = () => resetView()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [resetView, mode])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: view.x, originY: view.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setView((current) => ({ ...current, x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y }))
  }
  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }
  const zoom = (delta: number) => setView((current) => ({ ...current, scale: Math.min(1.5, Math.max(0.28, current.scale + delta)) }))
  const onHover = (entity: Entity, x: number, y: number) => setTooltip((current) => current?.pinned ? current : { entity, x, y, pinned: false })
  const onLeave = () => setTooltip((current) => current?.pinned ? current : null)
  const onTouch = (entity: Entity) => setTooltip({ entity, x: window.innerWidth / 2, y: window.innerHeight / 2, pinned: true })

  if (entities.size === 0) {
    return (
      <div className="empty-lineage">
        <span className="empty-orbit" aria-hidden="true">✦</span>
        <h2>No pets have been added yet</h2>
        <p>Log in to the dashboard to add pets, owners, and lineage connections.</p>
      </div>
    )
  }

  return (
    <section className="lineage-section" aria-label={mode === 'people' ? 'Interactive family tree' : 'Interactive pet lineage'}>
      <div className="graph-toolbar">
        <span>{mode === 'people' ? 'Family' : 'Pets'} · drag to explore</span>
        <div>
          <button type="button" onClick={() => zoom(-0.1)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => zoom(0.1)} aria-label="Zoom in">+</button>
          <button type="button" onClick={resetView} aria-label="Fit graph">⌂</button>
        </div>
      </div>
      <div
        className="lineage-viewport"
        ref={viewportRef}
        role="group"
        tabIndex={0}
        aria-label="Lineage canvas. Use arrow keys or drag to explore."
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onKeyDown={(event) => {
          const movements: Record<string, { x: number; y: number }> = {
            ArrowLeft: { x: 44, y: 0 },
            ArrowRight: { x: -44, y: 0 },
            ArrowUp: { x: 0, y: 44 },
            ArrowDown: { x: 0, y: -44 },
          }
          const movement = movements[event.key]
          if (!movement) return
          event.preventDefault()
          setView((current) => ({ ...current, x: current.x + movement.x, y: current.y + movement.y }))
        }}
      >
        <div
          className="lineage-canvas"
          ref={canvasRef}
          style={{ width: canvasWidth, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <svg className="connector-layer" aria-hidden="true">
            {paths.map((path, index) => <path key={`${path}-${index}`} d={path} />)}
          </svg>
          <div className="root-forest">
            {roots.map((rootId) => (
              <LineageBranch
                key={rootId}
                entityId={rootId}
                entities={entities}
                families={normalizedFamilies}
                people={people}
                path={new Set()}
                onHover={onHover}
                onLeave={onLeave}
                onTouch={onTouch}
              />
            ))}
          </div>
          {standalone.length > 0 && (
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
      {tooltip && <DetailPopover tooltip={tooltip} people={people} onClose={() => setTooltip(null)} />}
    </section>
  )
}
