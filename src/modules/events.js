// modules/events.js
const { insertOperation } = require("./database");
const { getConsumer, inspectPlayers } = require("./command"); 
const { queryOperations } = require("./database");    


const actionMap = {
    place: { desc: "放置方块" },
    destroy: { desc: "破坏方块" },
    explode_block: { desc: "爆炸破坏" },
    container_change: { desc: "容器变动" },
    inventory_change: { desc: "物品栏变动" },
    pickup: { desc: "捡起物品" },
    drop: { desc: "丢出物品" },
    liquid_react: { desc: "液体反应" }
};

function isPlayerReady(player) {
    return player && !player.isLoading;
}

function posToObj(pos) {
    return {
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        z: pos?.z ?? 0,
        dimid: pos?.dimid ?? 0
    };
}

function blockToData(block) {
    const blockNbt = block.getNbt();
    const be = block.getBlockEntity();
    let beNbtSnbt = null;
    if (be) {
        const beNbt = be.getNbt();
        if (beNbt) beNbtSnbt = beNbt.toSNBT();
    }
    return JSON.stringify({
        name: block.name,
        type: block.type,
        tileData: block.tileData,
        nbt: blockNbt?.toSNBT() || "",
        beNbt: beNbtSnbt
    });
}

function itemToData(item) {
    if (!item || item.isNull()) return "";
    return JSON.stringify({
        name: item.name,
        type: item.type,
        count: item.count,
        aux: item.aux,
        damage: item.damage,
        nbt: item.getNbt()?.toSNBT()
    });
}

function registerEvents() {
    mc.listen("afterPlaceBlock", (player, block) => {
        if (!getConsumer() || !isPlayerReady(player)) return;
        insertOperation({
            type: "place",
            xuid: player.xuid,
            name: player.realName,
            playerPos: posToObj(player.blockPos),
            blockPos: posToObj(block.pos),
            oldData: "",
            newData: blockToData(block),
            time: system.getTimeStr()
        });
        if (inspectPlayers.has(player.xuid)) {
            showInspectInfo(player, block.pos);
        }
    });

    mc.listen("onDestroyBlock", (player, block) => {
        if (!getConsumer() || !isPlayerReady(player)) return;
        insertOperation({
            type: "destroy",
            xuid: player.xuid,
            name: player.realName,
            playerPos: posToObj(player.blockPos),
            blockPos: posToObj(block.pos),
            oldData: blockToData(block),
            newData: "",
            time: system.getTimeStr()
        });
        if (inspectPlayers.has(player.xuid)) {
            showInspectInfo(player, block.pos);
        }
    });


    mc.listen("onContainerChange", (player, container, slot, oldItem, newItem) => {
        if (!getConsumer() || !isPlayerReady(player)) return;

        let blockInfo = null;
        if (container.pos) {
            const cb = mc.getBlock(container.pos.x, container.pos.y, container.pos.z, container.pos.dimid);
            if (cb) {
                blockInfo = {
                    type: cb.type,
                    tileData: cb.tileData
                };
            }
        }
        
        insertOperation({
            type: "container_change",
            xuid: player.xuid,
            name: player.realName,
            playerPos: posToObj(player.blockPos),
            blockPos: container.pos ? posToObj(container.pos) : posToObj(player.blockPos),
            oldData: itemToData(oldItem),
            newData: itemToData(newItem),
            slot: slot,
            time: system.getTimeStr(),
            extra: JSON.stringify(blockInfo)
        });
    });


    mc.listen("onInventoryChange", (player, slot, oldItem, newItem) => {
        if (!getConsumer() || !isPlayerReady(player)) return;
        insertOperation({
            type: "inventory_change",
            xuid: player.xuid,
            name: player.realName,
            playerPos: posToObj(player.blockPos),
            blockPos: posToObj(player.blockPos),
            oldData: itemToData(oldItem),
            newData: itemToData(newItem),
            slot: slot,
            time: system.getTimeStr()
        });
    });

    mc.listen("onTakeItem", (player, entity, item) => {
        if (!getConsumer() || !isPlayerReady(player)) return;
        insertOperation({
            type: "pickup",
            xuid: player.xuid,
            name: player.realName,
            playerPos: posToObj(player.blockPos),
            blockPos: posToObj(entity.blockPos),
            oldData: "",
            newData: itemToData(item),
            time: system.getTimeStr()
        });
    });


    mc.listen("onDropItem", (player, item) => {
        if (!getConsumer() || !isPlayerReady(player)) return;
        insertOperation({
            type: "drop",
            xuid: player.xuid,
            name: player.realName,
            playerPos: posToObj(player.blockPos),
            blockPos: posToObj(player.blockPos),
            oldData: itemToData(item),
            newData: "",
            time: system.getTimeStr()
        });
    });


    mc.listen("onBlockExploded", (block, source) => {
        if (!getConsumer()) return;
        insertOperation({
            type: "explode_block",
            xuid: "",
            name: source ? source.name : "Explosion",
            playerPos: { x: 0, y: 0, z: 0, dimid: block.pos.dimid },
            blockPos: posToObj(block.pos),
            oldData: blockToData(block),
            newData: "",
            time: system.getTimeStr()
        });
    });


    mc.listen("onUseBucketTake", (player, item, target, side, pos) => {
        if (!getConsumer() || !isPlayerReady(player)) return;
        if (target && target.pos) {
            insertOperation({
                type: "destroy",
                xuid: player.xuid,
                name: player.realName,
                playerPos: posToObj(player.blockPos),
                blockPos: posToObj(target.pos),
                oldData: blockToData(target),
                newData: "",
                time: system.getTimeStr()
            });
        }
    });


    mc.listen("onBlockChanged", (beforeBlock, afterBlock) => {
        if (!getConsumer()) return;
        if (!beforeBlock || !afterBlock) return;
        const beforeType = beforeBlock.type;
        const afterType = afterBlock.type;
        const isBeforeLiquid = beforeType.includes("water") || beforeType.includes("lava");
        if (!isBeforeLiquid) return;
        const productTypes = ["minecraft:stone", "minecraft:cobblestone", "minecraft:obsidian"];
        if (!productTypes.includes(afterType)) return;
        insertOperation({
            type: "liquid_react",
            xuid: "",
            name: "LiquidMix",
            playerPos: { x: 0, y: 0, z: 0, dimid: beforeBlock.pos.dimid },
            blockPos: posToObj(beforeBlock.pos),
            oldData: blockToData(beforeBlock),
            newData: blockToData(afterBlock),
            time: system.getTimeStr()
        });
    });
}

function showInspectInfo(player, pos) {
    const ops = queryOperations(
        pos.x, pos.y, pos.z,
        pos.x, pos.y, pos.z,
        pos.dimid, 5
    );
    if (ops.length > 0) {
        player.tell(`§e----- 监察 (${pos.x},${pos.y},${pos.z}) -----`);
        ops.forEach(op => {
            const relTime = relativeTime(op[15]);
            let line = `  §7${relTime}: §f${op[3]} §e${actionMap[op[1]] ? actionMap[op[1]].desc : op[1]}`;
            const data = (op[1] === "place" ? op[13] : op[12]) || op[13] || op[12];
            if (data) {
                try {
                    const d = JSON.parse(data);
                    if (d.name) line += ` §8[§6${d.name}§8]`;
                } catch(e) {}
            }
            player.tell(line);
        });
    }
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
    return `${Math.floor(hours / 24)}天前`;
}

module.exports = { registerEvents };