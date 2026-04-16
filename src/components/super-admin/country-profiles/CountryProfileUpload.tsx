'use client'

import { useState, useRef } from 'react'
import { validateCountryProfile } from '@/lib/country-profile-validation'
import { repairCountryProfile, RepairResult } from '@/lib/country-profile-repair'

interface CountryProfileUploadProps {
  onUploadSuccess: () => void
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function CountryProfileUpload({ onUploadSuccess }: CountryProfileUploadProps) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [profileData, setProfileData] = useState<any>(null)
  const [originalProfileData, setOriginalProfileData] = useState<any>(null)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isRepairing, setIsRepairing] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [activeTab, setActiveTab] = useState<'file' | 'text'>('file')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      setUploadError('Please select a valid JSON file')
      return
    }

    setUploadedFile(file)
    setUploadError(null)
    setRepairResult(null)

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string
        const parsed = JSON.parse(content)
        setOriginalProfileData(parsed)

        // Attempt to repair the profile
        setIsRepairing(true)
        const repair = await repairCountryProfile(parsed)
        setRepairResult(repair)
        setIsRepairing(false)

        if (repair.success && repair.repairedProfile) {
          setProfileData(repair.repairedProfile)
          setJsonText(JSON.stringify(repair.repairedProfile, null, 2))
          setValidationResult(repair.validationResult)
        } else {
          // If repair failed, use original and show errors
          setProfileData(parsed)
          setJsonText(JSON.stringify(parsed, null, 2))
          setValidationResult(repair.validationResult)
        }
      } catch (error) {
        setUploadError('Invalid JSON file: ' + (error instanceof Error ? error.message : 'Unknown error'))
        setProfileData(null)
        setOriginalProfileData(null)
        setValidationResult(null)
        setRepairResult(null)
      }
    }
    reader.readAsText(file)
  }

  const handleTextChange = async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value
    setJsonText(text)
    setRepairResult(null)

    try {
      const parsed = JSON.parse(text)
      setOriginalProfileData(parsed)
      setUploadError(null)

      // Attempt to repair the profile
      setIsRepairing(true)
      const repair = await repairCountryProfile(parsed)
      setRepairResult(repair)
      setIsRepairing(false)

      if (repair.success && repair.repairedProfile) {
        setProfileData(repair.repairedProfile)
        setValidationResult(repair.validationResult)
      } else {
        // If repair failed, use original and show errors
        setProfileData(parsed)
        setValidationResult(repair.validationResult)
      }
    } catch (error) {
      setProfileData(null)
      setOriginalProfileData(null)
      setValidationResult(null)
      setRepairResult(null)
      if (text.trim()) {
        setUploadError('Invalid JSON: ' + (error instanceof Error ? error.message : 'Unknown error'))
      } else {
        setUploadError(null)
      }
    }
  }

  const handleSubmit = async () => {
    if (!profileData || !validationResult?.valid) return

    setIsUploading(true)
    setUploadError(null)

    try {
      const response = await fetch('/api/super-admin/countries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          countryCode: profileData.meta.code,
          name: profileData.meta.name,
          profileData: profileData,
          status: 'DRAFT'
        })
      })

      const result = await response.json()

      if (response.ok) {
        // Reset form
        setUploadedFile(null)
        setProfileData(null)
        setValidationResult(null)
        setJsonText('')
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }

        onUploadSuccess()
        alert('Country profile uploaded successfully!')
      } else {
        setUploadError(result.error || 'Upload failed')
      }
    } catch (error) {
      setUploadError('Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsUploading(false)
    }
  }

  const loadSampleProfile = () => {
    const sampleProfile = {
      "meta": {
        "id": "US",
        "name": "United States",
        "code": "US",
        "continent": "North America",
        "office": "USPTO",
        "officeUrl": "https://www.uspto.gov",
        "applicationTypes": ["utility"],
        "languages": ["en"],
        "version": 1,
        "status": "active",
        "inheritsFrom": null,
        "tags": ["anglophone", "strict_claims"],
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-01-01T00:00:00Z"
      },
      "structure": {
        "defaultVariant": "standard",
        "variants": [
          {
            "id": "standard",
            "label": "Standard Utility Application",
            "description": "Regular non-provisional utility application.",
            "sections": [
              {
                "id": "title",
                "label": "Title",
                "order": 1,
                "canonicalKeys": ["title"],
                "required": true,
                "group": "header",
                "maxLengthChars": 500,
                "ui": {
                  "placeholder": "Enter a concise technical title",
                  "helpText": "No trademarks, no 'patent' word, purely technical."
                }
              },
              {
                "id": "field",
                "label": "Field of the Invention",
                "order": 3,
                "canonicalKeys": ["field_of_invention"],
                "required": true,
                "group": "body",
                "ui": {
                  "placeholder": "State the technical field.",
                  "helpText": "1–3 sentences indicating the field; avoid advantages/embodiments here."
                }
              },
              {
                "id": "background",
                "label": "Background",
                "order": 4,
                "canonicalKeys": ["background"],
                "required": false,
                "group": "body",
                "ui": {
                  "placeholder": "Describe prior art and problems.",
                  "helpText": "Explain limitations of known techniques without conceding obviousness."
                }
              },
              {
                "id": "summary",
                "label": "Summary",
                "order": 5,
                "canonicalKeys": ["summary_of_invention"],
                "required": false,
                "group": "body",
                "ui": {
                  "placeholder": "Provide a high-level summary.",
                  "helpText": "Capture the gist of the inventive concept without excessive detail."
                }
              },
              {
                "id": "detailed_description",
                "label": "Detailed Description",
                "order": 7,
                "canonicalKeys": ["detailed_description"],
                "required": true,
                "group": "body",
                "ui": {
                  "placeholder": "Provide a full detailed description.",
                  "helpText": "Cover all embodiments that support the claims; reference drawings where relevant."
                }
              },
              {
                "id": "claims",
                "label": "Claims",
                "order": 8,
                "canonicalKeys": ["claims"],
                "required": true,
                "group": "claims",
                "ui": {
                  "placeholder": "Independent and dependent claims.",
                  "helpText": "Each claim as a separate numbered paragraph."
                }
              },
              {
                "id": "abstract",
                "label": "Abstract",
                "order": 9,
                "canonicalKeys": ["abstract"],
                "required": true,
                "group": "abstract",
                "ui": {
                  "placeholder": "Short technical abstract.",
                  "helpText": "≤150 words, technical only, no advantages or marketing."
                }
              }
            ]
          }
        ]
      },
      "rules": {
        "global": {
          "paragraphNumberingRequired": false,
          "maxPagesRecommended": 100,
          "allowEquations": true,
          "allowTables": true
        },
        "abstract": {
          "wordLimit": 150,
          "noBenefitsOrAdvantages": true,
          "noClaimLanguage": true,
          "singleParagraph": true
        },
        "claims": {
          "twoPartFormPreferred": false,
          "allowMultipleDependent": true,
          "prohibitMultipleDependentOnMultipleDependent": true,
          "preferredConnectors": ["comprising"],
          "discouragedConnectors": ["consisting of"],
          "forbiddenPhrases": ["characterized in that"],
          "maxIndependentClaimsBeforeExtraFee": 3,
          "maxTotalClaimsRecommended": 20,
          "allowReferenceNumeralsInClaims": true,
          "requireSupportInDescription": true,
          "unityStandard": "US_112"
        },
        "description": {
          "requireBestModeDisclosure": true,
          "avoidClaimLanguage": true,
          "allowReferenceNumerals": true,
          "requireEmbodimentSupportForAllClaims": true,
          "industrialApplicabilitySectionRequired": false
        },
        "drawings": {
          "requiredWhenApplicable": true,
          "paperSize": "LETTER",
          "colorAllowed": false,
          "lineStyle": "black_and_white_solid",
          "referenceNumeralsMandatoryWhenDrawings": true,
          "minReferenceTextSizePt": 8,
          "marginTopCm": 2.5,
          "marginBottomCm": 1.0,
          "marginLeftCm": 2.5,
          "marginRightCm": 1.5
        },
        "procedural": {
          "gracePeriodMonths": 12,
          "foreignFilingLicenseRequired": true,
          "idsRequired": true,
          "priorArtDisclosureThreshold": "material_to_patentability",
          "allowProvisionalPriority": true
        },
        "language": {
          "allowedLanguages": ["en"],
          "requiresOfficialTranslation": false
        }
      },
      "validation": {
        "sectionChecks": {
          "title": [
            {
              "id": "title_length_words",
              "type": "maxWords",
              "limit": 25,
              "severity": "warning",
              "message": "Title appears long; consider making it more concise."
            }
          ],
          "abstract": [
            {
              "id": "abstract_word_limit",
              "type": "maxWords",
              "limit": 150,
              "severity": "error",
              "message": "Abstract exceeds the 150 word limit."
            }
          ],
          "claims": [
            {
              "id": "claims_count_recommended",
              "type": "maxCount",
              "limit": 20,
              "severity": "warning",
              "message": "Number of claims exceeds recommended 20; fees may increase."
            }
          ]
        },
        "crossSectionChecks": [
          {
            "id": "claims_supported_by_description",
            "type": "support",
            "from": "claims",
            "mustBeSupportedBy": ["detailed_description"],
            "severity": "error",
            "message": "Some claim elements may not be clearly supported in the detailed description."
          },
          {
            "id": "abstract_consistent_with_claims",
            "type": "consistency",
            "from": "abstract",
            "mustBeConsistentWith": ["claims"],
            "severity": "warning",
            "message": "Abstract may describe features not clearly reflected in the independent claims."
          }
        ]
      },
      "prompts": {
        "baseStyle": {
          "tone": "technical, neutral, precise",
          "voice": "impersonal_third_person",
          "avoid": [
            "marketing language",
            "unsupported advantages",
            "overly legalistic phrasing"
          ]
        },
        "sections": {
          "title": {
            "instruction": "Draft a concise technical title for the invention.",
            "constraints": [
              "Do not exceed 500 characters.",
              "Do not use trademarks or the word 'patent'."
            ]
          },
          "field": {
            "instruction": "Draft the Field of the Invention section.",
            "constraints": [
              "Limit to 1–3 sentences.",
              "State the technical field without describing advantages or embodiments."
            ]
          },
          "background": {
            "instruction": "Draft the Background section.",
            "constraints": [
              "Describe relevant prior art and its limitations.",
              "Avoid explicit admissions that specific references are prior art unless clearly signaled.",
              "Do not state that the invention is obvious or trivial."
            ]
          },
          "summary": {
            "instruction": "Draft the Summary section.",
            "constraints": [
              "Provide a high-level overview of the inventive concept.",
              "Ensure consistency with the independent claims."
            ]
          },
          "detailed_description": {
            "instruction": "Draft the Detailed Description section.",
            "constraints": [
              "Describe embodiments in sufficient detail to practice the invention.",
              "Ensure each independent claim has at least one supporting embodiment.",
              "Reference drawings where applicable."
            ]
          },
          "claims": {
            "instruction": "Draft a full set of claims compliant with this jurisdiction's rules.",
            "constraints": [
              "Use 'comprising' as the preferred connector.",
              "Avoid two-part 'characterized in that' format.",
              "Each dependent claim must reference a single prior claim.",
              "Claims must be supported by the detailed description."
            ]
          },
          "abstract": {
            "instruction": "Draft the Abstract section.",
            "constraints": [
              "No more than 150 words.",
              "Summarize the technical disclosure without mentioning advantages or benefits.",
              "Do not use claim-style language."
            ]
          }
        }
      },
      "export": {
        "documentTypes": [
          {
            "id": "spec_pdf",
            "label": "Specification PDF",
            "includesSections": ["title", "field", "background", "summary", "brief_drawings", "detailed_description", "claims", "abstract"],
            "pageSize": "LETTER",
            "lineSpacing": 1.5,
            "fontFamily": "Times New Roman",
            "fontSizePt": 12,
            "addPageNumbers": true,
            "addParagraphNumbers": false
          }
        ],
        "sectionHeadings": {
          "field": "FIELD OF THE INVENTION",
          "background": "BACKGROUND",
          "summary": "SUMMARY",
          "brief_drawings": "BRIEF DESCRIPTION OF THE DRAWINGS",
          "detailed_description": "DETAILED DESCRIPTION",
          "claims": "CLAIMS",
          "abstract": "ABSTRACT"
        }
      },
      "diagrams": {
        "requiredWhenApplicable": true,
        "supportedDiagramTypes": ["block", "flowchart", "schematic", "perspective_view"],
        "figureLabelFormat": "Fig. {number}",
        "autoGenerateReferenceTable": true,
        "diagramGenerationHints": {
          "block": "Use rectangles for components and arrows for data/control flow.",
          "flowchart": "Use standard flowchart symbols for processes and decisions."
        }
      },
      "crossChecks": {
        "enableSemanticCrossCheck": true,
        "checkList": [
          {
            "id": "drawings_vs_description",
            "description": "Ensure all reference numerals in drawings are explained in the description.",
            "from": "drawings",
            "mustBeExplainedIn": ["detailed_description"]
          },
          {
            "id": "claims_vs_drawings",
            "description": "Ensure key claimed elements appear in at least one figure when drawings are present.",
            "from": "claims",
            "mustBeShownIn": ["drawings"]
          }
        ]
      }
    }

    setJsonText(JSON.stringify(sampleProfile, null, 2))
    setActiveTab('text')
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Upload Country Profile</h2>
        <p className="text-gray-600">
          Upload a JSON file containing a country profile or paste JSON directly.
          The profile will be validated against the required schema before saving.
        </p>
      </div>

      {/* Input Method Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('file')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'file'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Upload File
            </button>
            <button
              onClick={() => setActiveTab('text')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'text'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Paste JSON
            </button>
          </nav>
        </div>
      </div>

      {/* File Upload Tab */}
      {activeTab === 'file' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select JSON File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {uploadedFile && (
              <p className="mt-2 text-sm text-gray-600">
                Selected: {uploadedFile.name} ({(uploadedFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        </div>
      )}

      {/* Text Input Tab */}
      {activeTab === 'text' && (
        <div className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Country Profile JSON
              </label>
              <button
                onClick={loadSampleProfile}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Load Sample Profile
              </button>
            </div>
            <textarea
              value={jsonText}
              onChange={handleTextChange}
              placeholder="Paste your country profile JSON here..."
              className="w-full h-96 px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* Repair Status */}
      {isRepairing && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-blue-800 font-medium">Repairing country profile...</span>
          </div>
        </div>
      )}

      {/* Repair Results */}
      {repairResult && !isRepairing && repairResult.repairs.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-medium mb-3 flex items-center">
            <svg className="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Auto-Repairs Applied ({repairResult.repairs.length})
          </h3>

          <div className="bg-green-50 border border-green-200 rounded-md p-4 max-h-60 overflow-y-auto">
            <div className="space-y-2">
              {repairResult.repairs.map((repair, index) => (
                <div key={index} className="flex items-start space-x-2 text-sm">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    repair.type === 'added' ? 'bg-blue-100 text-blue-800' :
                    repair.type === 'fixed' ? 'bg-yellow-100 text-yellow-800' :
                    repair.type === 'converted' ? 'bg-purple-100 text-purple-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {repair.type}
                  </span>
                  <div className="flex-1">
                    <span className="font-medium text-green-800">{repair.field}:</span>
                    <span className="text-green-700 ml-1">{repair.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {repairResult.success && (
            <div className="mt-3 p-3 bg-green-100 border border-green-300 rounded-md">
              <div className="flex items-center text-green-800">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="font-medium">Profile successfully repaired and validated!</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Validation Results */}
      {validationResult && !isRepairing && (
        <div className="mt-6">
          <h3 className="text-lg font-medium mb-3">Validation Results</h3>

          {validationResult.errors.length > 0 && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <h4 className="text-red-800 font-medium mb-2">Errors ({validationResult.errors.length})</h4>
              <ul className="list-disc list-inside text-red-700 text-sm space-y-1">
                {validationResult.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {validationResult.warnings.length > 0 && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <h4 className="text-yellow-800 font-medium mb-2">Warnings ({validationResult.warnings.length})</h4>
              <ul className="list-disc list-inside text-yellow-700 text-sm space-y-1">
                {validationResult.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {validationResult.valid && validationResult.errors.length === 0 && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-md">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-green-800 font-medium">Profile is valid and ready to upload!</span>
              </div>
              {profileData && (
                <div className="mt-2 text-sm text-green-700">
                  Country: {profileData.meta.name} ({profileData.meta.code}) - {profileData.structure.variants.length} variant(s)
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {uploadError && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-red-800 font-medium">{uploadError}</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-6 flex justify-end space-x-4">
        <button
          onClick={() => {
            setUploadedFile(null)
            setProfileData(null)
            setOriginalProfileData(null)
            setValidationResult(null)
            setRepairResult(null)
            setJsonText('')
            setUploadError(null)
            if (fileInputRef.current) {
              fileInputRef.current.value = ''
            }
          }}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          disabled={isUploading}
        >
          Clear
        </button>
        <button
          onClick={handleSubmit}
          disabled={!validationResult?.valid || isUploading}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          {isUploading ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Uploading...
            </>
          ) : (
            'Upload Profile'
          )}
        </button>
      </div>
    </div>
  )
}
