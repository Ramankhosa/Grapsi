import sgMail from '@sendgrid/mail'
import { prisma } from '@/lib/prisma'

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
}

export class ExpiryNotificationService {
  /**
   * Find tokens that are expiring within the next 7 days
   */
  async findTokensExpiringSoon() {
    const sevenDaysFromNow = new Date()
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)

    const tokens = await prisma.aTIToken.findMany({
      where: {
        expiresAt: {
          lte: sevenDaysFromNow,
          gt: new Date() // Not already expired
        },
        status: {
          in: ['ACTIVE', 'ISSUED']
        }
      },
      include: {
        tenant: true
      }
    })

    return tokens.filter(token => {
      const daysUntilExpiry = Math.ceil(
        (token.expiresAt!.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      )
      return daysUntilExpiry <= 7 && daysUntilExpiry > 0
    })
  }

  /**
   * Send expiry notifications for a token
   */
  async sendExpiryNotification(tokenId: string) {
    const token = await prisma.aTIToken.findUnique({
      where: { id: tokenId },
      include: {
        tenant: true
      }
    })

    if (!token || !token.expiresAt) return

    // Calculate days until expiry
    const daysUntilExpiry = Math.ceil(
      (token.expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    )

    // Only send notifications for tokens expiring in 7 days or less
    if (daysUntilExpiry > 7 || daysUntilExpiry <= 0) return

    // Find users to notify (users who signed up with this token)
    const usersToNotify = await prisma.user.findMany({
      where: {
        signupAtiTokenId: tokenId,
        status: 'ACTIVE'
      }
    })

    for (const user of usersToNotify) {
      await this.sendUserExpiryNotification(user, token, daysUntilExpiry)
    }

    // Also notify tenant admins if this is a tenant-level token
    if (token.tenant && token.tenant.atiId !== 'PLATFORM') {
      const tenantAdmins = await prisma.user.findMany({
        where: {
          tenantId: token.tenantId,
          roles: { hasSome: ['OWNER', 'ADMIN'] },
          status: 'ACTIVE'
        }
      })

      for (const admin of tenantAdmins) {
        await this.sendAdminExpiryNotification(admin, token, usersToNotify.length, daysUntilExpiry)
      }
    }
  }

  /**
   * Send expiry notification to a user
   */
  async sendUserExpiryNotification(user: any, token: any, daysUntilExpiry: number) {
    if (!process.env.SENDGRID_API_KEY) {
      console.log(`[NOTIFICATION] Would send expiry email to ${user.email} for token expiring in ${daysUntilExpiry} days`)
      return
    }

    // Check if we already sent this type of notification
    const existingNotification = await prisma.tokenNotification.findUnique({
      where: {
        tokenId_userId_notificationType: {
          tokenId: token.id,
          userId: user.id,
          notificationType: `${daysUntilExpiry}_days`
        }
      }
    })

    if (existingNotification) {
      console.log(`[NOTIFICATION] Already sent ${daysUntilExpiry}_days notification to ${user.email}`)
      return
    }

    const subject = daysUntilExpiry === 1
      ? `⚠️ Your access expires TOMORROW`
      : `Your access expires in ${daysUntilExpiry} days`

    const expiryDate = token.expiresAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })

    const msg = {
      to: user.email,
      from: 'noreply@patentnest.ai',
      subject,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
            <h1 style="margin: 0; font-size: 24px;">Access Expiry Notice</h1>
          </div>

          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin-top: 0; color: #333;">Hi ${user.name || 'User'},</h2>

            <p style="color: #666; line-height: 1.6;">
              Your ATI token access is expiring soon. Here's what you need to know:
            </p>

            <div style="background: white; padding: 15px; border-radius: 6px; border-left: 4px solid ${daysUntilExpiry <= 3 ? '#dc3545' : '#ffc107'}; margin: 20px 0;">
              <strong>Expiry Date:</strong> ${expiryDate}<br>
              <strong>Days Remaining:</strong> ${daysUntilExpiry} days<br>
              <strong>Token Fingerprint:</strong> ${token.fingerprint}
            </div>

            <p style="color: #666; line-height: 1.6;">
              To continue using PatentNest, please contact your tenant administrator to renew your access before the expiry date.
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.NEXTAUTH_URL}/dashboard" style="display: inline-block; background-color: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
              Go to Dashboard
            </a>
          </div>

          <div style="color: #999; font-size: 12px; text-align: center; border-top: 1px solid #eee; padding-top: 20px;">
            <p>This is an automated notification from PatentNest. If you believe this is an error, please contact support.</p>
          </div>
        </div>
      `
    }

    try {
      await sgMail.send(msg)

      // Record the notification
      await prisma.tokenNotification.create({
        data: {
          tokenId: token.id,
          userId: user.id,
          notificationType: `${daysUntilExpiry}_days`,
          deliveryMethod: 'email',
          status: 'sent',
          emailSent: true
        }
      })

      console.log(`[NOTIFICATION] Sent ${daysUntilExpiry}_days expiry notification to ${user.email}`)
    } catch (error) {
      console.error(`[NOTIFICATION] Failed to send expiry notification to ${user.email}:`, error)

      // Record failed notification
      await prisma.tokenNotification.create({
        data: {
          tokenId: token.id,
          userId: user.id,
          notificationType: `${daysUntilExpiry}_days`,
          deliveryMethod: 'email',
          status: 'failed',
          emailSent: false
        }
      })
    }
  }

  /**
   * Send expiry notification to tenant admin
   */
  async sendAdminExpiryNotification(admin: any, token: any, affectedUsers: number, daysUntilExpiry: number) {
    if (!process.env.SENDGRID_API_KEY) {
      console.log(`[NOTIFICATION] Would send admin expiry alert to ${admin.email} for ${affectedUsers} users`)
      return
    }

    const subject = `⚠️ ${affectedUsers} user${affectedUsers > 1 ? 's' : ''} ${affectedUsers > 1 ? 'have' : 'has'} access expiring in ${daysUntilExpiry} days`

    const expiryDate = token.expiresAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })

    const msg = {
      to: admin.email,
      from: 'noreply@patentnest.ai',
      subject,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
            <h1 style="margin: 0; font-size: 24px;">User Access Expiry Alert</h1>
          </div>

          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin-top: 0; color: #333;">Hi ${admin.name || 'Admin'},</h2>

            <p style="color: #666; line-height: 1.6;">
              You have <strong>${affectedUsers} user${affectedUsers > 1 ? 's' : ''}</strong> in your tenant whose access is expiring soon.
            </p>

            <div style="background: white; padding: 15px; border-radius: 6px; border-left: 4px solid ${daysUntilExpiry <= 3 ? '#dc3545' : '#ffc107'}; margin: 20px 0;">
              <strong>Token Expiry Date:</strong> ${expiryDate}<br>
              <strong>Days Remaining:</strong> ${daysUntilExpiry} days<br>
              <strong>Token Fingerprint:</strong> ${token.fingerprint}<br>
              <strong>Affected Users:</strong> ${affectedUsers}
            </div>

            <p style="color: #666; line-height: 1.6;">
              Please review and renew these tokens before they expire to prevent access disruption.
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.NEXTAUTH_URL}/ati-management" style="display: inline-block; background-color: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
              Manage ATI Tokens
            </a>
          </div>

          <div style="color: #999; font-size: 12px; text-align: center; border-top: 1px solid #eee; padding-top: 20px;">
            <p>This is an automated alert from PatentNest. Regular monitoring helps maintain user access.</p>
          </div>
        </div>
      `
    }

    try {
      await sgMail.send(msg)
      console.log(`[NOTIFICATION] Sent admin expiry alert to ${admin.email} for ${affectedUsers} users`)
    } catch (error) {
      console.error(`[NOTIFICATION] Failed to send admin expiry alert to ${admin.email}:`, error)
    }
  }

  /**
   * Main method to check and send all expiry notifications
   */
  async checkAndNotifyExpiringTokens() {
    console.log('[NOTIFICATION] Checking for tokens expiring within 7 days...')

    const expiringTokens = await this.findTokensExpiringSoon()
    console.log(`[NOTIFICATION] Found ${expiringTokens.length} tokens expiring soon`)

    for (const token of expiringTokens) {
      try {
        await this.sendExpiryNotification(token.id)
        // Add small delay to avoid overwhelming the email service
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        console.error(`[NOTIFICATION] Failed to process token ${token.id}:`, error)
      }
    }

    console.log('[NOTIFICATION] Expiry notification check completed')
  }
}
