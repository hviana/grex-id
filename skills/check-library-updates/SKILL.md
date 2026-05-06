---
name: check-library-updates
description: Use whenever the user asks to check for outdated dependencies, update libraries, bump package versions, see what's out of date in package.json, or audit npm packages for newer releases. Trigger on phrases like "check for updates", "are my packages outdated", "update my dependencies", "any new versions", or "bump libraries". This skill reads package.json, reports what can be upgraded, and — only with the user's explicit approval — runs the upgrade.
---

# Check Library Updates

A minimal workflow for suggesting and applying dependency updates in an npm
project.

## Workflow

1. **Read `package.json`** at the project root to see the declared dependencies
   and `devDependencies`. If there is no `package.json`, stop and tell the user.

2. **Check for outdated packages** by running:
   ```bash
   npm outdated --json
   ```
   This returns each package with its `current`, `wanted`, and `latest`
   versions. An empty output means everything is up to date — report that and
   stop.

3. **Present the results** as a simple table with columns: package, current,
   latest, and type of bump (patch / minor / major based on semver). Group major
   bumps at the bottom and flag them as potentially breaking.

4. **Ask the user which updates to apply.** Offer three options:
   - All safe updates (patch + minor)
   - Everything including majors
   - A specific subset they name

   Do NOT proceed without an explicit answer.

5. **Apply the chosen updates** by running `npm install <pkg>@<version>` for
   each selected package, then run `npm install` once at the end to refresh the
   lockfile. Report what was updated.

## Rules

- Never update without explicit user confirmation.
- Never suggest pre-release, beta, or RC versions.
- If `npm outdated` or `npm install` fails, show the error verbatim and stop —
  do not try to "fix" it.
