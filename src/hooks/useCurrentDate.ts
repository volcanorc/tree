import { useEffect, useState } from 'react'

export function millisecondsUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now)
  next.setHours(24, 0, 0, 50)
  return Math.max(1, next.getTime() - now.getTime())
}

export function useCurrentDate(): Date {
  const [currentDate, setCurrentDate] = useState(() => new Date())

  useEffect(() => {
    let timeoutId = 0
    const schedule = () => {
      const now = new Date()
      timeoutId = window.setTimeout(() => {
        setCurrentDate(new Date())
        schedule()
      }, millisecondsUntilNextLocalMidnight(now))
    }
    schedule()
    return () => window.clearTimeout(timeoutId)
  }, [])

  return currentDate
}
