// Answers the `stip` command: one JSON line in, one JSON reply out, over a
// socket only this user can open. No network.
use crate::app;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

static SOCKET: Mutex<Option<PathBuf>> = Mutex::new(None);

async fn serve<S: AsyncRead + AsyncWrite + Unpin>(stream: S, app: AppHandle) {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    if reader.read_line(&mut line).await.is_err() {
        return;
    }
    let reply = match serde_json::from_str::<Value>(&line) {
        Ok(request) => tauri::async_runtime::spawn_blocking(move || app::cli_command(&app, &request))
            .await
            .unwrap_or_else(|_| json!({ "error": "Stip didn't understand that." })),
        Err(_) => json!({ "error": "Stip didn't understand that." }),
    };
    let mut stream = reader.into_inner();
    let _ = stream.write_all(reply.to_string().as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(unix)]
pub fn start(app: &AppHandle, socket: PathBuf) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = std::fs::remove_file(&socket);
        let listener = match tokio::net::UnixListener::bind(&socket) {
            Ok(l) => l,
            Err(err) => return eprintln!("stip command unavailable: {err}"),
        };
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600));
        *SOCKET.lock().unwrap() = Some(socket);
        loop {
            let Ok((stream, _)) = listener.accept().await else { continue };
            tokio::spawn(serve(stream, app.clone()));
        }
    });
}

#[cfg(windows)]
pub fn start(app: &AppHandle, socket: PathBuf) {
    use tokio::net::windows::named_pipe::ServerOptions;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let name = socket.as_os_str().to_owned();
        let mut server = match ServerOptions::new().first_pipe_instance(true).create(&name) {
            Ok(s) => s,
            Err(err) => return eprintln!("stip command unavailable: {err}"),
        };
        loop {
            if server.connect().await.is_err() {
                continue;
            }
            let Ok(next) = ServerOptions::new().create(&name) else { return };
            let client = std::mem::replace(&mut server, next);
            tokio::spawn(serve(client, app.clone()));
        }
    });
}

/// Removes the socket file on the way out.
pub fn cleanup() {
    if let Some(path) = SOCKET.lock().unwrap().take() {
        let _ = std::fs::remove_file(path);
    }
}
