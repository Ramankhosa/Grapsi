'use client'

interface UsageMetrics {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  apiCalls: number
  cost: number
  requests: number
}

interface ChartData {
  period?: string
  entity?: string
  entityName?: string
  metrics?: UsageMetrics
  [key: string]: any
}

interface UsageChartProps {
  data: ChartData[]
  title: string
  dataKey: string
  isPieChart?: boolean
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D']

export function UsageChart({ data, title, dataKey, isPieChart = false }: UsageChartProps) {
  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  if (isPieChart) {
    return (
      <div className="bg-white p-6 rounded-lg shadow border">
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        <div className="space-y-3">
          {data.slice(0, 8).map((item, index) => {
            const value = getNestedValue(item, dataKey)
            const percentage = data.length > 0 ? (value / data.reduce((sum, d) => sum + getNestedValue(d, dataKey), 0)) * 100 : 0

            return (
              <div key={index} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  ></div>
                  <span className="text-sm">{item.entityName || item.entity || `Item ${index + 1}`}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium">{formatNumber(value)}</span>
                  <span className="text-xs text-gray-500 ml-2">({percentage.toFixed(1)}%)</span>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4 text-center text-gray-500 text-sm">
          📊 Chart visualization requires recharts library
        </div>
      </div>
    )
  }

  // Simple table for trends
  return (
    <div className="bg-white p-6 rounded-lg shadow border">
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">Period</th>
              <th className="text-right py-2">Tokens</th>
              <th className="text-right py-2">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 10).map((item, index) => (
              <tr key={index} className="border-b">
                <td className="py-2">{item.period || `Period ${index + 1}`}</td>
                <td className="text-right py-2">{formatNumber(getNestedValue(item, dataKey))}</td>
                <td className="text-right py-2">{formatCurrency(item.metrics?.cost || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 text-center text-gray-500 text-sm">
        📈 Interactive charts require recharts library
      </div>
    </div>
  )
}

// Helper function to get nested object values
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}
