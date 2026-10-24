# 交付记录

## 目标与时间

本次任务将本地 FastCtx 的三个只读工具提取为独立 DSH 插件，仓库名称为 `dsh-fasttool`。

开始时间为 2026 年 10 月 19 日 19:02（北京时间），本轮在一小时内完成实现与自动化验证。时间上限为 20:02。

## 实现

已初始化独立 Git 仓库，默认分支为 `main`。两个来源仓库原先均无未提交改动，本次没有修改它们。

运行时从 FastCtx 的三个工具计算引擎出发提取依赖，排除 shell、替换、控制面板、自动更新和共享服务。插件按要求注册三个名称，按调用会话解析路径，并随插件启停注册工具、提示词和回收子进程。

本次采用独立运行时，是为了让插件分发和进程实际能力均限定在这三个工具内。来源、许可、基本安全检查和改动边界记录在 `PROVENANCE.md`。

## 验证状态

当前在 Windows x64、Node.js 22.23.3 和 Rust 1.99.0 环境验证。

- `npm run verify` 最终通过，共 105 项测试，均未跳过。
- Node.js 单元和传输测试：10 项通过，覆盖配置、会话路径、环境过滤、错误结果、图片投影、并发请求、取消和子进程回收。
- 真实 MCP 测试：7 项通过，覆盖工具白名单、检索、Git 忽略规则、分页、批量读取、UTF-16/GBK、hex、PDF 文本和图片输出、错误输入。
- DSH `0.2.0-rc.2` 组合测试：3 项通过，覆盖实际 Cordis 注册、会话目录隔离、提示词、SDK schema、外部工具保留、卸载、进程崩溃重连和握手中关闭。
- Rust 测试：85 项通过，覆盖编码、快照、并发预算、取消、遍历、排序、路径转义、PDF 缓存与超时处理。
- manifest 通过 `@dsh-std/manifest` 的 Community 0.15 解析器校验。插件版本、bundle、名称、入口、locale 和来源摘要的交叉检查通过，`cargo fmt --check` 通过。
- Windows x64 发布版构建通过，包含 PDF。PDFium 使用本地同版本缓存库，SHA-256 与上游固定值一致。
- npm 依赖审计无告警；OSV 检查 235 个锁定 Rust 包，修复构建依赖后复查无告警。
- `npm pack --dry-run` 检查通过：包含专用二进制、摘要、插件入口、源码和许可证；不包含构建目录、开发依赖或测试夹具。
- 实际归档解包验证通过：84 个文件，包内 manifest、插件入口和独立运行时均可加载，CLI 返回准确的三个工具名称。解包副本不依赖源码仓库的运行时路径。
- 目标 DSH 桌面应用安装与手工调用：未执行，不修改用户现用 profile。

## 使用与复现

安装包为项目根目录的 `dsh-fasttool-0.1.0.tgz`，适用于 Windows x64。安装和参数示例见 README。源码仓库已初始化为 Git 项目，默认分支为 `main`。

本机首次下载曾遇到 TLS 和大包超时。构建依赖已按锁文件摘要验证，缓存保留在 `E:/Game/github/.scratch/dsh-fasttool-cargo-home`。复现本机验证时，可在 PowerShell 中设置：

```powershell
$env:CARGO_HOME = 'E:\Game\github\.scratch\dsh-fasttool-cargo-home'
$env:DSH_FASTTOOL_PDFIUM_LIBRARY = "$env:LOCALAPPDATA\fastctx\pdfium-chromium-7763-a63949dc46a7314b.dll"
$env:CARGO_NET_OFFLINE = 'true'
npm run build
npm run verify
```

`scripts/test-rust.mjs` 为测试创建独立的项目临时目录。首次直接使用系统 TEMP 时，11 项测试因目录 ACL 返回拒绝访问；更换测试临时目录后，85 项全部通过。此设置仅作用于测试进程及其子进程。

## 后续可继续的工作

在目标 DSH 桌面应用中安装本地包并手工确认 UI、模型调用和热重载；构建其它平台载荷。npm 发布和 Git 远程仓库配置需要另行指定发布目标。

## 已知限制

文件工具不接入 DSH 文件系统沙箱。阻塞文件检查的取消不保证立即停止磁盘读取。PDF 依赖固定版本的 PDFium，首次构建需要下载或提供经过校验的本地归档。

当前分发只携带 Windows x64 二进制。Rust 1.88 的最低版本要求沿用上游，本轮实际使用 Rust 1.99.0。保留的上游兼容函数会产生未使用代码告警，Rust 1.99 还会提示 `fetch_update` 弃用；本轮未改写这些引擎代码。
