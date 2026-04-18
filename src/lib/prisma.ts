import { PrismaClient } from '@/lib/prisma-generated'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prismaOptions = process.env.DATABASE_URL
  ? {
      datasourceUrl: process.env.DATABASE_URL,
    }
  : undefined

const prismaBase = globalForPrisma.prisma ?? new PrismaClient(prismaOptions)

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

