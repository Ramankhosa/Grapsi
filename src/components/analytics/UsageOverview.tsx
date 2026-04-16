'use client'

interface UsageMetrics {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  apiCalls: number
  cost: number
  requests: number
}

interface UsageOverviewProps {
  data: UsageMetrics
}

export function UsageOverview({ data }: UsageOverviewProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num)
  }

  const stats = [
    {
      title: 'Total Tokens',
      value: formatNumber(data.totalTokens),
      description: `${formatNumber(data.inputTokens)} input, ${formatNumber(data.outputTokens)} output`,
    },
    {
      title: 'API Calls',
      value: formatNumber(data.apiCalls),
      description: `${formatNumber(data.requests)} total requests`,
    },
    {
      title: 'Total Cost',
      value: formatCurrency(data.cost),
      description: 'Estimated cost',
    },
    {
      title: 'Avg Tokens/Call',
      value: data.apiCalls > 0 ? formatNumber(Math.round(data.totalTokens / data.apiCalls)) : '0',
      description: 'Efficiency metric',
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat) => (
        <div key={stat.title} className="bg-white p-6 rounded-lg shadow border">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-600">{stat.title}</h3>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              stat.title.includes('Token') ? 'bg-blue-100 text-blue-600' :
              stat.title.includes('Cost') ? 'bg-purple-100 text-purple-600' :
              stat.title.includes('Call') ? 'bg-green-100 text-green-600' :
              'bg-orange-100 text-orange-600'
            }`}>
              <span className="text-sm font-bold">
                {stat.title.includes('Token') ? '⚡' :
                 stat.title.includes('Cost') ? '$' :
                 stat.title.includes('Call') ? '📞' :
                 '📈'}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
            <p className="text-sm text-gray-500 mt-1">{stat.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
