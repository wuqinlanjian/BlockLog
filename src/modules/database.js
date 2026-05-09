// modules/database.js
let session = null;
const crypto = require("crypto");

function initDatabase() {
    if (!File.exists("plugins/BlockLog")) File.mkdir("plugins/BlockLog");
    session = new DBSession("sqlite", { path: "plugins/BlockLog/blocklog.db" });
    if (!session) {
        logger.error("BlockLog: 数据库打开失败！");
        return;
    }
    try {
        session.exec(`
            CREATE TABLE IF NOT EXISTS operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation_type TEXT NOT NULL,
                player_xuid TEXT,
                player_name TEXT,
                player_pos_x REAL,
                player_pos_y REAL,
                player_pos_z REAL,
                player_dimid INTEGER,
                block_pos_x INTEGER,
                block_pos_y INTEGER,
                block_pos_z INTEGER,
                block_dimid INTEGER,
                old_data TEXT,
                new_data TEXT,
                container_slot INTEGER,
                timestamp TEXT NOT NULL,
                extra TEXT
            );
        `);
        session.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL
            );
        `);
        session.exec(`
            CREATE TABLE IF NOT EXISTS tokens (
                token TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                used INTEGER DEFAULT 0,
                created_by TEXT,
                created_at TEXT NOT NULL
            );
        `);
        session.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                sess TEXT NOT NULL,
                expired TEXT NOT NULL
            );
        `);
        logger.info("BlockLog 数据库初始化完成");
    } catch (e) {
        logger.error("数据库初始化失败: " + e);
        session.close();
        session = null;
    }
}


function insertOperation(data) {
    if (!session) {
        logger.warn("BlockLog: 数据库未初始化，无法记录操作");
        return;
    }
    try {
        const sql = `INSERT INTO operations 
            (operation_type, player_xuid, player_name, player_pos_x, player_pos_y, player_pos_z, player_dimid,
             block_pos_x, block_pos_y, block_pos_z, block_dimid,
             old_data, new_data, container_slot, timestamp, extra)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        session.exec(sql, [
            data.type,
            data.xuid || "",
            data.name || "",
            data.playerPos?.x ?? null,
            data.playerPos?.y ?? null,
            data.playerPos?.z ?? null,
            data.playerPos?.dimid ?? null,
            data.blockPos?.x ?? null,
            data.blockPos?.y ?? null,
            data.blockPos?.z ?? null,
            data.blockPos?.dimid ?? null,
            data.oldData || "",
            data.newData || "",
            data.slot ?? null,
            data.time || system.getTimeStr(),
            data.extra || ""
        ]);
    } catch (e) {
        logger.error("插入操作失败: " + e);
    }
}

function queryOperations(minX, minY, minZ, maxX, maxY, maxZ, dimid, limit = null) {
    if (!session) return [];
    try {
        let sql = `SELECT * FROM operations
            WHERE block_dimid = ?
              AND block_pos_x BETWEEN ? AND ?
              AND block_pos_y BETWEEN ? AND ?
              AND block_pos_z BETWEEN ? AND ?
            ORDER BY id DESC`;
        const params = [dimid, minX, maxX, minY, maxY, minZ, maxZ];
        if (limit) {
            sql += " LIMIT ?";
            params.push(limit);
        }
        const result = session.query(sql, params);
        if (!result || result.length <= 1) return [];
        return result.slice(1);
    } catch (e) {
        logger.error("查询操作失败: " + e);
        return [];
    }
}

function queryOperationsByTime(minX, minY, minZ, maxX, maxY, maxZ, dimid, timeFrom, timeTo = null, limit = null) {
    if (!session) return [];
    try {
        let sql = `SELECT * FROM operations
            WHERE block_dimid = ?
              AND block_pos_x BETWEEN ? AND ?
              AND block_pos_y BETWEEN ? AND ?
              AND block_pos_z BETWEEN ? AND ?
              AND timestamp >= ?`;
        const params = [dimid, minX, maxX, minY, maxY, minZ, maxZ, timeFrom];
        if (timeTo) {
            sql += " AND timestamp <= ?";
            params.push(timeTo);
        }
        sql += " ORDER BY id DESC";
        if (limit) {
            sql += " LIMIT ?";
            params.push(limit);
        }
        const result = session.query(sql, params);
        if (!result || result.length <= 1) return [];
        return result.slice(1);
    } catch (e) {
        logger.error("按时间查询操作失败: " + e);
        return [];
    }
}


function getUser(username) {
    if (!session) return null;
    try {
        const rows = session.query("SELECT * FROM users WHERE username = ?", [username]);
        if (!rows || rows.length <= 1) return null;
        const r = rows[1];
        return { id: r[0], username: r[1], password_hash: r[2], role: r[3], created_at: r[4] };
    } catch (e) {
        logger.error("获取用户失败: " + e);
        return null;
    }
}

function createUser(username, passwordHash, role) {
    if (!session) return;
    try {
        session.exec("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)", 
            [username, passwordHash, role, system.getTimeStr()]);
    } catch (e) {
        logger.error("创建用户失败: " + e);
    }
}

function deleteUser(username) {
    if (!session) return;
    try {
        session.exec("DELETE FROM users WHERE username = ?", [username]);
    } catch (e) {
        logger.error("删除用户失败: " + e);
    }
}

function getAllUsers() {
    if (!session) return [];
    try {
        const rows = session.query("SELECT id, username, role, created_at FROM users ORDER BY id");
        if (!rows || rows.length <= 1) return [];
        return rows.slice(1).map(r => ({
            id: r[0], username: r[1], role: r[2], created_at: r[3]
        }));
    } catch (e) {
        logger.error("获取用户列表失败: " + e);
        return [];
    }
}

function updatePassword(username, newHash) {
    if (!session) return;
    try {
        session.exec("UPDATE users SET password_hash = ? WHERE username = ?", [newHash, username]);
    } catch (e) {
        logger.error("更新密码失败: " + e);
    }
}


function getToken(token) {
    if (!session) return null;
    try {
        const rows = session.query("SELECT * FROM tokens WHERE token = ?", [token]);
        if (!rows || rows.length <= 1) return null;
        const r = rows[1];
        return { token: r[0], role: r[1], used: r[2], created_by: r[3], created_at: r[4] };
    } catch (e) {
        logger.error("获取Token失败: " + e);
        return null;
    }
}

function insertToken(token, role, creator) {
    if (!session) return;
    try {
        session.exec("INSERT INTO tokens (token, role, used, created_by, created_at) VALUES (?, ?, 0, ?, ?)",
            [token, role, creator, system.getTimeStr()]);
    } catch (e) {
        logger.error("插入Token失败: " + e);
    }
}

function markTokenUsed(token) {
    if (!session) return;
    try {
        session.exec("UPDATE tokens SET used = 1 WHERE token = ?", [token]);
    } catch (e) {
        logger.error("标记Token失败: " + e);
    }
}

function deleteToken(token) {
    if (!session) return;
    try {
        session.exec("DELETE FROM tokens WHERE token = ?", [token]);
    } catch (e) {
        logger.error("删除Token失败: " + e);
    }
}

function getAllTokens() {
    if (!session) return [];
    try {
        const rows = session.query("SELECT token, role, used, created_by, created_at FROM tokens ORDER BY created_at DESC");
        if (!rows || rows.length <= 1) return [];
        return rows.slice(1).map(r => ({
            token: r[0], role: r[1], used: r[2], created_by: r[3], created_at: r[4]
        }));
    } catch (e) {
        logger.error("获取Token列表失败: " + e);
        return [];
    }
}


function createInitialSuperToken() {
    if (!session) {
        logger.error("数据库未初始化，无法生成初始 Token");
        return;
    }
    try {
        const result = session.query("SELECT COUNT(*) AS cnt FROM tokens WHERE used = 0");
        let cnt = 0;
        if (result && result.length > 1 && result[1].length > 0) {
            cnt = result[1][0];
        }
        if (cnt > 0) return;

        const token = crypto.randomBytes(16).toString("hex");
        insertToken(token, "superadmin", "System");

        const tokenFile = "plugins/BlockLog/initial_token.txt";
        File.writeTo(tokenFile, token);
        logger.warn("首次启动已生成超级管理员 Token，请查看 plugins/BlockLog/initial_token.txt 文件，使用后文件将被自动删除。");
    } catch (e) {
        logger.error("生成初始Token失败: " + e);
    }
}


function getContainerSnapshot(x, y, z, dimid, beforeTime) {
    if (!session) return {};
    try {
        const sql = `
            SELECT container_slot, old_data, id
            FROM operations
            WHERE operation_type = 'container_change'
              AND block_pos_x = ?
              AND block_pos_y = ?
              AND block_pos_z = ?
              AND block_dimid = ?
              AND timestamp < ?
            ORDER BY id DESC
        `;
        const rows = session.query(sql, [x, y, z, dimid, beforeTime]);
        if (!rows || rows.length <= 1) return {};

        const snapshot = {};
        const seenSlots = new Set();
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const slot = r[0];
            if (seenSlots.has(slot)) continue;
            seenSlots.add(slot);
            snapshot[slot] = r[1]; 
        }
        return snapshot;
    } catch (e) {
        logger.error("获取容器快照失败: " + e);
        return {};
    }
}

function closeDatabase() {
    if (session) {
        session.close();
        session = null;
    }
}

module.exports = {
    initDatabase,
    insertOperation,
    queryOperations,
    queryOperationsByTime,
    getUser,
    createUser,
    deleteUser,
    getAllUsers,
    getToken,
    insertToken,
    markTokenUsed,
    deleteToken,
    getAllTokens,
    updatePassword,
    createInitialSuperToken,
    getSession: () => session,
    closeDatabase,
    getContainerSnapshot
};