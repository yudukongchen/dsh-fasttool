# 来源记录

## FastCtx

- 来源：本地 `../fastctx` 克隆。
- 上游仓库：<https://github.com/yc-duan/fastctx>。
- 基线提交：`ccaa157790d02328a60786eb94ee5ad698995a5f`。
- 基线版本：`0.2.6`。
- 许可证：Apache-2.0，原始文件保留在 `runtime/LICENSE-APACHE` 和 `runtime/NOTICE`。

`runtime/UPSTREAM.json` 记录初次复制的 32 个 Rust 文件及原始字节的 SHA-256，同时记录统一为 LF 后的摘要。`npm run validate` 校验未修改文件与基线一致；允许修改的引擎文件为 `pdf_engine.rs`。提取保留了编码识别、路径处理、输出预算、并发遍历、排序和 PDF 检查。

专用 `runtime/src/server.rs` 和 `runtime/src/main.rs` 替代上游 MCP 服务与 CLI。运行时只注册需求中的三个名称，不包含 shell、替换、更新、控制面板和共享后台服务。

`runtime/src/session.rs` 使用进程环境与工作目录，替代上游共享运行时的会话配置。`runtime/src/read_tool/pdf_engine.rs` 因此移除了跨线程复制会话环境的部分，文件头已标记修改。每个进程只有一份环境，DSH 的会话路径由 Node.js 层显式解析。

`runtime/Cargo.toml` 更换包名和入口，裁剪无关依赖。`runtime/Cargo.lock` 基于上游锁文件重新解析。第三方许可目录保留。`runtime/build.rs` 新增 `DSH_FASTTOOL_PDFIUM_LIBRARY`，允许显式提供本地库并强制匹配原平台摘要；默认归档下载和摘要校验保持上游方式，文件头已标记修改。

## dsh-ops

- 来源：本地 `../dsh-ops` 克隆。
- 基线提交：`846bccc1b3240e458ddf9e0c02915c8287a6ed78`。
- 参考部分：Cordis 插件生命周期、工具注册、提示词段、manifest、bundle patch 和 MCP 标准输入输出传输。
- `lib/mcp-client.js` 改写自其 `lib/handshake.js`，采用 MIT 许可。修改包括插件名称、取消通知、响应缓冲上限和诊断缓冲上限。
- 原始 MIT 版权声明保留在根目录 `LICENSE` 和 `NOTICE`。

图片结果按 DSH `0.2.0-rc.2` 的附件和 `projectContent` 接口实现。插件不改写宿主共享注册方法；每个注册项通过自己的 disposer 回收。

## 基本安全检查

复用前检查了本地代码的构建脚本、网络调用、文件写入和进程操作。提取范围内的用户文件操作为读取；临时快照和 PDF 缓存仍会写入磁盘。上游更新下载、Codex 配置写入、命令执行和文件替换模块未复制。

Node.js 运行部分仅使用内置模块，不新增运行时 npm 依赖。开发依赖安装使用 `--ignore-scripts`。Rust 依赖由 Cargo 锁文件固定并校验包摘要；PDFium 来源和摘要由构建脚本固定。

2026 年 10 月 19 日检查 npm 依赖，未发现已知漏洞。通过 OSV 官方 API 检查锁文件中的 235 个 Rust 包，发现上游 `rustls 0.23.41` 的告警。该依赖属于构建时 PDFium 下载器。已升级为 `rustls 0.23.46` 和 `rustls-webpki 0.103.15`，并更新第三方许可中的版本标签。复查结果无告警，报告保留在 `docs/rust-dependency-audit.json`。这不替代完整供应链审计。

## ShellCheck 0.2.0 接入

检查器来自 [ShellCheck 0.11.0 官方发布](https://github.com/koalaman/shellcheck/releases/tag/v0.11.0)。官方 Windows ZIP 的 SHA-256 为 `8a4e35ab0b331c85d73567b12f2a444df187f483e5079ceffa6bda1faa2e740e`，本机下载匹配该值。完整来源及文件摘要见 `vendor/shellcheck/UPSTREAM.json`。

二进制内的原始 README 标明构建提交为 `aac0823e6b58f8a499e856e93738082691cbf212`。版本标签的源码归档指向不同提交，因此分发中使用精确匹配二进制的提交归档，未修改 ShellCheck 源码或二进制。GPL 许可证、原始二进制说明、源码、上游使用说明和构建说明一并保留。

2026 年 10 月 24 日检查了上游 CLI 文档、参数处理和构建来源。插件以固定参数启动分析器，脚本文本只写入其标准输入；不通过 Bash、PowerShell 或命令字符串执行。检查关闭 rc 配置并过滤继承的 ShellCheck 选项，不提供任意参数入口。输入、输出、并发数和运行时间均有限制。自定义 `shellcheckPath` 是操作者信任的可执行文件，不享受随包摘要校验。
