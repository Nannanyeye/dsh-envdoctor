# 环境体检 · dsh-envdoctor

给 DSH 用的 Windows 开发环境管理器。扫描本机已装的开发工具，缺失的一键装到统一目录，自动管 PATH，还能把整套环境用一个 8 位短码分享给别人。

## 能做什么

- **体检**：30 种常用工具，扫全盘找出所有副本，给每个副本打分（可用的 / 捆绑的 / 可疑的）
- **安装**：稳定版 / 最新 / 指定版本；下载-解压-校验-加 PATH-跑 `--version` 全自动，带实时进度
- **预设包**：前端 / Java 后端 / Python 数据 / 命令行增强 / 逆向 / 媒体 / 云原生 / 数据库
- **分享**：把「装了哪些工具、什么版本」编码成短码，对方粘贴即还原同一套环境
- **PATH 管理**：合并用户级 + 系统级判断，只追加用户级，可生成便携 bat

## 安装

```
dsh plugin add dsh-envdoctor
```

装完重启 DSH，侧栏出现「环境体检」。

## 工具清单（30 个）

| 分类 | 工具 |
|---|---|
| 基础 | 7-Zip · Node.js · Python · Git · ffmpeg · PowerShell 7 · uv |
| 命令行 | jq · ripgrep · fd · bat · fzf |
| 开发 | JDK 21 · JDK 17 · Go · Maven · Gradle |
| 数据库 | MySQL 8.4 · PostgreSQL 16 · Redis · SQLite |
| 网络 | Nmap · kubectl · Helm · GitHub CLI |
| 媒体 | ImageMagick · Pandoc |
| 安全 | adb · Chrome · Ghidra |

加新工具**不用改代码** —— 编辑 `data/tools.json` 即可。

## 分享码怎么用

**A 分享给 B：**

```
A: 面板点「生成短码」→ 得到 A7K2M9XQ
A: 微信发：装环境用 A7K2M9XQ
B: 面板粘贴 A7K2M9XQ → 解析
B: 看到对比表（待装 / 已一致 / 版本不同 / 本地多出）
B: 点「按清单安装」
```

短码服务默认用 `https://ifhaoyi.xyz`（自建，只存压缩后的清单，不解压不解析）。
也可以留空，改用本地长码（约 250 字符），完全离线。

**三种码：**

| 类型 | 前缀 | 用途 |
|---|---|---|
| 长码 | `ENV1.` | 离线，直接粘贴 |
| 口令加密 | `ENV1E.` | 发公开群，没口令解不开（AES-256-GCM） |
| 签名 | `ENV1S.` | 官方预设包，Ed25519 验签 |

## 设置

存 `~/.dsh/plugins-data/envdoctor/settings.json`：

```json
{
  "root": "D:\\tools",
  "shareServer": "https://ifhaoyi.xyz"
}
```

`root` 留空会自动选盘（D: → E: → C: → 用户目录）。

## 不需要管理员权限

- 工具装在你选的目录（默认 `D:\tools`），不碰 `Program Files`
- PATH 写 `HKCU\Environment`，用户级，不需要提权
- 插件按绝对路径调用，即使 PATH 没生效也能用

## 短码服务

`share-server/server.mjs` 是一个零依赖单文件服务（207 行）：

```
POST /v1/env          {"d":"<压缩清单>"} → {"code":"A7K2M9XQ"}
GET  /v1/env/:code                       → {"d":"<压缩清单>"}
GET  /health                             → {"ok":true}
```

部署：`docker run -d --name env-share -p 8787:8787 -v $PWD:/app node:22-alpine node /app/server.mjs`

## License

MIT
