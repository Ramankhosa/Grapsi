#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const nextDir = path.join(process.cwd(), '.next');

try {
  if (fs.existsSync(nextDir)) {
    fs.rmSync(nextDir, { recursive: true, force: true });
    // eslint-disable-next-line no-console
    console.log('Removed .next to ensure a clean build.');
  }
} catch (error) {
  // eslint-disable-next-line no-console
  console.warn('Warning: failed to remove .next. Continuing build anyway.');
  // eslint-disable-next-line no-console
  console.warn(error);
}

