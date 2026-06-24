<p align="center">
  <img src="https://toyvcftguxhdayggitpf.supabase.co/storage/v1/object/public/brand/cleo-skill-banner.png" alt="Cleo - Capture the flow. Read the evidence. Ship the fix." width="100%" />
</p>

<h1 align="center">Cleo Security Skill</h1>

<p align="center">
  Scan local code and localhost apps for security issues, decode JWTs, lint headers, and map HAR auth flows - right from Claude.
</p>

<p align="center">
  <a href="https://cleo.flipflow.app">cleo.flipflow.app</a>
</p>

Security analysis from the command line and from Claude. Scan local source code
for security issues, analyze and scan sites running on `localhost`, decode JWTs,
lint security headers, and map HAR auth flows.

Built for [Claude Code](https://claude.com/claude-code) (works as an Agent Skill),
but the `cleo` CLI runs standalone too.

- **Local + free:** `jwt`, `headers` (run on your machine, nothing uploaded)
- **Gated (needs a Cleo plan):** `code`, `scan`, `har` (analysis runs on Cleo)

Your code is analyzed in memory and dropped: only a SHA-256 hash and the report
are stored. Re-scanning identical content returns a cached report at no cost.

## Requirements

- Node.js 18+ (`node --version`)
- A Cleo account: https://cleo.flipflow.app (free to start)

No API key to copy: you sign in through the browser with `/cleo login`.

## Install

### Claude Code (recommended)

```
/plugin marketplace add https://github.com/Flip-Flow/Cleo-Skill.git
/plugin install cleo
```

> Use the full HTTPS URL above. The short `Flip-Flow/Cleo-Skill` form clones over
> SSH and fails if GitHub is not in your `known_hosts`.

Then sign in (opens the browser, approve with your MFA):

```
/cleo login
```

That is it. Now use `/cleo code ./src`, `/cleo scan http://localhost:3000`, etc.

### Claude.ai (Pro / Max / Team / Enterprise)

Download this repo as a ZIP and upload it in **Settings > Capabilities > Skills**,
then ask Claude to run `cleo login`.

### Standalone CLI

```bash
git clone https://github.com/Flip-Flow/Cleo-Skill
cd Cleo-Skill
node cleo.mjs login
node cleo.mjs --help
```

## Commands

Type these in Claude as `/cleo <command>` (or `node cleo.mjs <command>` standalone):

| Command | Cost | What it does |
|---|---|---|
| `login` / `logout` | free | Browser sign in / sign out on this computer |
| `entitlements` | free | Show your plan, features, limits, and usage |
| `code <path>` | gated (Pro+) | AI security review of local source (file or directory): OWASP issues, injection, secrets, auth flaws |
| `scan <target>` | gated (Pro+) | AI security scan of a URL/domain, including `http://localhost:3000` |
| `har <file.har>` | gated (any plan) | Upload a local HAR; returns redirect chain, cookies, tokens, third parties |
| `jwt <token>` | local, free | Decode header + payload, flag `alg=none`, expiry, missing claims |
| `headers <url>` | local, free | Fetch a URL (incl. localhost) and list missing security headers |

```
/cleo login
/cleo code ./src                  # scan a directory
/cleo code ./auth.ts              # or a single file
/cleo scan http://localhost:3000  # scan a local app
/cleo har ./capture.har
/cleo jwt eyJhbGciOi...
/cleo headers http://localhost:3000
```

Your sign-in is a 90-day token stored at `~/.cleo/config.json` (mode 600), bound
to this computer. Manage or revoke connected devices in
**cleo.flipflow.app > Settings**.

For `code <dir>`, the CLI collects source locally and skips `node_modules`,
`.git`, build output, lock files, `*.min.js`, `*.map`, and `.env*`. Single files
are capped per plan (Pro 1 MB, Max 5 MB, Enterprise 10 MB). For `scan` of a
localhost / private address, the CLI probes it locally and uploads the capture
(the Cleo server cannot reach private hosts); public domains are scanned by Cleo.

## Output

`code` and `scan` return a machine-readable object for the agent to act on:

```json
{
  "kind": "code",
  "grade": "B",
  "score": 78,
  "summary": "...",
  "tips": ["harden this", "..."],
  "findings": [
    { "severity": "high", "title": "...", "detail": "...", "fix": "...", "line": 42, "cwe": "CWE-89" }
  ],
  "cached": false
}
```

## Plans

| Plan | code / scan | Depth | Single-file limit |
|---|---|---|---|
| Free | local tools only (`jwt`, `headers`) | - | - |
| Pro | yes | standard | 1 MB |
| Max | yes | deep | 5 MB |
| Enterprise | yes | deep | 10 MB |

Upgrade at https://cleo.flipflow.app/pricing

## Configuration

| Setting | How |
|---|---|
| Sign in | `cleo login` (browser) -> token in `~/.cleo/config.json` |
| API key (CI / non-interactive) | `cleo auth <key>` fallback |
| API host | `cleo login --api <url>`, or `CLEO_API` env var |

## License

Proprietary. Copyright 2026 FlipFlow. The CLI is a thin client; all analysis and
plan enforcement happen server-side.
