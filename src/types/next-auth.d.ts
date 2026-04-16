import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      tenantId?: string | null
    } & DefaultSession['user']
  }

  interface User {
    id: string
    tenantId?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    tenantId?: string | null
  }
}
