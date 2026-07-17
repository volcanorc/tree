import { ChangeEvent, FormEvent, useMemo, useRef, useState } from 'react'
import type { Pet, Person, TreeData } from '../types'
import {
  addChild,
  addPartner,
  addPetOffspring,
  addPetPartner,
  createBlankPet,
  deletePerson,
  deletePet,
  exportTreeData,
  getBirthOrder,
  getPetBirthOrder,
  makeId,
  isSafeExternalUrl,
  updateBirthOrder,
  updatePetBirthOrder,
  validateTreeData,
} from '../lib/data'
import { verifyLogin } from '../lib/auth'
import { LineageGraph } from './LineageGraph'

interface DashboardProps {
  data: TreeData
  publishedData: TreeData
  authenticated: boolean
  onAuthenticated: () => void
  onLogout: () => void
  onChange: (next: TreeData) => void
  onReset: () => void
}

type EditorTab = 'archive' | 'people' | 'pets' | 'preview'

const textFields: Array<{
  key: keyof Person
  label: string
  placeholder?: string
  textarea?: boolean
}> = [
  { key: 'displayName', label: 'Display name', placeholder: 'Full or public name' },
  { key: 'nickname', label: 'Nickname', placeholder: '?' },
  { key: 'birthDate', label: 'Birth date', placeholder: 'YYYY-MM-DD' },
  { key: 'ageOverride', label: 'Age override', placeholder: 'Used only when birth date is empty' },
  { key: 'relationshipLabel', label: 'Relationship label', placeholder: 'e.g. Eldest son' },
  { key: 'personality', label: 'Personality', placeholder: 'A few defining qualities' },
  { key: 'biography', label: 'Short biography', placeholder: 'A public, concise life note', textarea: true },
  { key: 'portrait', label: 'Portrait path or HTTPS URL', placeholder: '/portraits/name.webp' },
  { key: 'link', label: 'Video or profile link', placeholder: 'https://…' },
]

const petTextFields: Array<{
  key: keyof Pet
  label: string
  placeholder?: string
  textarea?: boolean
}> = [
  { key: 'displayName', label: 'Name', placeholder: 'Pet name' },
  { key: 'species', label: 'Species', placeholder: 'Dog, cat, bird…' },
  { key: 'breed', label: 'Breed', placeholder: '?' },
  { key: 'birthDate', label: 'Birth date', placeholder: 'YYYY-MM-DD' },
  { key: 'ageOverride', label: 'Age override', placeholder: 'Used only when birth date is empty' },
  { key: 'personality', label: 'Personality', placeholder: 'Temperament and favorite things' },
  { key: 'biography', label: 'Short biography', placeholder: 'A short public story', textarea: true },
  { key: 'portrait', label: 'Portrait path or HTTPS URL', placeholder: '/portraits/pet.webp' },
  { key: 'link', label: 'Video or profile link', placeholder: 'https://…' },
]

function DashboardLogin({ data, onAuthenticated }: Pick<DashboardProps, 'data' | 'onAuthenticated'>) {
  const [username, setUsername] = useState('admin')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setError('')
    const valid = await verifyLogin(username, pin, data.site.adminUser, data.site.adminPinHash)
    setWorking(false)
    if (!valid) {
      setError('That username or PIN does not match.')
      return
    }
    onAuthenticated()
  }

  return (
    <section className="login-shell reveal" id="dashboard-main" aria-labelledby="login-title">
      <div className="login-card celestial-panel">
        <p className="eyebrow">Local archive tools</p>
        <h1 id="login-title">Dashboard access</h1>
        <p>
          This session-only gate discourages casual editing. The published JSON remains public, and the PIN is
          not real security.
        </p>
        <form onSubmit={submit} className="login-form">
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            PIN
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              inputMode="numeric"
              autoComplete="current-password"
              type="password"
              required
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={working}>
            {working ? 'Checking…' : 'Enter dashboard'}
          </button>
        </form>
      </div>
    </section>
  )
}

function nextPetId(data: TreeData) {
  return makeId('pet', data.pets.map((pet) => pet.id))
}

export function Dashboard(props: DashboardProps) {
  const { data, publishedData, authenticated, onAuthenticated, onLogout, onChange, onReset } = props
  const [tab, setTab] = useState<EditorTab>('archive')
  const [selectedPersonId, setSelectedPersonId] = useState(data.people[0]?.id ?? '')
  const [selectedPetId, setSelectedPetId] = useState(data.pets[0]?.id ?? '')
  const [status, setStatus] = useState('Changes are saved as a draft in this browser.')
  const [importErrors, setImportErrors] = useState<string[]>([])
  const importInput = useRef<HTMLInputElement>(null)
  const validation = useMemo(() => validateTreeData(data), [data])

  if (!authenticated) {
    return <DashboardLogin data={data} onAuthenticated={onAuthenticated} />
  }

  const selectedPerson = data.people.find((person) => person.id === selectedPersonId) ?? data.people[0]
  const selectedPet = data.pets.find((pet) => pet.id === selectedPetId) ?? data.pets[0]
  const selectedBirthOrder = selectedPerson ? getBirthOrder(data, selectedPerson.id) : null
  const selectedPetBirthOrder = selectedPet ? getPetBirthOrder(data, selectedPet.id) : null

  function updateSite(field: 'title' | 'subtitle', value: string) {
    onChange({ ...data, site: { ...data.site, [field]: value } })
  }

  function updatePerson(patch: Partial<Person>) {
    if (!selectedPerson) return
    onChange({
      ...data,
      people: data.people.map((person) => (person.id === selectedPerson.id ? { ...person, ...patch } : person)),
    })
  }

  function updatePet(patch: Partial<Pet>) {
    if (!selectedPet) return
    onChange({
      ...data,
      pets: data.pets.map((pet) => (pet.id === selectedPet.id ? { ...pet, ...patch } : pet)),
    })
  }

  function addPersonChild() {
    if (!selectedPerson) return
    const next = addChild(data, selectedPerson.id)
    const newPerson = next.people[next.people.length - 1]
    onChange(next)
    setSelectedPersonId(newPerson.id)
    setStatus(`${newPerson.displayName} added as the youngest child. Complete the placeholders, then export JSON.`)
  }

  function addPersonPartner() {
    if (!selectedPerson) return
    const next = addPartner(data, selectedPerson.id)
    if (next === data) {
      setStatus('This person already has two parents in their active family unit.')
      return
    }
    const newPerson = next.people[next.people.length - 1]
    onChange(next)
    setSelectedPersonId(newPerson.id)
    setStatus('Partner added. Their shared family branch is ready for children.')
  }

  function removeSelectedPerson() {
    if (!selectedPerson) return
    const result = deletePerson(data, selectedPerson.id)
    if (!result.deleted) {
      setStatus(result.reason ?? 'This person cannot be deleted.')
      return
    }
    onChange(result.data)
    setSelectedPersonId(result.data.people[0]?.id ?? '')
    setStatus(`${selectedPerson.displayName} was removed from this local draft.`)
  }

  function addNewPet() {
    const pet = createBlankPet(nextPetId(data), 'New pet')
    onChange({ ...data, pets: [...data.pets, pet] })
    setSelectedPetId(pet.id)
    setStatus('New pet added. Add lineage only if you know its pet parent.')
  }

  function addPetChild() {
    if (!selectedPet) return
    const next = addPetOffspring(data, selectedPet.id)
    const pet = next.pets[next.pets.length - 1]
    onChange(next)
    setSelectedPetId(pet.id)
    setStatus('Pet offspring added to the lineage.')
  }

  function addSelectedPetPartner() {
    if (!selectedPet) return
    const next = addPetPartner(data, selectedPet.id)
    if (next === data) {
      setStatus('This pet family already has two parents.')
      return
    }
    const pet = next.pets[next.pets.length - 1]
    onChange(next)
    setSelectedPetId(pet.id)
    setStatus('Pet partner added to the same family unit.')
  }

  function removeSelectedPet() {
    if (!selectedPet) return
    const result = deletePet(data, selectedPet.id)
    if (!result.deleted) {
      setStatus(result.reason ?? 'This pet cannot be deleted.')
      return
    }
    onChange(result.data)
    setSelectedPetId(result.data.pets[0]?.id ?? '')
    setStatus(`${selectedPet.displayName} was removed from this local draft.`)
  }

  async function copyJson() {
    if (!validation.valid) {
      setStatus('Resolve validation errors before copying the file.')
      return
    }
    try {
      await navigator.clipboard.writeText(exportTreeData(data))
      setStatus('JSON copied. Replace public/tree-data.json in the repository, commit, and push.')
    } catch {
      setStatus('Clipboard access was blocked. Use Download JSON instead.')
    }
  }

  function downloadJson() {
    if (!validation.valid) {
      setStatus('Resolve validation errors before downloading the file.')
      return
    }
    const blob = new Blob([exportTreeData(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'tree-data.json'
    link.click()
    URL.revokeObjectURL(url)
    setStatus('tree-data.json downloaded. Replace the repository file and push the change.')
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as TreeData
      const result = validateTreeData(parsed)
      if (!result.valid) {
        setImportErrors(result.errors)
        setStatus('Import stopped because the file is not valid.')
        return
      }
      setImportErrors([])
      onChange(parsed)
      setSelectedPersonId(parsed.people[0]?.id ?? '')
      setSelectedPetId(parsed.pets[0]?.id ?? '')
      setStatus(`${file.name} imported into the local draft.`)
    } catch {
      setImportErrors(['The selected file is not valid JSON.'])
      setStatus('Import stopped because the file could not be read.')
    }
  }

  function resetPublished() {
    onReset()
    setSelectedPersonId(publishedData.people[0]?.id ?? '')
    setSelectedPetId(publishedData.pets[0]?.id ?? '')
    setStatus('Local draft cleared. The published tree-data.json is active again.')
  }

  return (
    <main className="dashboard reveal" id="dashboard-main">
      <section className="dashboard-heading">
        <div>
          <p className="eyebrow">Authenticated local editor</p>
          <h1>Archive dashboard</h1>
          <p>Edit locally, validate, then download the complete replacement data file.</p>
        </div>
        <button className="ghost-button" onClick={onLogout}>Log out</button>
      </section>

      <nav className="dashboard-tabs" aria-label="Dashboard sections">
        {(['archive', 'people', 'pets', 'preview'] as EditorTab[]).map((item) => (
          <button
            key={item}
            className={tab === item ? 'active' : ''}
            onClick={() => setTab(item)}
            aria-current={tab === item ? 'page' : undefined}
          >
            {item === 'archive' ? 'Archive & export' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      <div className="dashboard-grid">
        <section className="editor-panel celestial-panel">
          {tab === 'archive' && (
            <div className="editor-stack">
              <header>
                <p className="section-kicker">Published identity</p>
                <h2>Archive settings</h2>
              </header>
              <div className="form-grid two-column">
                <label>
                  Site title
                  <input value={data.site.title} onChange={(event) => updateSite('title', event.target.value)} />
                </label>
                <label>
                  Subtitle
                  <input value={data.site.subtitle} onChange={(event) => updateSite('subtitle', event.target.value)} />
                </label>
              </div>
              <div className={`validation-box ${validation.valid ? 'valid' : 'invalid'}`}>
                <strong>{validation.valid ? 'Archive is valid' : `${validation.errors.length} issue${validation.errors.length === 1 ? '' : 's'} to resolve`}</strong>
                {!validation.valid && (
                  <ul>{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul>
                )}
                {importErrors.length > 0 && (
                  <ul>{importErrors.map((error) => <li key={error}>{error}</li>)}</ul>
                )}
              </div>
              <div className="export-actions">
                <button className="primary-button" onClick={downloadJson} disabled={!validation.valid}>Download JSON</button>
                <button className="secondary-button" onClick={copyJson} disabled={!validation.valid}>Copy JSON</button>
                <button className="secondary-button" onClick={() => importInput.current?.click()}>Import JSON</button>
                <button className="danger-button" onClick={resetPublished}>Reset to published</button>
                <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={importJson} />
              </div>
              <div className="workflow-note">
                <span>01</span>
                <p>Edit and validate this local draft.</p>
                <span>02</span>
                <p>Download <code>tree-data.json</code>.</p>
                <span>03</span>
                <p>Replace <code>public/tree-data.json</code>, commit, and push. GitHub Actions republishes the archive.</p>
              </div>
            </div>
          )}

          {tab === 'people' && (
            <div className="record-editor">
              <aside className="record-list" aria-label="People">
                <div className="record-list-title">
                  <span>People</span>
                  <small>{data.people.length}</small>
                </div>
                {data.people.map((person) => (
                  <button
                    key={person.id}
                    className={selectedPerson?.id === person.id ? 'active' : ''}
                    onClick={() => setSelectedPersonId(person.id)}
                  >
                    <span>{person.displayName}</span>
                    <small>{person.protected ? 'Core' : person.relationshipLabel || '?'}</small>
                  </button>
                ))}
              </aside>
              {selectedPerson && (
                <div className="record-form">
                  <header className="record-form-header">
                    <div>
                      <p className="section-kicker">Stable ID · {selectedPerson.id}</p>
                      <h2>{selectedPerson.displayName}</h2>
                    </div>
                    {selectedPerson.protected && <span className="protected-badge">Protected</span>}
                  </header>
                  <div className="form-grid two-column">
                    {textFields.map((field) => (
                      <label key={field.key} className={field.textarea ? 'full-width' : ''}>
                        {field.label}
                        {field.textarea ? (
                          <textarea
                            value={String(selectedPerson[field.key] ?? '')}
                            placeholder={field.placeholder}
                            onChange={(event) => updatePerson({ [field.key]: event.target.value } as Partial<Person>)}
                          />
                        ) : (
                          <input
                            value={String(selectedPerson[field.key] ?? '')}
                            placeholder={field.placeholder}
                            type={field.key === 'birthDate' ? 'date' : field.key === 'ageOverride' ? 'number' : 'text'}
                            min={field.key === 'ageOverride' ? 0 : undefined}
                            onChange={(event) => updatePerson({
                              [field.key]: field.key === 'ageOverride'
                                ? (event.target.value === '' ? null : Number(event.target.value))
                                : event.target.value,
                            } as Partial<Person>)}
                          />
                        )}
                        {field.key === 'link' && selectedPerson.link && !isSafeExternalUrl(selectedPerson.link) && (
                          <small className="field-warning">Use an HTTP or HTTPS link.</small>
                        )}
                      </label>
                    ))}
                    <label>
                      Gender
                      <select value={selectedPerson.gender} onChange={(event) => updatePerson({ gender: event.target.value as Person['gender'] })}>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="nonbinary">Nonbinary</option>
                        <option value="prefer-not-to-say">Prefer not to say</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </label>
                    {selectedBirthOrder !== null && (
                      <label>
                        Birth order
                        <input
                          type="number"
                          min="1"
                          value={selectedBirthOrder}
                          onChange={(event) => onChange(updateBirthOrder(data, selectedPerson.id, Number(event.target.value)))}
                        />
                        <small>Higher numbers appear farther left (younger).</small>
                      </label>
                    )}
                  </div>
                  <div className="record-actions">
                    <button className="secondary-button" onClick={addPersonChild}>Add child</button>
                    <button className="secondary-button" onClick={addPersonPartner}>Add partner</button>
                    <button className="danger-button" onClick={removeSelectedPerson} disabled={selectedPerson.protected}>Delete person</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'pets' && (
            <div className="record-editor">
              <aside className="record-list" aria-label="Pets">
                <div className="record-list-title">
                  <span>Pets</span>
                  <button className="mini-button" onClick={addNewPet}>Add</button>
                </div>
                {data.pets.length === 0 && <p className="record-list-empty">No pets published yet.</p>}
                {data.pets.map((pet) => (
                  <button
                    key={pet.id}
                    className={selectedPet?.id === pet.id ? 'active' : ''}
                    onClick={() => setSelectedPetId(pet.id)}
                  >
                    <span>{pet.displayName}</span>
                    <small>{pet.species || '?'}</small>
                  </button>
                ))}
              </aside>
              {selectedPet ? (
                <div className="record-form">
                  <header className="record-form-header">
                    <div>
                      <p className="section-kicker">Stable ID · {selectedPet.id}</p>
                      <h2>{selectedPet.displayName}</h2>
                    </div>
                    {selectedPet.protected && <span className="protected-badge">Protected</span>}
                  </header>
                  <div className="form-grid two-column">
                    {petTextFields.map((field) => (
                      <label key={field.key} className={field.textarea ? 'full-width' : ''}>
                        {field.label}
                        {field.textarea ? (
                          <textarea
                            value={String(selectedPet[field.key] ?? '')}
                            placeholder={field.placeholder}
                            onChange={(event) => updatePet({ [field.key]: event.target.value } as Partial<Pet>)}
                          />
                        ) : (
                          <input
                            value={String(selectedPet[field.key] ?? '')}
                            placeholder={field.placeholder}
                            type={field.key === 'birthDate' ? 'date' : field.key === 'ageOverride' ? 'number' : 'text'}
                            min={field.key === 'ageOverride' ? 0 : undefined}
                            onChange={(event) => updatePet({
                              [field.key]: field.key === 'ageOverride'
                                ? (event.target.value === '' ? null : Number(event.target.value))
                                : event.target.value,
                            } as Partial<Pet>)}
                          />
                        )}
                      </label>
                    ))}
                    <label>
                      Gender
                      <select value={selectedPet.gender} onChange={(event) => updatePet({ gender: event.target.value as Pet['gender'] })}>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="nonbinary">Nonbinary</option>
                        <option value="prefer-not-to-say">Prefer not to say</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </label>
                    <label>
                      Human owner
                      <select value={selectedPet.ownerPersonId} onChange={(event) => updatePet({ ownerPersonId: event.target.value })}>
                        <option value="">None / unknown</option>
                        {data.people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
                      </select>
                    </label>
                    {selectedPetBirthOrder !== null && (
                      <label>
                        Birth order
                        <input
                          type="number"
                          min="1"
                          value={selectedPetBirthOrder}
                          onChange={(event) => onChange(updatePetBirthOrder(data, selectedPet.id, Number(event.target.value)))}
                        />
                        <small>Higher numbers appear farther left (younger).</small>
                      </label>
                    )}
                  </div>
                  <div className="record-actions">
                    <button className="secondary-button" onClick={addPetChild}>Add offspring</button>
                    <button className="secondary-button" onClick={addSelectedPetPartner}>Add pet partner</button>
                    <button className="danger-button" onClick={removeSelectedPet} disabled={selectedPet.protected}>Delete pet</button>
                  </div>
                </div>
              ) : (
                <div className="empty-editor">
                  <p className="eyebrow">Pet archive</p>
                  <h2>Begin a separate lineage</h2>
                  <p>Add a pet, then optionally assign a human owner and offspring.</p>
                  <button className="primary-button" onClick={addNewPet}>Add first pet</button>
                </div>
              )}
            </div>
          )}

          {tab === 'preview' && (
            <div className="editor-stack">
              <header>
                <p className="section-kicker">Live local rendering</p>
                <h2>Graph preview</h2>
              </header>
              <LineageGraph mode="people" people={data.people} families={data.families} pets={data.pets} petFamilies={data.petFamilies} />
              <LineageGraph mode="pets" people={data.people} families={data.families} pets={data.pets} petFamilies={data.petFamilies} />
            </div>
          )}
        </section>

        <aside className="dashboard-aside">
          <div className="celestial-panel status-card" aria-live="polite">
            <p className="section-kicker">Current state</p>
            <p>{status}</p>
            <dl>
              <div><dt>People</dt><dd>{data.people.length}</dd></div>
              <div><dt>Pets</dt><dd>{data.pets.length}</dd></div>
              <div><dt>Validation</dt><dd>{validation.valid ? 'Ready' : 'Needs attention'}</dd></div>
            </dl>
          </div>
          <div className="privacy-card">
            <span aria-hidden="true">◌</span>
            <div>
              <strong>Everything published is public</strong>
              <p>Avoid private addresses, private dates, or portraits without permission.</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
