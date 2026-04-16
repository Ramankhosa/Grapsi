import { createServer, type Server } from 'http'

import { Document, Packer, Paragraph } from 'docx'
import PDFDocument from 'pdfkit'

function buildFixtureText() {
  return [
    'Future Energy Catalyst Grant 2026',
    'Agency: National Science Foundation',
    'Funding Opportunity Number: NSF-ENERGY-2026-01',
    'Deadline: July 15, 2026',
    '',
    'This call supports early-stage clean energy pilots for universities and startups focused on resilient power systems and storage.',
    'Applicants must demonstrate community impact, a clear pilot methodology, and measurable outcomes.',
  ].join('\n')
}

function createFileFromBuffer(buffer: Buffer, fileName: string, type: string) {
  return new File([new Uint8Array(buffer)], fileName, { type })
}

export function createFundingTextFile() {
  return createFileFromBuffer(Buffer.from(buildFixtureText(), 'utf8'), 'funding-call.txt', 'text/plain')
}

export function createFundingHtmlFile() {
  const html = `
    <html>
      <head>
        <title>Future Energy Catalyst Grant 2026</title>
      </head>
      <body>
        <h1>Future Energy Catalyst Grant 2026</h1>
        <p>Agency: National Science Foundation</p>
        <p>Funding Opportunity Number: NSF-ENERGY-2026-01</p>
        <p>Deadline: July 15, 2026</p>
        <p>This call supports early-stage clean energy pilots for universities and startups focused on resilient power systems and storage.</p>
      </body>
    </html>
  `

  return createFileFromBuffer(Buffer.from(html, 'utf8'), 'funding-call.html', 'text/html')
}

export async function createFundingDocxFile() {
  const document = new Document({
    sections: [
      {
        properties: {},
        children: buildFixtureText().split('\n').map((line) => new Paragraph(line)),
      },
    ],
  })

  const buffer = Buffer.from(await Packer.toBuffer(document))
  return createFileFromBuffer(
    buffer,
    'funding-call.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}

export async function createFundingPdfFile() {
  const pdf = new PDFDocument({ margin: 36 })
  const chunks: Buffer[] = []

  pdf.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))

  const completed = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)
  })

  for (const line of buildFixtureText().split('\n')) {
    pdf.text(line)
    pdf.moveDown(0.5)
  }
  pdf.end()

  const buffer = await completed
  return createFileFromBuffer(buffer, 'funding-call.pdf', 'application/pdf')
}

export async function startFundingFixtureServer() {
  const html = `
    <html>
      <head>
        <title>Community Climate Action Fund</title>
      </head>
      <body>
        <h1>Community Climate Action Fund</h1>
        <p>Agency: Global Resilience Council</p>
        <p>Funding Opportunity Number: GRC-CLIMATE-2026</p>
        <p>Deadline: August 31, 2026</p>
        <p>This funding opportunity supports local climate adaptation pilots, heat-risk mitigation, and resilient urban infrastructure.</p>
      </body>
    </html>
  `

  const server = createServer((request, response) => {
    if (request.url === '/funding-call.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(html)
      return
    }

    response.writeHead(404)
    response.end('Not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind funding fixture server')
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/funding-call.html`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}

export type FundingFixtureServer = Awaited<ReturnType<typeof startFundingFixtureServer>>
