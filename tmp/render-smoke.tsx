import 'dotenv/config'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrismaClient } from '@prisma/client'

import PriorWorkList from '@/components/funding-intelligence/PriorWorkList'
import CoverageMap from '@/components/funding-intelligence/CoverageMap'

const prisma = new PrismaClient()

async function main() {
  const call = await prisma.reviewerCall.findUnique({
    where: { id: 'cmq0o9bel00o214iusm84d32n' },
    select: { overall_review_json: true },
  })
  const landscape = (call?.overall_review_json as any)?.landscape
  if (!landscape) throw new Error('no landscape on call')

  const listHtml = renderToStaticMarkup(
    React.createElement(PriorWorkList, {
      rows: landscape.priorWork.rows,
      summary: landscape.priorWork.summary,
    })
  )
  const mapHtml = renderToStaticMarkup(
    React.createElement(CoverageMap, {
      coverage: landscape.priorWork.coverage,
      rows: landscape.priorWork.rows,
      patentsSearched: landscape.sources?.patents?.status === 'ok',
    })
  )
  console.log('PriorWorkList html len:', listHtml.length)
  console.log('contains first row title:', listHtml.includes(String(landscape.priorWork.rows[0].title).slice(0, 30)))
  console.log('CoverageMap html len:', mapHtml.length)
  console.log('coverage mentions first facet:', mapHtml.includes(String(landscape.facets[0]).slice(0, 20)))
}
main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e); process.exit(1) })
