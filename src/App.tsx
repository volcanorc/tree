import { useEffect, useMemo, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { LineageGraph } from './components/LineageGraph'
import { SiteHeader } from './components/SiteHeader'
import { countDescendants, loadPublishedData, migrateTreeData, validateTreeData } from './lib/data'
import type { TreeData } from './types'

type View = 'family' | 'pets' | 'dashboard'

const DRAFT_KEY = 'celestial-family-archive-draft-v1'
const AUTH_KEY = 'celestial-family-archive-admin'

function viewFromHash(): View {
  const hash = window.location.hash.toLowerCase()
  if (hash === '#pets') return 'pets'
  if (hash === '#dashboard') return 'dashboard'
  return 'family'
}

function ArchiveView({ data, view }: { data: TreeData; view: 'family' | 'pets' }) {
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
            <h2>{isFamily ? 'Family Branches' : 'Companions across generations'}</h2>
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
      <SiteHeader view={view} authenticated={authenticated} onNavigate={navigate} onLogout={logout} />

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
        />
      ) : (
        <ArchiveView data={data} view={view} />
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
