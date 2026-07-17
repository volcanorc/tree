import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverMock, writable: true })
Object.defineProperty(globalThis, 'IntersectionObserver', { value: IntersectionObserverMock, writable: true })
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
  writable: true,
})
Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: window.clearTimeout, writable: true })

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
