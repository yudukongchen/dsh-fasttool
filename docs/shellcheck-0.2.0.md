# fast-shellcheck 交付记录

## 变更与用法

2026 年 10 月 24 日新增 `fast-shellcheck`，解决 Windows 缺少 Bash 脚本静态检查入口的问题。插件版本升为 0.2.0；原有三个 Rust 文件工具及其二进制保持 0.1.0。

Windows x64 安装包携带 ShellCheck 0.11.0。无需 Bash、WSL 或系统安装的 ShellCheck。传入 `file_path` 或 `script` 二者之一，可选择方言、最低严重级别、排除规则及输出条数。相对文件路径使用当前 DSH 会话目录。

例如 `{"script":"echo $name\n","exclude":["SC2154"]}` 会返回 `SC2086`。问题作为诊断结果返回，包含行列、规则编号、级别及文字说明。检查不会执行脚本或修改源文件。

## 验证

已通过 17 项 Node.js 单元和传输测试，其中新增 7 项覆盖真实 ShellCheck。覆盖诊断、过滤、方言、语法错误、Unicode、输出截断、缺失文件、输入上限、取消、超时、并发限制及卸载回收。

`npm run verify` 整套回归通过，共 112 项，无跳过项：17 项 Node.js 单元与传输测试、7 项真实 MCP 测试、3 项 DSH 组合测试和 85 项 Rust 测试。真实 DSH 挂载测试确认第四个工具可见、可调用，卸载后只移除本插件工具，外来工具保留。

`npm run validate` 通过，确认 manifest 与四个工具名称一致，原始 FastCtx 文件摘要检查通过。npm 依赖审计返回 0 个已知漏洞。本轮未新增 npm 运行时依赖。

官方 ZIP 的 SHA-256 为 `8a4e35ab0b331c85d73567b12f2a444df187f483e5079ceffa6bda1faa2e740e`；检查器摘要为 `c9e82ada36ef4b8d4caf1f97fa89289048c8f4a33c2c76ffffc88bfe09ff00c5`。源码归档摘要与 `UPSTREAM.json` 一致，打包前强制校验。

`dsh-fasttool-0.2.0.tgz` 独立解包验证通过，共 97 个文件。归档内的插件入口、文件工具运行时和 ShellCheck 都可运行，包内 `fast-shellcheck` 能检出 `SC2086`。包内保留检查器、摘要、许可证、匹配源码和构建说明，不包含开发依赖、测试夹具或 Rust 构建目录。该验证不依赖原源码目录中的可执行文件。

## 来源、边界与限制

使用官方未修改的 Windows 二进制。ZIP 摘要由官方发布 API 提供，提取后再记录可执行文件摘要，加载时校验。对应源码按二进制内声明的精确提交保留，含 GPL 许可证和构建说明。见 `vendor/shellcheck/` 和 `PROVENANCE.md`。

只接受固定的分析参数，不提供任意命令或任意 CLI 参数。忽略 `.shellcheckrc` 和继承的 `SHELLCHECK_*` 环境选项。输入最多 2 MiB，输出缓冲最多 4 MiB，并发最多 4 次，运行上限 30 秒。诊断默认返回 100 条，上限 500 条，截断会明确标记。

文件权限沿用宿主用户，不接入 DSH 文件系统沙箱。源码内 ShellCheck 指令仍由上游解析。自定义检查器路径需要操作者自行信任。其它平台可通过 `shellcheckPath` 使用本机版本，但本轮只实测 Windows x64；未重新编译 Haskell，也未安装到用户现用的 DSH profile。
