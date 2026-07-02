import path from 'path'
import { describe, expect, it } from 'vitest'

import { resolveManagedFundingAssetPath } from '@/lib/fundingTemplates/storage'

describe('funding template asset storage sandbox', () => {
  it('rejects paths outside managed funding upload directories', async () => {
    await expect(resolveManagedFundingAssetPath(path.join(process.cwd(), '.env'))).rejects.toThrow(
      'outside the managed upload directories'
    )
  })
})
