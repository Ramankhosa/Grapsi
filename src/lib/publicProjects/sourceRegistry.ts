import type { PublicProjectSourceKey } from '@/lib/prisma-generated'

import { createBiracPublicProjectConnector } from './connectors/birac'
import { createCordisPublicProjectConnector } from './connectors/cordis'
import { createCsirPublicProjectConnector } from './connectors/csir'
import { createCsvImportPublicProjectConnector } from './connectors/csvImport'
import {
  createUkriGtrPublicProjectConnector,
  createWorldBankPublicProjectConnector,
} from './connectors/globalRaw'
import { createIcmrPublicProjectConnector } from './connectors/icmr'
import { createIcssrPublicProjectConnector } from './connectors/icssr'
import { createNihReporterPublicProjectConnector } from './connectors/nihReporter'
import { createNwoPublicProjectConnector } from './connectors/nwo'
import { createNsfAwardPublicProjectConnector } from './connectors/nsfAward'
import { createPrismPublicProjectConnector } from './connectors/prism'
import type { PublicProjectConnector } from './types'

export const TOP_FUNDED_PROJECT_SOURCE_KEYS = ['NIH_REPORTER', 'NSF', 'CORDIS', 'UKRI_GTR', 'NWO'] as const

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
      pilotFetchAuxiliarySections: false,
      fetchAuxiliarySections: true,
      rawIngestionOnlySupported: true,
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
      rawIngestionOnlySupported: true,
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
      rawIngestionOnlySupported: true,
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
      rawIngestionOnlySupported: true,
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
      rawIngestionOnlySupported: true,
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
      rawIngestionOnlySupported: false,
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'NIH_REPORTER',
    name: 'NIH RePORTER funded projects',
    baseUrl: 'https://api.reporter.nih.gov',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'reporter_v2_projects_search_by_fiscal_year',
      rawDataOnly: true,
      startYear: 2015,
      pageSize: 100,
      pilotRecordCap: 25,
      minimumRequestSpacingMs: 1000,
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'NSF',
    name: 'NSF Award Search funded projects',
    baseUrl: 'https://www.research.gov/awardapi-service/v1',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'awardapi_date_range_awards_json',
      rawDataOnly: true,
      startYear: 2015,
      pageSize: 100,
      pilotRecordCap: 25,
      minimumRequestSpacingMs: 1000,
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'CORDIS',
    name: 'EU CORDIS projects',
    baseUrl: 'https://cordis.europa.eu',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'data_europa_official_cordis_json_distributions',
      rawDataOnly: true,
      startYear: 2015,
      pilotRecordCap: 25,
      datasetIds: ['cordis-eu-research-projects-under-horizon-europe-2021-2027', 'cordish2020projects'],
      minimumRequestSpacingMs: 1000,
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'UKRI_GTR',
    name: 'UKRI Gateway to Research projects',
    baseUrl: 'https://gtr.ukri.org',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'gtr_api_projects_json',
      rawDataOnly: true,
      startYear: 2015,
      pageSize: 100,
      pilotRecordCap: 25,
      minimumRequestSpacingMs: 1000,
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'WORLD_BANK',
    name: 'World Bank Projects & Operations',
    baseUrl: 'https://search.worldbank.org',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'world_bank_projects_api',
      rawDataOnly: true,
      startYear: 2015,
      pageSize: 100,
      pilotRecordCap: 25,
      minimumRequestSpacingMs: 1000,
    },
    scheduleConfig: {
      monthlyIncrementalEnabled: false,
      disabledUntilProductionQualityValidation: true,
    },
  },
  {
    sourceKey: 'NWO' as PublicProjectSourceKey,
    name: 'NWO Project Database / NWOpen API',
    baseUrl: 'https://nwopen-api.nwo.nl/NWOpen-API/api',
    enabled: true,
    crawlConfig: {
      status: 'pilot_enabled',
      discovery: 'nwopen_projects_api',
      rawDataOnly: true,
      startYear: 2015,
      pilotRecordCap: 25,
      minimumRequestSpacingMs: 1000,
      upstreamTimeoutSensitive: true,
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
    case 'NIH_REPORTER':
      return createNihReporterPublicProjectConnector()
    case 'NSF':
      return createNsfAwardPublicProjectConnector()
    case 'CORDIS':
      return createCordisPublicProjectConnector()
    case 'UKRI_GTR':
      return createUkriGtrPublicProjectConnector()
    case 'NWO' as PublicProjectSourceKey:
      return createNwoPublicProjectConnector()
    case 'WORLD_BANK':
      return createWorldBankPublicProjectConnector()
    default:
      throw new Error(`Unsupported public-project source: ${sourceKey}`)
  }
}
