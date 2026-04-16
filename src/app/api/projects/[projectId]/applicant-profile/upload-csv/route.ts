import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'

export const dynamic = 'force-dynamic'

function buildAccessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }

  console.error('Applicant CSV upload route error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized', code: error?.code ?? 'UNAUTHORIZED' },
        { status: error?.status ?? 401 }
      )
    }

    await assertProjectCapability(params.projectId, user.id, user.tenantId, 'editContent')

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be a CSV' }, { status: 400 })
    }

    const text = await file.text()
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)

    if (lines.length !== 2) {
      return NextResponse.json(
        { error: 'CSV must contain exactly one header row and one data row' },
        { status: 400 }
      )
    }

    const headers = lines[0].split(',').map((header) => header.trim())
    const values = lines[1].split(',').map((value) => value.trim())

    if (headers.length !== values.length) {
      return NextResponse.json(
        { error: 'Header and data row must have the same number of columns' },
        { status: 400 }
      )
    }

    const expectedHeaders = [
      'applicant_legal_name', 'applicant_category', 'applicant_address_line1',
      'applicant_address_line2', 'applicant_city', 'applicant_state',
      'applicant_country_code', 'applicant_postal_code', 'correspondence_name',
      'correspondence_email', 'correspondence_phone', 'correspondence_address_line1',
      'correspondence_address_line2', 'correspondence_city', 'correspondence_state',
      'correspondence_country_code', 'correspondence_postal_code', 'use_agent',
      'agent_name', 'agent_registration_no', 'agent_email', 'agent_phone',
      'agent_address_line1', 'agent_address_line2', 'agent_city', 'agent_state',
      'agent_country_code', 'agent_postal_code', 'default_jurisdiction',
      'default_route', 'default_language', 'default_entity_status_in',
    ]

    const missingHeaders = expectedHeaders.filter((header) => !headers.includes(header))
    if (missingHeaders.length > 0) {
      return NextResponse.json(
        { error: `Missing required headers: ${missingHeaders.join(', ')}` },
        { status: 400 }
      )
    }

    const headerMap: Record<string, string> = {}
    headers.forEach((header, index) => {
      headerMap[header] = values[index] || ''
    })

    const normalizedData = {
      applicantLegalName: headerMap.applicant_legal_name,
      applicantCategory: headerMap.applicant_category,
      applicantAddressLine1: headerMap.applicant_address_line1,
      applicantAddressLine2: headerMap.applicant_address_line2,
      applicantCity: headerMap.applicant_city,
      applicantState: headerMap.applicant_state,
      applicantCountryCode: headerMap.applicant_country_code.toUpperCase(),
      applicantPostalCode: headerMap.applicant_postal_code,
      correspondenceName: headerMap.correspondence_name,
      correspondenceEmail: headerMap.correspondence_email,
      correspondencePhone: headerMap.correspondence_phone,
      correspondenceAddressLine1: headerMap.correspondence_address_line1,
      correspondenceAddressLine2: headerMap.correspondence_address_line2,
      correspondenceCity: headerMap.correspondence_city,
      correspondenceState: headerMap.correspondence_state,
      correspondenceCountryCode: headerMap.correspondence_country_code.toUpperCase(),
      correspondencePostalCode: headerMap.correspondence_postal_code,
      useAgent: headerMap.use_agent.toLowerCase() === 'true',
      agentName: headerMap.agent_name,
      agentRegistrationNo: headerMap.agent_registration_no,
      agentEmail: headerMap.agent_email,
      agentPhone: headerMap.agent_phone,
      agentAddressLine1: headerMap.agent_address_line1,
      agentAddressLine2: headerMap.agent_address_line2,
      agentCity: headerMap.agent_city,
      agentState: headerMap.agent_state,
      agentCountryCode: headerMap.agent_country_code.toUpperCase(),
      agentPostalCode: headerMap.agent_postal_code,
      defaultJurisdiction: headerMap.default_jurisdiction,
      defaultRoute: headerMap.default_route,
      defaultLanguage: headerMap.default_language || 'EN',
      defaultEntityStatusIn: headerMap.default_entity_status_in,
    }

    const errors: string[] = []

    if (!normalizedData.applicantLegalName || normalizedData.applicantLegalName.length < 3) {
      errors.push('applicant_legal_name must be at least 3 characters')
    }
    if (!['natural_person', 'small_entity', 'startup', 'others'].includes(normalizedData.applicantCategory)) {
      errors.push('applicant_category must be one of: natural_person, small_entity, startup, others')
    }
    if (!normalizedData.applicantAddressLine1) {
      errors.push('applicant_address_line1 is required')
    }
    if (normalizedData.applicantCountryCode.length !== 2) {
      errors.push('applicant_country_code must be 2 characters (ISO-2)')
    }
    if (!normalizedData.correspondenceName) {
      errors.push('correspondence_name is required')
    }
    if (!normalizedData.correspondenceEmail || !normalizedData.correspondenceEmail.includes('@')) {
      errors.push('correspondence_email must be a valid email')
    }
    if (!normalizedData.correspondencePhone || !normalizedData.correspondencePhone.startsWith('+')) {
      errors.push('correspondence_phone must be in E.164 format (+country code)')
    }
    if (!normalizedData.correspondenceAddressLine1) {
      errors.push('correspondence_address_line1 is required')
    }
    if (normalizedData.correspondenceCountryCode.length !== 2) {
      errors.push('correspondence_country_code must be 2 characters (ISO-2)')
    }
    if (!['IN', 'PCT', 'US', 'EP'].includes(normalizedData.defaultJurisdiction)) {
      errors.push('default_jurisdiction must be one of: IN, PCT, US, EP')
    }
    if (!['national', 'pct_international', 'pct_national'].includes(normalizedData.defaultRoute)) {
      errors.push('default_route must be one of: national, pct_international, pct_national')
    }
    if (!['startup', 'small_entity', 'university', 'regular'].includes(normalizedData.defaultEntityStatusIn)) {
      errors.push('default_entity_status_in must be one of: startup, small_entity, university, regular')
    }

    if (normalizedData.useAgent) {
      if (!normalizedData.agentName) errors.push('agent_name is required when use_agent is true')
      if (!normalizedData.agentRegistrationNo) errors.push('agent_registration_no is required when use_agent is true')
      if (!normalizedData.agentEmail) errors.push('agent_email is required when use_agent is true')
      if (!normalizedData.agentPhone) errors.push('agent_phone is required when use_agent is true')
      if (!normalizedData.agentAddressLine1) errors.push('agent_address_line1 is required when use_agent is true')
      if (!normalizedData.agentCity) errors.push('agent_city is required when use_agent is true')
      if (!normalizedData.agentState) errors.push('agent_state is required when use_agent is true')
      if (!normalizedData.agentCountryCode) errors.push('agent_country_code is required when use_agent is true')
      if (!normalizedData.agentPostalCode) errors.push('agent_postal_code is required when use_agent is true')
    }

    if (errors.length > 0) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: errors,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      normalizedData,
      message: 'CSV parsed and validated successfully',
    })
  } catch (error) {
    return buildAccessErrorResponse(error)
  }
}
