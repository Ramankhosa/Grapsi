'use client'

import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { BUDGET_HEAD_LABELS, type BudgetHead } from '@/lib/proposals/shared'

/**
 * The ask, by head of expenditure and project year.
 *
 * A grid because that is the form every Indian agency prints, and because a
 * school's ask by head is a question the department is asked. The total is
 * computed, never typed, whenever there are lines: a total that disagrees with
 * its own rows is worse than no total.
 */

export interface BudgetLine {
  id?: string
  head: BudgetHead | string
  yearNo: number
  amount: number
  note?: string | null
}

export default function BudgetGrid({
  proposalId,
  budget,
  heads,
  currency,
  durationMonths,
  canEdit,
  onChanged,
}: {
  proposalId: string
  budget: BudgetLine[]
  heads: BudgetHead[]
  currency: string
  durationMonths: number | null
  canEdit: boolean
  onChanged: () => void | Promise<void>
}) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const initialYears = useMemo(() => {
    const maxYear = budget.reduce((max, line) => Math.max(max, line.yearNo), 0)
    if (maxYear > 0) return maxYear
    // A three-year project is the common case, and an empty grid with one
    // column invites a total typed in the wrong place.
    return durationMonths ? Math.max(1, Math.ceil(durationMonths / 12)) : 3
  }, [budget, durationMonths])

  const [years, setYears] = useState(initialYears)
  const [cells, setCells] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const line of budget) next[`${line.head}:${line.yearNo}`] = String(line.amount)
    setCells(next)
    setYears(initialYears)
  }, [budget, initialYears])

  const yearList = Array.from({ length: years }, (_, index) => index + 1)

  function cell(head: string, year: number): number {
    const raw = cells[`${head}:${year}`]
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  const headTotals = heads.map((head) => ({
    head,
    total: yearList.reduce((sum, year) => sum + cell(head, year), 0),
  }))
  const yearTotals = yearList.map((year) => heads.reduce((sum, head) => sum + cell(head, year), 0))
  const grandTotal = yearTotals.reduce((sum, value) => sum + value, 0)

  const money = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 0 })

  async function save() {
    setBusy(true)
    try {
      const lines: BudgetLine[] = []
      for (const head of heads) {
        for (const year of yearList) {
          const amount = cell(head, year)
          if (amount > 0) lines.push({ head, yearNo: year, amount })
        }
      }

      const response = await authFetch(`/api/proposals/${proposalId}/budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, durationMonths: years * 12 }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not save the budget.')
      showToast({ type: 'success', title: 'Budget saved' })
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not save', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="cb-scroll-x overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-hairline">
              <th className="nk-label py-2 text-left">Head</th>
              {yearList.map((year) => (
                <th key={year} className="nk-label py-2 text-right">
                  Year {year}
                </th>
              ))}
              <th className="nk-label py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {heads.map((head, index) => (
              <tr key={head} className="border-b border-hairline/60">
                <td className="py-2 pr-3 text-nickel-800">{BUDGET_HEAD_LABELS[head] || head}</td>
                {yearList.map((year) => (
                  <td key={year} className="py-1.5 pl-2 text-right">
                    {canEdit ? (
                      <input
                        className="nk-input w-28 text-right"
                        inputMode="decimal"
                        value={cells[`${head}:${year}`] ?? ''}
                        placeholder="0"
                        onChange={(event) =>
                          setCells((current) => ({
                            ...current,
                            [`${head}:${year}`]: event.target.value,
                          }))
                        }
                      />
                    ) : (
                      <span className="nk-mono">{money(cell(head, year))}</span>
                    )}
                  </td>
                ))}
                <td className="py-2 pl-2 text-right">
                  <span className="nk-mono">{money(headTotals[index].total)}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="nk-label py-2">Total</td>
              {yearTotals.map((total, index) => (
                <td key={index} className="py-2 pl-2 text-right">
                  <span className="nk-readout-sm">{money(total)}</span>
                </td>
              ))}
              <td className="py-2 pl-2 text-right">
                <span className="nk-readout-sm">
                  {currency} {money(grandTotal)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="nk-btn-secondary nk-btn-xs"
            onClick={() => setYears((value) => Math.min(value + 1, 10))}
          >
            Add a year
          </button>
          {years > 1 && (
            <button
              type="button"
              className="nk-btn-ghost nk-btn-xs"
              onClick={() => setYears((value) => Math.max(value - 1, 1))}
            >
              Remove last year
            </button>
          )}
          <button
            type="button"
            className="nk-btn-primary nk-btn-sm ml-auto"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save budget'}
          </button>
        </div>
      )}
    </div>
  )
}
