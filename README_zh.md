# BlockLog - Minecraft 基岩版服务器方块操作记录与回档插件

## 简介

BlockLog 是一款基于 [Levilamina](https://github.com/LiteLDev/Levilamina) 的 Minecraft 基岩版服务器插件。它能够记录玩家在游戏中的方块放置、破坏、物品容器变动、爆炸、液体反应等操作，支持按坐标、玩家、时间、方块类型等条件检索，并提供回档（回滚/恢复）功能。内置的 Web 管理面板允许管理员通过浏览器查看日志、管理用户、生成 Token 等。

## 特性

- **完整的操作记录**：覆盖放置、破坏、爆炸、容器变动、物品栏变动、拾取/丢弃、液体反应等 8 种事件。
- **强大的查询系统**：支持按玩家名、时间范围、坐标半径、操作类型、包含/排除方块等组合过滤。
- **可视化回档**：在游戏内或通过 Web 面板选择记录进行回滚或恢复，支持容器内物品的完整还原。
- **分层权限管理**：超级管理员、管理员、普通用户三级角色，可配合 Token 注册使用。
- **Web 管理面板**：提供登录、用户管理、Token 管理、操作日志查看、系统状态监控等功能。
- **性能友好**：使用 SQLite 本地存储，默认 10 格半径的查询范围，普通玩家查询半径上限可配置。

## 安装要求

- Levilamina 1.0.0 或更高版本
- Node.js 环境（随 Levilamina 内置，无需额外安装）
- 依赖项（通过 `lip` 或手动安装）：
  - express
  - express-session
  - bcryptjs

## 安装步骤

1. 将本仓库克隆或下载到 BDS 根目录下的 `plugins/` 文件夹中，确保路径为 `plugins/BlockLog/`。
2. 进入 `plugins/BlockLog/` 目录，安装依赖：
   ```bash
   lip install express express-session bcryptjs
   ```
   （若使用官方 Levilamina 环境，也可直接将 `node_modules` 目录一并放入插件文件夹）
3. 启动服务器，插件将自动初始化数据库并生成配置文件。
4. **首次启动**后，会在 `plugins/BlockLog/initial_token.txt` 生成一个超级管理员令牌，请妥善保管并使用它注册管理员账号。

## 配置文件

`config.json` 位于 `plugins/BlockLog/` 下，默认内容：

```json
{
  "webPort": 3000,
  "allowRecord": true,
  "maxLogLines": 1000,
  "sessionSecret": "随机生成"
}
```

- **webPort**：Web 管理面板监听端口。
- **allowRecord**：是否记录操作事件（可通过游戏内 `/bl consumer on|off` 动态切换）。
- **maxLogLines**：API 返回的最大日志行数限制。
- **sessionSecret**：Web 会话加密密钥，首次启动自动生成，请勿泄露。

## 命令用法

所有命令前缀为 `/blocklog` 或 `/bl`，仅玩家可用（控制台可执行 `status`、`reload` 等部分命令）。

| 命令                                    | 说明                   |
| --------------------------------------- | ---------------------- |
| `/bl help`                              | 显示帮助信息           |
| `/bl inspect` (简写 `i`)                | 开启/关闭监察模式       |
| `/bl lookup` (简写 `l`) [参数]          | 查询操作记录           |
| `/bl rollback` (简写 `rb`) [参数]       | 回滚操作（需 OP）      |
| `/bl restore` (简写 `rs`) [参数]        | 恢复操作（需 OP）      |
| `/bl purge t:<时间> [#vacuum]`          | 清理旧数据（需 OP）    |
| `/bl reload`                            | 重载配置文件（需 OP）  |
| `/bl status`                            | 查看插件状态           |
| `/bl consumer [on/off]`                 | 开启/暂停事件记录（需 OP） |

**查询参数说明**（适用于 `lookup`、`rollback`、`restore`）：

- `u:<玩家名>`        - 按玩家过滤
- `t:<时间>`          - 时间范围，如 `t:30m`、`t:2h`、`t:1h-30m`
- `r:<半径|#global>`  - 坐标半径，`r:20` 或 `r:#global` 全局不限
- `a:<操作组>`        - 操作类型，如 `a:+block`（放置）、`a:-block`（破坏）、`a:container`（容器）
- `i:<方块名>`        - 包含方块/物品名（支持部分匹配）
- `e:<方块名>`        - 排除方块/物品名
- `#preview`          - 预览模式（返回记录数，不显示详情）
- `#count`            - 仅显示计数

**示例**：
- 查看 Steve 在 20 格范围内最近 1 小时的放置记录：  
  `/bl l u:Steve t:1h r:20 a:+block`
- 回滚全局所有名为 `TNT` 的破坏事件：  
  `/bl rb r:#global a:-block i:tnt`

## Web 管理面板

插件启动后，访问 `http://服务器IP:端口`（默认 3000）即可打开管理界面。

### 首次使用

1. 使用超级管理员 Token 登录（位于 `plugins/BlockLog/initial_token.txt`，使用后文件会自动删除）。
2. 在 “Token 管理” 中生成不同角色的注册令牌。
3. 普通用户或管理员可使用令牌在注册页面创建账号，之后通过用户名+密码登录。

### 功能页面

- **仪表盘**：在线人数、今日操作数等概览。
- **操作日志**：实时显示最新记录，可条件筛选并单条回档。
- **用户管理**：仅超级管理员可查看、删除用户。
- **Token 管理**：生成、删除注册令牌，控制用户注册权限。

## API 接口

Web 面板通过内部 REST API 工作，也可供高级用户直接调用。所有接口需通过 Session 认证（登录后获得），部分接口需管理员或超级管理员权限。

常用接口：

- `POST /api/login` - 账号密码登录
- `POST /api/login-token` - Token 登录
- `POST /api/register` - 使用 Token 注册
- `GET /api/operations` - 查询操作记录（支持空间与时间参数）
- `POST /api/rollback` - 按操作 ID 数组执行回档
- `GET /api/stats` - 获取服务器状态

完整接口可查看 `src/web.js` 中的路由定义。

## 权限说明

| 角色          | 游戏内命令权限   | Web 面板权限                     |
| ------------- | ---------------- | -------------------------------- |
| 普通用户      | 查询（半径受限） | 查看日志、修改密码               |
| 管理员        | 回档、清理、开关 | 回档操作、查看日志               |
| 超级管理员    | 同管理员         | 用户管理、Token 管理、系统配置   |

## 开源协议

本项目采用 MIT 许可证，详见 LICENSE 文件。

## 致谢

- Levilamina 开发团队
- 本插件灵感来源于 Java 版 CoreProtect 插件

---

**注意**：本插件仅适用于 Minecraft 基岩版，与 Java 版不兼容。在生产环境使用前，建议先在测试服验证回档功能，避免误操作造成不可逆损失。
