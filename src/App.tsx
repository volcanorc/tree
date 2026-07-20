import { useEffect, useMemo, useRef, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { LineageGraph, type LineageFocusRequest } from './components/LineageGraph'
import { SiteHeader } from './components/SiteHeader'
import {
  addChild,
  addPartner,
  addPetOffspring,
  addPetPartner,
  addPetSibling,
  addSibling,
  applyPersonDeletePlan,
  applyPetDeletePlan,
  countDescendants,
  loadPublishedData,
  migrateTreeData,
  planPersonDeletion,
  planPetDeletion,
  validateTreeData,
} from './lib/data'
import type {
  ArchiveEditIntent,
  ArchiveEditRequest,
  ArchiveEntityPatch,
  PersonDeletePlan,
  PetDeletePlan,
  TreeData,
} from './types'

type View = 'family' | 'pets' | 'dashboard'

type ArchiveChoice =
  | { kind: 'person-child'; entityId: string }
  | { kind: 'person-partner'; entityId: string }
  | { kind: 'pet-child'; entityId: string }
  | { kind: 'pet-partner'; entityId: string }

type ArchiveDelete =
  | { kind: 'person'; plan: PersonDeletePlan }
  | { kind: 'pet'; plan: PetDeletePlan }

const DRAFT_KEY = 'celestial-family-archive-draft-v1'
const AUTH_KEY = 'celestial-family-archive-admin'

function viewFromHash(): View {
  const hash = window.location.hash.toLowerCase()
  if (hash === '#pets') return 'pets'
  if (hash === '#dashboard') return 'dashboard'
  return 'family'
}

function ArchiveView({
  data,
  view,
  focusRequest,
  onPersonNavigate,
  onPetNavigate,
  onFocusAcknowledge,
  authenticated,
  onEditIntent,
  onEntityPatch,
  recentEntityId,
}: {
  data: TreeData
  view: 'family' | 'pets'
  focusRequest: LineageFocusRequest | null
  onPersonNavigate: (personId: string) => void
  onPetNavigate: (petId: string) => void
  onFocusAcknowledge: (requestId: number) => void
  authenticated: boolean
  onEditIntent: (intent: ArchiveEditIntent) => void
  onEntityPatch: (request: ArchiveEntityPatch) => string
  recentEntityId: string | null
}) {
  const isFamily = view === 'family'
  return (
    <main id="archive-main" className="archive-main">
      <section className="archive-hero reveal">
        <p className="eyebrow">{isFamily ? 'Celestial lineage · living archive' : 'Companion lineage · family orbit'}</p>
        <h1>{isFamily ? data.site.title : 'The Pet Archive'}</h1>
        <p className="hero-subtitle">
          {isFamily
            ? data.site.subtitle
            : 'The animals who share our homes, stories, and generations.'}
        </p>
        <div className="hero-rule" aria-hidden="true"><span /></div>
        <p className="hero-instruction">Drag the map to explore · hover a portrait to read its record</p>
      </section>

      <section className="map-frame reveal">
        <div className="map-heading">
          <div>
            <p className="section-kicker">{isFamily ? 'Generation map' : 'Pet lineage map'}</p>
            <h2>{isFamily ? 'Lineage Branches' : 'Companions across generations'}</h2>
          </div>
          <div className="map-legend" aria-label="Map legend">
            <span><i className="legend-dot copper" /> Person</span>
            <span><i className="legend-line" /> Relationship</span>
          </div>
        </div>
        <LineageGraph
          key={isFamily ? 'family-graph' : 'pet-graph'}
          mode={isFamily ? 'people' : 'pets'}
          people={data.people}
          families={data.families}
          pets={data.pets}
          petFamilies={data.petFamilies}
          onOwnerNavigate={isFamily ? undefined : onPersonNavigate}
          onPetNavigate={isFamily ? onPetNavigate : undefined}
          focusRequest={focusRequest}
          onFocusAcknowledge={onFocusAcknowledge}
          canEdit={authenticated}
          onEditAction={authenticated ? onEditIntent : undefined}
          onEntityPatch={authenticated ? onEntityPatch : undefined}
          recentEntityId={recentEntityId}
        />
      </section>

      <section className="archive-note reveal">
        <span className="archive-mark" aria-hidden="true">HS</span>
        <div>
          <p className="section-kicker">{isFamily ? 'A family record' : 'An evolving record'}</p>
          <h2>{isFamily ? 'Hermoso - Sullano' : 'Every companion belongs in the story'}</h2>
          <p>
            {isFamily
              ? 'From the founding generation to every branch that follows, each name, story, and connection is preserved as part of a living family legacy.'
              : 'Add pets independently, connect them to a human owner, or map known pet parents and offspring in the dashboard.'}
          </p>
        </div>
      </section>
    </main>
  )
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash)
  const [publishedData, setPublishedData] = useState<TreeData | null>(null)
  const [data, setData] = useState<TreeData | null>(null)
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem(AUTH_KEY) === 'yes')
  const [loadingError, setLoadingError] = useState('')
  const [draftRecovered, setDraftRecovered] = useState(false)
  const [familyFocusRequest, setFamilyFocusRequest] = useState<LineageFocusRequest | null>(null)
  const [petFocusRequest, setPetFocusRequest] = useState<LineageFocusRequest | null>(null)
  const [dashboardEditRequest, setDashboardEditRequest] = useState<ArchiveEditRequest | null>(null)
  const [archiveChoice, setArchiveChoice] = useState<ArchiveChoice | null>(null)
  const [archiveDelete, setArchiveDelete] = useState<ArchiveDelete | null>(null)
  const [archiveStatus, setArchiveStatus] = useState('')
  const [recentEntity, setRecentEntity] = useState<{ kind: 'person' | 'pet'; id: string; sequence: number } | null>(null)
  const familyFocusSequence = useRef(0)
  const petFocusSequence = useRef(0)
  const dashboardEditSequence = useRef(0)
  const recentEntitySequence = useRef(0)
  const currentSiteTitle = data?.site.title

  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    let active = true
    loadPublishedData()
      .then((published) => {
        if (!active) return
        setPublishedData(published)
        const stored = localStorage.getItem(DRAFT_KEY)
        if (stored) {
          try {
            const migratedDraft = migrateTreeData(JSON.parse(stored))
            const draft = {
              ...migratedDraft,
              site: {
                ...migratedDraft.site,
                adminUser: published.site.adminUser,
                adminPinHash: published.site.adminPinHash,
              },
            }
            if (validateTreeData(draft).valid) {
              setData(draft)
              localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
              setDraftRecovered(true)
              return
            }
          } catch {
            localStorage.removeItem(DRAFT_KEY)
          }
        }
        setData(published)
      })
      .catch((error: unknown) => {
        if (active) setLoadingError(error instanceof Error ? error.message : 'The archive data could not be loaded.')
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (currentSiteTitle === undefined) return
    document.title = currentSiteTitle || 'The Lineage Archive'
  }, [currentSiteTitle])

  useEffect(() => {
    if (!recentEntity) return
    const timer = window.setTimeout(() => {
      setRecentEntity((current) => current?.sequence === recentEntity.sequence ? null : current)
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [recentEntity])

  useEffect(() => {
    if (!data) return
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible')
      }),
      { threshold: 0.08 },
    )
    document.querySelectorAll('.reveal').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [data, view, authenticated])

  const counts = useMemo(() => {
    if (!data) return null
    return countDescendants(data)
  }, [data])

  function navigate(next: View) {
    window.location.hash = next === 'family' ? 'family' : next
    setView(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function navigateToPerson(personId: string) {
    if (!data?.people.some((person) => person.id === personId)) return
    familyFocusSequence.current += 1
    setFamilyFocusRequest({ entityId: personId, requestId: familyFocusSequence.current })
    window.location.hash = 'family'
    setView('family')
  }

  function navigateToPet(petId: string) {
    if (!data?.pets.some((pet) => pet.id === petId)) return
    petFocusSequence.current += 1
    setPetFocusRequest({ entityId: petId, requestId: petFocusSequence.current })
    window.location.hash = 'pets'
    setView('pets')
  }

  function acknowledgeFamilyFocus(requestId: number) {
    setFamilyFocusRequest((current) => current?.requestId === requestId ? null : current)
  }

  function acknowledgePetFocus(requestId: number) {
    setPetFocusRequest((current) => current?.requestId === requestId ? null : current)
  }

  function openDashboardEditor(intent: ArchiveEditIntent) {
    if (!authenticated) return
    dashboardEditSequence.current += 1
    setDashboardEditRequest({ ...intent, requestId: dashboardEditSequence.current })
    navigate('dashboard')
  }

  function markRecentEntity(kind: 'person' | 'pet', id: string) {
    recentEntitySequence.current += 1
    setRecentEntity({ kind, id, sequence: recentEntitySequence.current })
  }

  function commitArchiveMutation(next: TreeData, kind: 'person' | 'pet', message: string) {
    const collection = kind === 'person' ? next.people : next.pets
    const newEntity = collection[collection.length - 1]
    changeData(next)
    if (newEntity) markRecentEntity(kind, newEntity.id)
    setArchiveChoice(null)
    setArchiveStatus(message)
  }

  function addPersonChildFromMap(personId: string, familyId?: string | 'single') {
    if (!data) return
    commitArchiveMutation(addChild(data, personId, 'New child', familyId), 'person', 'New child added to this local draft.')
  }

  function addPersonPartnerFromMap(personId: string, attachFamilyId?: string) {
    if (!data) return
    commitArchiveMutation(addPartner(data, personId, 'New partner', attachFamilyId), 'person', 'New partner added to this local draft.')
  }

  function addPetChildFromMap(petId: string, familyId?: string | 'single') {
    if (!data) return
    commitArchiveMutation(addPetOffspring(data, petId, 'New pet', familyId), 'pet', 'New offspring added to this local draft.')
  }

  function addPetPartnerFromMap(petId: string, attachFamilyId?: string) {
    if (!data) return
    commitArchiveMutation(addPetPartner(data, petId, 'New pet partner', attachFamilyId), 'pet', 'New pet partner added to this local draft.')
  }

  function handleArchiveEdit(intent: ArchiveEditIntent) {
    if (!authenticated || !data) return
    if (intent.action === 'settings') {
      openDashboardEditor(intent)
      return
    }
    if (intent.action === 'delete') {
      const plan = intent.kind === 'person'
        ? planPersonDeletion(data, [intent.entityId])
        : planPetDeletion(data, [intent.entityId])
      setArchiveDelete({ kind: intent.kind, plan } as ArchiveDelete)
      return
    }
    if (intent.kind === 'person') {
      if (intent.action === 'sibling') {
        const next = addSibling(data, intent.entityId)
        if (next === data) setArchiveStatus('No recorded parents are available for this sibling.')
        else commitArchiveMutation(next, 'person', 'New sibling added to the exact same parent branch.')
        return
      }
      if (intent.action === 'child') {
        const units = data.families.filter((family) => family.parentIds.includes(intent.entityId))
        if (units.length > 1) setArchiveChoice({ kind: 'person-child', entityId: intent.entityId })
        else addPersonChildFromMap(intent.entityId, units[0]?.id ?? 'single')
        return
      }
      const soloUnits = data.families.filter((family) => family.parentIds.length === 1 && family.parentIds[0] === intent.entityId)
      if (soloUnits.length) setArchiveChoice({ kind: 'person-partner', entityId: intent.entityId })
      else addPersonPartnerFromMap(intent.entityId)
      return
    }
    if (intent.action === 'sibling') {
      const next = addPetSibling(data, intent.entityId)
      if (next === data) setArchiveStatus('No recorded pet parents are available for this sibling.')
      else commitArchiveMutation(next, 'pet', 'New pet sibling added to the exact same parent branch.')
      return
    }
    if (intent.action === 'child') {
      const units = data.petFamilies.filter((family) => family.parentPetIds.includes(intent.entityId))
      if (units.length > 1) setArchiveChoice({ kind: 'pet-child', entityId: intent.entityId })
      else addPetChildFromMap(intent.entityId, units[0]?.id ?? 'single')
      return
    }
    const soloUnits = data.petFamilies.filter((family) => family.parentPetIds.length === 1 && family.parentPetIds[0] === intent.entityId)
    if (soloUnits.length) setArchiveChoice({ kind: 'pet-partner', entityId: intent.entityId })
    else addPetPartnerFromMap(intent.entityId)
  }

  function patchArchiveEntity(request: ArchiveEntityPatch): string {
    if (!authenticated || !data) return 'Sign in to edit this record.'
    let next: TreeData
    if (request.kind === 'person') {
      const current = data.people.find((person) => person.id === request.entityId)
      if (!current) return 'Person not found.'
      const updated = { ...current, ...request.patch }
      if (!updated.displayName.trim()) return 'Name is required.'
      if (updated.status === 'alive') updated.deathDate = ''
      next = { ...data, people: data.people.map((person) => person.id === request.entityId ? updated : person) }
    } else {
      const current = data.pets.find((pet) => pet.id === request.entityId)
      if (!current) return 'Pet not found.'
      const updated = { ...current, ...request.patch }
      if (!updated.displayName.trim()) return 'Name is required.'
      if (updated.status === 'alive') updated.deathDate = ''
      next = { ...data, pets: data.pets.map((pet) => pet.id === request.entityId ? updated : pet) }
    }
    const validation = validateTreeData(next)
    if (!validation.valid) return validation.errors[0] ?? 'This change is not valid.'
    changeData(next)
    setArchiveStatus('Profile change saved to this browser draft.')
    return ''
  }

  function confirmArchiveDelete() {
    if (!data || !archiveDelete || archiveDelete.plan.blockedReason) return
    const next = archiveDelete.kind === 'person'
      ? applyPersonDeletePlan(data, archiveDelete.plan)
      : applyPetDeletePlan(data, archiveDelete.plan)
    const count = archiveDelete.plan.deleteIds.length
    changeData(next)
    setArchiveDelete(null)
    setArchiveStatus(`${count} ${archiveDelete.kind === 'person' ? (count === 1 ? 'person' : 'people') : (count === 1 ? 'pet' : 'pets')} removed from this local draft.`)
  }

  function acknowledgeDashboardEdit(requestId: number) {
    setDashboardEditRequest((current) => current?.requestId === requestId ? null : current)
  }

  function authenticate() {
    sessionStorage.setItem(AUTH_KEY, 'yes')
    setAuthenticated(true)
  }

  function logout() {
    sessionStorage.removeItem(AUTH_KEY)
    setAuthenticated(false)
    navigate('family')
  }

  function changeData(next: TreeData) {
    setData(next)
    localStorage.setItem(DRAFT_KEY, JSON.stringify(next))
    setDraftRecovered(true)
  }

  function resetData() {
    if (!publishedData) return
    localStorage.removeItem(DRAFT_KEY)
    setData(publishedData)
    setDraftRecovered(false)
  }

  if (loadingError) {
    return (
      <div className="app-shell error-shell">
        <div className="site-mural" aria-hidden="true" />
        <div className="site-veil" aria-hidden="true" />
        <main className="fatal-card celestial-panel">
          <p className="eyebrow">Archive unavailable</p>
          <h1>We could not open the lineage data.</h1>
          <p>{loadingError}</p>
          <button className="primary-button" onClick={() => window.location.reload()}>Try again</button>
        </main>
      </div>
    )
  }

  if (!data || !publishedData) {
    return (
      <div className="app-shell loading-shell" aria-live="polite">
        <div className="site-mural" aria-hidden="true" />
        <div className="site-veil" aria-hidden="true" />
        <div className="loading-mark"><span>✦</span><p>Charting the archive…</p></div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="site-mural" aria-hidden="true" />
      <div className="site-veil" aria-hidden="true" />
      <div className="site-grain" aria-hidden="true" />
      <a className="skip-link" href={view === 'dashboard' ? '#dashboard-main' : '#archive-main'}>Skip to content</a>
      <SiteHeader title={data.site.title} view={view} authenticated={authenticated} onNavigate={navigate} onLogout={logout} />

      {draftRecovered && view !== 'dashboard' && (
        <div className="draft-banner" role="status">
          <span>Local draft active</span>
          <button onClick={() => navigate('dashboard')}>Review changes</button>
        </div>
      )}

      {view === 'dashboard' ? (
        <Dashboard
          data={data}
          publishedData={publishedData}
          authenticated={authenticated}
          onAuthenticated={authenticate}
          onLogout={logout}
          onChange={changeData}
          onReset={resetData}
          onNavigateToOwner={navigateToPerson}
          onNavigateToPet={navigateToPet}
          editRequest={dashboardEditRequest}
          onEditRequestHandled={acknowledgeDashboardEdit}
          onEditIntent={openDashboardEditor}
        />
      ) : (
        <ArchiveView
          data={data}
          view={view}
          focusRequest={view === 'family' ? familyFocusRequest : petFocusRequest}
          onPersonNavigate={navigateToPerson}
          onPetNavigate={navigateToPet}
          onFocusAcknowledge={view === 'family' ? acknowledgeFamilyFocus : acknowledgePetFocus}
          authenticated={authenticated}
          onEditIntent={handleArchiveEdit}
          onEntityPatch={patchArchiveEntity}
          recentEntityId={recentEntity?.kind === (view === 'family' ? 'person' : 'pet') ? recentEntity.id : null}
        />
      )}

      {archiveStatus && view !== 'dashboard' && (
        <div className="archive-status-toast" role="status">
          <span>{archiveStatus}</span>
          <button type="button" onClick={() => setArchiveStatus('')} aria-label="Dismiss message">Close</button>
        </div>
      )}

      {archiveChoice && view !== 'dashboard' && (
        <div className="modal-backdrop archive-map-overlay" role="presentation" onMouseDown={() => setArchiveChoice(null)}>
          <section className="dashboard-modal celestial-panel" role="dialog" aria-modal="true" aria-labelledby="archive-choice-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Choose the exact branch</p>
            <h2 id="archive-choice-title">
              {archiveChoice.kind.endsWith('child') ? 'Which parents belong to this new record?' : 'Where should this partnership begin?'}
            </h2>
            <p>The map will update immediately and keep the current profile open.</p>
            <div className="choice-grid">
              {archiveChoice.kind === 'person-child' && data.families
                .filter((family) => family.parentIds.length === 2 && family.parentIds.includes(archiveChoice.entityId))
                .map((family) => {
                  const partner = data.people.find((person) => family.parentIds.some((id) => id !== archiveChoice.entityId && id === person.id))
                  return <button className="secondary-button" type="button" key={family.id} onClick={() => addPersonChildFromMap(archiveChoice.entityId, family.id)}>{partner?.displayName ?? 'Recorded partner'}</button>
                })}
              {archiveChoice.kind === 'person-child' && (
                <button className="secondary-button" type="button" onClick={() => {
                  const solo = data.families.find((family) => family.parentIds.length === 1 && family.parentIds[0] === archiveChoice.entityId)
                  addPersonChildFromMap(archiveChoice.entityId, solo?.id ?? 'single')
                }}>Single-parent branch</button>
              )}
              {archiveChoice.kind === 'person-partner' && data.families
                .filter((family) => family.parentIds.length === 1 && family.parentIds[0] === archiveChoice.entityId)
                .map((family) => <button className="secondary-button" type="button" key={family.id} onClick={() => addPersonPartnerFromMap(archiveChoice.entityId, family.id)}>Attach to branch with {family.children.length} {family.children.length === 1 ? 'child' : 'children'}</button>)}
              {archiveChoice.kind === 'person-partner' && <button className="secondary-button" type="button" onClick={() => addPersonPartnerFromMap(archiveChoice.entityId)}>Start separate union</button>}
              {archiveChoice.kind === 'pet-child' && data.petFamilies
                .filter((family) => family.parentPetIds.length === 2 && family.parentPetIds.includes(archiveChoice.entityId))
                .map((family) => {
                  const partner = data.pets.find((pet) => family.parentPetIds.some((id) => id !== archiveChoice.entityId && id === pet.id))
                  return <button className="secondary-button" type="button" key={family.id} onClick={() => addPetChildFromMap(archiveChoice.entityId, family.id)}>{partner?.displayName ?? 'Recorded pet partner'}</button>
                })}
              {archiveChoice.kind === 'pet-child' && (
                <button className="secondary-button" type="button" onClick={() => {
                  const solo = data.petFamilies.find((family) => family.parentPetIds.length === 1 && family.parentPetIds[0] === archiveChoice.entityId)
                  addPetChildFromMap(archiveChoice.entityId, solo?.id ?? 'single')
                }}>Single-parent branch</button>
              )}
              {archiveChoice.kind === 'pet-partner' && data.petFamilies
                .filter((family) => family.parentPetIds.length === 1 && family.parentPetIds[0] === archiveChoice.entityId)
                .map((family) => <button className="secondary-button" type="button" key={family.id} onClick={() => addPetPartnerFromMap(archiveChoice.entityId, family.id)}>Attach to branch with {family.children.length} offspring</button>)}
              {archiveChoice.kind === 'pet-partner' && <button className="secondary-button" type="button" onClick={() => addPetPartnerFromMap(archiveChoice.entityId)}>Start separate union</button>}
            </div>
            <button className="ghost-button modal-cancel" type="button" onClick={() => setArchiveChoice(null)}>Cancel</button>
          </section>
        </div>
      )}

      {archiveDelete && view !== 'dashboard' && (
        <div className="modal-backdrop archive-map-overlay" role="presentation" onMouseDown={() => setArchiveDelete(null)}>
          <section className="dashboard-modal celestial-panel delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="archive-delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Local archive change</p>
            <h2 id="archive-delete-title">{archiveDelete.plan.blockedReason ? 'This record cannot be deleted' : `Delete ${archiveDelete.plan.deleteIds.length} ${archiveDelete.kind === 'person' ? (archiveDelete.plan.deleteIds.length === 1 ? 'person' : 'people') : (archiveDelete.plan.deleteIds.length === 1 ? 'pet' : 'pets')}?`}</h2>
            {archiveDelete.plan.blockedReason ? (
              <p className="form-error" role="alert">{archiveDelete.plan.blockedReason}</p>
            ) : (
              <>
                <p>This updates the browser draft immediately. The published JSON remains unchanged until you export and commit it.</p>
                <p><strong>Affected:</strong> {archiveDelete.plan.deleteIds.map((id) => archiveDelete.kind === 'person' ? data.people.find((person) => person.id === id)?.displayName : data.pets.find((pet) => pet.id === id)?.displayName).filter(Boolean).join(', ')}</p>
                {archiveDelete.plan.cascadeIds.length > 0 && <p><strong>Automatic descendants:</strong> {archiveDelete.plan.cascadeIds.map((id) => archiveDelete.kind === 'person' ? data.people.find((person) => person.id === id)?.displayName : data.pets.find((pet) => pet.id === id)?.displayName).filter(Boolean).join(', ')}</p>}
              </>
            )}
            <div className="modal-actions">
              {!archiveDelete.plan.blockedReason && <button className="danger-button" type="button" onClick={confirmArchiveDelete}>Delete from draft</button>}
              <button className="ghost-button" type="button" onClick={() => setArchiveDelete(null)}>{archiveDelete.plan.blockedReason ? 'Close' : 'Cancel'}</button>
            </div>
          </section>
        </div>
      )}

      <footer className="site-footer">
        <div>
          <span className="footer-mark" aria-hidden="true">✦</span>
          <p>{data.site.title}</p>
        </div>
        <p>{`${counts} descendants recorded`}</p>
        <button onClick={() => navigate('dashboard')}>Manage archive</button>
      </footer>
    </div>
  )
}
