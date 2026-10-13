'use strict';
// INTERNAL private-pipe protocol. Never invoke this helper through chat/tool output.
const { createRequire } = require('node:module');
const path = require('node:path');

function loadExplicit(payload) {
  // Fresh subprocess per load; inherited environment is NOT a credential source.
  process.env = { NODE_ENV: 'development' };
  const appRequire = createRequire(path.join(payload.nextRoot, 'package.json'));
  const nextRequire = createRequire(appRequire.resolve('next/package.json'));
  const { processEnv } = nextRequire('@next/env');
  let failed = false;
  const logger = { error() { failed = true; }, info() {}, warn() {} };
  const [combined] = processEnv(payload.files, payload.nextRoot, logger, true);
  if (failed) throw new Error('private parse failed');
  const env = {};
  for (const key of payload.keys) {
    if (typeof combined[key] === 'string') env[key] = combined[key];
  }
  return { env, nextCLI: appRequire.resolve('next/dist/bin/next') };
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > 600000) {
      process.stderr.write('PRIVATE_ENV_PROTOCOL_REJECTED\n');
      process.exit(2);
    }
  });
  process.stdin.on('end', () => {
    try {
      // stdout is consumed privately by launcher.py, never relayed to a terminal.
      const output = loadExplicit(JSON.parse(input));
      process.stdout.write(JSON.stringify(output));
    } catch {
      process.stderr.write('PRIVATE_ENV_LOAD_FAILED\n');
      process.exitCode = 2;
    }
  });
}
module.exports = { loadExplicit };
