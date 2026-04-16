/**
 * Feature Flag System for Research Paper Writing Application
 *
 * This system allows gradual rollout of new features while maintaining
 * backward compatibility with existing patent drafting functionality.
 *
 * Flags are read from environment variables for easy deployment control.
 */

export interface FeatureFlags {
  // Citation Management Features
  ENABLE_CITATIONS: boolean;
  ENABLE_CITATION_STYLES: boolean;

  // Literature Search Features
  ENABLE_LITERATURE_SEARCH: boolean;
  ENABLE_MULTI_SOURCE_SEARCH: boolean;
  ENABLE_SEARCH_STRATEGY: boolean; // Pro feature - AI search strategy generation

  // Paper Type Features
  ENABLE_NEW_PAPER_TYPES: boolean;
  ENABLE_PAPER_TYPE_EDITOR: boolean;

  // UI/UX Features
  ENABLE_PAPER_WRITING_UI: boolean;
  ENABLE_NEW_STAGE_NAVIGATION: boolean;

  // Advanced Features
  ENABLE_LATEX_EXPORT: boolean;
  ENABLE_COLLABORATIVE_EDITING: boolean;

  // Generation Pipeline
  ENABLE_TWO_PASS_GENERATION: boolean;

  // Paper Writing Upgrade (SRS V2)
  ENABLE_ARGUMENT_PLAN: boolean;
  ENABLE_CITATION_BUDGET_VALIDATOR: boolean;
  ENABLE_RHETORICAL_BLUEPRINT: boolean;
  ENABLE_RHETORICAL_COMPOSER_PASS2B: boolean;

  // Migration Flags
  DISABLE_PATENT_DRAFTING: boolean;
  MIGRATION_MODE: boolean;
}

/**
 * Default feature flag values
 * Paper writing is enabled by default as this is a paper-only app.
 * Patent features are disabled.
 */
const DEFAULT_FLAGS: FeatureFlags = {
  // Citation Management - Enabled for paper writing
  ENABLE_CITATIONS: true,
  ENABLE_CITATION_STYLES: true,

  // Literature Search - Enabled for paper writing
  ENABLE_LITERATURE_SEARCH: true,
  ENABLE_MULTI_SOURCE_SEARCH: true,
  ENABLE_SEARCH_STRATEGY: true, // Pro feature - requires plan check

  // Paper Types - Enabled for paper writing
  ENABLE_NEW_PAPER_TYPES: true,
  ENABLE_PAPER_TYPE_EDITOR: true,

  // UI/UX - Enabled for paper writing
  ENABLE_PAPER_WRITING_UI: true,
  ENABLE_NEW_STAGE_NAVIGATION: true,

  // Advanced Features - Disabled by default (can enable later)
  ENABLE_LATEX_EXPORT: false,
  ENABLE_COLLABORATIVE_EDITING: false,

  // Generation Pipeline - Two-pass: evidence draft → publication polish
  ENABLE_TWO_PASS_GENERATION: true,

  // Paper Writing Upgrade (SRS V2)
  ENABLE_ARGUMENT_PLAN: false, // Tier 2 — disabled until ArgumentPlan service is ready
  ENABLE_CITATION_BUDGET_VALIDATOR: true, // Tier 1 — citation-density lint only; no rewrite loop
  ENABLE_RHETORICAL_BLUEPRINT: true, // Tier 3 — prompt-level rhetorical blueprint injection
  ENABLE_RHETORICAL_COMPOSER_PASS2B: false, // Tier 3 — disabled; prompt guidance remains but no post-polish rewrite

  // Migration Flags - Patent drafting disabled (paper-only mode)
  DISABLE_PATENT_DRAFTING: true,
  MIGRATION_MODE: false,
};

/**
 * Environment variable mappings
 * Convention: FEATURE_[FLAG_NAME] or NEXT_PUBLIC_FEATURE_[FLAG_NAME]
 * NEXT_PUBLIC_ prefix is required for client-side access in Next.js
 */
const ENV_VAR_MAPPINGS: Record<keyof FeatureFlags, string[]> = {
  ENABLE_CITATIONS: ['NEXT_PUBLIC_FEATURE_ENABLE_CITATIONS', 'FEATURE_ENABLE_CITATIONS', 'FEATURE_CITATIONS'],
  ENABLE_CITATION_STYLES: ['NEXT_PUBLIC_FEATURE_ENABLE_CITATION_STYLES', 'FEATURE_ENABLE_CITATION_STYLES', 'FEATURE_CITATION_STYLES'],
  ENABLE_LITERATURE_SEARCH: ['NEXT_PUBLIC_FEATURE_ENABLE_LITERATURE_SEARCH', 'FEATURE_ENABLE_LITERATURE_SEARCH', 'FEATURE_LITERATURE_SEARCH'],
  ENABLE_MULTI_SOURCE_SEARCH: ['NEXT_PUBLIC_FEATURE_ENABLE_MULTI_SOURCE_SEARCH', 'FEATURE_ENABLE_MULTI_SOURCE_SEARCH', 'FEATURE_MULTI_SOURCE_SEARCH'],
  ENABLE_SEARCH_STRATEGY: ['NEXT_PUBLIC_FEATURE_ENABLE_SEARCH_STRATEGY', 'FEATURE_ENABLE_SEARCH_STRATEGY', 'FEATURE_SEARCH_STRATEGY'],
  ENABLE_NEW_PAPER_TYPES: ['NEXT_PUBLIC_FEATURE_ENABLE_NEW_PAPER_TYPES', 'FEATURE_ENABLE_NEW_PAPER_TYPES', 'FEATURE_NEW_PAPER_TYPES'],
  ENABLE_PAPER_TYPE_EDITOR: ['NEXT_PUBLIC_FEATURE_ENABLE_PAPER_TYPE_EDITOR', 'FEATURE_ENABLE_PAPER_TYPE_EDITOR', 'FEATURE_PAPER_TYPE_EDITOR'],
  ENABLE_PAPER_WRITING_UI: ['NEXT_PUBLIC_FEATURE_ENABLE_PAPER_WRITING_UI', 'FEATURE_ENABLE_PAPER_WRITING_UI', 'FEATURE_PAPER_WRITING_UI'],
  ENABLE_NEW_STAGE_NAVIGATION: ['NEXT_PUBLIC_FEATURE_ENABLE_NEW_STAGE_NAVIGATION', 'FEATURE_ENABLE_NEW_STAGE_NAVIGATION', 'FEATURE_NEW_STAGE_NAVIGATION'],
  ENABLE_LATEX_EXPORT: ['NEXT_PUBLIC_FEATURE_ENABLE_LATEX_EXPORT', 'FEATURE_ENABLE_LATEX_EXPORT', 'FEATURE_LATEX_EXPORT'],
  ENABLE_COLLABORATIVE_EDITING: ['NEXT_PUBLIC_FEATURE_ENABLE_COLLABORATIVE_EDITING', 'FEATURE_ENABLE_COLLABORATIVE_EDITING', 'FEATURE_COLLABORATIVE_EDITING'],
  ENABLE_TWO_PASS_GENERATION: ['FEATURE_ENABLE_TWO_PASS_GENERATION', 'FEATURE_TWO_PASS_GENERATION'],
  ENABLE_ARGUMENT_PLAN: ['FEATURE_ENABLE_ARGUMENT_PLAN', 'FEATURE_ARGUMENT_PLAN'],
  ENABLE_CITATION_BUDGET_VALIDATOR: ['FEATURE_ENABLE_CITATION_BUDGET_VALIDATOR', 'FEATURE_CITATION_BUDGET_VALIDATOR'],
  ENABLE_RHETORICAL_BLUEPRINT: ['FEATURE_ENABLE_RHETORICAL_BLUEPRINT', 'FEATURE_RHETORICAL_BLUEPRINT'],
  ENABLE_RHETORICAL_COMPOSER_PASS2B: ['FEATURE_ENABLE_RHETORICAL_COMPOSER_PASS2B', 'FEATURE_RHETORICAL_COMPOSER_PASS2B'],
  DISABLE_PATENT_DRAFTING: ['NEXT_PUBLIC_FEATURE_DISABLE_PATENT_DRAFTING', 'FEATURE_DISABLE_PATENT_DRAFTING', 'FEATURE_PATENT_DRAFTING_DISABLED'],
  MIGRATION_MODE: ['NEXT_PUBLIC_FEATURE_MIGRATION_MODE', 'FEATURE_MIGRATION_MODE', 'FEATURE_MIGRATION'],
};

/**
 * Parse environment variable to boolean
 * Supports: "true", "1", "yes", "on" (case insensitive)
 */
function parseBooleanEnvVar(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * Get current feature flag configuration
 * Reads from environment variables with fallback to defaults
 * Only NEXT_PUBLIC_ prefixed vars are available on client-side
 */
export function getFeatureFlags(): FeatureFlags {
  // For paper-only app, just return defaults to avoid hydration issues
  // Environment variables can still override if needed
  const flags: Partial<FeatureFlags> = {};

  // Read each flag from environment variables (only if explicitly set)
  for (const [flagKey, envVarNames] of Object.entries(ENV_VAR_MAPPINGS)) {
    const envValue = envVarNames.map(name => process.env[name]).find(value => value !== undefined);
    // Only override default if env var is explicitly set
    if (envValue !== undefined) {
      flags[flagKey as keyof FeatureFlags] = parseBooleanEnvVar(envValue);
    }
  }

  // Merge with defaults - defaults are used when no env var is set
  return { ...DEFAULT_FLAGS, ...flags };
}

/**
 * Check if a specific feature is enabled
 * For paper-only app, paper features are always enabled to avoid hydration issues
 */
export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  // Paper-only mode: These features are always enabled
  const ALWAYS_ENABLED: (keyof FeatureFlags)[] = [
    'ENABLE_PAPER_WRITING_UI',
    'ENABLE_NEW_PAPER_TYPES',
    'ENABLE_CITATIONS',
    'ENABLE_CITATION_STYLES',
    'ENABLE_LITERATURE_SEARCH',
    'ENABLE_MULTI_SOURCE_SEARCH',
    'ENABLE_NEW_STAGE_NAVIGATION',
    'ENABLE_PAPER_TYPE_EDITOR',
    'DISABLE_PATENT_DRAFTING'
  ];

  if (ALWAYS_ENABLED.includes(flag)) {
    return true;
  }

  return getFeatureFlags()[flag];
}

/**
 * Get all enabled features as an array of flag names
 */
export function getEnabledFeatures(): (keyof FeatureFlags)[] {
  const flags = getFeatureFlags();
  return Object.keys(flags).filter(key => flags[key as keyof FeatureFlags]) as (keyof FeatureFlags)[];
}

/**
 * Get all disabled features as an array of flag names
 */
export function getDisabledFeatures(): (keyof FeatureFlags)[] {
  const flags = getFeatureFlags();
  return Object.keys(flags).filter(key => !flags[key as keyof FeatureFlags]) as (keyof FeatureFlags)[];
}

/**
 * Feature flag groups for easier management
 */
export const FEATURE_GROUPS = {
  CITATION_FEATURES: ['ENABLE_CITATIONS', 'ENABLE_CITATION_STYLES'] as const,
  SEARCH_FEATURES: ['ENABLE_LITERATURE_SEARCH', 'ENABLE_MULTI_SOURCE_SEARCH', 'ENABLE_SEARCH_STRATEGY'] as const,
  PAPER_TYPE_FEATURES: ['ENABLE_NEW_PAPER_TYPES', 'ENABLE_PAPER_TYPE_EDITOR'] as const,
  UI_FEATURES: ['ENABLE_PAPER_WRITING_UI', 'ENABLE_NEW_STAGE_NAVIGATION'] as const,
  ADVANCED_FEATURES: ['ENABLE_LATEX_EXPORT', 'ENABLE_COLLABORATIVE_EDITING'] as const,
  GENERATION_FEATURES: ['ENABLE_TWO_PASS_GENERATION'] as const,
  PAPER_WRITING_UPGRADE: [
    'ENABLE_ARGUMENT_PLAN',
    'ENABLE_CITATION_BUDGET_VALIDATOR',
    'ENABLE_RHETORICAL_BLUEPRINT',
    'ENABLE_RHETORICAL_COMPOSER_PASS2B'
  ] as const,
  MIGRATION_FEATURES: ['DISABLE_PATENT_DRAFTING', 'MIGRATION_MODE'] as const,
  PRO_FEATURES: ['ENABLE_SEARCH_STRATEGY'] as const, // Features that require Pro plan
} as const;

/**
 * Check if a feature group is fully enabled
 */
export function isFeatureGroupEnabled(group: keyof typeof FEATURE_GROUPS): boolean {
  const flags = getFeatureFlags();
  return FEATURE_GROUPS[group].every(flag => flags[flag]);
}

/**
 * Check if a feature group is partially enabled (at least one feature)
 */
export function isFeatureGroupPartiallyEnabled(group: keyof typeof FEATURE_GROUPS): boolean {
  const flags = getFeatureFlags();
  return FEATURE_GROUPS[group].some(flag => flags[flag]);
}

/**
 * Validation functions for feature flag combinations
 */
export const FEATURE_VALIDATIONS = {
  /**
   * Citations require citation styles to be meaningful
   */
  validateCitationSetup: (): { valid: boolean; message?: string } => {
    const flags = getFeatureFlags();
    if (flags.ENABLE_CITATIONS && !flags.ENABLE_CITATION_STYLES) {
      return {
        valid: false,
        message: 'ENABLE_CITATIONS requires ENABLE_CITATION_STYLES to be enabled'
      };
    }
    return { valid: true };
  },

  /**
   * Paper writing UI should be enabled with paper types
   */
  validatePaperWritingSetup: (): { valid: boolean; message?: string } => {
    const flags = getFeatureFlags();
    if (flags.ENABLE_PAPER_WRITING_UI && !flags.ENABLE_NEW_PAPER_TYPES) {
      return {
        valid: false,
        message: 'ENABLE_PAPER_WRITING_UI requires ENABLE_NEW_PAPER_TYPES to be enabled'
      };
    }
    return { valid: true };
  },

  /**
   * Migration mode should not have conflicting flags
   */
  validateMigrationMode: (): { valid: boolean; message?: string } => {
    const flags = getFeatureFlags();
    if (flags.MIGRATION_MODE && flags.DISABLE_PATENT_DRAFTING) {
      return {
        valid: false,
        message: 'MIGRATION_MODE and DISABLE_PATENT_DRAFTING cannot both be enabled'
      };
    }
    return { valid: true };
  },
};

/**
 * Validate all feature flag combinations
 */
export function validateFeatureFlags(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const validation of Object.values(FEATURE_VALIDATIONS)) {
    const result = validation();
    if (!result.valid && result.message) {
      errors.push(result.message);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Runtime feature flag checking with caching
 * Flags are cached for performance but can be invalidated when needed
 */
class FeatureFlagManager {
  private cache: FeatureFlags | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 30000; // 30 seconds

  getFlags(): FeatureFlags {
    const now = Date.now();
    if (this.cache && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return this.cache;
    }

    this.cache = getFeatureFlags();
    this.cacheTimestamp = now;
    return this.cache;
  }

  isEnabled(flag: keyof FeatureFlags): boolean {
    return this.getFlags()[flag];
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
  }
}

// Export singleton instance
export const featureFlags = new FeatureFlagManager();

/**
 * Type guard to check if we're in paper writing mode
 */
export function isPaperWritingMode(): boolean {
  return featureFlags.isEnabled('ENABLE_PAPER_WRITING_UI');
}

/**
 * Type guard to check if we're in patent drafting mode
 */
export function isPatentDraftingMode(): boolean {
  return !featureFlags.isEnabled('DISABLE_PATENT_DRAFTING');
}

/**
 * Type guard to check if we're in migration mode
 */
export function isMigrationMode(): boolean {
  return featureFlags.isEnabled('MIGRATION_MODE');
}
