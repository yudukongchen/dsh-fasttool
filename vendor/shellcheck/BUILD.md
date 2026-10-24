# ShellCheck 源码与构建

## 对应源码

`source-v0.11.0.tar.gz` 来自 ShellCheck 官方仓库，提交为 `aac0823e6b58f8a499e856e93738082691cbf212`。此提交由官方 Windows ZIP 内的 `README.txt` 声明。原始二进制和源码均未修改，来源及摘要记录在 `UPSTREAM.json`。

解压源码后，按上游 `README.md` 的“Compiling ShellCheck”说明操作。需要 Haskell GHC 和 Cabal：

```console
tar -xzf source-v0.11.0.tar.gz
cd koalaman-shellcheck-aac0823
cabal update
cabal install
```

本目录的 `README.upstream.md` 保留完整上游说明。源码内的 `builders/windows.x86_64/`、`builders/run_builder` 和 `.github/workflows/build.yml` 保留上游 Windows 发布构建方式及脚本。编译依赖由 Cabal 获取。本次使用官方发布二进制，没有在本机重新编译 Haskell，也不声称上述构建会逐字节复现官方二进制。

## 插件中的载荷

在插件源码根目录执行 `npm run build:shellcheck`，会下载并校验固定的官方 ZIP，提取检查器并生成本机摘要记录。也可设置 `DSH_FASTTOOL_SHELLCHECK_ARCHIVE` 指向已下载的同一 ZIP。运行时只读取本地载荷，不自动下载。

GPL 文本见 `LICENSE` 和发布包原样附带的 `LICENSE.txt`。Node.js 插件与 ShellCheck 通过独立进程的标准输入输出通信，各部分保留原许可证。
