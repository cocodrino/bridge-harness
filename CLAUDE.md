# bridge-harness — Project Instructions

## Versioning (MANDATORY)

- **Before every commit**, bump the `version` field in **both** `package.json` files:
  - `package.json` — main package `@cocodrino/bridge-harness`
  - `packages/bridge-harness-pi/package.json` — `@cocodrino/bridge-harness-pi`
- **Both versions MUST always match.** The two packages are released in lockstep —
  never commit with stale or mismatched versions.
- Bump the patch level by default during `0.x`.

## Build & publish

- The Claude Code side runs from the local repo `dist/` (see `~/.claude.json`), so run
  `npm run build` after any change under `src/` (MCP server / shared) before committing.
- The Pi extension ships `src/` directly (no build needed to publish), but run
  `tsc --noEmit` in `packages/bridge-harness-pi/` to typecheck.
- `npm publish` requires a 2FA OTP.

## Architecture notes

- `project` = the NATS namespace, derived from the git worktree root (or `BRIDGE_PROJECT`).
  Everything keys off it: subjects, registry, presence, and the default lobby room.
- Both agents auto-join the room named after the project. `use_bridge` switches the
  namespace at runtime.
- Running MCP/extension processes hold code in memory — rebuilding `dist/` or
  republishing only affects **newly started** processes. Restart sessions to pick up changes.
