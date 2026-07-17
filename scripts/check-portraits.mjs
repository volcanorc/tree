import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function validatePortraitFilenames(filenames, label) {
  return filenames
    .filter((name) => name !== '.gitkeep')
    .filter((name) => !/^[1-9]\d*\.png$/.test(name))
    .map((name) => `${label}/${name} must use a positive-number PNG filename such as 1.png.`)
}

async function filenamesIn(directory, allowedDirectory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const errors = []
  const filenames = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name !== allowedDirectory) errors.push(`${directory}/${entry.name} is not an allowed portrait directory.`)
      continue
    }
    if (entry.isFile()) filenames.push(entry.name)
  }
  return { filenames, errors }
}

export async function checkPortraitDirectories(root = ROOT) {
  const peopleDirectory = resolve(root, 'public', 'portraits')
  const petsDirectory = resolve(peopleDirectory, 'pets')
  const people = await filenamesIn(peopleDirectory, 'pets')
  const pets = await filenamesIn(petsDirectory)
  const errors = [
    ...people.errors,
    ...pets.errors,
    ...validatePortraitFilenames(people.filenames, 'public/portraits'),
    ...validatePortraitFilenames(pets.filenames, 'public/portraits/pets'),
  ]
  if (errors.length) throw new Error(errors.join('\n'))
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  checkPortraitDirectories()
    .then(() => console.log('Portrait folders are valid. Missing numbered PNGs will use the site fallback.'))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
