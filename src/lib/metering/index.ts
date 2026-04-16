// Main entry point for the metering system
// Export all types, errors, and service interfaces

export * from './types'
export * from './errors'

// Core service exports (implemented)
export { createIdentityService } from './identity'
export { createCatalogService } from './catalog'
export { createPolicyService } from './policy'
export { createReservationService } from './reservation'
export { createMeteringService } from './metering'

// High-level orchestration functions
export { enforceMetering, withMetering } from './enforcement'
export { MeteringError, MeteringErrorUtils } from './errors'
export { createMeteringMiddleware } from './middleware'
export { extractTenantContextFromRequest, createFeatureRequest, recordApiUsage } from './auth-bridge'

// LLM Gateway and Provider exports
export { llmGateway, executePriorArtSearch, executePatentDrafting, executeDiagramGeneration } from './gateway'
export { llmProviderRouter } from './providers/provider-router'
export { createLLMProvider } from './providers/llm-provider'

// Configuration and utilities
export { defaultConfig, createMeteringConfig } from './config'
export { createMeteringSystem, createDevMeteringSystem } from './system'
export * from './utils'
