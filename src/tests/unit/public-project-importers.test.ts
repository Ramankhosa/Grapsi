import { describe, expect, it } from 'vitest'

import { __csvImportTestables } from '@/lib/publicProjects/connectors/csvImport'
import { __icssrTestables } from '@/lib/publicProjects/connectors/icssr'

describe('public project file importers', () => {
  it('parses ICSSR rows whose serial number and application ID share a line', () => {
    const rows = __icssrTestables.parseIcssrPdfRows(
      `
      Detailed List of Recommended Proposals
      Sl. No. Application No. Name of the Project Director Recommended Title
      1. ICSSR-RMM-
      2024-4912
      Dr. Lovey Srivastava The Literature & Culture around Student Movements in India
      2 ICSSR-RMM-2024-11459
      Dr. Pallabi Borah Cultural Heritage Meets Market Innovation
      `,
      {
        fileId: 'major-2024',
        fileName: 'Major-2024-25.pdf',
        filePath: '/tmp/Major-2024-25.pdf',
        projectType: 'Major Research Project',
        yearWindow: '2024-25',
      } as any
    )

    expect(rows).toHaveLength(2)
    expect(rows[0].applicationId).toBe('ICSSR-RMM-2024-4912')
    expect(rows[0].principalInvestigator).toBe('Dr. Lovey Srivastava')
    expect(rows[0].title).toContain('Student Movements')
    expect(rows[1].title).toBe('Cultural Heritage Meets Market Innovation')
  })

  it('keeps the Indian PI when an NSTC collaboration is identified from PDF text', () => {
    const rows = __icssrTestables.parseIcssrPdfRows(
      `
      Indian Council of Social Science Research & National Science and Technology Council (NSTC), Taiwan
      RESULTS OF JOINT RESEARCH PROJECTS
      1. Dr. Sunil Kumar
      Professor
      South Asian University, New Delhi
      Dr. Ming-Miin Yu
      Distinguished Professor
      National Taiwan Ocean University
      Taipei, Taiwan
      Digital Payment Transactions and Bank Efficiency in India and Taiwan
      `,
      {
        fileId: 'joint-2024',
        fileName: 'result-jointresearch-2024.pdf',
        filePath: '/tmp/result-jointresearch-2024.pdf',
        projectType: 'Joint Research Programme',
        yearWindow: '2024',
      } as any
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].taiwanCollaboration).toBe(true)
    expect(rows[0].principalInvestigator).toBe('Dr. Sunil Kumar')
    expect(rows[0].institution).toContain('South Asian University')
    expect(rows[0].title).toContain('Digital Payment Transactions')
    expect(rows[0].rawBlock).toContain('Dr. Ming-Miin Yu')
  })

  it('maps the supplied DST CSV schema and preserves quoted commas', () => {
    const csv = Buffer.from(
      [
        'Funding_agency,dst_project_record_id,scheme,financial_year,title_for_embedding,pi_name,pi_organization_address,pi_emails,state,budget_single_value_inr',
        'DST,DST-SEED-00001,S&T for Women,2017-18,"SETTING UP A RURAL TECHNOLOGY PARK, VARANASI",DIGITAL INDIA CORPORATION,"NEHRU PLACE, NEW DELHI",,NEW DELHI,6065122',
      ].join('\n')
    )
    const rows = __csvImportTestables.parseCsvFile(csv, {
      fileId: 'dst-file',
      fileName: 'dst.csv',
      filePath: '/tmp/dst.csv',
    } as any)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      fundingAgency: 'DST',
      projectRecordId: 'DST-SEED-00001',
      title: 'SETTING UP A RURAL TECHNOLOGY PARK, VARANASI',
      piOrganization: 'NEHRU PLACE, NEW DELHI',
      budgetAmount: '6065122',
    })
  })

  it('reads agency names from the first CSV column when the header is agency-oriented', () => {
    const csv = Buffer.from(
      [
        'Agency Name,Project ID,Scheme,Financial Year,Title,PI Name,Organization,State,Budget',
        'DBT,DBT-001,BioCARe,2024-25,Microbiome intervention study,Dr Asha Rao,Institute of Life Sciences,Odisha,1200000',
      ].join('\n')
    )
    const rows = __csvImportTestables.parseCsvFile(csv, {
      fileId: 'dbt-file',
      fileName: 'dbt.csv',
      filePath: '/tmp/dbt.csv',
    } as any)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      fundingAgency: 'DBT',
      projectRecordId: 'DBT-001',
      title: 'Microbiome intervention study',
    })
  })
})
