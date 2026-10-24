# dsh-fasttool

## 功能

DSH 只读文件工具与脚本检查插件。三个文件工具使用从本地 FastCtx 提取的 Rust 运行时，`fast-shellcheck` 使用官方 ShellCheck 可执行文件。

| 工具名称 | 用途 |
| --- | --- |
| `fast-grep` | 用 Rust 正则搜索内容，支持过滤、计数、摘要和分页。 |
| `fast-glob` | 按多个模式查找路径，支持排除、排序、详情和分页。 |
| `fast_inspect_local_file` | 检查文本范围、批量文本、编码、图片、PDF 和十六进制字节。 |
| `fast-shellcheck` | 静态检查 Bash/POSIX shell 脚本，返回规则编号、级别及行列位置。 |

Rust 运行时只注册前三个工具，脚本检查器由插件单独管理。检查器不执行脚本，不修改脚本文件。源代码不包含 FastCtx 的替换、shell 执行、后台任务、自动更新和 Codex 配置管理模块。

## 构建与验证

源码构建需要 Node.js `^22.19 || >=24`、Rust 1.88 或更高版本，以及对应平台的本地编译工具。Windows 使用 MSVC 工具链时需要 Visual Studio C++ Build Tools。

```console
npm ci --ignore-scripts
npm run build
npm run verify
npm run status
npm pack
npm run test:package
```

构建使用 `runtime/Cargo.lock`。首次构建会下载锁定的 Rust 依赖和固定版本的 PDFium。上游构建脚本会校验 PDFium 归档及库文件的 SHA-256。也可用 `FASTCTX_PDFIUM_ARCHIVE` 提供对应归档，以便离线构建。

如果已有相同版本的 PDFium 库，可用 `DSH_FASTTOOL_PDFIUM_LIBRARY` 指定库文件。此入口仍强制校验该平台固定的库摘要，不能使用任意版本替代。

二进制写入 `native/<platform>-<arch>/`，附带摘要记录。插件默认校验该记录再启动。`native/` 和 `runtime/target/` 不提交到 Git；安装打包文件时直接使用包内二进制，不运行安装脚本，也不修改系统 PATH。

开发时可以执行 `npm run build -- --no-pdf --debug`。此构建不支持 PDF，`npm pack` 会拒绝把它作为发布包。

Windows x64 的 `npm run build` 还会准备固定版本的 ShellCheck。已有文件工具二进制时，可单独执行 `npm run build:shellcheck`。构建时下载官方 `0.11.0` ZIP 并校验固定 SHA-256；离线构建可设置 `DSH_FASTTOOL_SHELLCHECK_ARCHIVE` 指向该 ZIP。安装包自带检查器，调用时不下载，不要求 Bash 或 WSL。

## 安装到 DSH

先构建并执行 `npm pack`，再用目标应用自带的官方 DSH CLI 安装本地包。下面用 `web` profile 举例：

```console
dsh plugin --profile web add E:/Game/github/dsh-fasttool/dsh-fasttool-0.2.0.tgz
```

桌面版应使用桌面应用自带的 CLI，并选择 `desktop` profile。按应用提示重载插件或重启。当前仓库没有发布到 npm，因此不能直接从 npm 市场安装。

本地包是否能被目标 DSH 版本的插件管理器接受，需要在目标应用中确认；自动化测试覆盖插件与 DSH `0.2.0-rc.2` 注册表的组合。

在插件配置行中可设置：

```yaml
config:
  promptPolicy: true
  required: true
  toolCallTimeoutMs: 300000
  # binaryPath: 'C:\tools\dsh-fasttool-runtime.exe'
  # shellcheckPath: 'C:\tools\shellcheck.exe'
  # cwd: 'E:\your-project'
```

- `promptPolicy`：注入工具使用说明；关闭或卸载插件时撤销。
- `required`：默认 `true`，运行时启动失败会使插件激活失败。设为 `false` 时记录错误，并对已创建的连接最多重试 5 次。
- `toolCallTimeoutMs`：单次调用的等待上限。超时会发送取消通知；文件检查中的阻塞读取可能继续运行，直到本次读取结束或进程关闭。
- `binaryPath`：指定已构建的专用运行时，必须是绝对路径。不能指向原版 `fastctx`。显式路径不使用随包摘要校验，由配置者确认来源。
- `cwd`：没有调用会话目录时的默认目录，必须是绝对路径。未设置时使用宿主启动目录。
- `shellcheckPath`：可选的 ShellCheck 绝对路径。默认使用随包并经过摘要校验的检查器，不自动搜索 PATH。其它平台可通过此配置使用本机 ShellCheck，需支持 `json1` 和 `--norc`。

开发验证可用 `DSH_FASTTOOL_BINARY` 指定运行时，用 `DSH_FASTTOOL_CARGO` 指定 Cargo。插件配置中的 `binaryPath` 优先于环境变量。

## 调用示例

搜索内容，多个过滤规则合并调用：

```json
{"pattern":"TODO|FIXME","path":"E:/your-project","glob":["**/*.rs","!target/**"],"output_mode":"summary"}
```

查找文件：

```json
{"pattern":["**/*.rs","**/*.toml","!target/**"],"path":"E:/your-project","limit":100}
```

批量读取不同文件或同一文件的多个范围：

```json
{"files":[{"path":"src/main.rs","offset":1,"limit":80},{"path":"Cargo.toml","offset":1,"limit":40}]}
```

相对路径按调用会话的 `header.cwd` 解析，插件不会修改宿主的工作目录。没有会话信息时使用配置的 `cwd`。文本行号从 1 开始。检索分页应使用结果中的 `Partial` 提示和续读偏移。

`fast-grep` 沿用上游的 Git 忽略规则。`fast-glob` 默认只读取普通 `.ignore`，同时包含隐藏文件和 `.git`，不读取 Git 忽略规则。用 `!` 模式显式排除不需要的目录。

## 检查 Bash 脚本

调用 `fast-shellcheck`，传入脚本路径：

```json
{"file_path":"scripts/build.sh","shell":"bash","severity":"warning"}
```

也可直接传入源码，无需创建临时文件。`file_path` 与 `script` 必须二选一：

```json
{"script":"#!/bin/bash\necho $name\n","exclude":["SC2154"],"max_diagnostics":100}
```

结果会指出第 2 行的 `SC2086`，提示给变量展开加双引号。检查发现问题时，调用仍返回成功结果；`structuredContent.clean` 为 `false`，`diagnostics` 中包含规则编号、级别、起止行列和说明。检查器无法启动、参数无效或读取失败时才返回工具错误。

`shell` 支持 `bash`、`sh`、`dash` 和 `ksh`，默认 `bash`。`severity` 是最低报告级别，默认 `style`，包含全部级别。`exclude` 最多接收 100 个 `SCxxxx` 编号。诊断默认最多返回 100 条，可用 `max_diagnostics` 调整至 500 条；截断时会明确标记，`total_diagnostics` 保留完整数量。

单次输入最多 2 MiB，最多同时运行 4 次检查。超时上限为 `toolCallTimeoutMs` 和 30 秒中的较小值。取消或卸载插件会终止自有检查进程。为使结果可复现，检查忽略 `.shellcheckrc` 和继承的 `SHELLCHECK_*` 环境选项，脚本内的 ShellCheck 指令仍由上游处理。

## 权限与限制

文件访问沿用运行宿主的用户权限，未接入 DSH 文件系统沙箱。只读指不提供用户文件修改工具；检索可能创建临时快照，PDF 支持会将校验过的库写入用户缓存。

图片结果通过 DSH 附件存储转换为持久附件，并要求当前模型声明图片输入能力。缺少附件服务或图片能力时返回文字说明；原始 MCP 图片仍保留在结构化结果中。

插件关闭时只回收自己创建的进程和注册项。服务意外退出后最多尝试重连 5 次，不扫描或终止其它 FastCtx 进程。传输层对单条未完成响应设置 128 MiB 上限。

构建包只携带当前平台的二进制。当前 ShellCheck 随包载荷支持 Windows x64。其它平台需要单独构建文件工具，并配置本机 ShellCheck。验证结果见 [初版交付记录](docs/delivery.md) 和 [ShellCheck 交付记录](docs/shellcheck-0.2.0.md)。

## 来源与许可证

Rust 代码来自本地 FastCtx `0.2.6`，基线提交为 `ccaa157790d02328a60786eb94ee5ad698995a5f`。DSH 插件接口参考本地 dsh-ops，MCP 传输代码由其 MIT 代码改写。详见 [来源记录](PROVENANCE.md)。

Node.js 插件采用 MIT，提取的 Rust 代码采用 Apache-2.0。独立的 ShellCheck 采用 GPL-3.0-or-later。组合分发标识为 `MIT AND Apache-2.0 AND GPL-3.0-or-later`；各组件按各自许可证分发。ShellCheck 通过独立进程通信。

`vendor/shellcheck/` 保留官方二进制说明、GPL 许可证、与二进制提交匹配的源码归档和构建说明。第三方许可与 PDFium 声明保留在 `runtime/` 中。

This product includes FastCtx
(https://github.com/yc-duan/fastctx), Copyright (c) 2026 yc-duan,
used under the Apache License 2.0.

FastCtx is redistributed and/or modified here by the maintainer of
this distribution. Any such change is that maintainer's own work
and their sole responsibility. It is not endorsed by, not
supported by, and not attributable to the author of FastCtx, who
accepts no liability of any kind arising from this distribution or
from anything built on top of it.
