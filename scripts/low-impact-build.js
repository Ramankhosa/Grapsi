#!/usr/bin/env node

const { spawnSync } = require('child_process');
const os = require('os');

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(checker, args, {
    shell: process.platform !== 'win32',
    stdio: 'ignore',
  });
  return result.status === 0;
}

function setLowPriority() {
  try {
    os.setPriority(process.pid, 15);
  } catch {
    // Best effort only. Some hosts disallow changing process priority.
  }
}

const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || '1',
  NEXT_BUILD_MAX_OLD_SPACE_SIZE: process.env.NEXT_BUILD_MAX_OLD_SPACE_SIZE || '3072',
};

setLowPriority();

let command = 'node';
let args = ['scripts/run-local-command.js', 'next', 'build'];

if (process.platform !== 'win32' && commandExists('ionice')) {
  command = 'ionice';
  args = ['-c2', '-n7', 'node', 'scripts/run-local-command.js', 'next', 'build'];
}

const result = spawnSync(command, args, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
