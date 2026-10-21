#!/usr/bin/env node
/**
 * Integrity checks for the catalogue release bundle.
 *
 *   node check.mjs bundle <bundle-dir>            every file matches SHA256SUMS,
 *                                                  and the snapshot its manifest
 *   node check.mjs code <bundle-dir> <app-dir>    the app checkout carries the
 *                                                  code and seed files this
 *                                                  bundle was built against
 *   node check.mjs pgurl <database-url>           the URL with only the query
 *                                                  parameters libpq accepts
 *                                                  (pg_dump / psql reject
 *                                                  Prisma's, e.g. ?schema=)
 *
 * Seed files are compared with line endings normalised: a Windows checkout
 * stores them CRLF, a Linux one LF, and both are the same data.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const [command, ...args] = process.argv.slice(2)

function sha256File(file, normalizeEol = false) {
  const hash = crypto.createHash('sha256')
  if (normalizeEol) {
    hash.update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    return hash.digest('hex')
  }
  const fd = fs.openSync(file, 'r')
  const buffer = Buffer.alloc(1 << 20)
  let read
  while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read))
  fs.closeSync(fd)
  return hash.digest('hex')
}

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exitCode = 1
}

if (command === 'bundle') {
  const [dir] = args
  const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').split(/\r?\n/).filter(Boolean)
  for (const line of sums) {
    const [expected, ...rest] = line.split(/\s+/)
    const name = rest.join(' ').replace(/^\*/, '')
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) fail(`missing ${name}`)
    else if (sha256File(file) !== expected) fail(`checksum mismatch: ${name}`)
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'bundle-manifest.json'), 'utf8'))
  const snapDir = path.join(dir, 'snapshot', manifest.snapshot)
  const snap = JSON.parse(fs.readFileSync(path.join(snapDir, 'manifest.json'), 'utf8'))
  for (const entry of snap.files) {
    if (sha256File(path.join(snapDir, entry.name)) !== entry.sha256) fail(`snapshot file ${entry.name} does not match its manifest`)
  }
  if (!process.exitCode) console.log(`bundle OK: ${sums.length} files; snapshot ${manifest.snapshot} (${snap.files.map((f) => `${f.name} ${f.lines}`).join(', ')})`)
} else if (command === 'code') {
  const [dir, appDir] = args
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'bundle-manifest.json'), 'utf8'))
  for (const [relative, expected] of Object.entries(manifest.codeFiles)) {
    const file = path.join(appDir, relative)
    if (!fs.existsSync(file)) fail(`app checkout lacks ${relative}`)
    else if (sha256File(file, true) !== expected) fail(`app checkout has a different ${relative} than this bundle was built with`)
  }
  for (const migration of manifest.migrations) {
    if (!fs.existsSync(path.join(appDir, 'prisma', 'migrations', migration, 'migration.sql'))) fail(`app checkout lacks migration ${migration}`)
  }
  if (!process.exitCode) console.log(`code OK: ${Object.keys(manifest.codeFiles).length} files and ${manifest.migrations.length} migrations match (built from ${manifest.gitCommit})`)
} else if (command === 'pgurl') {
  const keep = new Set(['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'application_name', 'connect_timeout', 'options', 'host', 'port'])
  const url = new URL(args[0])
  for (const key of [...url.searchParams.keys()]) if (!keep.has(key)) url.searchParams.delete(key)
  process.stdout.write(url.toString())
} else {
  console.error('usage: check.mjs bundle <dir> | code <dir> <app-dir> | pgurl <url>')
  process.exitCode = 64
}
