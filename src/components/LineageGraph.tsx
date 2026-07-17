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
  displayValue,
  isSafeExternalUrl,
  portraitCandidates,
  sortChildren,
} from '../lib/data'
import type { FamilyUnit, Person, Pet, PetFamilyUnit } from '../types'

type Entity = Person | Pet
type ViewState = { x: number; y: number; scale: number }

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

function DetailPopover({ tooltip, people, onClose }: { tooltip: TooltipState; people: Person[]; onClose: () => void }) {
  const { entity, pinned } = tooltip
  const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
  const left = Math.min(window.innerWidth - 254, Math.max(16, tooltip.x + 18))
  const top = Math.min(window.innerHeight - 300, Math.max(82, tooltip.y + 18))
  const style = pinned ? undefined : ({ left, top } as CSSProperties)
  const safeLinks = entity.links.filter((link) => link.trim() && isSafeExternalUrl(link))
  const rows = isPet(entity)
    ? [
        ['Species', displayValue(entity.species)],
        ['Breed', displayValue(entity.breed)],
        ['Age', calculateAge(entity.birthDate, entity.ageOverride)],
        ['Born', bornValue(entity)],
        ['Gender', displayValue(entity.gender)],
        ['Status', entity.status === 'dead' ? 'Dead' : 'Alive'],
        ['Owner', displayValue(owner?.displayName)],
        ['Personality', displayValue(entity.personality)],
      ]
    : [
        ['Age', calculateAge(entity.birthDate, entity.ageOverride)],
        ['Born', bornValue(entity)],
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
  const units = families.filter((family) => family.parentIds.includes(entityId))
  const partnerIds = [...new Set(units.flatMap((family) => family.parentIds.filter((id) => id !== entityId)))]
  const owner = isPet(entity) ? people.find((person) => person.id === entity.ownerPersonId) : undefined
  return (
    <div className={`lineage-branch ${units.length > 1 ? 'has-multiple-unions' : ''}`}>
      <div className="parent-unit">
        <EntityCard entity={entity} owner={owner} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />
        {partnerIds.map((partnerId) => {
          const partner = entities.get(partnerId)
          if (!partner) return null
          const partnerOwner = isPet(partner) ? people.find((person) => person.id === partner.ownerPersonId) : undefined
          return <EntityCard key={partnerId} entity={partner} owner={partnerOwner} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />
        })}
      </div>
      {units.length > 0 && (
        <div className="family-units-row">
          {units.map((family) => (
            <div className="family-unit-branch" key={family.id}>
              <span className="family-anchor" data-family-anchor={family.id} aria-hidden="true" />
              {family.children.length > 0 && (
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
          ))}
        </div>
      )}
    </div>
  )
}

export function LineageGraph({ mode, people, families, pets, petFamilies }: LineageGraphProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const activePointers = useRef(new Map<number, { x: number; y: number }>())
  const gestureRef = useRef<Gesture | null>(null)
  const wheelTimer = useRef<number | null>(null)
  const [view, setView] = useState<ViewState>({ x: 24, y: 24, scale: 0.82 })
  const viewRef = useRef(view)
  const [paths, setPaths] = useState<string[]>([])
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
  const childIds = useMemo(() => new Set(normalizedFamilies.flatMap((family) => family.children.map((child) => child.entityId))), [normalizedFamilies])
  const roots = useMemo(() => {
    const rootIds = normalizedFamilies
      .filter((family) => family.parentIds.every((id) => !childIds.has(id)))
      .map((family) => family.parentIds[0])
      .filter(Boolean)
    const deduped = [...new Set(rootIds)]
    return deduped.length ? deduped : [...entities.keys()].filter((id) => !childIds.has(id)).slice(0, 1)
  }, [childIds, entities, normalizedFamilies])
  const usedIds = useMemo(() => new Set(normalizedFamilies.flatMap((family) => [...family.parentIds, ...family.children.map((child) => child.entityId)])), [normalizedFamilies])
  const standalone = useMemo(() => [...entities.keys()].filter((id) => !usedIds.has(id) && !roots.includes(id)), [entities, roots, usedIds])
  const branchUnits = useMemo(() => {
    const countBranch = (entityId: string, path: Set<string>): number => {
      if (path.has(entityId)) return 1
      const units = normalizedFamilies.filter((family) => family.parentIds.includes(entityId) && family.children.length)
      if (!units.length) return 1
      const nextPath = new Set(path).add(entityId)
      return Math.max(1, units.reduce((unitTotal, unit) => unitTotal + unit.children.reduce((total, child) => total + countBranch(child.entityId, nextPath), 0), 0))
    }
    return Math.max(1, roots.reduce((total, rootId) => total + countBranch(rootId, new Set()), standalone.length))
  }, [normalizedFamilies, roots, standalone.length])
  const canvasWidth = Math.max(1160, branchUnits * 174 + Math.max(0, roots.length - 1) * 32)

  const measureConnectors = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const anchors = [...canvas.querySelectorAll<HTMLElement>('[data-family-anchor]')]
    const entityMap = new Map([...canvas.querySelectorAll<HTMLElement>('[data-entity-id]')].map((element) => [element.dataset.entityId ?? '', element]))
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
    anchors.forEach((anchor) => {
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
          <svg className="connector-layer" aria-hidden="true">{paths.map((path, index) => <path key={`${path}-${index}`} d={path} />)}</svg>
          <div className="root-forest">
            {roots.map((rootId) => <LineageBranch key={rootId} entityId={rootId} entities={entities} families={normalizedFamilies} people={people} path={new Set()} onHover={onHover} onLeave={onLeave} onTouch={onTouch} />)}
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
