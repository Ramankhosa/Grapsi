/**
 * Reset Password Script
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  const EMAIL = 'tenantadmin@spotipr.com'
  const NEW_PASSWORD = 'Admin123!'

  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 10)

  const user = await prisma.user.update({
    where: { email: EMAIL },
    data: { passwordHash }
  })

  console.log('✅ Password reset successfully!')
  console.log('================================')
  console.log(`Email: ${EMAIL}`)
  console.log(`New Password: ${NEW_PASSWORD}`)
  console.log(`User ID: ${user.id}`)
  console.log('================================')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

