#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadDatabaseUrlFromRepoEnv() {
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(process.cwd(), filename);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const parsed = dotenv.parse(fs.readFileSync(envPath));
    if (parsed.DATABASE_URL) {
      process.env.DATABASE_URL = parsed.DATABASE_URL;
    }
  }
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
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
