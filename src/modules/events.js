// modules/events.js
const { insertOperation, nameToUid } = require("./database.js");
const { getConsumer, inspectPlayers, formatRecord } = require("./command.js"); 
const { queryOperations } = require("./database.js");    

let _inspectClickCount = {};

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

// 修改：将 type 转换为 uid 再存入 JSON
function blockToData(block) {
    const blockNbt = block.getNbt();
    const be = block.getBlockEntity();
    let beNbtSnbt = null;
    if (be) {
        const beNbt = be.getNbt();
        if (beNbt) beNbtSnbt = beNbt.toSNBT();
    }
    return JSON.stringify({
        name: block.name,              // name 暂不转uid，仅type转
        type: nameToUid(block.type),
        tileData: block.tileData,
        nbt: blockNbt?.toSNBT() || "",
        beNbt: beNbtSnbt
    });
}

function itemToData(item) {
    if (!item || item.isNull()) return "";
    return JSON.stringify({
        name: item.name,
        type: nameToUid(item.type),
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
                    name: cb.name,
                    type: nameToUid(cb.type),  // 容器类型也转uid
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

    mc.listen("onUseItemOn", (player, item, block, side, pos) => {
        if (!inspectPlayers.has(player.xuid)) return;
        if (block.hasContainer()){
            showInspectInfo(player, block.pos);
            return;
        }
        _inspectClickCount[player.xuid] = (_inspectClickCount[player.xuid] || 0) + 1;
        if (_inspectClickCount[player.xuid] >= 10) {
            _inspectClickCount[player.xuid] = 0;
            showInspectInfo(player, block.pos);
        }
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
            player.tell(formatRecord(op, true));
        });
    } else {
        player.tell(`§7[监察] (${pos.x},${pos.y},${pos.z}) 暂无操作记录`);
    }
}

module.exports = { registerEvents };
