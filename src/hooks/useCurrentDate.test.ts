import { describe, expect, it } from 'vitest'
import { millisecondsUntilNextLocalMidnight } from './useCurrentDate'

describe('local date refresh scheduling', () => {
  it('schedules the next refresh immediately after local midnight', () => {
    const now = new Date(2026, 6, 20, 23, 59, 59, 0)
    expect(millisecondsUntilNextLocalMidnight(now)).toBe(1050)
  })
})
