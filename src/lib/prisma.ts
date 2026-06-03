import fs from 'node:fs'
import path from 'node:path'

import dotenv from 'dotenv'

import { PrismaClient } from '@/lib/prisma-generated'

function loadLocalDatabaseEnv() {
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(process.cwd(), filename)

    if (fs.existsSync(envPath)) {
      const parsed = dotenv.parse(fs.readFileSync(envPath))

      if (parsed.DATABASE_URL) {
        process.env.DATABASE_URL = parsed.DATABASE_URL
      }
    }
  }
}

loadLocalDatabaseEnv()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prismaBase = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaBase

// Extended type for SketchRecord model
// This ensures TypeScript recognizes the model even if types are cached
// The actual model exists in the database and generated Prisma client
interface SketchRecordDelegate {
  create: (args: { data: any }) => Promise<any>
  findUnique: (args: { where: any; include?: any }) => Promise<any>
  findFirst: (args: { where: any; include?: any }) => Promise<any>
  findMany: (args: { where?: any; orderBy?: any; take?: number; skip?: number; include?: any }) => Promise<any[]>
  update: (args: { where: any; data: any }) => Promise<any>
  delete: (args: { where: any }) => Promise<any>
  deleteMany: (args: { where?: any }) => Promise<{ count: number }>
  count: (args: { where?: any }) => Promise<number>
  upsert: (args: { where: any; update: any; create: any }) => Promise<any>
}

// Export prisma with extended types
export const prisma = prismaBase as PrismaClient & {
  sketchRecord: SketchRecordDelegate
}

export default prisma

