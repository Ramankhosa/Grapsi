import type { PublicProjectSourceKey } from '@/lib/prisma-generated'

import { createBiracPublicProjectConnector } from './connectors/birac'
import { createCsirPublicProjectConnector } from './connectors/csir'
import { createCsvImportPublicProjectConnector } from './connectors/csvImport'
import { createIcmrPublicProjectConnector } from './connectors/icmr'
import { createIcssrPublicProjectConnector } from './connectors/icssr'
import { createPrismPublicProjectConnector } from './connectors/prism'
import type { PublicProjectConnector } from './types'

export const PUBLIC_PROJECT_SOURCE_DEFINITIONS: Array<{
  sourceKey: PublicProjectSourceKey
  name: string
  baseUrl: string
  enabled: boolean
  crawlConfig: Record<string, unknown>
  scheduleConfig: Record<string, unknown>
}> = [
  {
    sourceKey: 'PRISM',
    name: 'SERB PRISM awarded projects',
    baseUrl: 'https://prism.serbonline.in',
    enabled: true,
    crawlConfig: {
      pilotStates: ['PUNJAB', 'DELHI'],
      pilotRecordCap: 20,
      onlinePerState: 5,
      legacyPerState: 5,
      minimumRequestSpacingMs: 250,
      detailFetchConcurrency: 4,
      resumableExtractionBatchSize: 100,
      skipExistingRecords: true,
      embedAfterExtraction: true,
      fetchAuxiliarySections: true,
      fullRunScope: 'all_current_indian_states_and_union_territories_from_source',
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
      refreshOngoingProjectsEveryDays: 30,
      refreshCompletedProjectsEveryDays: 180,
    },
  },
  {
    sourceKey: 'BIRAC',
    name: 'BIRAC supported projects',
    baseUrl: 'https://birac.nic.in',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'scheme_links_and_supported_project_pdfs',
      pilotRecordCap: 20,
      minimumRequestSpacingMs: 1000,
      abstractPolicy: 'store_NA_embed_title_only',
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'CSIR',
    name: 'CSIR Anusandhan projects',
    baseUrl: 'https://csirprojects.anusandhan.net',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'paginated_search_and_session_bound_detail_post',
      pilotRecordCap: 20,
      minimumRequestSpacingMs: 1000,
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'ICMR',
    name: 'ICMR approved projects',
    baseUrl: 'https://www.icmr.gov.in',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'approved_project_pdf_links_grouped_by_time_window',
      pilotRecordCap: 20,
      minimumRequestSpacingMs: 1000,
      abstractPolicy: 'store_NA_embed_title_only',
      sourcePage: 'https://www.icmr.gov.in/list-of-approved-projects',
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'ICSSR',
    name: 'ICSSR awarded projects (uploaded PDFs)',
    baseUrl: 'https://www.icssr.org',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'uploaded_pdf_folder_processing',
      pilotRecordCap: 50,
      pdfFolder: process.env.ICSSR_UPLOAD_DIR || '/tmp/icssr-uploads',
      abstractPolicy: 'store_NA_embed_title_only',
      sourceTypes: [
        'Major Research Project',
        'Minor Research Project',
        'FFSI Fellowship',
        'LSS Awardees',
        'Longitudinal Studies',
        'Special Calls (PVTGs/Tribes)',
        'ICSSR-JSPS Joint Research',
        'ICSSR-NSTC Joint Research',
        'Viksit Bharat 2047',
        'Jal Jeevan Mission',
      ],
      uploadEndpoint: '/api/super-admin/project-intelligence/crawlers/upload',
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'CSV_IMPORT',
    name: 'CSV Manual Import (Any Agency)',
    baseUrl: 'https://manual-import.local',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'csv_file_upload_processing',
      pilotRecordCap: 200,
      csvFolder: process.env.CSV_IMPORT_DIR || '/tmp/csv-imports',
      abstractPolicy: 'store_NA_embed_title_only',
      sourceTypes: [
        'DST - SEED',
        'DST - S&T for Women',
        'DST - Major Projects',
        'DST - Minor Projects',
        'DBT',
        'DAE',
        'DRDO',
        'ISRO',
        'Other Agencies',
      ],
      uploadEndpoint: '/api/super-admin/project-intelligence/crawlers/csv-upload',
      supportsMultipleAgencies: true,
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
]

export function getPublicProjectConnector(sourceKey: PublicProjectSourceKey): PublicProjectConnector {
  switch (sourceKey) {
    case 'PRISM':
      return createPrismPublicProjectConnector()
    case 'CSIR':
      return createCsirPublicProjectConnector()
    case 'BIRAC':
      return createBiracPublicProjectConnector()
    case 'ICMR':
      return createIcmrPublicProjectConnector()
    case 'ICSSR':
      return createIcssrPublicProjectConnector()
    case 'CSV_IMPORT':
      return createCsvImportPublicProjectConnector()
    default:
      throw new Error(`Unsupported public-project source: ${sourceKey}`)
  }
}
