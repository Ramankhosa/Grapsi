'use client'

interface UsageMetrics {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  apiCalls: number
  cost: number
  requests: number
}

interface TopUser {
  userId: string
  userName: string
  metrics: UsageMetrics
}

interface TopUsersChartProps {
  data: TopUser[]
}

export function TopUsersChart({ data }: TopUsersChartProps) {
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

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0:
        return <span className="text-yellow-500 text-lg">🏆</span>
      case 1:
        return <span className="text-gray-400 text-lg">🥈</span>
      case 2:
        return <span className="text-amber-600 text-lg">🥉</span>
      default:
        return <span className="text-sm font-bold text-gray-500">#{index + 1}</span>
    }
  }

  const getRankBadge = (index: number) => {
    switch (index) {
      case 0:
        return <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">Champion</span>
      case 1:
        return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">Runner-up</span>
      case 2:
        return <span className="px-2 py-1 text-xs bg-amber-100 text-amber-800 rounded">Third Place</span>
      default:
        return null
    }
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .join('')
      .slice(0, 2)
  }

  if (data.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow border">
        <h3 className="text-lg font-semibold mb-4">Top Users</h3>
        <div className="text-center py-8 text-gray-500">
          No user usage data available
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow border">
      <h3 className="text-lg font-semibold mb-2">Top LLM Users</h3>
      <p className="text-sm text-gray-600 mb-6">Users ranked by total token usage</p>

      <div className="space-y-4">
        {data.map((user, index) => (
          <div
            key={user.userId}
            className={`flex items-center justify-between p-4 rounded-lg border ${
              index < 3 ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200' : 'bg-white'
            }`}
          >
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                {getRankIcon(index)}
                <div className="w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-medium">
                  {getInitials(user.userName)}
                </div>
              </div>

              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-medium">{user.userName}</h3>
                  {getRankBadge(index)}
                </div>
                <div className="text-sm text-gray-600">
                  {formatNumber(user.metrics.apiCalls)} API calls
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-lg font-bold text-blue-600">
                {formatNumber(user.metrics.totalTokens)}
              </div>
              <div className="text-sm text-gray-600">
                tokens used
              </div>
              <div className="text-sm text-purple-600 font-medium">
                {formatCurrency(user.metrics.cost)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h4 className="font-medium mb-2">Usage Insights</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Total Users:</span> {data.length}
          </div>
          <div>
            <span className="text-gray-600">Avg Tokens/User:</span>{' '}
            {formatNumber(Math.round(
              data.reduce((sum, user) => sum + user.metrics.totalTokens, 0) / data.length
            ))}
          </div>
          <div>
            <span className="text-gray-600">Top User:</span>{' '}
            <span className="font-medium">{data[0]?.userName}</span>
          </div>
          <div>
            <span className="text-gray-600">Cost Leader:</span>{' '}
            <span className="font-medium">
              {data.reduce((max, user) =>
                user.metrics.cost > max.metrics.cost ? user : max
              ).userName}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}