import { llmGateway } from './metering/gateway';
import { prisma } from './prisma';
import { verifyJWT } from './auth';
import { TaskCode } from '@prisma/client';
import crypto from 'crypto';

export interface LLMResult {
  success: boolean;
  response?: any;
  error?: any;
}

export interface User {
  id: string;
  email: string;
  name?: string | null;
  tenantId?: string | null;
}

/**
 * Base class for patent-related services with common functionality
 */
export abstract class BasePatentService {

  /**
   * Verify JWT token and extract user information
   */
  protected async validateUser(jwtToken: string): Promise<User | never> {
    try {
      // Check if token exists and is not empty
      if (!jwtToken || jwtToken.trim() === '') {
        console.log('JWT validation failed: Token is empty or null');
        // Surface a clear, user-friendly message
        throw new Error('Your session has expired. Please log in again.');
      }

      const payload = verifyJWT(jwtToken);

      if (!payload) {
        // In development mode, we'll use fallback user, so don't throw error immediately
        if (process.env.NODE_ENV === 'development') {
          console.log('JWT validation failed in development mode - will use fallback user');
        } else {
          console.log('JWT validation failed: verifyJWT returned null - token may be invalid, expired, or secret mismatch');
          // Clear message for user
          throw new Error('Your session has expired or is invalid. Please log in again.');
        }
      } else {
        console.log('JWT payload for validation:', payload);
      }

      // Try to validate the JWT payload if available
      if (payload) {
        if (!payload.email) {
          console.log('Invalid JWT payload - missing email field');
          throw new Error('Your session has expired or is invalid. Please log in again.');
        }

        const user = await prisma.user.findUnique({
          where: { email: payload.email },
          select: { id: true, email: true, name: true, tenantId: true }
        });

        console.log('User lookup result:', user ? `Found user ${user.email}` : `No user found for email ${payload.email}`);

        if (user) {
          return user;
        }
      }

      // If we reach here, either payload is null (development mode) or user lookup failed
      // In development mode, we'll proceed to use fallback user
      // In production, throw error
      if (process.env.NODE_ENV !== 'development') {
        throw new Error('Your session has expired or is invalid. Please log in again.');
      }
    } catch (error) {
      console.error('JWT validation error:', error);

      // In development, provide a fallback user if JWT validation fails
      // This allows the API to work even with authentication issues
      if (process.env.NODE_ENV === 'development') {
        console.log('Development mode: Providing fallback user for testing');

        // Try to get the first user from the database as a fallback
        try {
          const fallbackUser = await prisma.user.findFirst({
            select: { id: true, email: true, name: true, tenantId: true }
          });

          if (fallbackUser) {
            console.log('Using fallback user:', fallbackUser.email);
            return fallbackUser;
          }
        } catch (dbError) {
          console.error('Failed to get fallback user:', dbError);
        }
        // If fallback user lookup failed in development, throw error
        throw new Error('Your session has expired. Please log in again.');
      }

      // If we reach here, authentication failed and no fallback was available
      throw new Error('Your session has expired. Please log in again.');
    }

    // Safety: if we somehow reach here, respond with a clear message
    throw new Error('Your session has expired. Please log in again.');
  }

  /**
   * Execute LLM operation through the gateway
   * @param requestHeaders - HTTP headers for authentication
   * @param params - LLM request parameters including optional stageCode for admin-configured model/limits
   */
  protected async callLLMGateway(
    requestHeaders: Record<string, string>,
    params: {
      taskCode: TaskCode;
      stageCode?: string; // Optional stage code for admin-configured model/token limits
      prompt: string;
      parameters?: any;
      maxOutputTokens?: number;
      idempotencyKey?: string;
      patentId?: string; // Patent ID for cost tracking - CRITICAL for patent-wise cost reports
      metadata?: Record<string, any>; // Additional metadata for tracking
    }
  ): Promise<LLMResult> {
    try {
      const result = await llmGateway.executeLLMOperation(
        { headers: requestHeaders },
        {
          taskCode: params.taskCode,
          stageCode: params.stageCode, // Pass stage code for admin-configured model resolution
          prompt: params.prompt,
          parameters: {
            ...params.parameters,
            ...(params.maxOutputTokens && { maxOutputTokens: params.maxOutputTokens })
          },
          idempotencyKey: params.idempotencyKey || crypto.randomUUID(),
          // Include patentId and stageCode in metadata for cost tracking
          metadata: {
            patentId: params.patentId,
            stageCode: params.stageCode,
            ...params.metadata
          }
        }
      );

      if (!result.success || !result.response) {
        return {
          success: false,
          error: result.error?.message || 'LLM call failed'
        };
      }

      return {
        success: true,
        response: result.response
      };
    } catch (error) {
      console.error('LLM gateway error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      };
    }
  }

  /**
   * Validate patent access permissions
   */
  protected async validatePatentAccess(patentId: string, userId: string): Promise<void> {
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: userId },
          {
            project: {
              OR: [
                { userId: userId },
                { collaborators: { some: { userId: userId } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      throw new Error('Patent not found or access denied');
    }
  }

  /**
   * Parse LLM response, robustly extracting JSON
   */
  protected parseLLMResponse(response: string): any {
    try {
      // First, try to find JSON within markdown code blocks (json/jsonc, case-insensitive)
      const codeBlockRegex = /```(?:json|jsonc)?\s*\n?([\s\S]*?)\n?\s*```/i;
      const match = response.match(codeBlockRegex);

      if (match && match[1]) {
        try {
          return JSON.parse(match[1]);
        } catch (e) {
          console.error('Failed to parse JSON from code block:', e);
          // Fall through to try parsing with sanitization
        }
      }

      // If no code block, or if parsing failed, try to find a JSON object anywhere in the string
      // Use a balanced brace extraction to avoid grabbing extra trailing text
      const rawBalanced = this.extractBalancedJSONObject(response);
      if (rawBalanced) {
        try {
          return JSON.parse(rawBalanced);
        } catch (e) {
          console.warn('Direct JSON parse failed, attempting sanitization...');
          const sanitized = this.sanitizeJSONResponse(rawBalanced);
          if (sanitized) {
            return sanitized;
          }
        }
      }

      // Try to find partial JSON (useful for truncated responses)
      const partialResult = this.parsePartialJSON(response);
      if (partialResult) {
        console.warn('Parsed partial JSON due to truncation');
        return partialResult;
      }

      throw new Error('No valid JSON found in the response');

    } catch (error) {
      console.error('JSON parsing error:', error);
      throw new Error('Failed to parse LLM response as JSON');
    }
  }

  /**
   * Extract the first balanced JSON object from a string using brace depth scanning
   */
  private extractBalancedJSONObject(text: string): string | null {
    const start = text.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return text.substring(start, i + 1);
        }
      }
    }
    // Not fully balanced; try to fix truncated JSON
    const partial = text.substring(start);
    const fixed = this.fixTruncatedJSON(partial);
    return fixed ? JSON.stringify(fixed) : null;
  }

  /**
   * Advanced JSON sanitization for LLM responses
   */
  private sanitizeJSONResponse(jsonText: string): any | null {
    try {
      let sanitized = jsonText.trim();

      // Remove trailing commas before closing braces/brackets
      sanitized = sanitized.replace(/,(\s*[}\]])/g, '$1');

      // Convert single-quoted strings to double-quoted (simple heuristic)
      sanitized = sanitized.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');

      // Quote unquoted object keys
      sanitized = sanitized.replace(/([\{,]\s*)([A-Za-z_][A-Za-z0-9_\-]*)(\s*):/g, '$1"$2"$3:');

      // Remove control characters
      sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

      // Fix common LLM mistakes
      // 1. Handle boolean values (true/false without quotes)
      sanitized = sanitized.replace(/:\s*(true|false)(\s*[,}])/g, ':"$1"$2');
      // 2. Handle numbers without quotes when they should be strings
      sanitized = sanitized.replace(/:\s*(\d+)(\s*[,}])/g, (match, num, end) => {
        // Only quote if it's likely a string (like patent numbers)
        if (num.length > 5) {
          return `:"${num}"${end}`;
        }
        return match;
      });

      // Try to parse the sanitized version
      try {
        return JSON.parse(sanitized);
      } catch (e) {
        // Try more aggressive fixes for truncated responses
        return this.fixTruncatedJSON(sanitized);
      }
    } catch (e) {
      return null;
    }
  }

  /**
   * Attempt to parse partial/truncated JSON responses
   */
  private parsePartialJSON(response: string): any | null {
    try {
      // Look for common patterns in feature mapping responses
      const featureMapPattern = /"feature_map"\s*:\s*\[([\s\S]*?)\]/;
      const match = response.match(featureMapPattern);

      if (match) {
        try {
          // Try to parse the feature_map array
          const featureMapArray = JSON.parse(`[${match[1]}`);
          return {
            feature_map: featureMapArray,
            quality_flags: { low_evidence: true, ambiguous_abstracts: false, language_mismatch: false },
            stats: { patents_analyzed: featureMapArray.length, avg_abstract_length_words: 0 }
          };
        } catch (e) {
          // Try to extract individual patent objects
          const patentObjects = this.extractPatentObjects(match[1]);
          if (patentObjects.length > 0) {
            return {
              feature_map: patentObjects,
              quality_flags: { low_evidence: true, ambiguous_abstracts: false, language_mismatch: false },
              stats: { patents_analyzed: patentObjects.length, avg_abstract_length_words: 0 }
            };
          }
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Extract individual patent objects from partially parsed JSON
   */
  private extractPatentObjects(featureMapContent: string): any[] {
    const patents: any[] = [];
    const patentRegex = /\{\s*"pn"\s*:\s*"([^"]+)"[\s\S]*?\}/g;

    let match;
    while ((match = patentRegex.exec(featureMapContent)) !== null) {
      try {
        const patentObj = JSON.parse(match[0]);
        patents.push(patentObj);
      } catch (e) {
        // Skip malformed patent objects
      }
    }

    return patents;
  }

  /**
   * Fix truncated JSON responses by attempting to complete them
   */
  private fixTruncatedJSON(jsonText: string): any | null {
    try {
      // Count braces to see if JSON is incomplete
      const openBraces = (jsonText.match(/\{/g) || []).length;
      const closeBraces = (jsonText.match(/\}/g) || []).length;
      const openBrackets = (jsonText.match(/\[/g) || []).length;
      const closeBrackets = (jsonText.match(/\]/g) || []).length;

      if (openBraces > closeBraces) {
        // Try adding closing braces
        const bracesToAdd = openBraces - closeBraces;
        jsonText += '}'.repeat(bracesToAdd);
      }

      if (openBrackets > closeBrackets) {
        // Try adding closing brackets
        const bracketsToAdd = openBrackets - closeBrackets;
        jsonText += ']'.repeat(bracketsToAdd);
      }

      // Remove trailing commas
      jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');

      return JSON.parse(jsonText);
    } catch (e) {
      return null;
    }
  }
}
