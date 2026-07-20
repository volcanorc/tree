interface SiteHeaderProps {
  title: string
  view: 'family' | 'pets' | 'dashboard'
  authenticated: boolean
  onNavigate: (view: 'family' | 'pets' | 'dashboard') => void
  onLogout: () => void
}

export function SiteHeader({ title, view, authenticated, onNavigate, onLogout }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <button className="brand" type="button" onClick={() => onNavigate('family')}>
        <span aria-hidden="true">✦</span>
        <span>{title}</span>
      </button>
      <nav className="primary-tabs" aria-label="Primary navigation">
        <button className={view === 'family' ? 'active' : ''} aria-current={view === 'family' ? 'page' : undefined} type="button" onClick={() => onNavigate('family')}>Family</button>
        <button className={view === 'pets' ? 'active' : ''} aria-current={view === 'pets' ? 'page' : undefined} type="button" onClick={() => onNavigate('pets')}>Pets</button>
      </nav>
      <div className="admin-actions">
        <button className={view === 'dashboard' ? 'active' : ''} aria-current={view === 'dashboard' ? 'page' : undefined} type="button" onClick={() => onNavigate('dashboard')}>
          {authenticated ? 'Dashboard' : 'Admin login'}
        </button>
        {authenticated && <button type="button" onClick={onLogout}>Log out</button>}
      </div>
    </header>
  )
}
