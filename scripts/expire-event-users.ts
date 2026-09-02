/**
 * Sweep expired EVENT (workshop) users — thin CLI wrapper over
 * eventUserExpiryService, which the /api/platform/users/expire-event-access
 * route (scheduled daily by scripts/funding-scheduler.js) also calls.
 *
 * Usage: npm run ops:expire-event-users
 */
import 'dotenv/config'

import { expireEventUsers } from '@/lib/services/eventUserExpiryService'

expireEventUsers()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  })
  .catch((error) => {
    console.error('expire-event-users failed:', error)
    process.exit(1)
  })
