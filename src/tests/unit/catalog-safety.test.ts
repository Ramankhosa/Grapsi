import {describe,it,expect} from 'vitest'
import {compareSafetySnapshots, type SafetySnapshot} from '@/lib/fundingCatalogImport/safety'

function snapshot(): SafetySnapshot {
  return {takenAt:'now',database:'scratch',columns:['id','description'],rows:{call:{fingerprint:'before',updatedAt:'then'}},dependentCounts:{assignments:1},invariantViolations:0}
}
describe('catalogue safety fails closed',()=>{
  it('accepts unchanged snapshots',()=>expect(compareSafetySnapshots(snapshot(),snapshot()).ok).toBe(true))
  it('rejects a content change even with a newer timestamp',()=>{
    const after=snapshot();after.rows.call={fingerprint:'changed',updatedAt:'later'}
    expect(compareSafetySnapshots(snapshot(),after)).toMatchObject({ok:false,appEdits:['call']})
  })
  it('rejects a change in attached work',()=>{
    const after=snapshot();after.dependentCounts.assignments=0
    expect(compareSafetySnapshots(snapshot(),after).ok).toBe(false)
  })
  it('rejects a snapshot from a different database',()=>{
    const after=snapshot();after.database='production'
    expect(compareSafetySnapshots(snapshot(),after).ok).toBe(false)
  })
})
