// modules/command.js
const { queryOperations, queryOperationsByTime, insertOperation, getSession, closeDatabase, createInitialSuperToken, getContainerSnapshot, uidToName, resolveTypeInJson } = require("./database.js");

let globalConfig = {};
let isConsumerActive = true;

function formatLocalTime(date) {
    const Y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const D = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}
function shortBlockName(fullType) {
    if (!fullType) return "";
    return fullType.replace(/^minecraft:/, "");
}

const actionMap = {
    place:           { group: "+block",        desc: "放置方块" },
    destroy:         { group: "-block",        desc: "破坏方块" },
    explode_block:   { group: "-block",        desc: "爆炸破坏" },
    container_change:{ group: "container",     desc: "容器变动" },
    inventory_change:{ group: "inventory",     desc: "物品栏变动" },
    pickup:          { group: "+item",         desc: "捡起物品" },
    drop:            { group: "-item",         desc: "丢出物品" },
    liquid_react:    { group: "liquid",        desc: "液体反应" },
};

function getGroupByType(type) {
    return actionMap[type] ? actionMap[type].group : type;
}

function parseTime(str) {
    if (!str) return null;
    str = str.toLowerCase();
    if (/^\d+$/.test(str)) return parseInt(str);
    const regex = /(\d+(?:\.\d+)?)\s*(s|m|h|d|w)/gi;
    let totalSeconds = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
        const num = parseFloat(match[1]);
        const unit = match[2];
        switch (unit) {
            case 's': totalSeconds += num; break;
            case 'm': totalSeconds += num * 60; break;
            case 'h': totalSeconds += num * 3600; break;
            case 'd': totalSeconds += num * 86400; break;
            case 'w': totalSeconds += num * 604800; break;
        }
    }
    return totalSeconds > 0 ? totalSeconds : null;
}

function parseTimeRange(str) {
    if (!str) return { from: null, to: null };
    const parts = str.split("-");
    if (parts.length === 2) {
        const from = parseTime(parts[0]);
        const to = parseTime(parts[1]);
        return {
            from: from ? (Date.now()/1000 - from) : null,
            to: to ? (Date.now()/1000 - to) : null
        };
    }
    const seconds = parseTime(str);
    if (seconds) {
        return { from: Date.now()/1000 - seconds, to: null };
    }
    return { from: null, to: null };
}

function relativeTime(timestamp) {
    const now = Date.now();
    const then = new Date(timestamp.replace(" ", "T")).getTime();
    let diff = Math.floor((now - then) / 1000);
    if (diff < 0) diff = 0;
    if (diff < 60) return `${diff}秒前`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
}

function parseArgs(raw) {
    const params = {
        users: [],
        time: null,
        radius: null,
        action: null,
        include: [],
        exclude: [],
        flags: [],
        limit: 9999999999
    };
    if (!raw) return params;
    
    const parts = raw.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    for (const part of parts) {
        if (part.startsWith("u:")) {
            params.users = part.slice(2).split(",").map(s => s.trim()).filter(Boolean);
        } else if (part.startsWith("t:")) {
            params.time = part.slice(2);
        } else if (part.startsWith("r:")) {
            const val = part.slice(2);
            if (val === "#global") params.radius = -1;
            else {
                const n = parseInt(val);
                if (!isNaN(n)) params.radius = n;
            }
        } else if (part.startsWith("a:")) {
            params.action = part.slice(2).trim();
        } else if (part.startsWith("i:")) {
            params.include = part.slice(2).split(",").map(s => s.trim()).filter(Boolean);
        } else if (part.startsWith("e:")) {
            params.exclude = part.slice(2).split(",").map(s => s.trim()).filter(Boolean);
        } else if (part.startsWith("#")) {
            params.flags.push(part.slice(1).trim());
        } else if (/^\d+$/.test(part)) {
            params.page = parseInt(part);
        }
    }
    return params;
}

function lookup(params, player) {
    const db = getSession();
    if (!db) return [];
    
    let dimid = player.blockPos.dimid;
    let minX, maxX, minY, maxY, minZ, maxZ;

    if (params.radius === -1) {
        minX = -30000000; maxX = 30000000;
        minY = -64; maxY = 320;
        minZ = -30000000; maxZ = 30000000;
    } else if (params.radius !== null) {
        const r = params.radius;
        const pos = player.blockPos;
        minX = pos.x - r; maxX = pos.x + r;
        minY = pos.y - r; maxY = pos.y + r;
        minZ = pos.z - r; maxZ = pos.z + r;
    } else {
        const r = 10;
        const pos = player.blockPos;
        minX = pos.x - r; maxX = pos.x + r;
        minY = pos.y - r; maxY = pos.y + r;
        minZ = pos.z - r; maxZ = pos.z + r;
    }
    const timeRange = parseTimeRange(params.time);
    let timeFromStr = null, timeToStr = null;
    if (timeRange.from) {
        timeFromStr = formatLocalTime(new Date(timeRange.from * 1000));
    }
    if (timeRange.to) {
        timeToStr = formatLocalTime(new Date(timeRange.to * 1000));
    }
    let ops;
    if (timeFromStr) {
        ops = queryOperationsByTime(minX, minY, minZ, maxX, maxY, maxZ, dimid, timeFromStr, timeToStr);
    } else {
        ops = queryOperations(minX, minY, minZ, maxX, maxY, maxZ, dimid);
    }

    if (params.users.length > 0) {
        ops = ops.filter(op => params.users.includes(op[3]));
    }
    if (params.action) {
        const actionFilter = params.action;
        ops = ops.filter(op => {
            const type = op[1];
            const group = getGroupByType(type);
            if (actionFilter.startsWith("+") || actionFilter.startsWith("-")) {
                const prefix = actionFilter[0];
                const wanted = actionFilter.slice(1);
                return group === `${prefix}${wanted}`;
            } else {
                return group === actionFilter || type === actionFilter;
            }
        });
    }
    if (params.include.length > 0 || params.exclude.length > 0) {
        ops = ops.filter(op => {
            // 对于方块类型操作，需要检查包含/排除
            const dataStr = op[1] === 'place' || op[1] === 'destroy' || op[1] === 'explode_block' || op[1] === 'liquid_react'
                ? (op[1] === 'place' ? op[13] : op[12])
                : op[13] || op[12];
            if (!dataStr) return params.include.length === 0;
            
            let blockType = null;
            try {
                const data = JSON.parse(resolveTypeInJson(dataStr)); // 还原为名称
                blockType = data.type || data.name;
            } catch(e) {}
            if (params.include.length > 0) {
                if (!blockType) return false;
                return params.include.some(inc => blockType.includes(inc));
            }
            if (params.exclude.length > 0) {
                if (blockType && params.exclude.some(exc => blockType.includes(exc))) return false;
            }
            return true;
        });
    }
    ops = ops.slice(0, params.limit);
    return ops;
}

function formatRecord(op, showCoord = true) {
    // 先将op中的old_data/new_data还原为可读字符串
    const oldDataRaw = op[12];
    const newDataRaw = op[13];
    const oldData = resolveTypeInJson(oldDataRaw);
    const newData = resolveTypeInJson(newDataRaw);
    // 构建一个临时op副本用于后续解析
    const opResolved = [...op];
    opResolved[12] = oldData;
    opResolved[13] = newData;

    const type = opResolved[1];
    const playerName = opResolved[3] || "??";
    const bx = opResolved[8], by = opResolved[9], bz = opResolved[10];
    const timestamp = opResolved[15];
    const relTime = relativeTime(timestamp);
    const group = getGroupByType(type);
    
    let desc = "";
    const dataStr = type === "place" ? opResolved[13] : opResolved[12];
    let itemName = "?";
    let count = 1;
    if (dataStr) {
        try {
            const d = JSON.parse(dataStr);
            itemName = d.name || "?";
            count = d.count || 1;
        } catch(e) {}
    }
    
    if (group === "+block") {
        desc = `§a+ §f${playerName} §b放置 §fx${count} §7${itemName}`;
    } else if (group === "-block") {
        desc = `§c- §f${playerName} §b破坏 §fx${count} §7${itemName}`;
    } else if (group === "container" || group === "inventory") {
        let action, item, count = 1;
        const newD = newData, oldD = oldData;
        if (newD && !oldD) {
            action = "放入";
            try { 
                const d = JSON.parse(newD);
                item = d.name || "?";
                count = d.count || 1;
            } catch(e) { item = "?"; }
        } else if (!newD && oldD) {
            action = "取出";
            try { 
                const d = JSON.parse(oldD);
                item = d.name || "?";
                count = d.count || 1;
            } catch(e) { item = "?"; }
        } else {
            action = "变动";
            item = itemName;
        }
        desc = `§b* §f${playerName} §e${action} §fx${count} §6${item}`;
        
        if (group === "container") {
            const extraStr = op[16];
            if (extraStr) {
                try {
                    const extra = JSON.parse(resolveTypeInJson(extraStr));
                    const containerName = extra.name || extra.type;
                    if (containerName) {
                        desc += ` §8(§6${shortBlockName(containerName)}§8)`;
                    }
                } catch(e) {}
            }
        }
    } else if (group === "+item") {
        desc = `§a+ §f${playerName} §b捡起 §fx${count} §7${itemName}`;
    } else if (group === "-item") {
        desc = `§c- §f${playerName} §b丢出 §fx${count} §7${itemName}`;
    } else if (type === "liquid_react") {
        desc = `§9~ §f${playerName} §b液体反应生成 §7${itemName}`;
    } else {
        desc = `§7${type} §f${playerName}`;
    }
    
    if (showCoord) {
        desc += ` §7(${bx},${by},${bz})`;
    }
    desc += ` §7${relTime}`;
    return desc;
}

function showPaginatedChat(player, ops, page = 1) {
    const perPage = 10;
    const totalPages = Math.ceil(ops.length / perPage);
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    
    const start = (page - 1) * perPage;
    const end = Math.min(start + perPage, ops.length);
    const pageOps = ops.slice(start, end);
    const title = `§7----- §3BlockLog§7 查询结果 -----`;
    player.tell(title);
    for (const op of pageOps) {
        player.tell(formatRecord(op, true));
    }
    const footer = `§7----- §3第 ${page}/${totalPages} 页，共 ${ops.length} 条记录§7 -----`;
    player.tell(footer);
    if (totalPages > 1) {
        player.tell(`§7输入 /bl l ${page+1} 查看下一页`);
    }
}

function performRollback(player, ops, isRestore = false) {
    let success = 0;
    let fail = 0;
    const sortedOps = [...ops].sort((a, b) => a[0] - b[0]);
    
    for (const op of sortedOps) {
        const type = op[1];
        const blockPos = { x: op[8], y: op[9], z: op[10], dimid: op[11] };
        // 还原类型为名称
        const oldData = resolveTypeInJson(op[12]);
        const newData = resolveTypeInJson(op[13]);
        const slot = op[14];
        try {
            if (isRestore) {
                switch (type) {
                    case "place":
                        if (newData) {
                            const info = JSON.parse(newData);
                            mc.setBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid, info.type, info.tileData || 0);
                            const block = mc.getBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid);
                            if (block) {
                                if (info.nbt) { const nbt = NBT.parseSNBT(info.nbt); if (nbt) block.setNbt(nbt); }
                                if (info.beNbt && block.hasBlockEntity()) { const be = block.getBlockEntity(); if (be) { const beNbt = NBT.parseSNBT(info.beNbt); if (beNbt) be.setNbt(beNbt); } }
                            }
                            success++;
                        }
                        break;
                    case "container_change":
                    case "inventory_change": {
                        let container = null;
                        if (type === "container_change") {
                            let block = mc.getBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid);
                            if (block && block.hasContainer()) {
                                container = block.getContainer();
                            } else {
                                const extra = op[16];
                                if (extra) {
                                    try {
                                        const blockInfo = JSON.parse(resolveTypeInJson(extra));
                                        if (blockInfo.type) {
                                            mc.setBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid, blockInfo.type, blockInfo.tileData || 0);
                                            block = mc.getBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid);
                                            if (block && block.hasContainer()) {
                                                container = block.getContainer();
                                            }
                                        }
                                    } catch(e) {}
                                }
                            }
                        } else {
                            if (player && blockPos.x === player.blockPos.x && blockPos.y === player.blockPos.y && blockPos.z === player.blockPos.z) {
                                container = player.getInventory();
                            }
                        }
                        if (container && slot !== null) {
                            if (oldData) {
                                const info = JSON.parse(oldData);
                                const item = mc.newItem(info.type, info.count);
                                item.setAux(info.aux || 0);
                                item.setDamage(info.damage || 0);
                                if (info.nbt) {
                                    const nbt = NBT.parseSNBT(info.nbt);
                                    if (nbt) item.setNbt(nbt);
                                }
                                container.setItem(slot, item);
                            } else {
                                container.setItem(slot, mc.newItem("minecraft:air", 0));
                            }
                            success++;
                        } else {
                            logger.warn(`容器回档失败：无法获取容器 slot=${slot} pos=${blockPos.x},${blockPos.y},${blockPos.z}`);
                        }
                        break;
                    }
                }
            } else {
                switch (type) {
                    case "place":
                        mc.setBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid, "minecraft:air", 0);
                        success++;
                        break;
                    case "destroy":
                    case "explode_block":
                        if (oldData) {
                            const info = JSON.parse(oldData);
                            mc.setBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid, info.type, info.tileData || 0);
                            let block = mc.getBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid);
                            if (info.nbt && block) {
                                const nbt = NBT.parseSNBT(info.nbt);
                                if (nbt) {
                                    block.setNbt(nbt);
                                    block = mc.getBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid);
                                }
                            }
                            if (info.beNbt && block && block.hasBlockEntity()) {
                                const be = block.getBlockEntity();
                                if (be) {
                                    const beNbt = NBT.parseSNBT(info.beNbt);
                                    if (beNbt) be.setNbt(beNbt);
                                }
                            }
                            if (block && block.hasContainer()) {
                                const snapshot = getContainerSnapshot(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid, op[15]);
                                const container = block.getContainer();
                                if (container) {
                                    container.removeAllItems();
                                    for (const [slot, data] of Object.entries(snapshot)) {
                                        if (data) {
                                            try {
                                                const itemInfo = JSON.parse(resolveTypeInJson(data));
                                                const item = mc.newItem(itemInfo.type, itemInfo.count);
                                                item.setAux(itemInfo.aux || 0);
                                                item.setDamage(itemInfo.damage || 0);
                                                if (itemInfo.nbt) {
                                                    const nbt = NBT.parseSNBT(itemInfo.nbt);
                                                    if (nbt) item.setNbt(nbt);
                                                }
                                                container.setItem(parseInt(slot), item);
                                            } catch(e) {}
                                        }
                                    }
                                }
                            }
                            success++;
                        }
                        break;
                    case "container_change":
                    case "inventory_change": {
                        let container = null;
                        const block = mc.getBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid);
                        if (type === "container_change") {
                            if (block && block.hasContainer()) {
                                container = block.getContainer();
                            } else {
                                const extra = op[16];
                                if (extra) {
                                    try {
                                        const blockInfo = JSON.parse(resolveTypeInJson(extra));
                                        if (blockInfo.type) {
                                            mc.setBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid, blockInfo.type, blockInfo.tileData || 0);
                                            const newBlock = mc.getBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid);
                                            if (newBlock && newBlock.hasContainer()) {
                                                container = newBlock.getContainer();
                                            }
                                        }
                                    } catch(e) {}
                                }
                            }
                        } else {
                            if (player && blockPos.x === player.blockPos.x && blockPos.y === player.blockPos.y && blockPos.z === player.blockPos.z) {
                                container = player.getInventory();
                            }
                        }
                        if (container && slot !== null) {
                            if (oldData) {
                                const info = JSON.parse(oldData);
                                const item = mc.newItem(info.type, info.count);
                                item.setAux(info.aux || 0);
                                item.setDamage(info.damage || 0);
                                if (info.nbt) {
                                    const nbt = NBT.parseSNBT(info.nbt);
                                    if (nbt) item.setNbt(nbt);
                                }
                                container.setItem(slot, item);
                            } else {
                                container.setItem(slot, mc.newItem("minecraft:air", 0));
                            }
                            success++;
                        }
                        break;
                    }
                    case "liquid_react":
                        if (oldData) {
                            const info = JSON.parse(oldData);
                            mc.setBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid, info.type, info.tileData || 0);
                            const block = mc.getBlock(blockPos.x, blockPos.y, blockPos.z, blockPos.dimid);
                            if (block) {
                                if (info.nbt) { const nbt = NBT.parseSNBT(info.nbt); if (nbt) block.setNbt(nbt); }
                                if (info.beNbt && block.hasBlockEntity()) { const be = block.getBlockEntity(); if (be) { const beNbt = NBT.parseSNBT(info.beNbt); if (beNbt) be.setNbt(beNbt); } }
                            }
                            success++;
                        }
                        break;
                }
            }
        } catch (e) {
            fail++;
            logger.error("回档错误: " + e);
        }
    }
    player.tell(`§a回档完成！成功 ${success} 条，失败 ${fail} 条`);
}

// 注册命令
function registerCommand() {
    const cmd = mc.newCommand("blocklog", "区域操作日志查询与回档", PermType.Any);
    cmd.setAlias("bl");

    cmd.setEnum("SubCommand", [
        "help", "inspect", "lookup", "rollback", "restore", "purge", "reload", "status", "consumer",
        "i", "l", "rb", "rs"
    ]);

    cmd.mandatory("subcmd", ParamType.Enum, "SubCommand", 1);
    cmd.optional("args", ParamType.RawText);

    cmd.overload(["SubCommand"]);
    cmd.overload(["SubCommand", "args"]);

    cmd.setCallback((_cmd, origin, output, results) => {
        let sub = results.subcmd;
        const player = origin.player;
        const rawArgs = results.args || "";

        const isConsole = !player;
        if (sub !== "status" && sub !== "reload" && sub !== "consumer" && isConsole) {
            return output.error("只有玩家可以使用此命令");
        }

        if ((sub === "rollback" || sub === "restore" || sub === "purge" || sub === "reload" || sub === "consumer") && player && !player.isOP()) {
            return output.error("你没有权限使用此命令");
        }

        if (sub === "i") sub = "inspect";
        if (sub === "l") sub = "lookup";
        if (sub === "rb") sub = "rollback";
        if (sub === "rs") sub = "restore";

        switch (sub) {
            case "help":
                showHelp(player || origin.entity);
                break;
            case "inspect":
                toggleInspect(player);
                break;
            case "lookup": {
                const params = parseArgs(rawArgs);
                
                if (player && !player.isOP()) {
                    if (params.users.length > 0) {
                        output.error("你没有权限按玩家名过滤记录");
                        return;
                    }
                    if (params.radius !== null) {
                        if (params.radius === -1 || params.radius > 200) {
                            params.radius = 200;
                            output.success("搜索半径已自动限制为 200 格（普通玩家上限）");
                        }
                    }
                }
                
                const ops = lookup(params, player);
                if (ops.length === 0) {
                    output.success("没有找到匹配的操作记录");
                    return;
                }
                showPaginatedChat(player, ops, params.page || 1);
                break;
            }
            case "rollback":
            case "restore": {
                const params = parseArgs(rawArgs);
                const ops = lookup(params, player);
                if (ops.length === 0) {
                    output.success("没有需要回档/恢复的操作");
                    return;
                }
                const isRestore = sub === "restore";
                player.tell(`§6即将${isRestore ? "恢复" : "回滚"} ${ops.length} 条操作...`);
                performRollback(player, ops, isRestore);
                break;
            }
            case "purge": {
                const params = parseArgs(rawArgs);
                const db = getSession();
                if (!db) return output.error("数据库未连接");
                if (!params.time) return output.error("请使用 t:<时间> 指定清理多久前的数据（例如 /bl purge t:30d）");
                const seconds = parseTime(params.time);
                if (!seconds) return output.error("时间格式错误");
            
                const cutoff = formatLocalTime(new Date(Date.now() - seconds * 1000));
                const safeCutoff = cutoff.replace(/'/g, "''");
            
                try {
                    const result = db.query(`SELECT COUNT(*) AS cnt FROM operations WHERE timestamp <= '${safeCutoff}'`);
                    let count = 0;
                    if (result && result.length > 1) count = result[1][0] || 0;
            
                    if (count === 0) {
                        output.success("没有需要清理的记录");
                        return;
                    }
            
                    db.exec(`DELETE FROM operations WHERE timestamp <= '${safeCutoff}'`);
                    let msg = `已清理 ${cutoff} 之前的 ${count} 条记录`;
            
                    if (params.flags.includes("vacuum")) {
                        db.exec("VACUUM");
                        msg += "，数据库已压缩";
                    }
            
                    output.success(msg);
                } catch (e) {
                    output.error("清理失败: " + e);
                }
                break;
            }
            case "reload": {
                try {
                    const configPath = "plugins/BlockLog/config.json";
                    if (File.exists(configPath)) {
                        globalConfig = JSON.parse(File.readFrom(configPath));
                    }
                    output.success("配置已重载");
                } catch (e) {
                    output.error("重载失败: " + e);
                }
                break;
            }
            case "status": {
                const db = getSession();
                let totalRecords = 0;
                if (db) {
                    const rows = db.query("SELECT COUNT(*) AS cnt FROM operations");
                    if (rows && rows.length > 1) totalRecords = rows[1][0];
                }
            
                let dbSizeStr = "未知";
                const dbPath = "plugins/BlockLog/blocklog.db";
                if (File.exists(dbPath)) {
                    const bytes = File.getFileSize(dbPath);
                    if (bytes >= 0) {
                        if (bytes < 1024) dbSizeStr = `${bytes} B`;
                        else if (bytes < 1048576) dbSizeStr = `${(bytes / 1024).toFixed(1)} KB`;
                        else dbSizeStr = `${(bytes / 1048576).toFixed(1)} MB`;
                    }
                }
            
                const msg = [
                    `§3BlockLog 状态`,
                    `§b版本: §f${globalConfig.version || "1.0.1"}`,
                    `§b数据库: §f${db ? "已连接" : "未连接"}`,
                    `§b数据库大小: §f${dbSizeStr}`,
                    `§b记录总数: §f${totalRecords}`,
                    `§b事件记录: §f${isConsumerActive ? "开启" : "暂停"}`,
                    `§b在线玩家: §f${mc.getOnlinePlayers().length}`
                ];
            
                if (player) {
                    msg.forEach(line => player.tell(line));
                } else {
                    logger.info(msg.join("\n"));
                }
                break;
            }
            case "consumer":
                if (!player || !player.isOP()) return output.error("权限不足");
                if (!rawArgs) {
                    output.success(`事件记录状态: ${isConsumerActive ? "§a开启" : "§c暂停"}`);
                    return;
                }
                const lower = rawArgs.toLowerCase();
                if (lower === "on" || lower === "start") {
                    isConsumerActive = true;
                    output.success("事件记录已开启");
                } else if (lower === "off" || lower === "stop" || lower === "pause") {
                    isConsumerActive = false;
                    output.success("事件记录已暂停");
                } else {
                    output.error("用法: /bl consumer on|off");
                }
                break;
            default:
                output.error("未知子命令，使用 /bl help 查看帮助");
        }
    });

    cmd.setup();
}

function showHelp(player) {
    player.tell(`§7===== BlockLog 帮助 =====
§b/bl help §7- 显示帮助
§b/bl inspect (i) §7- 开启/关闭监察模式
§b/bl lookup (l) [参数] §7- 查询记录
§b/bl rollback (rb) [参数] §7- 回滚操作
§b/bl restore (rs) [参数] §7- 恢复操作
§b/bl purge t:<时间> [#vacuum] §7- 清理旧数据（可选参数：#vacuum - 压缩数据库）
§b/bl reload §7- 重载配置
§b/bl status §7- 查看状态
§b/bl consumer [on|off] §7- 控制事件记录

§b参数说明:
    u:<玩家>  t:<时间>  r:<半径|#global>
    a:<动作>  i:<包含>  e:<排除>  #preview #count
示例: /bl l u:Steve t:1h r:20 a:+block`)
}

let inspectPlayers = new Set();

function toggleInspect(player) {
    if (inspectPlayers.has(player.xuid)) {
        inspectPlayers.delete(player.xuid);
        player.tell("§a监察模式已关闭");
    } else {
        inspectPlayers.add(player.xuid);
        player.tell("§a监察模式已开启，点击方块查看记录");
    }
}

module.exports = { 
    registerCommand, 
    toggleInspect, 
    inspectPlayers, 
    setConfig: (cfg) => { globalConfig = cfg; },
    setConsumer: (val) => { isConsumerActive = val; },
    getConsumer: () => isConsumerActive,
    formatRecord,
};
