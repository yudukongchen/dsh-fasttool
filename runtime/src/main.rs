//! Dedicated stdio server; no shell, updater, edit, or shared runtime commands.
use dsh_fasttool_runtime::server::FastToolServer;
use rmcp::ServiceExt;

#[tokio::main]
async fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let command = match args.as_slice() {
        [] => Some("serve"),
        [arg] => Some(arg.as_str()),
        _ => None,
    };
    match command {
        Some("--version") | Some("-V") => {
            println!("dsh-fasttool-runtime {}", env!("CARGO_PKG_VERSION"));
        }
        Some("serve") => {
            let outcome = async {
                let service = FastToolServer::new()
                    .serve(rmcp::transport::stdio())
                    .await?;
                service.waiting().await?;
                Ok::<(), Box<dyn std::error::Error>>(())
            }
            .await;
            if let Err(error) = outcome {
                eprintln!("dsh-fasttool-runtime: {error}");
                std::process::exit(1);
            }
            // A lost owner closes stdin. Exit even if a blocking read is still winding down.
            std::process::exit(0);
        }
        _ => {
            eprintln!("Usage: dsh-fasttool-runtime [serve|--version]");
            std::process::exit(2);
        }
    }
}
