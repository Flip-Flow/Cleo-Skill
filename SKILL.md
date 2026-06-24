---
name: cleo
description: Cleo security analysis. Scan local source code for security issues (OWASP, injection, secrets, auth flaws), scan sites on localhost, decode JWTs, lint security headers, and map HAR auth flows. Invoked as /cleo <login|code|scan|har|jwt|headers|entitlements> [args]. JWT and header checks run locally and free; code/scan/har require a Cleo plan (Pro or higher). Use when the user wants to security-review code, scan a local app or domain, inspect a token, audit headers, or map a HAR flow.
argument-hint: <login|code|scan|har|jwt|headers|entitlements> [args]
---

# Cleo

Run the bundled CLI with the user's arguments and present the result clearly. The
user invokes this as `/cleo <subcommand> [args]`, e.g. `/cleo code ./src` or
`/cleo scan http://localhost:3000`.

Run exactly this (pass everything after `/cleo` through):

```bash
node "${CLAUDE_PLUGIN_ROOT}/cleo.mjs" $ARGUMENTS
```

Run it with a long Bash timeout (e.g. 600000 ms) - `code` and `scan` can take a
couple of minutes on larger inputs, and the default timeout may cut them off.

## Subcommands

| Command | Cost | What it does |
|---|---|---|
| `login` | free | Browser sign in to Cleo (opens a page, approve this computer with MFA). Run first. |
| `logout` | free | Sign out on this computer |
| `entitlements` | free | Show the plan, features, limits, usage |
| `code <path> [--all]` | gated (Pro+) | AI security review of local source (file or directory). A large repo is scoped to a cost-sane default; pass `--all` to audit everything (uses more of the daily budget). |
| `scan <target>` | gated (Pro+) | AI security scan of a URL/domain incl. `http://localhost:3000` |
| `har <file.har>` | gated (any plan) | Analyse a HAR capture |
| `jwt <token>` | local, free | Decode + check a JWT |
| `headers <url>` | local, free | Check security headers on a URL (incl. localhost) |

## Output

`code` and `scan` return JSON: `{ kind, grade A-F, score, summary, tips[], findings[{severity,title,detail,fix,line,cwe}], cached }`.

After running:
- For `code` / `scan`: lead with the **grade**, then the top **findings** (severity, title, fix), then the **tips**. Offer to apply the fixes to the user's files.
- `login` prints a URL + short code on stderr - surface them so the user can approve in the browser; it waits and confirms when connected.
- `[401]` or "Not signed in" -> tell the user to run `/cleo login`.
- `[402]` / `[429]` -> relay the message + upgrade URL; do not retry or work around it.

## Notes

- Code is analysed in memory and dropped server-side: only a SHA-256 hash + the
  report are stored. Re-scanning identical content returns a cached report at no cost.
- Only run `code` / `scan` / `har` against assets the user is authorized to test
  (their own code, localhost, their own domains). All plan enforcement is server-side.
