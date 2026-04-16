// Configuration for the metering system

import type { MeteringConfig, PolicyLimits } from './types'

/**
 * Default configuration for the metering system
 */
export const defaultConfig: MeteringConfig = {
  enabled: true,
  allowBypassForAdmins: false,
  reservationTimeoutMs: 300000, // 5 minutes
  maxConcurrentReservations: 100,
  defaultLimits: {
    maxTokensIn: 2000,
    maxTokensOut: 12000,
    agentMaxSteps: 10,
    retrievalTopK: 5,
    diagramFilesPerReq: 1,
    concurrencyLimit: 20,
  },
}

/**
 * Create a metering configuration with validation
 */
export function createMeteringConfig(config: Partial<MeteringConfig> = {}): MeteringConfig {
  const finalConfig = { ...defaultConfig, ...config }

  // Validate configuration
  if (finalConfig.reservationTimeoutMs < 10000) {
    throw new Error('Reservation timeout must be at least 10 seconds')
  }

  if (finalConfig.maxConcurrentReservations < 1) {
    throw new Error('Max concurrent reservations must be at least 1')
  }

  return finalConfig
}

/**
 * Environment-based configuration
 */
export function createMeteringConfigFromEnv(): MeteringConfig {
  return createMeteringConfig({
    enabled: process.env.METERING_ENABLED !== 'false',
    allowBypassForAdmins: process.env.METERING_BYPASS_ADMINS === 'true',
    reservationTimeoutMs: parseInt(process.env.METERING_RESERVATION_TIMEOUT || '300000'),
    maxConcurrentReservations: parseInt(process.env.METERING_MAX_CONCURRENT || '100'),
    defaultLimits: {
      maxTokensIn: parseInt(process.env.METERING_DEFAULT_MAX_TOKENS_IN || '1000'),
      maxTokensOut: parseInt(process.env.METERING_DEFAULT_MAX_TOKENS_OUT || '6000'),
      agentMaxSteps: parseInt(process.env.METERING_DEFAULT_MAX_STEPS || '10'),
      retrievalTopK: parseInt(process.env.METERING_DEFAULT_TOP_K || '5'),
      diagramFilesPerReq: parseInt(process.env.METERING_DEFAULT_MAX_FILES || '1'),
      concurrencyLimit: parseInt(process.env.METERING_DEFAULT_CONCURRENCY || '20'),
    },
  })
}
