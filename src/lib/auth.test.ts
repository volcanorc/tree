import { describe, expect, it } from 'vitest'
import { sha256, verifyLogin } from './auth'

describe('session PIN verification', () => {
  it('accepts only the configured user and PIN hash', async () => {
    const hash = await sha256('482913')
    await expect(verifyLogin('admin', '482913', 'admin', hash)).resolves.toBe(true)
    await expect(verifyLogin('admin', '000000', 'admin', hash)).resolves.toBe(false)
    await expect(verifyLogin('someone', '482913', 'admin', hash)).resolves.toBe(false)
  })
})
