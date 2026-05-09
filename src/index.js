// index.js
const { initDatabase, closeDatabase, createInitialSuperToken } = require("./modules/database");
const { registerEvents } = require("./modules/events");
const { registerCommand, setConfig, setConsumer } = require("./modules/command");
const { startServer, stopServer } = require("./web");
const configPath = "plugins/BlockLog/config.json";

logger.info("")
logger.info("             ____  _            _    _                ")
logger.info("            | __ )| | ___   ___| | _| |    ___   __ _ ")
logger.info("            |  _ \\| |/ _ \\ / __| |/ / |   / _ \\ / _` |")
logger.info("            | |_) | | (_) | (__|   <| |__| (_) | (_| |")
logger.info("            |____/|_|\\___/ \\___|_|\\_\\_____\\___/ \\__, |")
logger.info("                                                |___/ ")
logger.info("")
logger.info("                A Minecraft Server BlockLog Plugin")
logger.info("         Author: Lanjian; Version 1.0.1, ALL RIGHTS RESERVED")
logger.info("")
// 读取或创建配置文件
let config = {};
if (File.exists(configPath)) {
    try {
        config = JSON.parse(File.readFrom(configPath));
    } catch (e) {
        logger.warn("配置文件解析失败，使用默认配置");
    }
}

if (!config.webPort) config.webPort = 3000;
if (config.allowRecord === undefined) config.allowRecord = true;
if (!config.maxLogLines) config.maxLogLines = 500;
if (!config.sessionSecret || config.sessionSecret === "") {
    config.sessionSecret = require("crypto").randomBytes(32).toString("hex");
    File.writeTo(configPath, JSON.stringify(config, null, 2));
    logger.info("已生成新的 sessionSecret");
}


if (!File.exists("plugins/BlockLog")) File.mkdir("plugins/BlockLog");


initDatabase();
createInitialSuperToken();
registerCommand();


setConfig(config);
setConsumer(true);


registerEvents();


mc.listen("onServerStarted", () => {
    startServer(config);
    logger.info(`BlockLog Web 面板已启动: http://localhost:${config.webPort}`);
});

ll.onUnload(() => {
    stopServer();
    closeDatabase();
    logger.info("BlockLog 已关闭");
});