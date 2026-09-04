import jwt from 'jsonwebtoken'
import { z } from 'zod'

const SOCIAL_SIGNUP_TOKEN_SECRET = process.env.SOCIAL_SIGNUP_TOKEN_SECRET
  || process.env.JWT_SECRET
  || 'your-super-secure-jwt-secret-change-in-production-min-32-chars'

const socialSignupPendingDataSchema = z.object({
  provider: z.enum(['google', 'facebook', 'linkedin', 'twitter']),
  providerId: z.string().min(1),
  email: z.string().email(),
  emailVerified: z.boolean().optional().default(false),
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  profile: z.any().optional(),
  iat: z.number(),
  exp: z.number(),
})

export type SocialSignupPendingData = z.infer<typeof socialSignupPendingDataSchema>

/** Input shape: `emailVerified` may be omitted and defaults to false. */
export type SocialSignupPendingInput = Omit<
  z.input<typeof socialSignupPendingDataSchema>,
  'iat' | 'exp'
>

export function createSocialSignupToken(
  payload: SocialSignupPendingInput
): string {
  return jwt.sign(payload, SOCIAL_SIGNUP_TOKEN_SECRET, {
    expiresIn: '15m',
    audience: 'social-signup',
    issuer: 'grapsi',
  })
}

export function verifySocialSignupToken(token: string): SocialSignupPendingData {
  const payload = jwt.verify(token, SOCIAL_SIGNUP_TOKEN_SECRET, {
    audience: 'social-signup',
    issuer: 'grapsi',
  })

  return socialSignupPendingDataSchema.parse(payload)
}
