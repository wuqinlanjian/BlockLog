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
        // 操作记录表
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
        // 用户表
        session.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL
            );
        `);
        // Token表
        session.exec(`
            CREATE TABLE IF NOT EXISTS tokens (
                token TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                used INTEGER DEFAULT 0,
                created_by TEXT,
                created_at TEXT NOT NULL
            );
        `);
        // Sessions表
        session.exec("DROP TABLE IF EXISTS sessions");
        session.exec(`
            CREATE TABLE sessions (
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

// 安全转义字符串（单引号替换为两个单引号）
function esc(str) {
    if (typeof str !== "string") return str;
    return str.replace(/'/g, "''");
}

// 插入操作记录
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
            VALUES (
                '${esc(data.type)}',
                '${esc(data.xuid || "")}',
                '${esc(data.name || "")}',
                ${data.playerPos?.x ?? null},
                ${data.playerPos?.y ?? null},
                ${data.playerPos?.z ?? null},
                ${data.playerPos?.dimid ?? null},
                ${data.blockPos?.x ?? null},
                ${data.blockPos?.y ?? null},
                ${data.blockPos?.z ?? null},
                ${data.blockPos?.dimid ?? null},
                '${esc(data.oldData || "")}',
                '${esc(data.newData || "")}',
                ${data.slot ?? null},
                '${esc(data.time || system.getTimeStr())}',
                '${esc(data.extra || "")}'
            )`;
        session.exec(sql);
    } catch (e) {
        logger.error("插入操作失败: " + e);
    }
}

// 查询操作记录（不带时间筛选）
function queryOperations(minX, minY, minZ, maxX, maxY, maxZ, dimid, limit = null) {
    if (!session) return [];
    try {
        let sql = `SELECT * FROM operations
            WHERE block_dimid = ${dimid}
              AND block_pos_x BETWEEN ${minX} AND ${maxX}
              AND block_pos_y BETWEEN ${minY} AND ${maxY}
              AND block_pos_z BETWEEN ${minZ} AND ${maxZ}
            ORDER BY id DESC`;
        if (limit) sql += ` LIMIT ${limit}`;
        const result = session.query(sql);
        if (!result || result.length <= 1) return [];
        return result.slice(1);
    } catch (e) {
        logger.error("查询操作失败: " + e);
        return [];
    }
}

// 按时间查询操作记录
function queryOperationsByTime(minX, minY, minZ, maxX, maxY, maxZ, dimid, timeFrom, timeTo = null, limit = null) {
    if (!session) return [];
    try {
        let sql = `SELECT * FROM operations
            WHERE block_dimid = ${dimid}
              AND block_pos_x BETWEEN ${minX} AND ${maxX}
              AND block_pos_y BETWEEN ${minY} AND ${maxY}
              AND block_pos_z BETWEEN ${minZ} AND ${maxZ}
              AND timestamp >= '${esc(timeFrom)}'`;
        if (timeTo) sql += ` AND timestamp <= '${esc(timeTo)}'`;
        sql += ` ORDER BY id DESC`;
        if (limit) sql += ` LIMIT ${limit}`;
        const result = session.query(sql);
        if (!result || result.length <= 1) return [];
        return result.slice(1);
    } catch (e) {
        logger.error("按时间查询操作失败: " + e);
        return [];
    }
}

// ================= 用户管理 =================
function getUser(username) {
    if (!session) return null;
    try {
        const rows = session.query(`SELECT * FROM users WHERE username = '${esc(username)}'`);
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
        session.exec(`INSERT INTO users (username, password_hash, role, created_at) 
            VALUES ('${esc(username)}', '${esc(passwordHash)}', '${esc(role)}', '${esc(system.getTimeStr())}')`);
    } catch (e) {
        logger.error("创建用户失败: " + e);
    }
}

function deleteUser(username) {
    if (!session) return;
    try {
        session.exec(`DELETE FROM users WHERE username = '${esc(username)}'`);
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
        session.exec(`UPDATE users SET password_hash = '${esc(newHash)}' WHERE username = '${esc(username)}'`);
    } catch (e) {
        logger.error("更新密码失败: " + e);
    }
}

// ================= Token 管理 =================
function getToken(token) {
    if (!session) return null;
    try {
        const rows = session.query(`SELECT * FROM tokens WHERE token = '${esc(token)}'`);
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
        session.exec(`INSERT INTO tokens (token, role, used, created_by, created_at) 
            VALUES ('${esc(token)}', '${esc(role)}', 0, '${esc(creator)}', '${esc(system.getTimeStr())}')`);
    } catch (e) {
        logger.error("插入Token失败: " + e);
    }
}

function markTokenUsed(token) {
    if (!session) return;
    try {
        session.exec(`UPDATE tokens SET used = 1 WHERE token = '${esc(token)}'`);
    } catch (e) {
        logger.error("标记Token失败: " + e);
    }
}

function deleteToken(token) {
    if (!session) return;
    try {
        session.exec(`DELETE FROM tokens WHERE token = '${esc(token)}'`);
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

// ================= 初始超级 Token =================
function createInitialSuperToken() {
    if (!session) {
        logger.error("数据库未初始化，无法生成初始 Token");
        return;
    }
    try {
        // 使用 query 直接获取结果，完全避免 prepare/step
        const result = session.query("SELECT COUNT(*) AS cnt FROM tokens WHERE used = 0");
        let cnt = 0;
        if (result && result.length > 1 && result[1].length > 0) {
            cnt = result[1][0];
        }
        if (cnt > 0) return;
        
        const token = crypto.randomBytes(16).toString("hex");
        insertToken(token, "superadmin", "System");
        logger.warn(`================================================`);
        logger.warn(`超级管理员一次性Token: ${token}`);
        logger.warn(`请妥善保管，使用后将失效`);
        logger.warn(`================================================`);
    } catch (e) {
        logger.error("生成初始Token失败: " + e);
    }
}
function getContainerSnapshot(x, y, z, dimid, beforeTime) {
    if (!session) return {};
    try {
        // 查询该容器在 beforeTime 之前的所有 container_change，按槽位分组取最新
        const sql = `
            SELECT slot, old_data, id
            FROM operations
            WHERE operation_type = 'container_change'
              AND block_pos_x = ${x}
              AND block_pos_y = ${y}
              AND block_pos_z = ${z}
              AND block_dimid = ${dimid}
              AND timestamp < '${esc(beforeTime)}'
            ORDER BY id DESC
        `;
        const rows = session.query(sql);
        if (!rows || rows.length <= 1) return {};

        const snapshot = {};
        const seenSlots = new Set();
        // 从新到旧遍历，每个槽位只取第一次出现的记录（即最新的一条）
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const slot = r[0];
            if (seenSlots.has(slot)) continue;
            seenSlots.add(slot);
            snapshot[slot] = r[1]; // old_data
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

function getContainerSnapshot(x, y, z, dimid, beforeTime) {
    if (!session) return {};
    try {
        const stmt = session.prepare(`
            SELECT container_slot, old_data, id
            FROM operations
            WHERE operation_type = 'container_change'
              AND block_pos_x = ?
              AND block_pos_y = ?
              AND block_pos_z = ?
              AND block_dimid = ?
              AND timestamp < ?
            ORDER BY id DESC
        `);
        stmt.bind([x, y, z, dimid, beforeTime]);
        stmt.execute();
        const rows = stmt.fetchAll();
        if (!rows || rows.length <= 1) return {};

        const snapshot = {};
        const seenSlots = new Set();
        // 从最近的记录开始遍历，只取每个 slot 第一次出现的 old_data
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const slot = r[0];
            if (seenSlots.has(slot)) continue;
            seenSlots.add(slot);
            snapshot[slot] = r[1]; // old_data 字符串
        }
        return snapshot;
    } catch (e) {
        logger.error("获取容器快照失败: " + e);
        return {};
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
