import { describe, expect, it } from 'vitest'

import {
  DELETE_ALL_CALLS_CONFIRMATION_PHRASE,
  isDeleteAllCallsConfirmation,
} from '@/lib/funding/catalogWipeConfirmation'

describe('delete-all-calls confirmation phrase', () => {
  it('accepts the exact phrase and forgiving whitespace/case variants', () => {
    expect(isDeleteAllCallsConfirmation(DELETE_ALL_CALLS_CONFIRMATION_PHRASE)).toBe(true)
    expect(isDeleteAllCallsConfirmation('delete all calls')).toBe(true)
    expect(isDeleteAllCallsConfirmation('  Delete   ALL calls  ')).toBe(true)
  })

  it('rejects anything else, so the wipe can never be armed accidentally', () => {
    expect(isDeleteAllCallsConfirmation('')).toBe(false)
    expect(isDeleteAllCallsConfirmation('delete all')).toBe(false)
    expect(isDeleteAllCallsConfirmation('delete all my calls')).toBe(false)
    expect(isDeleteAllCallsConfirmation('yes')).toBe(false)
    expect(isDeleteAllCallsConfirmation(undefined)).toBe(false)
    expect(isDeleteAllCallsConfirmation(null)).toBe(false)
    expect(isDeleteAllCallsConfirmation(42)).toBe(false)
    expect(isDeleteAllCallsConfirmation({ confirmation: 'delete all calls' })).toBe(false)
  })
})
