#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function readEnvFile(envPath) {
  const buffer = fs.readFileSync(envPath);

  if (buffer.length >= 2) {
    const bom0 = buffer[0];
    const bom1 = buffer[1];

    if (bom0 === 0xff && bom1 === 0xfe) {
      return buffer.toString('utf16le');
    }

    if (bom0 === 0xfe && bom1 === 0xff) {
      const swapped = Buffer.from(buffer);
      for (let index = 0; index + 1 < swapped.length; index += 2) {
        const first = swapped[index];
        swapped[index] = swapped[index + 1];
        swapped[index + 1] = first;
      }
      return swapped.toString('utf16le');
    }
  }

  return buffer.toString('utf8');
}

function loadDatabaseUrlFromRepoEnv() {
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(process.cwd(), filename);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const parsed = dotenv.parse(readEnvFile(envPath));
    if (parsed.DATABASE_URL) {
      process.env.DATABASE_URL = parsed.DATABASE_URL;
    }
  }
}

function withNextBuildHeapLimit(env, command, args) {
  if (command !== 'next' || args[0] !== 'build') {
    return env;
  }

  const nodeOptions = env.NODE_OPTIONS || '';
  if (/--max[-_]old[-_]space[-_]size(?:=|\s+)/.test(nodeOptions)) {
    return env;
  }

  const requestedMb = Number.parseInt(env.NEXT_BUILD_MAX_OLD_SPACE_SIZE || '', 10);
  const heapMb = Number.isFinite(requestedMb) && requestedMb > 0 ? requestedMb : 4096;

  return {
    ...env,
    NODE_OPTIONS: `${nodeOptions} --max-old-space-size=${heapMb}`.trim(),
  };
}

const [, , command, ...args] = process.argv;

if (!command) {
  console.error('Usage: node scripts/run-local-command.js <command> [args...]');
  process.exit(1);
}

loadDatabaseUrlFromRepoEnv();

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: withNextBuildHeapLimit(process.env, command, args),
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
