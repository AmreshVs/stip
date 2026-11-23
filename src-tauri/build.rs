// Copies the renderer pages (shared with the Electron app) and the fonts they
// import into ui-dist/, keeping their relative paths, so Tauri can embed them
// without pulling in the rest of node_modules.
use std::fs;
use std::path::{Path, PathBuf};

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        let dest = to.join(entry.file_name());
        if path.is_dir() {
            copy_dir(&path, &dest);
        } else {
            fs::copy(&path, &dest).unwrap();
        }
    }
}

// The CSP in each page allows only its own origin. Tauri's IPC goes through
// the ipc: scheme, so the staged copies allow that too.
fn allow_ipc(dir: &Path) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            allow_ipc(&path);
        } else if path.extension().is_some_and(|e| e == "html") {
            let html = fs::read_to_string(&path).unwrap();
            let html = html.replace(
                "default-src 'self';",
                "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost;",
            );
            fs::write(&path, html).unwrap();
        }
    }
}

// Each @import in base.css is a fontsource stylesheet; copy it with the woff2
// files it names (WebKit and WebView2 never fall back to the woff ones). They
// go in vendor/, since the Tauri CLI won't bundle a node_modules folder, and
// the staged base.css points there.
fn copy_fonts(root: &Path, out: &Path) {
    let base = fs::read_to_string(root.join("src/renderer/shared/base.css")).unwrap();
    for line in base.lines() {
        let Some(rest) = line.split("node_modules/").nth(1) else { continue };
        let rel = rest.split('\'').next().unwrap();
        let css_from = root.join("node_modules").join(rel);
        let css_to = out.join("vendor").join(rel);
        let Ok(css) = fs::read_to_string(&css_from) else {
            println!("cargo:warning=missing font stylesheet {}; run npm install", css_from.display());
            continue;
        };
        fs::create_dir_all(css_to.parent().unwrap().join("files")).unwrap();
        fs::write(&css_to, &css).unwrap();
        for part in css.split("url(./").skip(1) {
            let file = part.split(')').next().unwrap();
            if file.ends_with(".woff2") {
                let from = css_from.parent().unwrap().join(file);
                let _ = fs::copy(&from, css_to.parent().unwrap().join(file));
            }
        }
    }
    let staged = out.join("src/renderer/shared/base.css");
    fs::write(&staged, base.replace("../../../node_modules/", "../../../vendor/")).unwrap();
}

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest.parent().unwrap().to_path_buf();
    let out = manifest.join("ui-dist");
    let _ = fs::remove_dir_all(&out);
    copy_dir(&root.join("src/renderer"), &out.join("src/renderer"));
    allow_ipc(&out);
    copy_fonts(&root, &out);
    println!("cargo:rerun-if-changed=../src/renderer");
    println!("cargo:rerun-if-changed=src/bridge.js");
    tauri_build::build()
}
