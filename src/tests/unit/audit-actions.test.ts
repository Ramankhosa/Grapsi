import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ACTION_GROUPS,
  AUDIT_GROUPS,
  AUDIT_GROUP_COPY,
  DEFAULT_GROUPS,
  actionLabel,
  actionsInGroups,
  groupForAction,
  parseResource,
} from '@/lib/audit/actions'

/**
 * The audit vocabulary against what the code actually writes.
 *
 * The viewer defaults to the governance groups, so an action that nobody
 * classified is an action that quietly stops appearing on the screen an
 * administrator opens. This reads the source to catch that, the same way the job
 * registry test does and for the same reason: the risk is a hand-maintained list
 * falling behind the code.
 */

const ROOT = join(__dirname, '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Action strings written to the audit log anywhere under src, tests excluded. */
function actionsInSource(): Set<string> {
  const found = new Set<string>()
  const tests = join(ROOT, 'src', 'tests')
  const audit = join(ROOT, 'src', 'lib', 'audit')
  for (const file of walk(join(ROOT, 'src'))) {
    // The vocabulary module lists every action by definition, and this test
    // names the pattern it looks for, so neither is evidence of a writer.
    if (file.startsWith(tests) || file.startsWith(audit)) continue
    const text = readFileSync(file, 'utf8')
    if (!text.includes('auditLog.create') && !text.includes('createAuditLog')) continue
    for (const match of text.matchAll(/action:\s*'([A-Z][A-Z0-9_]*)'/g)) found.add(match[1])
  }
  return found
}

describe('audit action vocabulary', () => {
  it('classifies every action the code writes', () => {
    const written = actionsInSource()
    expect(written.size).toBeGreaterThan(20)
    const unclassified = Array.from(written).filter((action) => !(action in ACTION_GROUPS))
    expect(
      unclassified,
      `these actions are written but ungrouped, so they only appear under "everything": ${unclassified.join(', ')}`
    ).toEqual([])
  })

  it('puts each action in exactly one group', () => {
    const seen = new Map<string, string>()
    for (const group of AUDIT_GROUPS) {
      for (const action of actionsInGroups([group])) {
        expect(seen.has(action), `${action} is in two groups`).toBe(false)
        seen.set(action, group)
      }
    }
    expect(seen.size).toBe(Object.keys(ACTION_GROUPS).length)
  })

  it('describes every group it offers', () => {
    for (const group of AUDIT_GROUPS) {
      expect(AUDIT_GROUP_COPY[group]?.label, group).toBeTruthy()
      expect(AUDIT_GROUP_COPY[group]?.help, group).toBeTruthy()
    }
  })

  it('opens on governance and leaves the noisy groups out', () => {
    // Product activity and sign-ins are both high volume, and a first screen
    // full of either is a screen nobody comes back to.
    expect(DEFAULT_GROUPS).not.toContain('activity')
    expect(DEFAULT_GROUPS).not.toContain('sessions')
    expect(DEFAULT_GROUPS).toContain('access')
  })

  it('keeps role changes and sign-ins apart despite the shared prefix', () => {
    // The reason the mapping is an explicit table rather than a prefix rule.
    expect(groupForAction('USER_ROLE_CHANGE')).toBe('access')
    expect(groupForAction('USER_LOGIN')).toBe('sessions')
  })

  it('treats an unknown action as product activity rather than governance', () => {
    // Safe direction: a new action stays visible under "everything" and never
    // silently claims to be a governance event.
    expect(groupForAction('SOMETHING_INVENTED_LATER')).toBe('activity')
  })
})

describe('reading a row', () => {
  it('turns an action into something a person can read', () => {
    expect(actionLabel('USER_ROLE_ADD')).toBe('user role add')
    expect(actionLabel('TOKEN_REVEALED')).toBe('revealed an access token')
  })

  it('splits the kind:id resource convention', () => {
    expect(parseResource('user:clx123')).toEqual({ kind: 'user', id: 'clx123' })
    expect(parseResource('tenant_org_unit:abc')).toEqual({ kind: 'tenant_org_unit', id: 'abc' })
  })

  it('keeps a resource that does not follow the convention whole', () => {
    // `resource` is free text and nothing enforces the format, so a value
    // without a colon must not be truncated into nonsense.
    expect(parseResource('everything')).toEqual({ kind: 'everything', id: null })
    expect(parseResource(':orphan')).toEqual({ kind: ':orphan', id: null })
  })
})
