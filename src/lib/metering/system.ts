import type { MeteringConfig } from './types'
import { createIdentityService } from './identity'
import { createCatalogService } from './catalog'
import { createPolicyService } from './policy'
import { createReservationService } from './reservation'
import { createMeteringService } from './metering'
import { defaultConfig } from './config'

/**
 * Create a complete metering system with all services
 */
export function createMeteringSystem(config: Partial<MeteringConfig> = {}) {
  const finalConfig = { ...defaultConfig, ...config }

  return {
    config: finalConfig,
    identity: createIdentityService(finalConfig),
    catalog: createCatalogService(finalConfig),
    policy: createPolicyService(finalConfig),
    reservation: createReservationService(finalConfig),
    metering: createMeteringService(finalConfig),
  }
}

/**
 * Quick setup for development/testing
 */
export function createDevMeteringSystem() {
  return createMeteringSystem({
    enabled: true,
    allowBypassForAdmins: true,
    reservationTimeoutMs: 30000, // 30 seconds
    maxConcurrentReservations: 10,
  })
}
