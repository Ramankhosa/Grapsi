import { prisma } from '@/lib/prisma'
import { completeTaskInTx, deferTask, withFence, type Lease } from './queue'

/** Publication delivery runs after budgeted indexing; recipient services deduplicate. */
export async function notifyPublication(lease: Lease) {
  if (process.env.MONITOR_NOTIFICATIONS_ENABLED !== 'true') {
    await deferTask(lease, new Date(Date.now() + 3600000), 'Notifications are disabled', 'PAUSED_PROVIDER')
    return
  }
  const callId = String(lease.payload.callId)
  const call = await prisma.fundingCall.findUnique({ where: { id: callId } })
  await withFence(lease, async tx => {
    // Check ownership immediately before dispatch. Delivery rows in the alert
    // service make retries safe if the process dies after dispatch.
    if (!call || call.catalog_status !== 'PUBLISHED') { await completeTaskInTx(tx, lease, { skipped: true }); return }
    const { fundingAlertService } = await import('@/lib/services/fundingAlertService')
    await fundingAlertService.dispatchAlertsForFundingCall(callId)
    await completeTaskInTx(tx, lease, { callId })
  })
}
