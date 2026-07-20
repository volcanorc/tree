import { ChangeEvent, FormEvent, useMemo, useRef, useState } from 'react'
import type { PersonDeletePlan, PetDeletePlan, Pet, Person, TreeData } from '../types'
import {
  addChild,
  addPartner,
  addPetOffspring,
  addPetPartner,
  createBlankPet,
  applyPetDeletePlan,
  applyPersonDeletePlan,
  calculateAge,
  dateFieldError,
  exportTreeData,
  getBirthOrder,
  getPetBirthOrder,
  isAutomaticPortraitPath,
  makeId,
  isSafeExternalUrl,
  isSafePortrait,
  migrateTreeData,
  normalizeArchiveDate,
  nextPetPortraitNumber,
  personPortraitPath,
  petPortraitPath,
  planPetDeletion,
  planPersonDeletion,
  updateBirthOrder,
  updatePetBirthOrder,
  validateTreeData,
} from '../lib/data'
import { verifyLogin } from '../lib/auth'
import { useCurrentDate } from '../hooks/useCurrentDate'
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
  { key: 'birthDetails', label: 'Born / origin details', placeholder: 'Shown when birth date is empty' },
  { key: 'relationshipLabel', label: 'Relationship label', placeholder: 'e.g. Eldest son' },
  { key: 'personality', label: 'Personality', placeholder: 'A few defining qualities' },
  { key: 'biography', label: 'Short biography', placeholder: 'A public, concise life note', textarea: true },
  { key: 'portrait', label: 'Portrait path or HTTPS PNG URL', placeholder: 'portraits/1.png' },
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
  { key: 'birthDate', label: 'Birth date', placeholder: 'YYYY, YYYY-MM, or YYYY-MM-DD' },
  { key: 'birthDetails', label: 'Born / origin details', placeholder: 'Shown when birth date is empty' },
  { key: 'personality', label: 'Personality', placeholder: 'Temperament and favorite things' },
  { key: 'biography', label: 'Short biography', placeholder: 'A short public story', textarea: true },
  { key: 'portrait', label: 'Portrait path or HTTPS PNG URL', placeholder: 'portraits/pets/1.png' },
]

function LinkEditor({ links, onChange }: { links: string[]; onChange: (links: string[]) => void }) {
  const safeLinks = Array.isArray(links) ? links : []
  const rows = safeLinks.length > 0 ? safeLinks : ['']
  const updateLink = (index: number, value: string) => {
    const next = [...rows]
    next[index] = value
    onChange(next)
  }

  return (
    <fieldset className="link-editor full-width">
      <legend>
        <span>Video or profile links</span>
        <button
          className="mini-button link-add-button"
          type="button"
          onClick={() => onChange([...rows, ''])}
          aria-label="Add another profile link"
        >
          +
        </button>
      </legend>
      <div className="link-rows">
        {rows.map((link, index) => (
          <div className="link-row" key={index}>
            <label>
              <span className="visually-hidden">Profile link {index + 1}</span>
              <input
                value={link}
                placeholder="https://…"
                type="url"
                onChange={(event) => updateLink(index, event.target.value)}
                aria-invalid={Boolean(link && !isSafeExternalUrl(link))}
              />
              {link && !isSafeExternalUrl(link) && <small className="field-warning">Use an HTTP or HTTPS link.</small>}
            </label>
            {index > 0 && (
              <button
                className="mini-button link-remove-button"
                type="button"
                onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                aria-label={`Remove profile link ${index + 1}`}
              >
                −
              </button>
            )}
          </div>
        ))}
      </div>
    </fieldset>
  )
}

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
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<PersonDeletePlan | null>(null)
  const [petSelectionMode, setPetSelectionMode] = useState(false)
  const [selectedPetIds, setSelectedPetIds] = useState<Set<string>>(new Set())
  const [pendingPetDelete, setPendingPetDelete] = useState<PetDeletePlan | null>(null)
  const [showChildChooser, setShowChildChooser] = useState(false)
  const [showPartnerChooser, setShowPartnerChooser] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const validation = useMemo(() => validateTreeData(data), [data])
  const currentDate = useCurrentDate()

  if (!authenticated) {
    return <DashboardLogin data={data} onAuthenticated={onAuthenticated} />
  }

  const selectedPerson = data.people.find((person) => person.id === selectedPersonId) ?? data.people[0]
  const selectedPet = data.pets.find((pet) => pet.id === selectedPetId) ?? data.pets[0]
  const selectedPartnerUnits = selectedPerson
    ? data.families.filter((family) => family.parentIds.length === 2 && family.parentIds.includes(selectedPerson.id))
    : []
  const childPartnerChoices = selectedPartnerUnits.map((family) => {
    const partnerId = family.parentIds.find((id) => id !== selectedPerson?.id) ?? ''
    const partner = data.people.find((person) => person.id === partnerId)
    return { family, partner, baseLabel: partner?.displayName.trim() || partnerId || '?' }
  }).map((choice, _index, choices) => ({
    ...choice,
    label: choices.filter((candidate) => candidate.baseLabel === choice.baseLabel).length > 1
      ? `${choice.baseLabel} · Portrait ${choice.partner?.portraitNumber ?? '?'}`
      : choice.baseLabel,
  }))
  const selectedBirthOrder = selectedPerson ? getBirthOrder(data, selectedPerson.id) : null
  const selectedPetBirthOrder = selectedPet ? getPetBirthOrder(data, selectedPet.id) : null
  const personPortraitNumberError = selectedPerson
    ? !Number.isInteger(selectedPerson.portraitNumber) || selectedPerson.portraitNumber < 1
      ? 'Use a positive whole number.'
      : data.people.some((person) => person.id !== selectedPerson.id && person.portraitNumber === selectedPerson.portraitNumber)
        ? `Portrait ${selectedPerson.portraitNumber} is already assigned to another person.`
        : ''
    : ''
  const petPortraitNumberError = selectedPet
    ? !Number.isInteger(selectedPet.portraitNumber) || selectedPet.portraitNumber < 1
      ? 'Use a positive whole number.'
      : data.pets.some((pet) => pet.id !== selectedPet.id && pet.portraitNumber === selectedPet.portraitNumber)
        ? `Pet portrait ${selectedPet.portraitNumber} is already assigned to another pet.`
        : ''
    : ''
  const personBirthDateError = selectedPerson ? dateFieldError(selectedPerson.birthDate, false, currentDate) : ''
  const personDeathDateError = selectedPerson ? dateFieldError(selectedPerson.deathDate, false, currentDate) : ''
  const petBirthDateError = selectedPet ? dateFieldError(selectedPet.birthDate, true, currentDate) : ''
  const petDeathDateError = selectedPet ? dateFieldError(selectedPet.deathDate, true, currentDate) : ''
  const selectedPersonAge = selectedPerson
    ? calculateAge(selectedPerson.birthDate, currentDate, selectedPerson.deathDate, selectedPerson.status)
    : '?'
  const selectedPetAge = selectedPet
    ? calculateAge(selectedPet.birthDate, currentDate, selectedPet.deathDate, selectedPet.status, true)
    : '?'

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

  function updatePersonPortraitNumber(portraitNumber: number) {
    if (!selectedPerson) return
    const syncPath = !selectedPerson.portrait.trim()
      || isAutomaticPortraitPath(selectedPerson.portrait, 'person', selectedPerson.portraitNumber)
    updatePerson({
      portraitNumber,
      portrait: syncPath ? personPortraitPath(portraitNumber) : selectedPerson.portrait,
    })
  }

  function updatePetPortraitNumber(portraitNumber: number) {
    if (!selectedPet) return
    const syncPath = !selectedPet.portrait.trim()
      || isAutomaticPortraitPath(selectedPet.portrait, 'pet', selectedPet.portraitNumber)
    updatePet({
      portraitNumber,
      portrait: syncPath ? petPortraitPath(portraitNumber) : selectedPet.portrait,
    })
  }

  function addPersonChild() {
    if (!selectedPerson) return
    if (selectedPartnerUnits.length > 1) {
      setShowChildChooser(true)
      return
    }
    if (selectedPartnerUnits.length === 1) {
      completeAddPersonChild(selectedPartnerUnits[0].id)
      return
    }
    const singleParentUnit = data.families.find((family) => family.parentIds.length === 1 && family.parentIds[0] === selectedPerson.id)
    completeAddPersonChild(singleParentUnit?.id ?? 'single')
  }

  function completeAddPersonChild(familyId?: string | 'single') {
    if (!selectedPerson) return
    const next = addChild(data, selectedPerson.id, 'New child', familyId)
    const newPerson = next.people[next.people.length - 1]
    onChange(next)
    setSelectedPersonId(newPerson.id)
    setShowChildChooser(false)
    setStatus(`${newPerson.displayName} added as the youngest child. Complete the placeholders, then export JSON.`)
  }

  function addPersonPartner() {
    if (!selectedPerson) return
    const soloUnits = data.families.filter((family) => family.parentIds.length === 1 && family.parentIds[0] === selectedPerson.id)
    if (soloUnits.length > 0) {
      setShowPartnerChooser(true)
      return
    }
    completeAddPersonPartner()
  }

  function completeAddPersonPartner(attachFamilyId?: string) {
    if (!selectedPerson) return
    const next = addPartner(data, selectedPerson.id, 'New partner', attachFamilyId)
    const newPerson = next.people[next.people.length - 1]
    onChange(next)
    setSelectedPersonId(newPerson.id)
    setShowPartnerChooser(false)
    setStatus('Partner added. Their shared family branch is ready for children.')
  }

  function removeSelectedPerson() {
    if (!selectedPerson) return
    beginPersonDeletion([selectedPerson.id])
  }

  function beginPersonDeletion(ids: string[]) {
    const plan = planPersonDeletion(data, ids)
    if (plan.blockedReason) {
      setStatus(plan.blockedReason)
      return
    }
    if (!plan.deleteIds.length) return
    setPendingDelete(plan)
  }

  function confirmPersonDeletion() {
    if (!pendingDelete) return
    const anchorId = pendingDelete.deleteIds.includes(selectedPersonId) ? selectedPersonId : pendingDelete.requestedIds[0]
    const currentIndex = Math.max(0, data.people.findIndex((person) => person.id === anchorId))
    const removedNames = pendingDelete.deleteIds
      .map((id) => data.people.find((person) => person.id === id)?.displayName)
      .filter(Boolean)
    const next = applyPersonDeletePlan(data, pendingDelete)
    const nextSelected = next.people[Math.min(currentIndex, Math.max(0, next.people.length - 1))]
    onChange(next)
    setSelectedPersonId(nextSelected?.id ?? '')
    setSelectedPersonIds(new Set())
    setSelectionMode(false)
    setPendingDelete(null)
    setStatus(`${removedNames.join(', ')} ${removedNames.length === 1 ? 'was' : 'were'} removed from this local draft.`)
  }

  function toggleBulkPerson(id: string) {
    const person = data.people.find((candidate) => candidate.id === id)
    if (!person || person.protected) return
    setSelectedPersonIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addNewPet() {
    const pet = createBlankPet(nextPetId(data), 'New pet', nextPetPortraitNumber(data))
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
    beginPetDeletion([selectedPet.id])
  }

  function beginPetDeletion(ids: string[]) {
    const plan = planPetDeletion(data, ids)
    if (plan.blockedReason) {
      setStatus(plan.blockedReason)
      return
    }
    if (!plan.deleteIds.length) return
    setPendingPetDelete(plan)
  }

  function confirmPetDeletion() {
    if (!pendingPetDelete) return
    const anchorId = pendingPetDelete.deleteIds.includes(selectedPetId) ? selectedPetId : pendingPetDelete.requestedIds[0]
    const currentIndex = Math.max(0, data.pets.findIndex((pet) => pet.id === anchorId))
    const removedNames = pendingPetDelete.deleteIds
      .map((id) => data.pets.find((pet) => pet.id === id)?.displayName)
      .filter(Boolean)
    const next = applyPetDeletePlan(data, pendingPetDelete)
    const nextSelected = next.pets[Math.min(currentIndex, Math.max(0, next.pets.length - 1))]
    onChange(next)
    setSelectedPetId(nextSelected?.id ?? '')
    setSelectedPetIds(new Set())
    setPetSelectionMode(false)
    setPendingPetDelete(null)
    setStatus(`${removedNames.join(', ')} ${removedNames.length === 1 ? 'was' : 'were'} removed from this local draft.`)
  }

  function toggleBulkPet(id: string) {
    const pet = data.pets.find((candidate) => candidate.id === id)
    if (!pet || pet.protected) return
    setSelectedPetIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
      const parsed = migrateTreeData(JSON.parse(await file.text()))
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
          <p className="eyebrow">Every detail preserved.</p>
          <h1>Archive dashboard</h1>
          <p>Modify the current family history.</p>
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
                  <ul>{validation.errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul>
                )}
                {importErrors.length > 0 && (
                  <ul>{importErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul>
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
                  <label className="bulk-toggle">
                    <input
                      type="checkbox"
                      checked={selectionMode}
                      onChange={(event) => {
                        setSelectionMode(event.target.checked)
                        if (!event.target.checked) setSelectedPersonIds(new Set())
                      }}
                    />
                    <span>People</span>
                  </label>
                  <small>{data.people.length}</small>
                </div>
                {selectionMode && (
                  <div className="bulk-actions">
                    <span>{selectedPersonIds.size} selected</span>
                    <button
                      className="mini-button danger-mini"
                      type="button"
                      disabled={selectedPersonIds.size === 0}
                      onClick={() => beginPersonDeletion([...selectedPersonIds])}
                    >
                      Delete selected
                    </button>
                  </div>
                )}
                {data.people.map((person) => (
                  <div className={`record-row ${selectedPerson?.id === person.id ? 'active' : ''}`} key={person.id}>
                    {selectionMode && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${person.displayName}`}
                        checked={selectedPersonIds.has(person.id)}
                        disabled={person.protected}
                        onChange={() => toggleBulkPerson(person.id)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => selectionMode ? toggleBulkPerson(person.id) : setSelectedPersonId(person.id)}
                    >
                      <span>{person.displayName}</span>
                      <small>{person.protected ? 'Core · locked' : person.relationshipLabel || '?'}</small>
                    </button>
                  </div>
                ))}
              </aside>
              {selectedPerson && (
                <div className="record-form">
                  <header className="record-form-header">
                    <div>
                      <p className="section-kicker">Editing: {selectedPerson.displayName}</p>
                      <p className="stable-id">Stable ID · {selectedPerson.id}</p>
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
                            type={field.key === 'birthDate' ? 'date' : 'text'}
                            aria-invalid={field.key === 'birthDate' ? Boolean(personBirthDateError) : undefined}
                            onChange={(event) => updatePerson({ [field.key]: event.target.value } as Partial<Person>)}
                          />
                        )}
                        {field.key === 'birthDate' && personBirthDateError && (
                          <small className="field-warning" role="alert">{personBirthDateError}</small>
                        )}
                        {field.key === 'portrait' && !isSafePortrait(selectedPerson.portrait) && (
                          <small className="field-warning">Use a repository PNG path or HTTPS PNG URL.</small>
                        )}
                      </label>
                    ))}
                    <LinkEditor links={selectedPerson.links} onChange={(links) => updatePerson({ links })} />
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
                    <label>
                      Status
                      <select
                        value={selectedPerson.status}
                        onChange={(event) => {
                          const nextStatus = event.target.value as Person['status']
                          updatePerson({ status: nextStatus, ...(nextStatus === 'alive' ? { deathDate: '' } : {}) })
                        }}
                      >
                        <option value="alive">Alive</option>
                        <option value="dead">Dead</option>
                      </select>
                    </label>
                    {selectedPerson.status === 'dead' && (
                      <label className="death-date-reveal">
                        Death date
                        <input
                          type="date"
                          value={selectedPerson.deathDate}
                          aria-invalid={Boolean(personDeathDateError)}
                          onChange={(event) => updatePerson({ deathDate: event.target.value })}
                        />
                        {personDeathDateError && <small className="field-warning" role="alert">{personDeathDateError}</small>}
                      </label>
                    )}
                    <label>
                      Calculated age
                      <input value={selectedPersonAge} readOnly aria-readonly="true" />
                      <small>Calculated from birth date and death date (when supplied).</small>
                    </label>
                    <label>
                      Portrait number
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={selectedPerson.portraitNumber}
                        aria-invalid={Boolean(personPortraitNumberError)}
                        onChange={(event) => updatePersonPortraitNumber(Number(event.target.value))}
                      />
                      <small>Automatic path: portraits/{selectedPerson.portraitNumber}.png</small>
                      {personPortraitNumberError && <small className="field-warning" role="alert">{personPortraitNumberError}</small>}
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
                  <label className="bulk-toggle">
                    <input
                      type="checkbox"
                      checked={petSelectionMode}
                      onChange={(event) => {
                        setPetSelectionMode(event.target.checked)
                        if (!event.target.checked) setSelectedPetIds(new Set())
                      }}
                    />
                    <span>Pets</span>
                  </label>
                  <div className="record-list-title-actions">
                    <small>{data.pets.length}</small>
                    <button className="mini-button" onClick={addNewPet}>Add</button>
                  </div>
                </div>
                {petSelectionMode && (
                  <div className="bulk-actions">
                    <span>{selectedPetIds.size} selected</span>
                    <button
                      className="mini-button danger-mini"
                      type="button"
                      disabled={selectedPetIds.size === 0}
                      onClick={() => beginPetDeletion([...selectedPetIds])}
                    >
                      Delete selected
                    </button>
                  </div>
                )}
                {data.pets.length === 0 && <p className="record-list-empty">No pets published yet.</p>}
                {data.pets.map((pet) => (
                  <div className={`record-row ${selectedPet?.id === pet.id ? 'active' : ''}`} key={pet.id}>
                    {petSelectionMode && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${pet.displayName}`}
                        checked={selectedPetIds.has(pet.id)}
                        disabled={pet.protected}
                        onChange={() => toggleBulkPet(pet.id)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => petSelectionMode ? toggleBulkPet(pet.id) : setSelectedPetId(pet.id)}
                    >
                      <span>{pet.displayName}</span>
                      <small>{pet.protected ? `${pet.species || '?'} · locked` : pet.species || '?'}</small>
                    </button>
                  </div>
                ))}
              </aside>
              {selectedPet ? (
                <div className="record-form">
                  <header className="record-form-header">
                    <div>
                      <p className="section-kicker">Editing: {selectedPet.displayName}</p>
                      <p className="stable-id">Stable ID · {selectedPet.id}</p>
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
                            type="text"
                            aria-invalid={field.key === 'birthDate' ? Boolean(petBirthDateError) : undefined}
                            onChange={(event) => updatePet({ [field.key]: event.target.value } as Partial<Pet>)}
                            onBlur={() => {
                              if (field.key === 'birthDate' && selectedPet.birthDate.trim()) {
                                updatePet({ birthDate: normalizeArchiveDate(selectedPet.birthDate, true) })
                              }
                            }}
                          />
                        )}
                        {field.key === 'birthDate' && petBirthDateError && (
                          <small className="field-warning" role="alert">{petBirthDateError}</small>
                        )}
                        {field.key === 'portrait' && !isSafePortrait(selectedPet.portrait) && (
                          <small className="field-warning">Use a repository PNG path or HTTPS PNG URL.</small>
                        )}
                      </label>
                    ))}
                    <LinkEditor links={selectedPet.links} onChange={(links) => updatePet({ links })} />
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
                      Status
                      <select
                        value={selectedPet.status}
                        onChange={(event) => {
                          const nextStatus = event.target.value as Pet['status']
                          updatePet({ status: nextStatus, ...(nextStatus === 'alive' ? { deathDate: '' } : {}) })
                        }}
                      >
                        <option value="alive">Alive</option>
                        <option value="dead">Dead</option>
                      </select>
                    </label>
                    {selectedPet.status === 'dead' && (
                      <label className="death-date-reveal">
                        Death date
                        <input
                          type="text"
                          value={selectedPet.deathDate}
                          placeholder="YYYY, YYYY-MM, or YYYY-MM-DD"
                          aria-invalid={Boolean(petDeathDateError)}
                          onChange={(event) => updatePet({ deathDate: event.target.value })}
                          onBlur={() => {
                            if (selectedPet.deathDate.trim()) {
                              updatePet({ deathDate: normalizeArchiveDate(selectedPet.deathDate, true) })
                            }
                          }}
                        />
                        {petDeathDateError && <small className="field-warning" role="alert">{petDeathDateError}</small>}
                      </label>
                    )}
                    <label>
                      Calculated age
                      <input value={selectedPetAge} readOnly aria-readonly="true" />
                      <small>Calculated from the accepted birth-date precision.</small>
                    </label>
                    <label>
                      Human owner
                      <select value={selectedPet.ownerPersonId} onChange={(event) => updatePet({ ownerPersonId: event.target.value })}>
                        <option value="">None / unknown</option>
                        {data.people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
                      </select>
                    </label>
                    <label>
                      Portrait number
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={selectedPet.portraitNumber}
                        aria-invalid={Boolean(petPortraitNumberError)}
                        onChange={(event) => updatePetPortraitNumber(Number(event.target.value))}
                      />
                      <small>Automatic path: portraits/pets/{selectedPet.portraitNumber}.png</small>
                      {petPortraitNumberError && <small className="field-warning" role="alert">{petPortraitNumberError}</small>}
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
      {showChildChooser && selectedPerson && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowChildChooser(false)}>
          <section className="dashboard-modal celestial-panel" role="dialog" aria-modal="true" aria-labelledby="child-unit-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Choose the parents</p>
            <h2 id="child-unit-title">Which branch does this child belong to?</h2>
            <p>Select the other parent for {selectedPerson.displayName}.</p>
            <div className="choice-grid">
              {childPartnerChoices.map(({ family, label }) => (
                <button className="secondary-button" type="button" key={family.id} onClick={() => completeAddPersonChild(family.id)}>
                  {label}
                </button>
              ))}
            </div>
            <button className="ghost-button modal-cancel" type="button" onClick={() => setShowChildChooser(false)}>Cancel</button>
          </section>
        </div>
      )}
      {showPartnerChooser && selectedPerson && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowPartnerChooser(false)}>
          <section className="dashboard-modal celestial-panel" role="dialog" aria-modal="true" aria-labelledby="partner-unit-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Add another partner</p>
            <h2 id="partner-unit-title">Where should this partnership begin?</h2>
            <p>Attach the partner to an existing single-parent branch, or start a separate union.</p>
            <div className="choice-grid">
              {data.families.filter((family) => family.parentIds.length === 1 && family.parentIds[0] === selectedPerson.id).map((family) => (
                <button className="secondary-button" type="button" key={family.id} onClick={() => completeAddPersonPartner(family.id)}>
                  Attach to branch with {family.children.length} {family.children.length === 1 ? 'child' : 'children'}
                </button>
              ))}
              <button className="secondary-button" type="button" onClick={() => completeAddPersonPartner()}>Start separate union</button>
            </div>
            <button className="ghost-button modal-cancel" type="button" onClick={() => setShowPartnerChooser(false)}>Cancel</button>
          </section>
        </div>
      )}
      {pendingDelete && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingDelete(null)}>
          <section className="dashboard-modal celestial-panel delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Permanent draft change</p>
            <h2 id="delete-title">Delete {pendingDelete.deleteIds.length} {pendingDelete.deleteIds.length === 1 ? 'person' : 'people'}?</h2>
            <p>
              Selected: {pendingDelete.requestedIds.map((id) => data.people.find((person) => person.id === id)?.displayName ?? id).join(', ')}
            </p>
            {pendingDelete.cascadeIds.length > 0 && (
              <p className="cascade-warning">
                This also removes the descendant branch: {pendingDelete.cascadeIds.map((id) => data.people.find((person) => person.id === id)?.displayName ?? id).join(', ')}
              </p>
            )}
            <div className="modal-actions">
              <button className="danger-button" type="button" onClick={confirmPersonDeletion}>Delete permanently</button>
              <button className="ghost-button" type="button" onClick={() => setPendingDelete(null)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {pendingPetDelete && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingPetDelete(null)}>
          <section className="dashboard-modal celestial-panel delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="pet-delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Permanent draft change</p>
            <h2 id="pet-delete-title">Delete {pendingPetDelete.deleteIds.length} {pendingPetDelete.deleteIds.length === 1 ? 'pet' : 'pets'}?</h2>
            <p>
              Selected: {pendingPetDelete.requestedIds.map((id) => data.pets.find((pet) => pet.id === id)?.displayName ?? id).join(', ')}
            </p>
            {pendingPetDelete.cascadeIds.length > 0 && (
              <p className="cascade-warning">
                This also removes the offspring branch: {pendingPetDelete.cascadeIds.map((id) => data.pets.find((pet) => pet.id === id)?.displayName ?? id).join(', ')}
              </p>
            )}
            <div className="modal-actions">
              <button className="danger-button" type="button" onClick={confirmPetDeletion}>Delete permanently</button>
              <button className="ghost-button" type="button" onClick={() => setPendingPetDelete(null)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
