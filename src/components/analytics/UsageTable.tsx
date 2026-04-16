'use client'

interface UsageMetrics {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  apiCalls: number
  cost: number
  requests: number
}

interface TableData {
  entity: string
  entityName: string
  metrics: UsageMetrics
  percentage: number
}

interface UsageTableProps {
  data: TableData[]
  groupBy: string
}

export function UsageTable({ data, groupBy }: UsageTableProps) {
  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const formatPercentage = (percentage: number) => {
    return `${percentage.toFixed(1)}%`
  }

  const getEntityTypeLabel = (groupBy: string) => {
    switch (groupBy) {
      case 'tenant':
        return 'Tenant'
      case 'user':
        return 'User'
      case 'feature':
        return 'Feature'
      case 'task':
        return 'Task'
      case 'model':
        return 'Model'
      case 'provider':
        return 'Provider'
      default:
        return 'Entity'
    }
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow border">
      <h3 className="text-lg font-semibold mb-4">Usage Breakdown by {getEntityTypeLabel(groupBy)}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">{getEntityTypeLabel(groupBy)}</th>
              <th className="text-right py-2">Total Tokens</th>
              <th className="text-right py-2">Input Tokens</th>
              <th className="text-right py-2">Output Tokens</th>
              <th className="text-right py-2">API Calls</th>
              <th className="text-right py-2">Cost</th>
              <th className="text-right py-2">Usage %</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.entity} className="border-b hover:bg-gray-50">
                <td className="py-3 font-medium">
                  <div className="flex items-center space-x-2">
                    <span>{row.entityName}</span>
                    {row.percentage >= 50 && (
                      <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">High Usage</span>
                    )}
                    {row.percentage >= 80 && (
                      <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded">Very High</span>
                    )}
                  </div>
                </td>
                <td className="text-right py-3 font-mono">
                  {formatNumber(row.metrics.totalTokens)}
                </td>
                <td className="text-right py-3 font-mono text-blue-600">
                  {formatNumber(row.metrics.inputTokens)}
                </td>
                <td className="text-right py-3 font-mono text-green-600">
                  {formatNumber(row.metrics.outputTokens)}
                </td>
                <td className="text-right py-3 font-mono">
                  {formatNumber(row.metrics.apiCalls)}
                </td>
                <td className="text-right py-3 font-mono text-purple-600">
                  {formatCurrency(row.metrics.cost)}
                </td>
                <td className="text-right py-3">
                  <div className="flex items-center justify-end space-x-2">
                    <span className="font-mono">{formatPercentage(row.percentage)}</span>
                    <div className="w-16 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{ width: `${Math.min(row.percentage, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  No usage data available for the selected period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="font-medium">Total Entities:</span> {data.length}
            </div>
            <div>
              <span className="font-medium">Avg Tokens/Entity:</span>{' '}
              {formatNumber(Math.round(data.reduce((sum, row) => sum + row.metrics.totalTokens, 0) / data.length))}
            </div>
            <div>
              <span className="font-medium">Highest Usage:</span>{' '}
              {formatPercentage(Math.max(...data.map(row => row.percentage)))} by {data[0]?.entityName}
            </div>
            <div>
              <span className="font-medium">Total Cost:</span>{' '}
              {formatCurrency(data.reduce((sum, row) => sum + row.metrics.cost, 0))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
