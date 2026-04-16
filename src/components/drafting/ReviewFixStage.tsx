'use client'

import { useEffect, useState } from 'react'

interface ReviewFixStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type CheckItem = {
  label: string
  ok: boolean
  remark: string
  status: 'pending' | 'pass' | 'fail'
}

export default function ReviewFixStage({ session, patent, onComplete, onRefresh }: ReviewFixStageProps) {
  const [extReport, setExtReport] = useState<any>(null)
  const [checkList, setCheckList] = useState<CheckItem[]>([])
  const availableJurisdictions: string[] = (Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
    ? session.draftingJurisdictions
    : ['IN']
  ).map((c: string) => (c || '').toUpperCase())
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string>(() => (session?.activeJurisdiction || availableJurisdictions[0] || 'IN'))

  useEffect(() => {
    const next = (session?.activeJurisdiction || availableJurisdictions[0] || 'IN').toUpperCase()
    setSelectedJurisdiction(next)
  }, [session?.activeJurisdiction, availableJurisdictions.join(',')])

  useEffect(() => {
    setExtReport(null)
    setCheckList([])
  }, [selectedJurisdiction])

  const runChecks = async () => {
    const res = await onComplete({ action: 'run_review_checks', sessionId: session?.id, jurisdiction: selectedJurisdiction })
    setExtReport(res)

    const er = res?.extendedReport || {}
    const activeJurisdiction = selectedJurisdiction || (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN').toUpperCase()
    const rows: Array<Omit<CheckItem, 'status'>> = []

    // Abstract vs profile limits
    const absLen = er.abstract?.length || 0
    const absMax = er.abstract?.maxWords as number | undefined
    rows.push({
      label: absMax ? `Abstract length ≤ ${absMax} words` : 'Abstract length (informational)',
      ok: absMax ? absLen <= absMax : true,
      remark: `length=${absLen}${absMax ? `, max=${absMax}` : ''}`
    })
    if (activeJurisdiction === 'IN') {
      rows.push({
        label: 'Abstract starts with Title (IN practice)',
        ok: !!er.abstract?.startsWithTitle,
        remark: er.abstract?.startsWithTitle ? '' : 'For IN practice, abstract should begin with the approved title.'
      })
    }
    rows.push({
      label: 'Abstract forbidden terms absent',
      ok: !(er.abstract?.forbiddenHits || []).length,
      remark: (er.abstract?.forbiddenHits || []).join(', ')
    })

    // BDOD
    rows.push({
      label: 'BDOD has all figures',
      ok: !(er.bdod?.missingFigures || []).length,
      remark: (er.bdod?.missingFigures || []).join(', ')
    })
    rows.push({
      label: 'BDOD has no extra figures',
      ok: !(er.bdod?.extraFigures || []).length,
      remark: (er.bdod?.extraFigures || []).join(', ')
    })
    const bdodFormatOk = !(er.bdod?.formatViolations || []).length && !(er.bdod?.overlengthLines || []).length
    rows.push({
      label: 'BDOD format/line length OK',
      ok: bdodFormatOk,
      remark: `formatViolations=${(er.bdod?.formatViolations || []).join(', ') || '0'} overlengthLines=${(er.bdod?.overlengthLines || []).join(', ') || '0'}`
    })

    // Industrial Applicability (if provided by profile)
    if (er.industrialApplicability) {
      const iaLen = er.industrialApplicability?.length || 0
      const iaMax = er.industrialApplicability?.maxWords as number | undefined
      rows.push({
        label: 'Industrial Applicability present',
        ok: !!er.industrialApplicability?.present,
        remark: er.industrialApplicability?.present ? '' : 'Add Industrial Applicability as required by the office.'
      })
      if (iaMax) {
        rows.push({
          label: `Industrial Applicability length ≤ ${iaMax} words`,
          ok: iaLen <= iaMax,
          remark: `length=${iaLen}, max=${iaMax}`
        })
      }
      if (activeJurisdiction === 'IN') {
        rows.push({
          label: 'IA starts with required IN phrase',
          ok: !!er.industrialApplicability?.startsWith,
          remark: er.industrialApplicability?.startsWith ? '' : 'For IN, start with "The invention is industrially applicable to ...".'
        })
      }
    }

    // Figures / numerals
    rows.push({
      label: 'No invalid figure references',
      ok: !(er.figures?.invalidReferences || []).length,
      remark: (er.figures?.invalidReferences || []).join(', ')
    })
    rows.push({
      label: 'No numerals used-not-declared',
      ok: !(er.numerals?.usedNotDeclared || []).length,
      remark: (er.numerals?.usedNotDeclared || []).join(', ')
    })
    rows.push({
      label: 'No duplicate numerals in text',
      ok: !(er.numerals?.duplicates || []).length,
      remark: (er.numerals?.duplicates || []).join(', ')
    })

    // Claims
    const claimsMax = er.claims?.maxCount as number | undefined
    rows.push({
      label: claimsMax ? `Claims count ≤ ${claimsMax} (profile)` : 'Claims count (informational)',
      ok: claimsMax ? (er.claims?.total || 0) <= claimsMax : true,
      remark: `total=${er.claims?.total || 0}${claimsMax ? `, max=${claimsMax}` : ''}`
    })
    rows.push({
      label: 'No forbidden claim tokens (and/or, etc., approximately, substantially)',
      ok: !(er.claims?.forbiddenHits || []).length,
      remark: (er.claims?.forbiddenHits || []).join(', ')
    })

    setCheckList(
      rows.map(r => ({
        ...r,
        status: 'pending'
      }))
    )
    rows.forEach((r, idx) => {
      setTimeout(() => {
        setCheckList(prev =>
          prev.map((it, i) =>
            i === idx
              ? {
                  ...it,
                  status: r.ok ? 'pass' : 'fail'
                }
              : it
          )
        )
      }, 120 * idx)
    })

    return res
  }

  const handleAutoFix = async () => {
    // Placeholder for future auto-fix actions
    await onRefresh()
  }

  const effectiveJurisdiction = selectedJurisdiction || (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN').toUpperCase()
  const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
  const lastDraft = drafts.find((d: any) => (d.jurisdiction || 'IN').toUpperCase() === effectiveJurisdiction) || drafts[0]
  const report = lastDraft?.validationReport

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Review & Fix</h2>
        <p className="text-gray-600">Review consistency and fix any validation issues.</p>
      </div>

      <div className="border rounded-lg p-6 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Consistency & Validation</h3>
          <div className="flex items-center gap-2">
            {availableJurisdictions.length > 1 && (
              <select
                className="border rounded px-3 py-2 text-sm text-gray-900 bg-white"
                value={effectiveJurisdiction}
                onChange={(e) => setSelectedJurisdiction(e.target.value.toUpperCase())}
                aria-label="Select jurisdiction for review"
              >
                {availableJurisdictions.map(code => <option key={code} value={code}>{code}</option>)}
              </select>
            )}
            <button onClick={runChecks} className="px-3 py-2 text-sm rounded bg-indigo-600 text-white">
              Run Checks
            </button>
            <button onClick={handleAutoFix} className="px-3 py-2 text-sm rounded border border-gray-200 text-gray-700">
              Apply Quick Fixes
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 rounded bg-gray-50">
            <div className="text-xs text-gray-500">Numeral Consistency</div>
            <div className="text-sm">{report?.numeralConsistency ? 'OK' : 'Needs Attention'}</div>
          </div>
          <div className="p-3 rounded bg-gray-50">
            <div className="text-xs text-gray-500">Figure References</div>
            <div className="text-sm">{report?.figureReferences ? 'OK' : 'Invalid refs present'}</div>
          </div>
          <div className="p-3 rounded bg-gray-50">
            <div className="text-xs text-gray-500">Issues</div>
            <div className="text-sm">
              Missing: {(report?.missingNumerals || []).join(', ') || '—'} | Unused:{' '}
              {(report?.unusedNumerals || []).join(', ') || '—'}
            </div>
          </div>
        </div>

        {checkList.length > 0 && (
          <div className="mt-6">
            <div className="font-medium text-gray-900 mb-2">Checklist (profile-aware)</div>
            <ul className="space-y-1">
              {checkList.map((c, i) => (
                <li key={i} className="flex items-center justify-between p-2 rounded border bg-white">
                  <div className="text-sm text-gray-800">{c.label}</div>
                  <div className="flex items-center gap-3">
                    {c.status === 'pending' && <span className="text-xs text-gray-500">…</span>}
                    {c.status === 'pass' && <span className="text-green-600">✔</span>}
                    {c.status === 'fail' && <span className="text-red-600">✖</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {extReport?.extendedReport && (
          <div className="mt-6 p-4 rounded bg-gray-50">
            <div className="font-medium text-gray-900 mb-2">Recommendations</div>
            <ul className="list-disc ml-6 text-sm text-gray-700 space-y-1">
              {(() => {
                const er = extReport.extendedReport || {}
                const items: string[] = []
                const absMax = er.abstract?.maxWords as number | undefined
                if (absMax && er.abstract?.length > absMax) {
                  items.push(`Trim Abstract to ≤ ${absMax} words as per the country profile.`)
                }
                if ((er.bdod?.missingFigures || []).length > 0) {
                  items.push('Add BDOD lines for all figures and ensure they follow the required "Fig. X - ..." format.')
                }
                if ((er.claims?.forbiddenHits || []).length > 0) {
                  items.push('Remove forbidden claim terms (and/or, etc., approximately, substantially) from the claims.')
                }
                if (!er.industrialApplicability?.present) {
                  items.push('Add an Industrial Applicability section consistent with the selected jurisdiction.')
                }
                if (items.length === 0) {
                  items.push('No major issues detected against the current country profile; focus on minor wording and style improvements.')
                }
                return items.map((t, idx) => <li key={idx}>{t}</li>)
              })()}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <div className="flex justify-end">
          <button
            onClick={() => onRefresh()}
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            Next Stage
            <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
