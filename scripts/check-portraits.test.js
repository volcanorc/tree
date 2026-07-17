import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPortraitDirectories, validatePortraitFilenames } from './check-portraits.mjs'

const temporaryRoots = []

async function portraitRoot() {
  const root = await mkdtemp(join(tmpdir(), 'portrait-check-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'public', 'portraits', 'pets'), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('portrait folder validation', () => {
  it('allows missing optional images, .gitkeep, and positive-number PNGs', async () => {
    expect(validatePortraitFilenames([], 'portraits')).toEqual([])
    expect(validatePortraitFilenames(['.gitkeep', '1.png', '42.png'], 'portraits')).toEqual([])
    const root = await portraitRoot()
    await writeFile(join(root, 'public', 'portraits', '.gitkeep'), '')
    await writeFile(join(root, 'public', 'portraits', '1.png'), '')
    await writeFile(join(root, 'public', 'portraits', 'pets', '1.png'), '')
    await expect(checkPortraitDirectories(root)).resolves.toBeUndefined()
  })

  it('rejects unsupported formats and invalid numbered filenames', async () => {
    const errors = validatePortraitFilenames(['0.png', 'father.png', '1.jpg', '2.webp'], 'portraits')
    expect(errors).toHaveLength(4)
    expect(errors.join(' ')).toMatch(/positive-number PNG/)

    const root = await portraitRoot()
    await writeFile(join(root, 'public', 'portraits', 'father.png'), '')
    await writeFile(join(root, 'public', 'portraits', 'pets', '1.jpg'), '')
    await expect(checkPortraitDirectories(root)).rejects.toThrow(/positive-number PNG/)
  })

  it('rejects unexpected portrait subdirectories', async () => {
    const root = await portraitRoot()
    await mkdir(join(root, 'public', 'portraits', 'people'))
    await expect(checkPortraitDirectories(root)).rejects.toThrow(/not an allowed portrait directory/)
  })
})
