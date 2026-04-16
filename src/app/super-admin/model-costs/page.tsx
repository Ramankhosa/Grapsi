'use client'

import { useEffect, useState } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { useAuth } from '@/lib/auth-context'

interface ModelPrice {
  id: string
  provider: string
  modelClass: string
  inputPricePerMTokens: number
  outputPricePerMTokens: number
  currency: string
  createdAt: string
  updatedAt: string
}

interface FormState {
  provider: string
  modelClass: string
  inputPricePerMTokens: string
  outputPricePerMTokens: string
  currency: string
}

export default function ModelCostsPage() {
  noStore()

  const { user, logout } = useAuth()
  const [prices, setPrices] = useState<ModelPrice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>({
    provider: '',
    modelClass: '',
    inputPricePerMTokens: '',
    outputPricePerMTokens: '',
    currency: 'USD'
  })

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }

    if (!user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      window.location.href = '/dashboard'
      return
    }

    fetchPrices()
  }, [user])

  const fetchPrices = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/analytics/model-costs', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        }
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load model costs')
      }

      const body = await response.json()
      setPrices(body || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model costs')
      setPrices([])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.provider || !form.modelClass) return

    try {
      setSaving(true)
      setError(null)

      const response = await fetch('/api/analytics/model-costs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          provider: form.provider,
          modelClass: form.modelClass,
          inputPricePerMTokens: parseFloat(form.inputPricePerMTokens || '0'),
          outputPricePerMTokens: parseFloat(form.outputPricePerMTokens || '0'),
          currency: form.currency || 'USD'
        })
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to save model cost')
      }

      await fetchPrices()

      setForm(prev => ({
        ...prev,
        modelClass: '',
        inputPricePerMTokens: '',
        outputPricePerMTokens: ''
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save model cost')
    } finally {
      setSaving(false)
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Access denied. Super admin privileges required.</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">LLM Model Cost Configuration</h1>
            <p className="text-gray-600 mt-1 text-sm">
              Configure per-million token costs for each provider/model. Analytics dashboards will use these
              values to compute accurate cost trends.
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500">Super Admin: {user.email}</span>
            <button
              onClick={() => logout()}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Form */}
        <div className="bg-white p-6 rounded-lg shadow border">
          <h2 className="text-lg font-semibold mb-4">Add / Update Model Cost</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
              <input
                type="text"
                value={form.provider}
                onChange={e => setForm(prev => ({ ...prev, provider: e.target.value }))}
                placeholder="e.g. gemini, openai"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model class</label>
              <input
                type="text"
                value={form.modelClass}
                onChange={e => setForm(prev => ({ ...prev, modelClass: e.target.value }))}
                placeholder="e.g. gemini-2.5-pro, gpt-4o"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Input cost (USD / 1M tokens)
              </label>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form.inputPricePerMTokens}
                onChange={e => setForm(prev => ({ ...prev, inputPricePerMTokens: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Output cost (USD / 1M tokens)
              </label>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form.outputPricePerMTokens}
                onChange={e => setForm(prev => ({ ...prev, outputPricePerMTokens: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="flex flex-col space-y-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <input
                type="text"
                value={form.currency}
                onChange={e => setForm(prev => ({ ...prev, currency: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <button
                type="submit"
                disabled={saving}
                className="mt-1 inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save model cost'}
              </button>
            </div>
          </form>
          <p className="mt-3 text-xs text-gray-500">
            Hint: for current Gemini and OpenAI pricing, refer to their official pricing pages. You can then
            copy the per‑million token rates here.
          </p>
          {error && (
            <div className="mt-3 text-xs text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* Existing prices */}
        <div className="bg-white p-6 rounded-lg shadow border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Configured Model Prices</h2>
            {loading && (
              <span className="text-xs text-gray-500">Loading...</span>
            )}
          </div>
          {prices.length === 0 ? (
            <p className="text-sm text-gray-500">
              No model prices configured yet. Add entries above for models like{' '}
              <span className="font-mono">gemini-2.5-pro</span>,{' '}
              <span className="font-mono">gemini-2.5-flash-lite</span>,{' '}
              <span className="font-mono">gpt-4o</span>, etc.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-4 py-2 text-left">Provider</th>
                    <th className="px-4 py-2 text-left">Model class</th>
                    <th className="px-4 py-2 text-right">Input (USD / 1M)</th>
                    <th className="px-4 py-2 text-right">Output (USD / 1M)</th>
                    <th className="px-4 py-2 text-left">Currency</th>
                    <th className="px-4 py-2 text-left">Updated at</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map(p => (
                    <tr key={p.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono">{p.provider}</td>
                      <td className="px-4 py-2 font-mono">{p.modelClass}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        {p.inputPricePerMTokens.toFixed(4)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {p.outputPricePerMTokens.toFixed(4)}
                      </td>
                      <td className="px-4 py-2">{p.currency}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {new Date(p.updatedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

