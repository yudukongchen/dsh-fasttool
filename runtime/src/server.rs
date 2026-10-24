//! dsh-fasttool's dedicated read-only MCP surface, using the extracted FastCtx engines.
use crate::glob_tool::{GlobRequest, glob_files};
use crate::grep_tool::{GrepRequest, grep_files};
use crate::read_tool::{ReadRequest, read_file};
use crate::{ImageDetail, ToolContent, ToolResponse};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, ContentBlock, ImageContent, Implementation, Meta, ServerCapabilities,
    ServerInfo,
};
use rmcp::service::RequestContext;
use rmcp::{RoleServer, ServerHandler, tool, tool_handler, tool_router};
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct FastToolServer {
    tool_router: ToolRouter<Self>,
    permits: Arc<Semaphore>,
}

impl Default for FastToolServer {
    fn default() -> Self {
        Self::new()
    }
}

impl FastToolServer {
    pub fn new() -> Self {
        let mut tool_router = Self::tool_router();
        for route in tool_router.map.values_mut() {
            route.attr.input_schema = Arc::new(crate::tool_schema::normalize_published_schema(
                &route.attr.input_schema,
            ));
        }
        Self {
            tool_router,
            permits: Arc::new(Semaphore::new(8)),
        }
    }

    async fn run(
        &self,
        cancel: CancellationToken,
        operation: impl FnOnce(CancellationToken) -> ToolResponse + Send + 'static,
    ) -> CallToolResult {
        let permit = tokio::select! {
            _ = cancel.cancelled() => return CallToolResult::error(vec![ContentBlock::text("Request cancelled.")]),
            permit = Arc::clone(&self.permits).acquire_owned() => permit.expect("admission gate stays open"),
        };
        // Dropping the async request cancels any ongoing grep/glob worker.
        let cancellation_guard = cancel.clone().drop_guard();
        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            operation(cancel)
        })
        .await;
        cancellation_guard.disarm();
        match result {
            Ok(response) => into_mcp_result(response),
            Err(error) => CallToolResult::error(vec![ContentBlock::text(format!(
                "File operation failed: {error}"
            ))]),
        }
    }
}

#[tool_router]
impl FastToolServer {
    #[tool(
        name = "fast-grep",
        description = "Search file contents with Rust regex (no lookaround). Prefer files_with_matches, count, or summary to limit output; content returns matching lines. glob[] filters support ! exclusions. Use an absolute local path. Reuse escaped filenames verbatim. Follow the returned Partial continuation offset exactly.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn grep(
        &self,
        Parameters(request): Parameters<GrepRequest>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        self.run(context.ct.child_token(), move |cancel| {
            grep_files(request, cancel)
        })
        .await
    }

    #[tool(
        name = "fast-glob",
        description = "Find file paths with pattern[] batches and ! exclusions. Choose paths or details output. Use an absolute local directory. Reuse escaped filenames verbatim. Follow the returned Partial continuation offset exactly.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn glob(
        &self,
        Parameters(request): Parameters<GlobRequest>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        self.run(context.ct.child_token(), move |cancel| {
            glob_files(request, cancel)
        })
        .await
    }

    #[tool(
        name = "fast_inspect_local_file",
        description = "Inspect text, images, PDFs, or raw bytes (view: hex). Prefer files[] batches for up to 32 text ranges. Text offset starts at 1; limit sets the line window. Supply encoding when known. PDF pages selects up to 20 pages; pdf_mode is text or image. Use absolute local paths. Follow returned continuation markers.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = false
        )
    )]
    async fn inspect(
        &self,
        Parameters(request): Parameters<ReadRequest>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        self.run(context.ct.child_token(), move |_| read_file(request))
            .await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for FastToolServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("dsh-fasttool-runtime", env!("CARGO_PKG_VERSION")))
            .with_instructions("Read-only local file tools: fast-grep, fast-glob, fast_inspect_local_file. Prefer batched queries and use absolute local paths. Follow each result's Complete/Partial marker.")
    }
}

fn into_mcp_result(response: ToolResponse) -> CallToolResult {
    let content = response
        .content
        .into_iter()
        .map(|block| match block {
            ToolContent::Text(text) => ContentBlock::text(text),
            ToolContent::Image {
                data,
                mime_type,
                detail,
            } => {
                let image = ImageContent::new(data, mime_type);
                if detail == Some(ImageDetail::High) {
                    let mut meta = Meta::new();
                    meta.0.insert(
                        "codex/imageDetail".into(),
                        serde_json::Value::String("high".into()),
                    );
                    ContentBlock::Image(image.with_meta(meta))
                } else {
                    ContentBlock::Image(image)
                }
            }
        })
        .collect();
    if response.is_error {
        CallToolResult::error(content)
    } else {
        CallToolResult::success(content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn surface_has_exactly_the_requested_read_only_tools() {
        let server = FastToolServer::new();
        let tools = server.tool_router.list_all();
        let mut names = tools
            .iter()
            .map(|tool| tool.name.as_ref())
            .collect::<Vec<_>>();
        names.sort_unstable();
        assert_eq!(names, ["fast-glob", "fast-grep", "fast_inspect_local_file"]);
        for tool in tools {
            assert_eq!(
                tool.annotations.as_ref().unwrap().read_only_hint,
                Some(true)
            );
            let schema = serde_json::to_string(&tool.input_schema).unwrap();
            assert!(!schema.contains("\"$ref\""));
        }
    }
}
