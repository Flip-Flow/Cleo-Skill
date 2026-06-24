#!/usr/bin/env node
/*
 * Copyright 2026 FlipFlow. All rights reserved.
 *
 * SessionStart hook: if the Cleo CLI is not signed in on this computer, prompt
 * the user to connect. No-op once a token exists, so it only nudges until login.
 * Runs right after install (first session) and on each new session thereafter.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let signedIn = false;
try {
  const cfg = JSON.parse(readFileSync(join(homedir(), '.cleo', 'config.json'), 'utf8'));
  signedIn = Boolean(cfg.token || cfg.key);
} catch { /* no config yet = not signed in */ }

if (!signedIn) {
  console.log(JSON.stringify({
    systemMessage: 'Cleo is installed but not signed in. Run /cleo login to connect this computer (opens your browser), then use /cleo code, /cleo scan, /cleo har.',
  }));
}
process.exit(0);
