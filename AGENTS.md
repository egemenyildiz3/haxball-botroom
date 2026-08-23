# Haxball Botroom Working Guide

This repo runs a persistent Haxball headless room with account storage, automated
team management, moderation tools, and in-memory bot players.

## Ground Rules

- Keep behavior changes separate from structural refactors when possible.
- Preserve `createRoom(room, deps)` and `handlePlayerChat(room, player, msg, deps)`
  as stable integration points unless you are deliberately changing the room API.
- Prefer small modules with clear ownership over growing `room.js` or
  `commands.js` again.
- Run `node --check` on edited JavaScript files before restarting the container.
- Do not reset or discard local changes unless the owner explicitly asks.

## Main Entry Points

- `scripts/index.js`: process startup, env config, database initialization,
  node-haxball host creation, bot manager creation.
- `scripts/room.js`: room event coordinator. This should stay thin.
- `scripts/commands.js`: compatibility facade for command/chat exports.
- `scripts/bot/manager.js`: fake bot player lifecycle and tick integration.
- `scripts/bot/brain.js`: pure bot decision logic.

## Room Modules

- `scripts/room/state.js`: mutable runtime state for one room instance.
- `scripts/room/playerIdentity.js`: player sanitization, auth cache lookup,
  join tags.
- `scripts/room/terminal.js`: stdin command/chat handling.
- `scripts/room/spacebounceSafety.js`: Spacebounce map-specific ball repair.
- `scripts/room/moderationGuards.js`: native kick/admin/team-change protection.
- `scripts/room/autoManager.js`: automatic-management mode.
- `scripts/room/teamBalancer.js`: team assignment and bot-aware balancing.
- `scripts/room/matchManager.js`: match start, goals, score save, rotation.

## Command Modules

- `scripts/commands/router.js`: chat formatting, chat filter, command routing.
- `scripts/commands/accountCommands.js`: login, register, stats, auto-login.
- `scripts/commands/adminCommands.js`: ban, kick, blacklist, clear bans, admin
  password.
- `scripts/commands/playerCommands.js`: player list, AFK, help.
- `scripts/commands/botCommands.js`: bot add/remove/status.
- `scripts/commands/autoCommands.js`: automatic-management commands.
- `scripts/commands/helpers.js`: shared command helpers.

## Permissions

Player-facing roles are `Admin` and `Kurucu` (`isadmin = 1` in the `users`
table). Native Haxball `player.admin` means regular Admin-level room authority;
Kurucu-only commands must check the router context's `isSuperAdmin` flag.

Terminal/stdin commands run through `scripts/room/terminal.js` as the synthetic
`Host-admin` player (`id = 0`). That player is treated as Kurucu only for that
command context by injecting a transient `loggedInPlayers` entry; do not create a
real database user for `Host-admin`.

## Bot And Team Policy

The room auto-starts bots with `HAXBALL_BOT_AUTOSTART` and caps them with
`HAXBALL_BOT_MAX`.

Team balancing should always prefer real players:

- 8 real players: 8 humans, 0 active bots.
- 7 real players: 7 humans, 1 active bot.
- 6 real players: 6 humans, 2 active bots.
- 5 real players: 5 humans, 3 active bots when available.

Bots are fillers, not owners of team slots. If humans join, extra bots should be
moved to spectators before humans are displaced.

`!bot kapat` removes one bot, starting from the latest active bot. Use
`!bot hepsi` to remove all bots.

Bot identities are protected. Anything with the fake bot auth/conn signature
(`bot-auth-*` / `bot-conn-*`) must be exempt from blacklist joins and ban flows,
even if those values accidentally appear in the database.

## Verification

Minimum checks after JavaScript edits:

```bash
node --check scripts/index.js
node --check scripts/room.js
for f in scripts/room/*.js scripts/commands/*.js scripts/bot/*.js; do node --check "$f"; done
```

Useful smoke checks:

- Start the room and confirm three bots join automatically.
- Join as 6, 7, and 8 real players and confirm bot slots shrink to 2, 1, and 0.
- Confirm `!bot kapat` removes one bot and `!bot hepsi` removes all.
- Confirm admin/superadmin chat filter exemption still works.
- Confirm `/` and `!` commands are not rate-limited or profanity-filtered.

## Restart

After changing runtime code, rebuild/restart the service with the repo's existing
deployment flow, usually:

```bash
make rebuild
```
