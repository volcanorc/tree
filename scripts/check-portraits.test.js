import { describe, expect, it } from 'vitest'
import { validatePortraitFilenames } from './check-portraits.mjs'

describe('portrait folder validation', () => {
  it('allows missing files, .gitkeep, and positive-number PNGs', () => {
    expect(validatePortraitFilenames([], 'portraits')).toEqual([])
    expect(validatePortraitFilenames(['.gitkeep', '1.png', '42.png'], 'portraits')).toEqual([])
  })

  it('rejects unsupported formats and invalid numbered filenames', () => {
    const errors = validatePortraitFilenames(['0.png', 'father.png', '1.jpg', '2.webp'], 'portraits')
    expect(errors).toHaveLength(4)
    expect(errors.join(' ')).toMatch(/positive-number PNG/)
  })
})
