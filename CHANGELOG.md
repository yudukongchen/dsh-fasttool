# 变更记录

## 0.2.0

新增 `fast-shellcheck`，随 Windows x64 安装包提供官方 ShellCheck 0.11.0。支持文件路径和直接源码检查、方言选择、严重级别过滤、规则排除及有界诊断输出。检查不会执行脚本。

增加超时、取消、卸载回收和并发限制。附带 GPL 许可、与二进制提交匹配的源码及构建说明。详细验证结果见 `docs/shellcheck-0.2.0.md`。Rust 文件工具运行时保持 0.1.0。

## 0.1.0

从本地 FastCtx 提取内容搜索、路径查找和文件检查引擎，提供独立的 DSH 插件。工具名称为 `fast-grep`、`fast-glob` 和 `fast_inspect_local_file`。

加入会话目录解析、插件生命周期回收、MCP 取消通知、图片附件投影和随包运行时摘要校验。使用方式见 README，验证状态见 `docs/delivery.md`。

升级构建下载器的 `rustls` 和 `rustls-webpki`，修复继承的锁文件告警。
