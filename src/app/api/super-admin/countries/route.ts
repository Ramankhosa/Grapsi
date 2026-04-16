import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateUser } from '@/lib/auth-middleware'
import { validateCountryProfile } from '@/lib/country-profile-validation'
import { invalidateCountryProfileCache } from '@/lib/country-profile-service'

// Schema for creating/updating country profiles
const createCountryProfileSchema = z.object({
  countryCode: z.string().min(2).max(3).toUpperCase(),
  name: z.string().min(1).max(100),
  profileData: z.record(z.any()), // JSON object validated separately
  status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).optional().default('DRAFT')
})

const updateCountryProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  profileData: z.record(z.any()).optional(), // JSON object validated separately
  status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).optional()
})

// GET /api/super-admin/countries - List all country profiles
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      )
    }

    // Check if user has super admin privileges
    if (!authResult.user.roles?.includes('SUPER_ADMIN') &&
        !authResult.user.roles?.includes('SUPER_ADMIN_VIEWER')) {
      return NextResponse.json(
        { error: 'Super admin privileges required' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const where: any = {}
    if (status && ['ACTIVE', 'INACTIVE', 'DRAFT'].includes(status)) {
      where.status = status
    }

    const countryProfiles = await prisma.countryProfile.findMany({
      where,
      include: {
        creator: {
          select: { id: true, name: true, email: true }
        },
        updater: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    })

    return NextResponse.json({
      success: true,
      countryProfiles
    })

  } catch (error) {
    console.error('Error fetching country profiles:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/super-admin/countries - Create new country profile
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      )
    }

    // Check if user has super admin privileges
    if (!authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json(
        { error: 'Super admin privileges required' },
        { status: 403 }
      )
    }

    const body = await request.json()

    // Validate basic schema first
    const basicValidation = createCountryProfileSchema.safeParse(body)
    if (!basicValidation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: basicValidation.error.errors },
        { status: 400 }
      )
    }

    const { countryCode, name, profileData, status } = basicValidation.data

    // Validate country profile JSON structure
    const profileValidation = validateCountryProfile(profileData)
    if (!profileValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid country profile structure', details: profileValidation.errors },
        { status: 400 }
      )
    }

    // Check if country code already exists
    const existingProfile = await prisma.countryProfile.findUnique({
      where: { countryCode }
    })

    if (existingProfile) {
      return NextResponse.json(
        { error: 'Country profile with this code already exists' },
        { status: 409 }
      )
    }

    // Create the country profile
    const countryProfile = await prisma.countryProfile.create({
      data: {
        countryCode,
        name,
        profileData,
        status: status as any,
        createdBy: authResult.user.id,
        updatedBy: authResult.user.id
      },
      include: {
        creator: {
          select: { id: true, name: true, email: true }
        }
      }
    })

    invalidateCountryProfileCache()

    return NextResponse.json({
      success: true,
      message: 'Country profile created successfully',
      countryProfile
    }, { status: 201 })

  } catch (error) {
    console.error('Error creating country profile:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PUT /api/super-admin/countries/[countryCode] - Update existing country profile
export async function PUT(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      )
    }

    // Check if user has super admin privileges
    if (!authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json(
        { error: 'Super admin privileges required' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { countryCode } = body

    if (!countryCode) {
      return NextResponse.json(
        { error: 'Country code is required' },
        { status: 400 }
      )
    }

    // Validate basic schema
    const basicValidation = updateCountryProfileSchema.safeParse(body)
    if (!basicValidation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: basicValidation.error.errors },
        { status: 400 }
      )
    }

    const { name, profileData, status } = basicValidation.data

    // Check if profile data is being updated and validate it
    if (profileData) {
      const profileValidation = validateCountryProfile(profileData)
      if (!profileValidation.valid) {
        return NextResponse.json(
          { error: 'Invalid country profile structure', details: profileValidation.errors },
          { status: 400 }
        )
      }
    }

    // Check if country profile exists
    const existingProfile = await prisma.countryProfile.findUnique({
      where: { countryCode }
    })

    if (!existingProfile) {
      return NextResponse.json(
        { error: 'Country profile not found' },
        { status: 404 }
      )
    }

    // Update the country profile
    const updateData: any = {
      updatedBy: authResult.user.id,
      updatedAt: new Date()
    }

    if (name !== undefined) updateData.name = name
    if (profileData !== undefined) updateData.profileData = profileData
    if (status !== undefined) updateData.status = status

    const updatedProfile = await prisma.countryProfile.update({
      where: { countryCode },
      data: updateData,
      include: {
        creator: {
          select: { id: true, name: true, email: true }
        },
        updater: {
          select: { id: true, name: true, email: true }
        }
      }
    })

    invalidateCountryProfileCache()

    return NextResponse.json({
      success: true,
      message: 'Country profile updated successfully',
      countryProfile: updatedProfile
    })

  } catch (error) {
    console.error('Error updating country profile:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/super-admin/countries/[countryCode] - Delete country profile
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      )
    }

    // Check if user has super admin privileges
    if (!authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json(
        { error: 'Super admin privileges required' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const countryCode = searchParams.get('countryCode')

    if (!countryCode) {
      return NextResponse.json(
        { error: 'Country code is required' },
        { status: 400 }
      )
    }

    // Check if country profile exists
    const existingProfile = await prisma.countryProfile.findUnique({
      where: { countryCode }
    })

    if (!existingProfile) {
      return NextResponse.json(
        { error: 'Country profile not found' },
        { status: 404 }
      )
    }

    // Delete the country profile
    await prisma.countryProfile.delete({
      where: { countryCode }
    })

    invalidateCountryProfileCache()

    return NextResponse.json({
      success: true,
      message: 'Country profile deleted successfully'
    })

  } catch (error) {
    console.error('Error deleting country profile:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
