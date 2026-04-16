declare module 'pdf-parse-fork' {
  export interface PdfParseResult {
    text: string
    numpages?: number
    numrender?: number
    info?: Record<string, unknown>
    metadata?: Record<string, unknown>
    version?: string
  }

  export default function pdfParse(buffer: Buffer): Promise<PdfParseResult>
}
