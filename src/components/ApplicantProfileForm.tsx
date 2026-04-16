'use client'

import { useState, useRef } from 'react'
import { z } from 'zod'

const applicantProfileSchema = z.object({
  applicantLegalName: z.string().min(3, 'Legal name must be at least 3 characters').max(200, 'Legal name too long'),
  applicantCategory: z.enum(['natural_person', 'small_entity', 'startup', 'others']),
  applicantAddressLine1: z.string().min(1, 'Address line 1 is required'),
  applicantAddressLine2: z.string().optional(),
  applicantCity: z.string().min(1, 'City is required'),
  applicantState: z.string().min(1, 'State is required'),
  applicantCountryCode: z.string().length(2, 'Country code must be 2 characters (ISO-2)'),
  applicantPostalCode: z.string().min(1, 'Postal code is required'),
  correspondenceName: z.string().min(1, 'Correspondence name is required'),
  correspondenceEmail: z.string().email('Invalid email format'),
  correspondencePhone: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (+country code)'),
  correspondenceAddressLine1: z.string().min(1, 'Address line 1 is required'),
  correspondenceAddressLine2: z.string().optional(),
  correspondenceCity: z.string().min(1, 'City is required'),
  correspondenceState: z.string().min(1, 'State is required'),
  correspondenceCountryCode: z.string().length(2, 'Country code must be 2 characters (ISO-2)'),
  correspondencePostalCode: z.string().min(1, 'Postal code is required'),
  useAgent: z.boolean(),
  agentName: z.string().optional(),
  agentRegistrationNo: z.string().optional(),
  agentEmail: z.string().optional(),
  agentPhone: z.string().optional(),
  agentAddressLine1: z.string().optional(),
  agentAddressLine2: z.string().optional(),
  agentCity: z.string().optional(),
  agentState: z.string().optional(),
  agentCountryCode: z.string().optional(),
  agentPostalCode: z.string().optional(),
  defaultJurisdiction: z.enum(['IN', 'PCT', 'US', 'EP']),
  defaultRoute: z.enum(['national', 'pct_international', 'pct_national']),
  defaultLanguage: z.string().default('EN'),
  defaultEntityStatusIn: z.enum(['startup', 'small_entity', 'university', 'regular']),
}).refine((data) => {
  if (data.useAgent) {
    return data.agentName && data.agentRegistrationNo && data.agentEmail && data.agentPhone &&
           data.agentAddressLine1 && data.agentCity && data.agentState && data.agentCountryCode && data.agentPostalCode
  }
  return true
}, {
  message: "Agent details are required when using an agent",
  path: ["agentName"]
})

type ApplicantProfileData = z.infer<typeof applicantProfileSchema>

interface ApplicantProfileFormProps {
  projectId: string
  initialData?: Partial<ApplicantProfileData>
  onSuccess: () => void
}

export function ApplicantProfileForm({ projectId, initialData, onSuccess }: ApplicantProfileFormProps) {
  const [formData, setFormData] = useState<ApplicantProfileData>({
    applicantLegalName: initialData?.applicantLegalName || '',
    applicantCategory: (initialData?.applicantCategory as any) || 'others',
    applicantAddressLine1: initialData?.applicantAddressLine1 || '',
    applicantAddressLine2: initialData?.applicantAddressLine2 || '',
    applicantCity: initialData?.applicantCity || '',
    applicantState: initialData?.applicantState || '',
    applicantCountryCode: initialData?.applicantCountryCode || '',
    applicantPostalCode: initialData?.applicantPostalCode || '',
    correspondenceName: initialData?.correspondenceName || '',
    correspondenceEmail: initialData?.correspondenceEmail || '',
    correspondencePhone: initialData?.correspondencePhone || '',
    correspondenceAddressLine1: initialData?.correspondenceAddressLine1 || '',
    correspondenceAddressLine2: initialData?.correspondenceAddressLine2 || '',
    correspondenceCity: initialData?.correspondenceCity || '',
    correspondenceState: initialData?.correspondenceState || '',
    correspondenceCountryCode: initialData?.correspondenceCountryCode || '',
    correspondencePostalCode: initialData?.correspondencePostalCode || '',
    useAgent: initialData?.useAgent || false,
    agentName: initialData?.agentName || '',
    agentRegistrationNo: initialData?.agentRegistrationNo || '',
    agentEmail: initialData?.agentEmail || '',
    agentPhone: initialData?.agentPhone || '',
    agentAddressLine1: initialData?.agentAddressLine1 || '',
    agentAddressLine2: initialData?.agentAddressLine2 || '',
    agentCity: initialData?.agentCity || '',
    agentState: initialData?.agentState || '',
    agentCountryCode: initialData?.agentCountryCode || '',
    agentPostalCode: initialData?.agentPostalCode || '',
    defaultJurisdiction: (initialData?.defaultJurisdiction as any) || 'IN',
    defaultRoute: (initialData?.defaultRoute as any) || 'national',
    defaultLanguage: initialData?.defaultLanguage || 'EN',
    defaultEntityStatusIn: (initialData?.defaultEntityStatusIn as any) || 'regular',
  })

  const [sameAsApplicant, setSameAsApplicant] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCsvUpload, setShowCsvUpload] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvPreview, setCsvPreview] = useState<any>(null)
  const [csvErrors, setCsvErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleInputChange = (field: keyof ApplicantProfileData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }

    // Auto-fill correspondence fields when "same as applicant" is checked
    if (field === 'applicantAddressLine1' && sameAsApplicant) {
      setFormData(prev => ({
        ...prev,
        correspondenceAddressLine1: value as string,
        correspondenceAddressLine2: prev.applicantAddressLine2 || '',
        correspondenceCity: prev.applicantCity,
        correspondenceState: prev.applicantState,
        correspondenceCountryCode: prev.applicantCountryCode,
        correspondencePostalCode: prev.applicantPostalCode,
        correspondenceName: prev.applicantLegalName,
        correspondenceEmail: prev.correspondenceEmail,
        correspondencePhone: prev.correspondencePhone,
      }))
    }
  }

  const handleSameAsApplicantToggle = (checked: boolean) => {
    setSameAsApplicant(checked)
    if (checked) {
      setFormData(prev => ({
        ...prev,
        correspondenceAddressLine1: prev.applicantAddressLine1,
        correspondenceAddressLine2: prev.applicantAddressLine2,
        correspondenceCity: prev.applicantCity,
        correspondenceState: prev.applicantState,
        correspondenceCountryCode: prev.applicantCountryCode,
        correspondencePostalCode: prev.applicantPostalCode,
        correspondenceName: prev.applicantLegalName,
      }))
    }
  }

  const handleCsvUpload = async (file: File) => {
    setCsvFile(file)
    setCsvErrors([])

    try {
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())

      if (lines.length !== 2) {
        setCsvErrors(['CSV must contain exactly one header row and one data row'])
        return
      }

      const headers = lines[0].split(',').map(h => h.trim())
      const values = lines[1].split(',').map(v => v.trim())

      if (headers.length !== values.length) {
        setCsvErrors(['Header and data row must have the same number of columns'])
        return
      }

      // Expected headers
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
        'default_route', 'default_language', 'default_entity_status_in'
      ]

      const headerMap: Record<string, string> = {}
      headers.forEach((header, index) => {
        headerMap[header] = values[index] || ''
      })

      // Validate CSV structure
      const missingHeaders = expectedHeaders.filter(h => !headers.includes(h))
      if (missingHeaders.length > 0) {
        setCsvErrors([`Missing required headers: ${missingHeaders.join(', ')}`])
        return
      }

      // Parse and validate data
      const parsedData = {
        applicantLegalName: headerMap.applicant_legal_name,
        applicantCategory: headerMap.applicant_category as any,
        applicantAddressLine1: headerMap.applicant_address_line1,
        applicantAddressLine2: headerMap.applicant_address_line2,
        applicantCity: headerMap.applicant_city,
        applicantState: headerMap.applicant_state,
        applicantCountryCode: headerMap.applicant_country_code,
        applicantPostalCode: headerMap.applicant_postal_code,
        correspondenceName: headerMap.correspondence_name,
        correspondenceEmail: headerMap.correspondence_email,
        correspondencePhone: headerMap.correspondence_phone,
        correspondenceAddressLine1: headerMap.correspondence_address_line1,
        correspondenceAddressLine2: headerMap.correspondence_address_line2,
        correspondenceCity: headerMap.correspondence_city,
        correspondenceState: headerMap.correspondence_state,
        correspondenceCountryCode: headerMap.correspondence_country_code,
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
        agentCountryCode: headerMap.agent_country_code,
        agentPostalCode: headerMap.agent_postal_code,
        defaultJurisdiction: headerMap.default_jurisdiction as any,
        defaultRoute: headerMap.default_route as any,
        defaultLanguage: headerMap.default_language,
        defaultEntityStatusIn: headerMap.default_entity_status_in as any,
      }

      setCsvPreview(parsedData)
    } catch (error) {
      setCsvErrors(['Failed to parse CSV file'])
    }
  }

  const applyCsvData = () => {
    if (csvPreview) {
      setFormData(csvPreview)
      setCsvPreview(null)
      setCsvFile(null)
      setShowCsvUpload(false)
      setCsvErrors([])
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const validatedData = applicantProfileSchema.parse(formData)
      setIsSubmitting(true)

      const response = await fetch(`/api/projects/${projectId}/applicant-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(validatedData),
      })

      if (response.ok) {
        onSuccess()
      } else {
        const error = await response.json()
        setErrors({ submit: error.error || 'Failed to save profile' })
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {}
        error.errors.forEach(err => {
          if (err.path.length > 0) {
            fieldErrors[err.path[0] as string] = err.message
          }
        })
        setErrors(fieldErrors)
      } else {
        setErrors({ submit: 'An unexpected error occurred' })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* CSV Upload Section */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gpt-gray-900">Quick Setup</h2>
          <button
            type="button"
            onClick={() => setShowCsvUpload(!showCsvUpload)}
            className="inline-flex items-center px-4 py-2 border border-gpt-gray-300 text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
          >
            📄 {showCsvUpload ? 'Hide CSV Upload' : 'Upload CSV to Prefill'}
          </button>
        </div>

        {showCsvUpload && (
          <div className="space-y-4">
            <div>
              <label htmlFor="csvFile" className="block text-sm font-medium text-gpt-gray-700 mb-2">
                Select CSV File
              </label>
              <input
                ref={fileInputRef}
                id="csvFile"
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    handleCsvUpload(file)
                  }
                }}
                className="block w-full text-sm text-gpt-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gpt-blue-50 file:text-gpt-blue-700 hover:file:bg-gpt-blue-100"
              />
              <p className="mt-1 text-sm text-gpt-gray-600">
                Upload a single-row CSV with the required headers to prefill the form
              </p>
            </div>

            {csvErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                <ul className="list-disc list-inside">
                  {csvErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {csvPreview && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="text-sm font-medium text-green-800 mb-2">CSV Preview - Ready to Apply</h3>
                <div className="text-sm text-green-700 space-y-1">
                  <p><strong>Legal Name:</strong> {csvPreview.applicantLegalName}</p>
                  <p><strong>Category:</strong> {csvPreview.applicantCategory}</p>
                  <p><strong>Address:</strong> {csvPreview.applicantAddressLine1}, {csvPreview.applicantCity}</p>
                </div>
                <div className="mt-4 flex space-x-3">
                  <button
                    type="button"
                    onClick={applyCsvData}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-200"
                  >
                    Apply CSV Data
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCsvPreview(null)
                      setCsvFile(null)
                      setCsvErrors([])
                      if (fileInputRef.current) {
                        fileInputRef.current.value = ''
                      }
                    }}
                    className="inline-flex items-center px-4 py-2 border border-gpt-gray-300 text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Applicant Information Card */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gpt-gray-900 mb-6">Applicant (Institution)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label htmlFor="applicantLegalName" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Legal name <span className="text-red-500">*</span>
              </label>
              <input
                id="applicantLegalName"
                type="text"
                value={formData.applicantLegalName}
                onChange={(e) => handleInputChange('applicantLegalName', e.target.value)}
                placeholder="e.g., Lovely Professional University"
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.applicantLegalName && <p className="mt-1 text-sm text-red-600">{errors.applicantLegalName}</p>}
            </div>

            <div>
              <label htmlFor="applicantCategory" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Applicant category <span className="text-red-500">*</span>
              </label>
              <select
                id="applicantCategory"
                value={formData.applicantCategory}
                onChange={(e) => handleInputChange('applicantCategory', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              >
                <option value="natural_person">Natural person</option>
                <option value="small_entity">Small entity</option>
                <option value="startup">Startup</option>
                <option value="others">Others</option>
              </select>
              {errors.applicantCategory && <p className="mt-1 text-sm text-red-600">{errors.applicantCategory}</p>}
            </div>

            <div className="md:col-span-2">
              <label htmlFor="applicantAddressLine1" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Registered address - Line 1 <span className="text-red-500">*</span>
              </label>
              <input
                id="applicantAddressLine1"
                type="text"
                value={formData.applicantAddressLine1}
                onChange={(e) => handleInputChange('applicantAddressLine1', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.applicantAddressLine1 && <p className="mt-1 text-sm text-red-600">{errors.applicantAddressLine1}</p>}
            </div>

            <div className="md:col-span-2">
              <label htmlFor="applicantAddressLine2" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Registered address - Line 2
              </label>
              <input
                id="applicantAddressLine2"
                type="text"
                value={formData.applicantAddressLine2}
                onChange={(e) => handleInputChange('applicantAddressLine2', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
              />
            </div>

            <div>
              <label htmlFor="applicantCity" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                City <span className="text-red-500">*</span>
              </label>
              <input
                id="applicantCity"
                type="text"
                value={formData.applicantCity}
                onChange={(e) => handleInputChange('applicantCity', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.applicantCity && <p className="mt-1 text-sm text-red-600">{errors.applicantCity}</p>}
            </div>

            <div>
              <label htmlFor="applicantState" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                State <span className="text-red-500">*</span>
              </label>
              <input
                id="applicantState"
                type="text"
                value={formData.applicantState}
                onChange={(e) => handleInputChange('applicantState', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.applicantState && <p className="mt-1 text-sm text-red-600">{errors.applicantState}</p>}
            </div>

            <div>
              <label htmlFor="applicantCountryCode" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Country code <span className="text-red-500">*</span>
              </label>
              <input
                id="applicantCountryCode"
                type="text"
                value={formData.applicantCountryCode}
                onChange={(e) => handleInputChange('applicantCountryCode', e.target.value.toUpperCase())}
                placeholder="e.g., IN"
                maxLength={2}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200 uppercase"
                required
              />
              {errors.applicantCountryCode && <p className="mt-1 text-sm text-red-600">{errors.applicantCountryCode}</p>}
            </div>

            <div>
              <label htmlFor="applicantPostalCode" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                PIN <span className="text-red-500">*</span>
              </label>
              <input
                id="applicantPostalCode"
                type="text"
                value={formData.applicantPostalCode}
                onChange={(e) => handleInputChange('applicantPostalCode', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.applicantPostalCode && <p className="mt-1 text-sm text-red-600">{errors.applicantPostalCode}</p>}
            </div>
          </div>
        </div>

        {/* Address for Service Card */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gpt-gray-900">Address for Service</h2>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={sameAsApplicant}
                onChange={(e) => handleSameAsApplicantToggle(e.target.checked)}
                className="h-4 w-4 text-gpt-blue-600 focus:ring-gpt-blue-500 border-gpt-gray-300 rounded"
              />
              <span className="ml-2 text-sm text-gpt-gray-700">Same as applicant</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label htmlFor="correspondenceName" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Name shown on the address block <span className="text-red-500">*</span>
              </label>
              <input
                id="correspondenceName"
                type="text"
                value={formData.correspondenceName}
                onChange={(e) => handleInputChange('correspondenceName', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.correspondenceName && <p className="mt-1 text-sm text-red-600">{errors.correspondenceName}</p>}
            </div>

            <div>
              <label htmlFor="correspondenceEmail" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Official email <span className="text-red-500">*</span>
              </label>
              <input
                id="correspondenceEmail"
                type="email"
                value={formData.correspondenceEmail}
                onChange={(e) => handleInputChange('correspondenceEmail', e.target.value)}
                placeholder="e.g., dip@lpu.co.in"
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.correspondenceEmail && <p className="mt-1 text-sm text-red-600">{errors.correspondenceEmail}</p>}
            </div>

            <div>
              <label htmlFor="correspondencePhone" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Phone <span className="text-red-500">*</span>
              </label>
              <input
                id="correspondencePhone"
                type="tel"
                value={formData.correspondencePhone}
                onChange={(e) => handleInputChange('correspondencePhone', e.target.value)}
                placeholder="e.g., +919876543210"
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.correspondencePhone && <p className="mt-1 text-sm text-red-600">{errors.correspondencePhone}</p>}
            </div>

            <div className="md:col-span-2">
              <label htmlFor="correspondenceAddressLine1" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Full postal address - Line 1 <span className="text-red-500">*</span>
              </label>
              <input
                id="correspondenceAddressLine1"
                type="text"
                value={formData.correspondenceAddressLine1}
                onChange={(e) => handleInputChange('correspondenceAddressLine1', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.correspondenceAddressLine1 && <p className="mt-1 text-sm text-red-600">{errors.correspondenceAddressLine1}</p>}
            </div>

            <div className="md:col-span-2">
              <label htmlFor="correspondenceAddressLine2" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Full postal address - Line 2
              </label>
              <input
                id="correspondenceAddressLine2"
                type="text"
                value={formData.correspondenceAddressLine2}
                onChange={(e) => handleInputChange('correspondenceAddressLine2', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
              />
            </div>

            <div>
              <label htmlFor="correspondenceCity" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                City <span className="text-red-500">*</span>
              </label>
              <input
                id="correspondenceCity"
                type="text"
                value={formData.correspondenceCity}
                onChange={(e) => handleInputChange('correspondenceCity', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.correspondenceCity && <p className="mt-1 text-sm text-red-600">{errors.correspondenceCity}</p>}
            </div>

            <div>
              <label htmlFor="correspondenceState" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                State <span className="text-red-500">*</span>
              </label>
              <input
                id="correspondenceState"
                type="text"
                value={formData.correspondenceState}
                onChange={(e) => handleInputChange('correspondenceState', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.correspondenceState && <p className="mt-1 text-sm text-red-600">{errors.correspondenceState}</p>}
            </div>

            <div>
              <label htmlFor="correspondenceCountryCode" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Country code <span className="text-red-500">*</span>
              </label>
              <input
                id="correspondenceCountryCode"
                type="text"
                value={formData.correspondenceCountryCode}
                onChange={(e) => handleInputChange('correspondenceCountryCode', e.target.value.toUpperCase())}
                placeholder="e.g., IN"
                maxLength={2}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200 uppercase"
                required
              />
              {errors.correspondenceCountryCode && <p className="mt-1 text-sm text-red-600">{errors.correspondenceCountryCode}</p>}
            </div>

            <div>
              <label htmlFor="correspondencePostalCode" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                PIN <span className="text-red-500">*</span>
              </label>
              <input
                id="correspondencePostalCode"
                type="text"
                value={formData.correspondencePostalCode}
                onChange={(e) => handleInputChange('correspondencePostalCode', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              />
              {errors.correspondencePostalCode && <p className="mt-1 text-sm text-red-600">{errors.correspondencePostalCode}</p>}
            </div>
          </div>
        </div>

        {/* Agent/Attorney Card */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="mb-6">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.useAgent}
                onChange={(e) => handleInputChange('useAgent', e.target.checked)}
                className="h-4 w-4 text-gpt-blue-600 focus:ring-gpt-blue-500 border-gpt-gray-300 rounded"
              />
              <span className="ml-2 text-sm font-medium text-gpt-gray-700">Use Agent/Attorney</span>
            </label>
          </div>

          {formData.useAgent && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="agentName" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  Agent/Attorney name <span className="text-red-500">*</span>
                </label>
                <input
                  id="agentName"
                  type="text"
                  value={formData.agentName}
                  onChange={(e) => handleInputChange('agentName', e.target.value)}
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
                {errors.agentName && <p className="mt-1 text-sm text-red-600">{errors.agentName}</p>}
              </div>

              <div>
                <label htmlFor="agentRegistrationNo" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  IN/PA reg. no. <span className="text-red-500">*</span>
                </label>
                <input
                  id="agentRegistrationNo"
                  type="text"
                  value={formData.agentRegistrationNo}
                  onChange={(e) => handleInputChange('agentRegistrationNo', e.target.value)}
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
                {errors.agentRegistrationNo && <p className="mt-1 text-sm text-red-600">{errors.agentRegistrationNo}</p>}
              </div>

              <div>
                <label htmlFor="agentEmail" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="agentEmail"
                  type="email"
                  value={formData.agentEmail}
                  onChange={(e) => handleInputChange('agentEmail', e.target.value)}
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
                {errors.agentEmail && <p className="mt-1 text-sm text-red-600">{errors.agentEmail}</p>}
              </div>

              <div>
                <label htmlFor="agentPhone" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  Phone <span className="text-red-500">*</span>
                </label>
                <input
                  id="agentPhone"
                  type="tel"
                  value={formData.agentPhone}
                  onChange={(e) => handleInputChange('agentPhone', e.target.value)}
                  placeholder="e.g., +919876543210"
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
                {errors.agentPhone && <p className="mt-1 text-sm text-red-600">{errors.agentPhone}</p>}
              </div>

              <div className="md:col-span-2">
                <label htmlFor="agentAddressLine1" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  Address - Line 1 <span className="text-red-500">*</span>
                </label>
                <input
                  id="agentAddressLine1"
                  type="text"
                  value={formData.agentAddressLine1}
                  onChange={(e) => handleInputChange('agentAddressLine1', e.target.value)}
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
                {errors.agentAddressLine1 && <p className="mt-1 text-sm text-red-600">{errors.agentAddressLine1}</p>}
              </div>

              <div className="md:col-span-2">
                <label htmlFor="agentAddressLine2" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  Address - Line 2
                </label>
                <input
                  id="agentAddressLine2"
                  type="text"
                  value={formData.agentAddressLine2}
                  onChange={(e) => handleInputChange('agentAddressLine2', e.target.value)}
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                />
              </div>

              <div>
                <label htmlFor="agentCity" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  City <span className="text-red-500">*</span>
                </label>
                <input
                  id="agentCity"
                  type="text"
                  value={formData.agentCity}
                  onChange={(e) => handleInputChange('agentCity', e.target.value)}
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
                {errors.agentCity && <p className="mt-1 text-sm text-red-600">{errors.agentCity}</p>}
              </div>

              <div>
                <label htmlFor="agentState" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  State <span className="text-red-500">*</span>
                </label>
                <input
                  id="agentState"
                  type="text"
                  value={formData.agentState}
                  onChange={(e) => handleInputChange('agentState', e.target.value)}
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
                {errors.agentState && <p className="mt-1 text-sm text-red-600">{errors.agentState}</p>}
              </div>

              <div>
                <label htmlFor="agentCountryCode" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  Country code <span className="text-red-500">*</span>
                </label>
                <input
                  id="agentCountryCode"
                  type="text"
                  value={formData.agentCountryCode}
                  onChange={(e) => handleInputChange('agentCountryCode', e.target.value.toUpperCase())}
                  placeholder="e.g., IN"
                  maxLength={2}
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200 uppercase"
                  required
                />
                {errors.agentCountryCode && <p className="mt-1 text-sm text-red-600">{errors.agentCountryCode}</p>}
              </div>

              <div>
                <label htmlFor="agentPostalCode" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                  PIN <span className="text-red-500">*</span>
                </label>
                <input
                  id="agentPostalCode"
                  type="text"
                  value={formData.agentPostalCode}
                  onChange={(e) => handleInputChange('agentPostalCode', e.target.value)}
                  className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
                {errors.agentPostalCode && <p className="mt-1 text-sm text-red-600">{errors.agentPostalCode}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Default Filing Preferences Card */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gpt-gray-900 mb-6">Default Filing Preferences</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="defaultJurisdiction" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Jurisdiction default <span className="text-red-500">*</span>
              </label>
              <select
                id="defaultJurisdiction"
                value={formData.defaultJurisdiction}
                onChange={(e) => handleInputChange('defaultJurisdiction', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              >
                <option value="IN">IN</option>
                <option value="PCT">PCT</option>
                <option value="US">US</option>
                <option value="EP">EP</option>
              </select>
              {errors.defaultJurisdiction && <p className="mt-1 text-sm text-red-600">{errors.defaultJurisdiction}</p>}
            </div>

            <div>
              <label htmlFor="defaultRoute" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Filing route default <span className="text-red-500">*</span>
              </label>
              <select
                id="defaultRoute"
                value={formData.defaultRoute}
                onChange={(e) => handleInputChange('defaultRoute', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              >
                <option value="national">National</option>
                <option value="pct_international">PCT-International</option>
                <option value="pct_national">PCT-National Phase</option>
              </select>
              {errors.defaultRoute && <p className="mt-1 text-sm text-red-600">{errors.defaultRoute}</p>}
            </div>

            <div>
              <label htmlFor="defaultLanguage" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Default language
              </label>
              <input
                id="defaultLanguage"
                type="text"
                value={formData.defaultLanguage}
                onChange={(e) => handleInputChange('defaultLanguage', e.target.value)}
                placeholder="EN"
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
              />
            </div>

            <div>
              <label htmlFor="defaultEntityStatusIn" className="block text-sm font-medium text-gpt-gray-700 mb-1">
                Default entity status (IN) <span className="text-red-500">*</span>
              </label>
              <select
                id="defaultEntityStatusIn"
                value={formData.defaultEntityStatusIn}
                onChange={(e) => handleInputChange('defaultEntityStatusIn', e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gpt-gray-300 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
                required
              >
                <option value="startup">Startup</option>
                <option value="small_entity">Small entity</option>
                <option value="university">University</option>
                <option value="regular">Regular</option>
              </select>
              {errors.defaultEntityStatusIn && <p className="mt-1 text-sm text-red-600">{errors.defaultEntityStatusIn}</p>}
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          {errors.submit && (
            <div className="mr-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {errors.submit}
            </div>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isSubmitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Saving...
              </>
            ) : (
              'Save Applicant Profile'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
