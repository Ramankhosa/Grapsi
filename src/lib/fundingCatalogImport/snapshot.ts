/**
 * Frozen, checksummed import inputs.
 *
 * The crawler keeps writing to its data directory, so an import never reads
 * it directly. `freezeSnapshot` copies the input files into a new directory
 * with a manifest (SHA-256, byte size, line count, time). A dry run and the
 * later --apply must reference the same snapshot, and `verifySnapshot`
 * refuses to proceed if any file changed since it was frozen — which is also
 * how the copy on the production server is checked after transfer.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

export interface SnapshotFileEntry {
  name: string
  sha256: string
  bytes: number
  lines: number
}

export interface SnapshotManifest {
  sourceKey: string
  takenAt: string
  sourceDir: string
  files: SnapshotFileEntry[]
}

export const MANIFEST_NAME = 'manifest.json'

async function describeFile(filePath: string): Promise<Omit<SnapshotFileEntry, 'name'>> {
  const hash = crypto.createHash('sha256')
  let bytes = 0
  let lines = 0
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      hash.update(buffer)
      bytes += buffer.length
      for (let i = 0; i < buffer.length; i++) if (buffer[i] === 10) lines++
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return { sha256: hash.digest('hex'), bytes, lines }
}

export async function freezeSnapshot(input: {
  sourceKey: string
  sourceDir: string
  files: string[]
  snapshotRoot: string
}): Promise<{ snapshotDir: string; manifest: SnapshotManifest }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotDir = path.join(input.snapshotRoot, `${input.sourceKey}-${stamp}`)
  fs.mkdirSync(snapshotDir, { recursive: true })
  const entries: SnapshotFileEntry[] = []
  for (const relative of input.files) {
    const source = path.join(input.sourceDir, relative)
    const target = path.join(snapshotDir, path.basename(relative))
    fs.copyFileSync(source, target)
    const sourceStats = await describeFile(source)
    const targetStats = await describeFile(target)
    if (sourceStats.sha256 !== targetStats.sha256) {
      // The crawler wrote to the file while it was being copied.
      throw new Error(`${relative} changed while it was being copied; stop the writer or retry.`)
    }
    entries.push({ name: path.basename(relative), ...targetStats })
  }
  const manifest: SnapshotManifest = {
    sourceKey: input.sourceKey,
    takenAt: new Date().toISOString(),
    sourceDir: input.sourceDir,
    files: entries,
  }
  fs.writeFileSync(path.join(snapshotDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2))
  return { snapshotDir, manifest }
}

export async function verifySnapshot(snapshotDir: string): Promise<SnapshotManifest> {
  const manifestPath = path.join(snapshotDir, MANIFEST_NAME)
  if (!fs.existsSync(manifestPath)) throw new Error(`No ${MANIFEST_NAME} in ${snapshotDir}; freeze a snapshot first.`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SnapshotManifest
  for (const entry of manifest.files) {
    const actual = await describeFile(path.join(snapshotDir, entry.name))
    if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) {
      throw new Error(`Snapshot file ${entry.name} does not match its manifest checksum; refusing to import.`)
    }
  }
  return manifest
}

export async function* readJsonLines<T = Record<string, unknown>>(filePath: string): AsyncGenerator<T> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    yield JSON.parse(trimmed) as T
  }
}
