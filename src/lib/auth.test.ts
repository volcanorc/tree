import { describe, expect, it } from 'vitest'
import { sha256, verifyLogin } from './auth'

describe('session PIN verification', () => {
  it('accepts only the configured user and PIN hash', async () => {
    const hash = await sha256('07181923')
    expect(hash).toBe('1d9231628ad5b3303ce6dd7ecd6e47b6a055e6a4551c0152e4ed168de523bd84')
    await expect(verifyLogin('admin', '07181923', 'admin', hash)).resolves.toBe(true)
    await expect(verifyLogin('admin', '000000', 'admin', hash)).resolves.toBe(false)
    await expect(verifyLogin('someone', '07181923', 'admin', hash)).resolves.toBe(false)
  })
})
