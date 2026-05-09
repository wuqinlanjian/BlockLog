// modules/web.js
const express = require("express");
const session = require("express-session");
const path = require("path");
const { 
    queryOperations, queryOperationsByTime, getUser, createUser, deleteUser, getAllUsers,
    getToken, insertToken, markTokenUsed, deleteToken, getAllTokens, updatePassword, 
    getSession 
} = require("./modules/database");
const { hashPassword, checkPassword, generateToken } = require("./modules/auth");

class LseSessionStore extends session.Store {
    constructor() {
        super();

        this._cleanupInterval = setInterval(() => this.clearExpired(), 60 * 60 * 1000);
    }

    esc(str) {
        if (typeof str !== "string") return str;
        return str.replace(/'/g, "''");
    }

    get(sid, callback) {
        try {
            const db = getSession();
            if (!db) return callback(null, null);
            const now = system.getTimeStr();
            const sql = `SELECT sess FROM sessions WHERE sid = '${this.esc(sid)}' AND expired > '${this.esc(now)}'`;
            const rows = db.query(sql);
            if (!rows || rows.length <= 1) return callback(null, null);
            const sess = JSON.parse(rows[1][0]);
            callback(null, sess);
        } catch (e) {
            callback(e);
        }
    }

    set(sid, sess, callback) {
        try {
            const db = getSession();
            if (!db) return callback(new Error("Database not available"));
            const maxAge = (sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : 86400000;
            const expires = new Date(Date.now() + maxAge);
            const pad = (n) => String(n).padStart(2, '0');
            const expiredStr = `${expires.getFullYear()}-${pad(expires.getMonth()+1)}-${pad(expires.getDate())} ${pad(expires.getHours())}:${pad(expires.getMinutes())}:${pad(expires.getSeconds())}`;
            const sessStr = JSON.stringify(sess);
            const sql = `REPLACE INTO sessions (sid, sess, expired) VALUES ('${this.esc(sid)}', '${this.esc(sessStr)}', '${this.esc(expiredStr)}')`;
            db.exec(sql);
            callback(null);
        } catch (e) {
            callback(e);
        }
    }

    destroy(sid, callback) {
        try {
            const db = getSession();
            if (db) {
                db.exec(`DELETE FROM sessions WHERE sid = '${this.esc(sid)}'`);
            }
            callback(null);
        } catch (e) {
            callback(e);
        }
    }

    clearExpired() {
        try {
            const db = getSession();
            if (db) {
                db.exec(`DELETE FROM sessions WHERE expired <= '${this.esc(system.getTimeStr())}'`);
            }
        } catch (e) {}
    }

    close() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
    }
}

const roleLevel = { user: 0, admin: 1, superadmin: 2 };


function auth(requiredRole) {
    return (req, res, next) => {
        if (!req.session.username) return res.status(401).json({ error: "未登录" });
        const user = getUser(req.session.username);
        if (!user) return res.status(401).json({ error: "用户不存在" });
        if (roleLevel[user.role] < roleLevel[requiredRole]) {
            return res.status(403).json({ error: "权限不足" });
        }
        req.user = user;
        next();
    };
}

let storeInstance = null;
let serverInstance = null;

function startServer(config) {
    const app = express();
    
    storeInstance = new LseSessionStore();

    app.use(express.json());
    app.use(session({
        store: storeInstance,
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: { 
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: 'lax'
        }
    }));


    app.use(express.static(path.join(__dirname, "..", "public")));

    app.post("/api/login", (req, res) => {
        try {
            const { username, password } = req.body || {};
            if (!username || !password) return res.status(400).json({ error: "请输入账号和密码" });
            const user = getUser(username);
            if (!user) return res.status(400).json({ error: "账号或密码错误" });
            if (!checkPassword(password, user.password_hash)) return res.status(400).json({ error: "账号或密码错误" });
            req.session.username = username;
            res.json({ success: true, role: user.role, username: user.username });
        } catch (e) {
            logger.error("登录异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });


    app.post("/api/login-token", (req, res) => {
        try {
            const { token } = req.body || {};
            if (!token) return res.status(400).json({ error: "Token不能为空" });
            const tokenRow = getToken(token);
            if (!tokenRow || tokenRow.used) return res.status(400).json({ error: "Token无效或已使用" });
            res.json({ success: true, role: tokenRow.role });
        } catch (e) {
            logger.error("Token验证异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });


    app.post("/api/register", (req, res) => {
        try {
            const { token, username, password } = req.body || {};
            if (!token || !username || !password) return res.status(400).json({ error: "Token、用户名和密码不能为空" });
            if (username.length < 3) return res.status(400).json({ error: "用户名至少3个字符" });
            if (password.length < 6) return res.status(400).json({ error: "密码至少6个字符" });
            const tokenRow = getToken(token);
            if (!tokenRow || tokenRow.used) return res.status(400).json({ error: "Token无效或已使用" });
            if (getUser(username)) return res.status(400).json({ error: "用户名已存在" });
            const hash = hashPassword(password);
            createUser(username, hash, tokenRow.role);
            markTokenUsed(token);
            req.session.username = username;
            res.json({ success: true, role: tokenRow.role, username });
        } catch (e) {
            logger.error("注册异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });


    app.post("/api/logout", auth("user"), (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ error: "登出失败" });
            res.clearCookie("connect.sid");
            res.json({ success: true });
        });
    });
    app.get("/api/me", auth("user"), (req, res) => {
        res.json({ username: req.user.username, role: req.user.role });
    });

    app.post("/api/change-password", auth("user"), (req, res) => {
        try {
            const { oldPassword, newPassword } = req.body || {};
            if (!oldPassword || !newPassword) return res.status(400).json({ error: "请输入原密码和新密码" });
            if (newPassword.length < 6) return res.status(400).json({ error: "新密码至少6个字符" });
            const user = getUser(req.session.username);
            if (!checkPassword(oldPassword, user.password_hash)) return res.status(400).json({ error: "原密码错误" });
            updatePassword(req.session.username, hashPassword(newPassword));
            res.json({ success: true });
        } catch (e) {
            logger.error("修改密码异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });

    // 查询操作记录
    app.get("/api/operations", auth("user"), (req, res) => {
        try {
            const { minX, minY, minZ, maxX, maxY, maxZ, dimid, timeFrom, timeTo, limit } = req.query;
            let ops;
            const dim = parseInt(dimid) || 0;
            if (timeFrom) {
                ops = queryOperationsByTime(
                    parseInt(minX), parseInt(minY), parseInt(minZ),
                    parseInt(maxX), parseInt(maxY), parseInt(maxZ),
                    dim, timeFrom, timeTo || null
                );
            } else {
                ops = queryOperations(
                    parseInt(minX), parseInt(minY), parseInt(minZ),
                    parseInt(maxX), parseInt(maxY), parseInt(maxZ),
                    dim
                );
            }
            const result = ops.map(op => ({
                id: op[0],
                type: op[1],
                player_name: op[3],
                block_x: op[8], block_y: op[9], block_z: op[10],
                dimid: op[11],
                old_data: op[12],
                new_data: op[13],
                slot: op[14],
                timestamp: op[15]
            }));
            if (limit) {
                res.json(result.slice(0, parseInt(limit)));
            } else {
                res.json(result);
            }
        } catch (e) {
            logger.error("API /api/operations 异常: " + e);
            res.status(500).json({ error: "查询失败，服务器内部错误" });
        }
    });


    app.get("/api/operations/latest", auth("user"), (req, res) => {
        try {
            const db = getSession();
            if (!db) return res.json([]);
            const limit = parseInt(config.maxLogLines) || 500;
            const rows = db.query(`SELECT * FROM operations ORDER BY id DESC LIMIT ${limit}`);
            if (!rows || rows.length <= 1) return res.json([]);
            const result = rows.slice(1).map(op => ({
                id: op[0],
                type: op[1],
                player_name: op[3],
                block_x: op[8], block_y: op[9], block_z: op[10],
                dimid: op[11],
                timestamp: op[15]
            }));
            res.json(result);
        } catch (e) {
            logger.error("获取最新日志异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });

    app.post("/api/rollback", auth("admin"), (req, res) => {
        try {
            const { operationIds } = req.body || {};
            logger.info("回档请求 operationIds: " + JSON.stringify(operationIds));
    
            if (!operationIds || !Array.isArray(operationIds) || operationIds.length === 0) {
                return res.status(400).json({ error: "请选择需要回档的操作" });
            }
            const ids = operationIds.map(id => parseInt(id)).filter(id => !isNaN(id));
            if (ids.length === 0) return res.status(400).json({ error: "无效的操作ID" });
    
            const idList = ids.join(',');
            const db = getSession();
            if (!db) return res.status(500).json({ error: "数据库未连接" });
    
            const sql = `SELECT * FROM operations WHERE id IN (${idList}) ORDER BY id ASC`;
            logger.info("回档SQL: " + sql);
            const rows = db.query(sql);
            logger.info("回档查询结果行数: " + (rows ? rows.length : 0));
    
            if (!rows || rows.length <= 1) {
                return res.json({ success: 0, total: 0, results: [], message: "未找到指定操作" });
            }
    
            const ops = rows.slice(1);
            logger.info("实际待回档记录数: " + ops.length);
    
            let success = 0;
            const results = [];
    
            for (const op of ops) {
                const id = op[0], type = op[1], bx = op[8], by = op[9], bz = op[10], bdim = op[11];
                const oldData = op[12], slot = op[14];
                const resultItem = {
                    id,
                    type,
                    blockPos: { x: bx, y: by, z: bz, dimid: bdim },
                    status: 'success',
                    error: null
                };
                try {
                    switch (type) {
                        case "place":
                            mc.setBlock(bx, by, bz, bdim, "minecraft:air", 0);
                            success++;
                            break;
                        case "destroy":
                        case "explode_block":
                            if (oldData) {
                                const oldInfo = JSON.parse(oldData);
                                mc.setBlock(bx, by, bz, bdim, oldInfo.type, oldInfo.tileData || 0);
                                const block = mc.getBlock(bx, by, bz, bdim);
                                if (block) {
                                    if (oldInfo.nbt) {
                                        const nbt = NBT.parseSNBT(oldInfo.nbt);
                                        if (nbt) block.setNbt(nbt);
                                    }
                                    if (oldInfo.beNbt && block.hasBlockEntity()) {
                                        const be = block.getBlockEntity();
                                        if (be) {
                                            const beNbt = NBT.parseSNBT(oldInfo.beNbt);
                                            if (beNbt) be.setNbt(beNbt);
                                        }
                                    }
                                }
                                success++;
                            }
                            break;
                        case "container_change":
                        case "inventory_change": {
                            const curBlock = mc.getBlock(bx, by, bz, bdim);
                            if (curBlock && curBlock.hasContainer()) {
                                const container = curBlock.getContainer();
                                if (container && slot !== null) {
                                    if (oldData) {
                                        const oldItemInfo = JSON.parse(oldData);
                                        const item = mc.newItem(oldItemInfo.type, oldItemInfo.count);
                                        item.setAux(oldItemInfo.aux || 0);
                                        item.setDamage(oldItemInfo.damage || 0);
                                        if (oldItemInfo.nbt) {
                                            const nbt = NBT.parseSNBT(oldItemInfo.nbt);
                                            if (nbt) item.setNbt(nbt);
                                        }
                                        container.setItem(slot, item);
                                    } else {
                                        container.setItem(slot, mc.newItem("minecraft:air", 0));
                                    }
                                    success++;
                                }
                            }
                            break;
                        }
                        case "liquid_react":
                            if (oldData) {
                                const oldInfo = JSON.parse(oldData);
                                mc.setBlock(bx, by, bz, bdim, oldInfo.type, oldInfo.tileData || 0);
                                const block = mc.getBlock(bx, by, bz, bdim);
                                if (block) {
                                    if (oldInfo.nbt) {
                                        const nbt = NBT.parseSNBT(oldInfo.nbt);
                                        if (nbt) block.setNbt(nbt);
                                    }
                                    if (oldInfo.beNbt && block.hasBlockEntity()) {
                                        const be = block.getBlockEntity();
                                        if (be) {
                                            const beNbt = NBT.parseSNBT(oldInfo.beNbt);
                                            if (beNbt) be.setNbt(beNbt);
                                        }
                                    }
                                }
                                success++;
                            }
                            break;
                            
                    }
                } catch (e) {
                    resultItem.status = 'failed';
                    resultItem.error = e.message || String(e);
                    logger.error("回档操作 " + id + " 失败: ", e);
                }
                results.push(resultItem);
            }
    
            logger.info(`回档完成，成功 ${success} / ${ops.length}`);
            res.json({ success: true, count: success, total: ops.length, results });
        } catch (e) {
            logger.error("回档API异常: " + e);
            res.status(500).json({ error: "回档失败，服务器内部错误" });
        }
    });
    
    app.get("/api/users", auth("superadmin"), (req, res) => {
        try {
            const users = getAllUsers();
            res.json(users);
        } catch (e) {
            logger.error("获取用户列表异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });

    app.delete("/api/users/:username", auth("superadmin"), (req, res) => {
        try {
            const target = getUser(req.params.username);
            if (!target) return res.status(404).json({ error: "用户不存在" });
            if (target.username === req.user.username) return res.status(400).json({ error: "不能删除自己" });
            if (target.role === "superadmin") return res.status(403).json({ error: "不能删除其他超级管理员" });
            deleteUser(target.username);
            res.json({ success: true });
        } catch (e) {
            logger.error("删除用户异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });

    app.get("/api/tokens", auth("superadmin"), (req, res) => {
        try {
            const tokens = getAllTokens();
            res.json(tokens);
        } catch (e) {
            logger.error("获取Token列表异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });

    app.post("/api/tokens", auth("superadmin"), (req, res) => {
        try {
            const { role } = req.body || {};
            if (!["superadmin", "admin", "user"].includes(role)) return res.status(400).json({ error: "无效角色" });
            const token = generateToken();
            insertToken(token, role, req.user.username);
            res.json({ success: true, token });
        } catch (e) {
            logger.error("生成Token异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });

    app.delete("/api/tokens/:token", auth("superadmin"), (req, res) => {
        try {
            deleteToken(req.params.token);
            res.json({ success: true });
        } catch (e) {
            logger.error("删除Token异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });

    app.get("/api/config", auth("superadmin"), (req, res) => {
        res.json(config);
    });

    app.post("/api/config", auth("superadmin"), (req, res) => {
        try {
            const { webPort, allowRecord, maxLogLines } = req.body || {};
            if (webPort !== undefined) config.webPort = parseInt(webPort) || 3000;
            if (allowRecord !== undefined) config.allowRecord = !!allowRecord;
            if (maxLogLines !== undefined) config.maxLogLines = parseInt(maxLogLines) || 500;
            File.writeTo("plugins/BlockLog/config.json", JSON.stringify(config, null, 2));
            res.json({ success: true });
        } catch (e) {
            logger.error("保存配置异常: " + e);
            res.status(500).json({ error: "保存失败" });
        }
    });

    app.get("/api/stats", auth("user"), (req, res) => {
        try {
            const players = mc.getOnlinePlayers();
            const db = getSession();
            let todayOps = 0;
            if (db) {
                const today = system.getTimeStr().split(" ")[0];
                const t = today.replace(/'/g, "''");
                const rows = db.query(`SELECT COUNT(*) AS cnt FROM operations WHERE timestamp LIKE '${t}%'`);
                if (rows && rows.length > 1) todayOps = rows[1][0];
            }
            res.json({
                players: players.length,
                maxPlayers: mc.getMaxPlayers ? mc.getMaxPlayers() : "?",
                todayOperations: todayOps,
                uptime: system.getTimeStr()
            });
        } catch (e) {
            logger.error("获取状态异常: " + e);
            res.status(500).json({ error: "服务器内部错误" });
        }
    });

    // 前端 fallback
    app.get("*", (req, res) => {
        if (req.path.startsWith("/api")) {
            return res.status(404).json({ error: "Not found" });
        }
        res.sendFile(path.join(__dirname, "..", "public", "index.html"));
    });

    app.listen(config.webPort, () => {
        logger.info(`BlockLog Web 面板已启动: http://localhost:${config.webPort}`);
    });

    serverInstance = app.listen(config.webPort, () => {
        logger.info(`BlockLog Web 面板已启动: http://localhost:${config.webPort}`);
    });
    serverInstance.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.error(`端口 ${config.webPort} 已被占用，请修改配置或关闭占用该端口的程序`);
        } else {
            logger.error("Web 服务器错误: " + err);
        }
        serverInstance = null;
    });
}

function stopServer() {
    // 关闭 HTTP 服务器
    if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
    }
    if (storeInstance) {
        storeInstance.close();
        storeInstance = null;
    }
}


module.exports = { startServer, stopServer };