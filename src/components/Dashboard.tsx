import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ArchiveEditIntent, ArchiveEditRequest, PersonDeletePlan, PetDeletePlan, Pet, Person, TreeData } from '../types'
import {
  addChild,
  addPartner,
  addPetOffspring,
  addPetPartner,
  addPetSibling,
  addSibling,
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
  portraitNumberFromPath,
  planPetDeletion,
  planPersonDeletion,
  updateBirthOrder,
  updatePetBirthOrder,
  validateTreeData,
} from '../lib/data'
import { verifyLogin } from '../lib/auth'
import { lineageSurnameAfterNameChange } from '../lib/lineage'
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
  onNavigateToOwner?: (personId: string) => void
  onNavigateToPet?: (petId: string) => void
  editRequest?: ArchiveEditRequest | null
  onEditRequestHandled?: (requestId: number) => void
  onEditIntent?: (intent: ArchiveEditIntent) => void
}

type EditorTab = 'archive' | 'people' | 'pets' | 'preview'

const textFields: Array<{
  key: keyof Person
  label: string
  placeholder?: string
  textarea?: boolean
  helper?: string
}> = [
  { key: 'displayName', label: 'Display name', placeholder: 'Full or public name' },
  {
    key: 'lineageSurname',
    label: 'Lineage surname',
    placeholder: 'Inherited or birth family name',
    helper: 'The inherited or birth family line; this may differ from a current married surname.',
  },
  { key: 'nickname', label: 'Nickname', placeholder: '?' },
  { key: 'birthDate', label: 'Birth date', placeholder: 'YYYY-MM-DD' },
  { key: 'birthDetails', label: 'Born / origin details', placeholder: 'Shown when birth date is empty' },
  { key: 'relationshipLabel', label: 'Relationship label', placeholder: 'e.g. Eldest son' },
  { key: 'personality', label: 'Personality', placeholder: 'A few defining qualities' },
  { key: 'biography', label: 'Short biography', placeholder: 'A public, concise life note', textarea: true },
  { key: 'portrait', label: 'Portrait path or HTTPS PNG URL', placeholder: 'portraits/1.png' },
]

const PERSON_NEW_RECORD_FIELDS = new Set<keyof Person>([
  'displayName',
  'lineageSurname',
  'nickname',
  'birthDate',
  'birthDetails',
  'personality',
  'biography',
  'links',
  'gender',
])

const petTextFields: Array<{
  key: keyof Pet
  label: string
  placeholder?: string
  textarea?: boolean
}> = [
  { key: 'displayName', label: 'Name', placeholder: 'Pet name' },
  { key: 'species', label: 'Species', placeholder: 'Dog, cat, bird…' },
  { key: 'breed', label: 'Breed', placeholder: 'e.g. Puspin, Aspin, Chihuahua' },
  { key: 'birthDate', label: 'Birth date', placeholder: 'Year, year-month, or year-month-day' },
  { key: 'birthDetails', label: 'Born / origin details', placeholder: 'Where the pet was born or found' },
  { key: 'personality', label: 'Personality', placeholder: 'Personality of the pet' },
  { key: 'biography', label: 'Short biography', placeholder: 'Short description or story of the pet', textarea: true },
  { key: 'portrait', label: 'Portrait path or HTTPS PNG URL', placeholder: 'portraits/pets/1.png' },
]

const PET_NEW_RECORD_FIELDS = new Set<keyof Pet>([
  'displayName',
  'species',
  'breed',
  'birthDate',
  'birthDetails',
  'personality',
  'biography',
  'links',
  'gender',
  'ownerPersonId',
])

const PERSON_COMPLETENESS_FIELDS = new Set<keyof Person>([
  'lineageSurname',
  'nickname',
  'birthDetails',
  'personality',
  'biography',
  'links',
  'gender',
])

const PET_COMPLETENESS_FIELDS = new Set<keyof Pet>([
  'species',
  'breed',
  'birthDetails',
  'personality',
  'biography',
  'links',
])

function LinkEditor({
  links,
  onChange,
  attention = false,
  onAcknowledge,
}: {
  links: string[]
  onChange: (links: string[]) => void
  attention?: boolean
  onAcknowledge?: () => void
}) {
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
            <label className={attention && index === 0 ? 'new-record-field-attention' : undefined}>
              <span className="visually-hidden">Profile link {index + 1}</span>
              <input
                value={link}
                placeholder="https://…"
                type="url"
                onFocus={index === 0 ? onAcknowledge : undefined}
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
  const {
    data,
    publishedData,
    authenticated,
    onAuthenticated,
    onLogout,
    onChange,
    onReset,
    onNavigateToOwner,
    onNavigateToPet,
    editRequest = null,
    onEditRequestHandled,
    onEditIntent,
  } = props
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
  const [childChooserPersonId, setChildChooserPersonId] = useState<string | null>(null)
  const [partnerChooserPersonId, setPartnerChooserPersonId] = useState<string | null>(null)
  const [offspringChooserPetId, setOffspringChooserPetId] = useState<string | null>(null)
  const [partnerChooserPetId, setPartnerChooserPetId] = useState<string | null>(null)
  const [acknowledgedDeathFields, setAcknowledgedDeathFields] = useState<Set<string>>(new Set())
  const [newRecordAttention, setNewRecordAttention] = useState<Map<string, Set<string>>>(new Map())
  const [acknowledgedAttentionFields, setAcknowledgedAttentionFields] = useState<Set<string>>(new Set())
  const handledEditRequestId = useRef<number | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const validation = useMemo(() => validateTreeData(data), [data])
  const currentDate = useCurrentDate()

  useEffect(() => {
    if (!authenticated || !editRequest || handledEditRequestId.current === editRequest.requestId) return
    const timer = window.setTimeout(() => {
      if (handledEditRequestId.current === editRequest.requestId) return
      handledEditRequestId.current = editRequest.requestId
      if (editRequest.kind === 'person') {
        if (!data.people.some((person) => person.id === editRequest.entityId)) {
          setStatus('The selected person is no longer available.')
        } else {
          setSelectionMode(false)
          setSelectedPersonIds(new Set())
          setSelectedPersonId(editRequest.entityId)
          setTab('people')
          if (editRequest.action === 'child') addPersonChild(editRequest.entityId)
          if (editRequest.action === 'partner') addPersonPartner(editRequest.entityId)
          if (editRequest.action === 'sibling') addPersonSibling(editRequest.entityId)
          if (editRequest.action === 'settings') setStatus(`Editing ${data.people.find((person) => person.id === editRequest.entityId)?.displayName ?? 'person'}.`)
          if (editRequest.action === 'delete') beginPersonDeletion([editRequest.entityId])
        }
      } else if (!data.pets.some((pet) => pet.id === editRequest.entityId)) {
        setStatus('The selected pet is no longer available.')
      } else {
        setPetSelectionMode(false)
        setSelectedPetIds(new Set())
        setSelectedPetId(editRequest.entityId)
        setTab('pets')
        if (editRequest.action === 'child') addPetChild(editRequest.entityId)
        if (editRequest.action === 'partner') addSelectedPetPartner(editRequest.entityId)
        if (editRequest.action === 'sibling') addSelectedPetSibling(editRequest.entityId)
        if (editRequest.action === 'settings') setStatus(`Editing ${data.pets.find((pet) => pet.id === editRequest.entityId)?.displayName ?? 'pet'}.`)
        if (editRequest.action === 'delete') beginPetDeletion([editRequest.entityId])
      }
      onEditRequestHandled?.(editRequest.requestId)
    }, 0)
    return () => window.clearTimeout(timer)
    // The request ID is the event boundary; creation handlers intentionally read the current data snapshot once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, editRequest?.requestId])

  if (!authenticated) {
    return <DashboardLogin data={data} onAuthenticated={onAuthenticated} />
  }

  const selectedPerson = data.people.find((person) => person.id === selectedPersonId) ?? data.people[0]
  const selectedPet = data.pets.find((pet) => pet.id === selectedPetId) ?? data.pets[0]
  const ownedPets = selectedPerson
    ? data.pets.filter((pet) => pet.ownerPersonId === selectedPerson.id)
    : []
  const selectedPersonParents = selectedPerson
    ? (data.families.find((family) => family.children.some((child) => child.personId === selectedPerson.id))?.parentIds ?? [])
        .map((id) => data.people.find((person) => person.id === id))
        .filter((person): person is Person => Boolean(person))
    : []
  const selectedPetOwner = selectedPet
    ? data.people.find((person) => person.id === selectedPet.ownerPersonId)
    : undefined
  const childChooserPerson = childChooserPersonId ? data.people.find((person) => person.id === childChooserPersonId) : undefined
  const childPartnerChoices = childChooserPerson
    ? data.families.filter((family) => family.parentIds.length === 2 && family.parentIds.includes(childChooserPerson.id)).map((family) => {
    const partnerId = family.parentIds.find((id) => id !== childChooserPerson.id) ?? ''
    const partner = data.people.find((person) => person.id === partnerId)
    return { family, partner, baseLabel: partner?.displayName.trim() || partnerId || '?' }
  }).map((choice, _index, choices) => ({
    ...choice,
    label: choices.filter((candidate) => candidate.baseLabel === choice.baseLabel).length > 1
      ? `${choice.baseLabel} · Portrait ${choice.partner?.portraitNumber ?? '?'}`
      : choice.baseLabel,
  })) : []
  const partnerChooserPerson = partnerChooserPersonId ? data.people.find((person) => person.id === partnerChooserPersonId) : undefined
  const offspringChooserPet = offspringChooserPetId ? data.pets.find((pet) => pet.id === offspringChooserPetId) : undefined
  const offspringPartnerChoices = offspringChooserPet
    ? data.petFamilies.filter((family) => family.parentPetIds.length === 2 && family.parentPetIds.includes(offspringChooserPet.id)).map((family) => {
        const partnerId = family.parentPetIds.find((id) => id !== offspringChooserPet.id) ?? ''
        const partner = data.pets.find((pet) => pet.id === partnerId)
        return { family, partner, baseLabel: partner?.displayName.trim() || partnerId || '?' }
      }).map((choice, _index, choices) => ({
        ...choice,
        label: choices.filter((candidate) => candidate.baseLabel === choice.baseLabel).length > 1
          ? `${choice.baseLabel} · Portrait ${choice.partner?.portraitNumber ?? '?'}`
          : choice.baseLabel,
      }))
    : []
  const partnerChooserPet = partnerChooserPetId ? data.pets.find((pet) => pet.id === partnerChooserPetId) : undefined
  const personPartnerLinks = selectedPerson
    ? [...new Map(data.families
        .filter((family) => family.parentIds.length === 2 && family.parentIds.includes(selectedPerson.id))
        .flatMap((family) => family.parentIds
          .filter((id) => id !== selectedPerson.id)
          .map((id) => [id, data.people.find((person) => person.id === id)] as const))
        .filter((entry): entry is readonly [string, Person] => Boolean(entry[1]))).values()]
    : []
  const personChildLinks = selectedPerson
    ? [...new Map(data.families
        .filter((family) => family.parentIds.includes(selectedPerson.id))
        .flatMap((family) => {
          const partner = family.parentIds
            .filter((id) => id !== selectedPerson.id)
            .map((id) => data.people.find((person) => person.id === id)?.displayName)
            .find(Boolean)
          return family.children.map((child) => {
            const person = data.people.find((candidate) => candidate.id === child.personId)
            return [child.personId, person ? { person, branch: partner ? `with ${partner}` : 'Single-parent branch' } : undefined] as const
          })
        })
        .filter((entry): entry is readonly [string, { person: Person; branch: string }] => Boolean(entry[1]))).values()]
    : []
  const petPartnerLinks = selectedPet
    ? [...new Map(data.petFamilies
        .filter((family) => family.parentPetIds.length === 2 && family.parentPetIds.includes(selectedPet.id))
        .flatMap((family) => family.parentPetIds
          .filter((id) => id !== selectedPet.id)
          .map((id) => [id, data.pets.find((pet) => pet.id === id)] as const))
        .filter((entry): entry is readonly [string, Pet] => Boolean(entry[1]))).values()]
    : []
  const petOffspringLinks = selectedPet
    ? [...new Map(data.petFamilies
        .filter((family) => family.parentPetIds.includes(selectedPet.id))
        .flatMap((family) => {
          const partner = family.parentPetIds
            .filter((id) => id !== selectedPet.id)
            .map((id) => data.pets.find((pet) => pet.id === id)?.displayName)
            .find(Boolean)
          return family.children.map((child) => {
            const pet = data.pets.find((candidate) => candidate.id === child.petId)
            return [child.petId, pet ? { pet, branch: partner ? `with ${partner}` : 'Single-parent branch' } : undefined] as const
          })
        })
        .filter((entry): entry is readonly [string, { pet: Pet; branch: string }] => Boolean(entry[1]))).values()]
    : []
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
    const synchronizedPatch = patch.displayName !== undefined && patch.lineageSurname === undefined
      ? { ...patch, lineageSurname: lineageSurnameAfterNameChange(selectedPerson, patch.displayName) }
      : patch
    onChange({
      ...data,
      people: data.people.map((person) => (person.id === selectedPerson.id ? { ...person, ...synchronizedPatch } : person)),
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

  function updatePersonPortraitPath(portrait: string) {
    const portraitNumber = portraitNumberFromPath(portrait, 'person')
    updatePerson({ portrait, ...(portraitNumber === null ? {} : { portraitNumber }) })
  }

  function updatePetPortraitPath(portrait: string) {
    const portraitNumber = portraitNumberFromPath(portrait, 'pet')
    updatePet({ portrait, ...(portraitNumber === null ? {} : { portraitNumber }) })
  }

  function openPetEditor(petId: string) {
    if (!data.pets.some((pet) => pet.id === petId)) return
    setPetSelectionMode(false)
    setSelectedPetIds(new Set())
    setSelectedPetId(petId)
    setTab('pets')
  }

  function openPersonEditor(personId: string) {
    if (!data.people.some((person) => person.id === personId)) return
    setSelectionMode(false)
    setSelectedPersonIds(new Set())
    setSelectedPersonId(personId)
    setTab('people')
  }

  function attentionRecordKey(kind: 'person' | 'pet', id: string) {
    return `${kind}:${id}`
  }

  function attentionFieldKey(kind: 'person' | 'pet', id: string, field: string) {
    return `${kind}:${id}:${field}`
  }

  function registerNewRecordAttention(kind: 'person' | 'pet', id: string) {
    const fields = kind === 'person' ? PERSON_NEW_RECORD_FIELDS : PET_NEW_RECORD_FIELDS
    setNewRecordAttention((current) => {
      const next = new Map(current)
      next.set(attentionRecordKey(kind, id), new Set(fields))
      return next
    })
    setAcknowledgedAttentionFields((current) => {
      const prefix = `${kind}:${id}:`
      return new Set([...current].filter((key) => !key.startsWith(prefix)))
    })
  }

  function hasFieldAttention(kind: 'person' | 'pet', id: string, field: string) {
    if (newRecordAttention.get(attentionRecordKey(kind, id))?.has(field)) return true
    if (acknowledgedAttentionFields.has(attentionFieldKey(kind, id, field))) return false
    if (kind === 'person') {
      const person = data.people.find((candidate) => candidate.id === id)
      if (!person || !PERSON_COMPLETENESS_FIELDS.has(field as keyof Person)) return false
      if (field === 'gender') return person.gender === 'unknown'
      if (field === 'links') return !person.links.some((link) => link.trim())
      return !String(person[field as keyof Person] ?? '').trim()
    }
    const pet = data.pets.find((candidate) => candidate.id === id)
    if (!pet || !PET_COMPLETENESS_FIELDS.has(field as keyof Pet)) return false
    if (field === 'links') return !pet.links.some((link) => link.trim())
    return !String(pet[field as keyof Pet] ?? '').trim()
  }

  function acknowledgeFieldAttention(kind: 'person' | 'pet', id: string, field: string) {
    setAcknowledgedAttentionFields((current) => new Set(current).add(attentionFieldKey(kind, id, field)))
    setNewRecordAttention((current) => {
      const key = attentionRecordKey(kind, id)
      const fields = current.get(key)
      if (!fields?.has(field)) return current
      const next = new Map(current)
      const remaining = new Set(fields)
      remaining.delete(field)
      if (remaining.size > 0) next.set(key, remaining)
      else next.delete(key)
      return next
    })
  }

  function resetFieldAttention() {
    setNewRecordAttention(new Map())
    setAcknowledgedAttentionFields(new Set())
  }

  function addPersonChild(personId = selectedPerson?.id) {
    if (!personId) return
    const partnerUnits = data.families.filter((family) => family.parentIds.length === 2 && family.parentIds.includes(personId))
    if (partnerUnits.length > 1) {
      setChildChooserPersonId(personId)
      return
    }
    if (partnerUnits.length === 1) {
      completeAddPersonChild(personId, partnerUnits[0].id)
      return
    }
    const singleParentUnit = data.families.find((family) => family.parentIds.length === 1 && family.parentIds[0] === personId)
    completeAddPersonChild(personId, singleParentUnit?.id ?? 'single')
  }

  function completeAddPersonChild(personId: string, familyId?: string | 'single') {
    const next = addChild(data, personId, 'New child', familyId)
    const newPerson = next.people[next.people.length - 1]
    onChange(next)
    registerNewRecordAttention('person', newPerson.id)
    setSelectedPersonId(newPerson.id)
    setChildChooserPersonId(null)
    setStatus(`${newPerson.displayName} added as the youngest child. Complete the placeholders, then export JSON.`)
  }

  function addPersonPartner(personId = selectedPerson?.id) {
    if (!personId) return
    const soloUnits = data.families.filter((family) => family.parentIds.length === 1 && family.parentIds[0] === personId)
    if (soloUnits.length > 0) {
      setPartnerChooserPersonId(personId)
      return
    }
    completeAddPersonPartner(personId)
  }

  function completeAddPersonPartner(personId: string, attachFamilyId?: string) {
    const next = addPartner(data, personId, 'New partner', attachFamilyId)
    const newPerson = next.people[next.people.length - 1]
    onChange(next)
    registerNewRecordAttention('person', newPerson.id)
    setSelectedPersonId(newPerson.id)
    setPartnerChooserPersonId(null)
    setStatus('Partner added. Their shared family branch is ready for children.')
  }

  function addPersonSibling(personId = selectedPerson?.id) {
    if (!personId) return
    const next = addSibling(data, personId)
    if (next === data) {
      setStatus('No recorded parents are available for this sibling.')
      return
    }
    const newPerson = next.people[next.people.length - 1]
    onChange(next)
    registerNewRecordAttention('person', newPerson.id)
    setSelectedPersonId(newPerson.id)
    setStatus('Sibling added to the same recorded parent branch.')
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
    registerNewRecordAttention('pet', pet.id)
    setSelectedPetId(pet.id)
    setStatus('New pet added. Add lineage only if you know its pet parent.')
  }

  function addPetChild(petId = selectedPet?.id) {
    if (!petId) return
    const partnerUnits = data.petFamilies.filter((family) => family.parentPetIds.length === 2 && family.parentPetIds.includes(petId))
    if (partnerUnits.length > 1) {
      setOffspringChooserPetId(petId)
      return
    }
    if (partnerUnits.length === 1) {
      completeAddPetChild(petId, partnerUnits[0].id)
      return
    }
    const singleParentUnit = data.petFamilies.find((family) => family.parentPetIds.length === 1 && family.parentPetIds[0] === petId)
    completeAddPetChild(petId, singleParentUnit?.id ?? 'single')
  }

  function completeAddPetChild(petId: string, familyId?: string | 'single') {
    const next = addPetOffspring(data, petId, 'New pet', familyId)
    const pet = next.pets[next.pets.length - 1]
    onChange(next)
    registerNewRecordAttention('pet', pet.id)
    setSelectedPetId(pet.id)
    setOffspringChooserPetId(null)
    setStatus('Pet offspring added to the lineage.')
  }

  function addSelectedPetPartner(petId = selectedPet?.id) {
    if (!petId) return
    const soloUnits = data.petFamilies.filter((family) => family.parentPetIds.length === 1 && family.parentPetIds[0] === petId)
    if (soloUnits.length > 0) {
      setPartnerChooserPetId(petId)
      return
    }
    completeAddPetPartner(petId)
  }

  function completeAddPetPartner(petId: string, attachFamilyId?: string) {
    const next = addPetPartner(data, petId, 'New pet partner', attachFamilyId)
    const pet = next.pets[next.pets.length - 1]
    onChange(next)
    registerNewRecordAttention('pet', pet.id)
    setSelectedPetId(pet.id)
    setPartnerChooserPetId(null)
    setStatus('Pet partner added. Their shared lineage branch is ready for offspring.')
  }

  function addSelectedPetSibling(petId = selectedPet?.id) {
    if (!petId) return
    const next = addPetSibling(data, petId)
    if (next === data) {
      setStatus('No recorded pet parents are available for this sibling.')
      return
    }
    const pet = next.pets[next.pets.length - 1]
    onChange(next)
    registerNewRecordAttention('pet', pet.id)
    setSelectedPetId(pet.id)
    setStatus('Pet sibling added to the same recorded parent branch.')
  }

  function removeSelectedPet() {
    if (!selectedPet) return
    beginPetDeletion([selectedPet.id])
  }

  function deathFieldKey(kind: 'person' | 'pet', id: string) {
    return `${kind}:${id}`
  }

  function acknowledgeDeathField(kind: 'person' | 'pet', id: string) {
    setAcknowledgedDeathFields((current) => {
      const key = deathFieldKey(kind, id)
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })
  }

  function resetDeathFieldAttention(kind: 'person' | 'pet', id: string) {
    setAcknowledgedDeathFields((current) => {
      const key = deathFieldKey(kind, id)
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
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
      resetFieldAttention()
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
    resetFieldAttention()
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
                    {textFields.map((field) => {
                      const attention = hasFieldAttention('person', selectedPerson.id, field.key)
                      return (
                      <label key={field.key} className={[field.textarea ? 'full-width' : '', attention ? 'new-record-field-attention' : ''].filter(Boolean).join(' ')}>
                        {field.label}
                        {field.textarea ? (
                          <textarea
                            aria-label={field.label}
                            value={String(selectedPerson[field.key] ?? '')}
                            placeholder={field.placeholder}
                            onFocus={() => acknowledgeFieldAttention('person', selectedPerson.id, field.key)}
                            onChange={(event) => field.key === 'portrait'
                              ? updatePersonPortraitPath(event.target.value)
                              : updatePerson({ [field.key]: event.target.value } as Partial<Person>)}
                          />
                        ) : (
                          <input
                            aria-label={field.label}
                            value={String(selectedPerson[field.key] ?? '')}
                            placeholder={field.placeholder}
                            type={field.key === 'birthDate' ? 'date' : 'text'}
                            aria-invalid={field.key === 'birthDate' ? Boolean(personBirthDateError) : undefined}
                            onFocus={() => acknowledgeFieldAttention('person', selectedPerson.id, field.key)}
                            onChange={(event) => field.key === 'portrait'
                              ? updatePersonPortraitPath(event.target.value)
                              : updatePerson({ [field.key]: event.target.value } as Partial<Person>)}
                          />
                        )}
                        {field.key === 'birthDate' && personBirthDateError && (
                          <small className="field-warning" role="alert">{personBirthDateError}</small>
                        )}
                        {field.key === 'portrait' && !isSafePortrait(selectedPerson.portrait) && (
                          <small className="field-warning">Use a repository PNG path or HTTPS PNG URL.</small>
                        )}
                        {field.helper && <small>{field.helper}</small>}
                      </label>
                    )})}
                    <LinkEditor
                      links={selectedPerson.links}
                      onChange={(links) => updatePerson({ links })}
                      attention={hasFieldAttention('person', selectedPerson.id, 'links')}
                      onAcknowledge={() => acknowledgeFieldAttention('person', selectedPerson.id, 'links')}
                    />
                    <label className={hasFieldAttention('person', selectedPerson.id, 'gender') ? 'new-record-field-attention' : undefined}>
                      Gender
                      <select
                        value={selectedPerson.gender}
                        onFocus={() => acknowledgeFieldAttention('person', selectedPerson.id, 'gender')}
                        onChange={(event) => updatePerson({ gender: event.target.value as Person['gender'] })}
                      >
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
                          if (nextStatus === 'dead') resetDeathFieldAttention('person', selectedPerson.id)
                          updatePerson({ status: nextStatus, ...(nextStatus === 'alive' ? { deathDate: '' } : {}) })
                        }}
                      >
                        <option value="alive">Alive</option>
                        <option value="dead">Dead</option>
                      </select>
                    </label>
                    {selectedPerson.status === 'dead' && (
                      <label className={!selectedPerson.deathDate && !acknowledgedDeathFields.has(deathFieldKey('person', selectedPerson.id)) ? 'death-date-reveal' : undefined}>
                        Death date
                        <input
                          type="date"
                          value={selectedPerson.deathDate}
                          aria-invalid={Boolean(personDeathDateError)}
                          onFocus={() => acknowledgeDeathField('person', selectedPerson.id)}
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
                  {selectedPersonParents.length > 0 && (
                    <section className="relationship-panel" aria-labelledby={`parents-${selectedPerson.id}`}>
                      <div>
                        <p className="section-kicker" id={`parents-${selectedPerson.id}`}>Parents</p>
                        <span>{selectedPersonParents.length}</span>
                      </div>
                      <div className="relationship-links">
                        {selectedPersonParents.map((parent) => {
                          const role = parent.gender === 'male' ? 'Father' : parent.gender === 'female' ? 'Mother' : 'Parent'
                          return (
                            <button
                              className="relationship-link"
                              type="button"
                              key={parent.id}
                              onClick={() => openPersonEditor(parent.id)}
                              aria-label={`Open ${role.toLowerCase()} ${parent.displayName}`}
                            >
                              <strong>{parent.displayName}</strong>
                              <small>{role}</small>
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  )}
                  <section className="relationship-panel" aria-labelledby={`owned-pets-${selectedPerson.id}`}>
                    <div>
                      <p className="section-kicker" id={`owned-pets-${selectedPerson.id}`}>Owned pets</p>
                      <span>{ownedPets.length}</span>
                    </div>
                    {ownedPets.length > 0 ? (
                      <div className="relationship-links">
                        {ownedPets.map((pet) => (
                          <button
                            className="relationship-link"
                            type="button"
                            key={pet.id}
                            onClick={() => openPetEditor(pet.id)}
                            aria-label={`Open ${pet.displayName} in Pets editor`}
                          >
                            <strong>{pet.displayName}</strong>
                            <small>{pet.species || '?'}</small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="relationship-empty">No pets are assigned to this person.</p>
                    )}
                  </section>
                  <section className="relationship-panel" aria-labelledby={`partners-${selectedPerson.id}`}>
                    <div>
                      <p className="section-kicker" id={`partners-${selectedPerson.id}`}>Partners</p>
                      <span>{personPartnerLinks.length}</span>
                    </div>
                    {personPartnerLinks.length > 0 ? (
                      <div className="relationship-links">
                        {personPartnerLinks.map((partner) => (
                          <button className="relationship-link" type="button" key={partner.id} onClick={() => openPersonEditor(partner.id)} aria-label={`Open partner ${partner.displayName}`}>
                            <strong>{partner.displayName}</strong>
                            <small>Partner</small>
                          </button>
                        ))}
                      </div>
                    ) : <p className="relationship-empty">No partners are recorded for this person.</p>}
                  </section>
                  <section className="relationship-panel" aria-labelledby={`children-${selectedPerson.id}`}>
                    <div>
                      <p className="section-kicker" id={`children-${selectedPerson.id}`}>Children</p>
                      <span>{personChildLinks.length}</span>
                    </div>
                    {personChildLinks.length > 0 ? (
                      <div className="relationship-links">
                        {personChildLinks.map(({ person, branch }) => (
                          <button className="relationship-link" type="button" key={person.id} onClick={() => openPersonEditor(person.id)} aria-label={`Open child ${person.displayName}, ${branch}`}>
                            <strong>{person.displayName}</strong>
                            <small>{branch}</small>
                          </button>
                        ))}
                      </div>
                    ) : <p className="relationship-empty">No children are recorded for this person.</p>}
                  </section>
                  <div className="record-actions">
                    <button className="secondary-button" onClick={() => addPersonChild()}>Add child</button>
                    <button className="secondary-button" onClick={() => addPersonPartner()}>Add partner</button>
                    <button className="secondary-button" onClick={() => addPersonSibling()} disabled={!data.families.some((family) => family.children.some((child) => child.personId === selectedPerson.id))}>Add sibling</button>
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
                    {petTextFields.map((field) => {
                      const attention = hasFieldAttention('pet', selectedPet.id, field.key)
                      return (
                      <label key={field.key} className={[field.textarea ? 'full-width' : '', attention ? 'new-record-field-attention' : ''].filter(Boolean).join(' ')}>
                        {field.label}
                        {field.textarea ? (
                          <textarea
                            value={String(selectedPet[field.key] ?? '')}
                            placeholder={field.placeholder}
                            onFocus={() => acknowledgeFieldAttention('pet', selectedPet.id, field.key)}
                            onChange={(event) => field.key === 'portrait'
                              ? updatePetPortraitPath(event.target.value)
                              : updatePet({ [field.key]: event.target.value } as Partial<Pet>)}
                          />
                        ) : (
                          <input
                            value={String(selectedPet[field.key] ?? '')}
                            placeholder={field.placeholder}
                            type="text"
                            aria-invalid={field.key === 'birthDate' ? Boolean(petBirthDateError) : undefined}
                            onFocus={() => acknowledgeFieldAttention('pet', selectedPet.id, field.key)}
                            onChange={(event) => field.key === 'portrait'
                              ? updatePetPortraitPath(event.target.value)
                              : updatePet({ [field.key]: event.target.value } as Partial<Pet>)}
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
                    )})}
                    <LinkEditor
                      links={selectedPet.links}
                      onChange={(links) => updatePet({ links })}
                      attention={hasFieldAttention('pet', selectedPet.id, 'links')}
                      onAcknowledge={() => acknowledgeFieldAttention('pet', selectedPet.id, 'links')}
                    />
                    <label className={hasFieldAttention('pet', selectedPet.id, 'gender') ? 'new-record-field-attention' : undefined}>
                      Gender
                      <select
                        value={selectedPet.gender}
                        onFocus={() => acknowledgeFieldAttention('pet', selectedPet.id, 'gender')}
                        onChange={(event) => updatePet({ gender: event.target.value as Pet['gender'] })}
                      >
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
                          if (nextStatus === 'dead') resetDeathFieldAttention('pet', selectedPet.id)
                          updatePet({ status: nextStatus, ...(nextStatus === 'alive' ? { deathDate: '' } : {}) })
                        }}
                      >
                        <option value="alive">Alive</option>
                        <option value="dead">Dead</option>
                      </select>
                    </label>
                    {selectedPet.status === 'dead' && (
                      <label className={!selectedPet.deathDate && !acknowledgedDeathFields.has(deathFieldKey('pet', selectedPet.id)) ? 'death-date-reveal' : undefined}>
                        Death date
                        <input
                          type="text"
                          value={selectedPet.deathDate}
                          placeholder="YY or YYYY, with optional month and day"
                          aria-invalid={Boolean(petDeathDateError)}
                          onFocus={() => acknowledgeDeathField('pet', selectedPet.id)}
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
                      <small>Adding a birth date automatically calculates the pet’s age.</small>
                    </label>
                    <label className={hasFieldAttention('pet', selectedPet.id, 'ownerPersonId') ? 'new-record-field-attention' : undefined}>
                      Human owner
                      <select
                        value={selectedPet.ownerPersonId}
                        onFocus={() => acknowledgeFieldAttention('pet', selectedPet.id, 'ownerPersonId')}
                        onChange={(event) => updatePet({ ownerPersonId: event.target.value })}
                      >
                        <option value="">None / unknown</option>
                        {data.people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
                      </select>
                    </label>
                    {selectedPetOwner && (
                      <div className="relationship-shortcut full-width">
                        <span>Owned by <strong>{selectedPetOwner.displayName}</strong></span>
                        <button className="mini-button" type="button" onClick={() => openPersonEditor(selectedPetOwner.id)}>Open owner</button>
                      </div>
                    )}
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
                  <section className="relationship-panel" aria-labelledby={`pet-partners-${selectedPet.id}`}>
                    <div>
                      <p className="section-kicker" id={`pet-partners-${selectedPet.id}`}>Partners</p>
                      <span>{petPartnerLinks.length}</span>
                    </div>
                    {petPartnerLinks.length > 0 ? (
                      <div className="relationship-links">
                        {petPartnerLinks.map((partner) => (
                          <button className="relationship-link" type="button" key={partner.id} onClick={() => openPetEditor(partner.id)} aria-label={`Open pet partner ${partner.displayName}`}>
                            <strong>{partner.displayName}</strong>
                            <small>Partner</small>
                          </button>
                        ))}
                      </div>
                    ) : <p className="relationship-empty">No partners are recorded for this pet.</p>}
                  </section>
                  <section className="relationship-panel" aria-labelledby={`offspring-${selectedPet.id}`}>
                    <div>
                      <p className="section-kicker" id={`offspring-${selectedPet.id}`}>Offspring</p>
                      <span>{petOffspringLinks.length}</span>
                    </div>
                    {petOffspringLinks.length > 0 ? (
                      <div className="relationship-links">
                        {petOffspringLinks.map(({ pet, branch }) => (
                          <button className="relationship-link" type="button" key={pet.id} onClick={() => openPetEditor(pet.id)} aria-label={`Open offspring ${pet.displayName}, ${branch}`}>
                            <strong>{pet.displayName}</strong>
                            <small>{branch}</small>
                          </button>
                        ))}
                      </div>
                    ) : <p className="relationship-empty">No offspring are recorded for this pet.</p>}
                  </section>
                  <div className="record-actions">
                    <button className="secondary-button" onClick={() => addPetChild()}>Add offspring</button>
                    <button className="secondary-button" onClick={() => addSelectedPetPartner()}>Add pet partner</button>
                    <button className="secondary-button" onClick={() => addSelectedPetSibling()} disabled={!data.petFamilies.some((family) => family.children.some((child) => child.petId === selectedPet.id))}>Add sibling</button>
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
              <LineageGraph mode="people" people={data.people} families={data.families} pets={data.pets} petFamilies={data.petFamilies} onPetNavigate={onNavigateToPet} canEdit onEditAction={onEditIntent} />
              <LineageGraph mode="pets" people={data.people} families={data.families} pets={data.pets} petFamilies={data.petFamilies} onOwnerNavigate={onNavigateToOwner} canEdit onEditAction={onEditIntent} />
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
      {childChooserPerson && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setChildChooserPersonId(null)}>
          <section className="dashboard-modal celestial-panel" role="dialog" aria-modal="true" aria-labelledby="child-unit-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Choose the parents</p>
            <h2 id="child-unit-title">Which branch does this child belong to?</h2>
            <p>Select the other parent for {childChooserPerson.displayName}.</p>
            <div className="choice-grid">
              {childPartnerChoices.map(({ family, label }) => (
                <button className="secondary-button" type="button" key={family.id} onClick={() => completeAddPersonChild(childChooserPerson.id, family.id)}>
                  {label}
                </button>
              ))}
            </div>
            <button className="ghost-button modal-cancel" type="button" onClick={() => setChildChooserPersonId(null)}>Cancel</button>
          </section>
        </div>
      )}
      {partnerChooserPerson && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPartnerChooserPersonId(null)}>
          <section className="dashboard-modal celestial-panel" role="dialog" aria-modal="true" aria-labelledby="partner-unit-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Add another partner</p>
            <h2 id="partner-unit-title">Where should this partnership begin?</h2>
            <p>Attach the partner to an existing single-parent branch, or start a separate union.</p>
            <div className="choice-grid">
              {data.families.filter((family) => family.parentIds.length === 1 && family.parentIds[0] === partnerChooserPerson.id).map((family) => (
                <button className="secondary-button" type="button" key={family.id} onClick={() => completeAddPersonPartner(partnerChooserPerson.id, family.id)}>
                  Attach to branch with {family.children.length} {family.children.length === 1 ? 'child' : 'children'}
                </button>
              ))}
              <button className="secondary-button" type="button" onClick={() => completeAddPersonPartner(partnerChooserPerson.id)}>Start separate union</button>
            </div>
            <button className="ghost-button modal-cancel" type="button" onClick={() => setPartnerChooserPersonId(null)}>Cancel</button>
          </section>
        </div>
      )}
      {offspringChooserPet && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOffspringChooserPetId(null)}>
          <section className="dashboard-modal celestial-panel" role="dialog" aria-modal="true" aria-labelledby="offspring-unit-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Choose the pet parents</p>
            <h2 id="offspring-unit-title">Which branch does this offspring belong to?</h2>
            <p>Select the other pet parent for {offspringChooserPet.displayName}.</p>
            <div className="choice-grid">
              {offspringPartnerChoices.map(({ family, label }) => (
                <button className="secondary-button" type="button" key={family.id} onClick={() => completeAddPetChild(offspringChooserPet.id, family.id)}>{label}</button>
              ))}
            </div>
            <button className="ghost-button modal-cancel" type="button" onClick={() => setOffspringChooserPetId(null)}>Cancel</button>
          </section>
        </div>
      )}
      {partnerChooserPet && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPartnerChooserPetId(null)}>
          <section className="dashboard-modal celestial-panel" role="dialog" aria-modal="true" aria-labelledby="pet-partner-unit-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="section-kicker">Add another pet partner</p>
            <h2 id="pet-partner-unit-title">Where should this partnership begin?</h2>
            <p>Attach the partner to an existing single-parent pet branch, or start a separate union.</p>
            <div className="choice-grid">
              {data.petFamilies.filter((family) => family.parentPetIds.length === 1 && family.parentPetIds[0] === partnerChooserPet.id).map((family) => (
                <button className="secondary-button" type="button" key={family.id} onClick={() => completeAddPetPartner(partnerChooserPet.id, family.id)}>
                  Attach to branch with {family.children.length} offspring
                </button>
              ))}
              <button className="secondary-button" type="button" onClick={() => completeAddPetPartner(partnerChooserPet.id)}>Start separate union</button>
            </div>
            <button className="ghost-button modal-cancel" type="button" onClick={() => setPartnerChooserPetId(null)}>Cancel</button>
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
