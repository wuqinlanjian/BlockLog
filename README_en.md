# BlockLog - Block Operation Logger & Rollback Plugin for Minecraft Bedrock

## Overview

BlockLog is a plugin for Minecraft Bedrock Dedicated Server (BDS) based on [Levilamina](https://github.com/LiteLDev/Levilamina). It records player actions including block placement, destruction, container interactions, explosions, liquid reactions, etc. You can query the logs with rich filters and perform rollback or restore operations directly in‑game or via a built‑in web admin panel.

## Features

- **Comprehensive logging**: 8 event types (place, destroy, explode, container_change, inventory_change, pickup, drop, liquid_react).
- **Powerful query system**: Filter by player, time range, radius, action type, included/excluded block names.
- **Visual rollback**: Undo/redo operations from chat or web UI, including full container content restoration.
- **Role‑based access**: Superadmin, admin, and regular user roles, managed through token‑based registration.
- **Web dashboard**: Monitor server stats, view logs, manage users and registration tokens.
- **Performance friendly**: SQLite storage, default search radius of 10 blocks (limit adjustable for non‑OP players).

## Requirements

- Levilamina 1.0.0 or above
- Built‑in Node.js environment (comes with Levilamina)
- npm packages (install via `lip` or manually):
  - express
  - express-session
  - bcryptjs

## Installation

1. Place the `BlockLog` folder inside your BDS `plugins/` directory.
2. Navigate to the plugin folder and install dependencies:
   ```bash
   lip install express express-session bcryptjs
   ```
3. Start the server. The plugin will create the SQLite database and default configuration automatically.
4. **On first run**, a superadmin token is saved in `plugins/BlockLog/initial_token.txt`. Use it to register your first admin account on the web panel.

## Configuration

`config.json` (auto‑generated):

```json
{
  "webPort": 3000,
  "allowRecord": true,
  "maxLogLines": 1000,
  "sessionSecret": "auto‑generated random string"
}
```

- **webPort**: HTTP port for the web dashboard.
- **allowRecord**: Enable/disable event recording (can be toggled in‑game with `/bl consumer`).
- **maxLogLines**: Maximum number of log lines returned by the API.
- **sessionSecret**: Session encryption key; do not share.

## Commands

All commands start with `/blocklog` or `/bl`. Most require a player executor.

| Command                                 | Description                       |
| --------------------------------------- | --------------------------------- |
| `/bl help`                              | Show help                         |
| `/bl inspect` (or `i`)                  | Toggle inspect mode               |
| `/bl lookup` (or `l`) [args]            | Query logs                        |
| `/bl rollback` (or `rb`) [args]         | Rollback operations (OP required) |
| `/bl restore` (or `rs`) [args]          | Restore operations (OP required)  |
| `/bl purge t:<time> [#vacuum]`          | Purge old data (OP required)      |
| `/bl reload`                            | Reload config (OP required)       |
| `/bl status`                            | Show plugin status                |
| `/bl consumer [on/off]`                 | Start/stop event recording (OP)   |

**Query arguments** (for `lookup`, `rollback`, `restore`):

- `u:<player>`        - Filter by player name
- `t:<time>`          - Time range, e.g. `t:30m`, `t:2h`, `t:1h-30m`
- `r:<radius|#global>`- Coordinate radius, e.g. `r:20` or `r:#global`
- `a:<action>`        - Action group: `+block`, `-block`, `container`, etc.
- `i:<block>`         - Include block/item name (partial match)
- `e:<block>`         - Exclude block/item name
- `#preview`          - Show record count only
- `#count`            - Display total count

**Examples**:
- View Steve's block placements within 20 blocks in the last hour:  
  `/bl l u:Steve t:1h r:20 a:+block`
- Rollback TNT explosions globally:  
  `/bl rb r:#global a:-block i:tnt`

## Web Admin Panel

Access `http://<server-ip>:3000` (or your configured port) after plugin startup.

### Getting started

1. Log in using the superadmin token from `initial_token.txt`.
2. Generate registration tokens for different roles in “Token Management”.
3. Users register accounts via those tokens, then log in with username/password.

### Pages

- **Dashboard**: Online players, today's operations count, etc.
- **Operations Log**: Real‑time log feed, filter and rollback individual entries.
- **User Management**: (Superadmin only) view and delete users.
- **Token Management**: Create/delete registration tokens.

## API Reference

The dashboard uses a REST API that you may also call directly. All endpoints require session authentication.

- `POST /api/login`
- `POST /api/login-token`
- `POST /api/register`
- `GET /api/operations`
- `POST /api/rollback`
- `GET /api/users` (superadmin)
- `GET /api/tokens` (superadmin)
- `POST /api/tokens` (superadmin)
- `DELETE /api/tokens/:token` (superadmin)
- `GET /api/stats`

See `src/web.js` for full route details.

## Permissions

| Role       | In‑game commands        | Web panel access                          |
| ---------- | ----------------------- | ----------------------------------------- |
| User       | Query (radius limited)  | View logs, change own password            |
| Admin      | Rollback, purge, toggle | Perform rollbacks, view logs              |
| Superadmin | Same as admin           | User management, token management, config |

## License

MIT License. See the `LICENSE` file for details.

## Credits

- Levilamina team
- Inspired by CoreProtect (Bukkit plugin)

---

**Important**: This plugin is for Minecraft Bedrock Edition only. Always test rollback functionality on a staging server before using it in production to avoid accidental data loss.
