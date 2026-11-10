// macOS pieces Tauri doesn't cover: window levels over full-screen apps, a
// picture of a page, the clipboard, and whether the screen is locked.
use objc2::runtime::AnyObject;
use objc2::{msg_send, MainThreadMarker};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSPasteboard, NSPasteboardTypePNG};
use objc2_foundation::{NSData, NSDictionary, NSError};
use objc2_web_kit::WKWebView;
use std::sync::mpsc;
use std::time::Duration;

pub const SCREEN_SAVER_LEVEL: isize = 1000;
pub const FLOATING_LEVEL: isize = 3;
// CanJoinAllSpaces | Stationary | FullScreenAuxiliary
const BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 8);

/// Sits the window above full-screen apps on every Space. Main thread only.
pub fn raise(win: &tauri::WebviewWindow, level: isize) {
    let Ok(ptr) = win.ns_window() else { return };
    let ns = ptr as *mut AnyObject;
    unsafe {
        let _: () = msg_send![ns, setLevel: level];
        let _: () = msg_send![ns, setCollectionBehavior: BEHAVIOR];
    }
}

pub fn describe(win: &tauri::WebviewWindow) -> (isize, usize) {
    let Ok(ptr) = win.ns_window() else { return (-1, 0) };
    let ns = ptr as *mut AnyObject;
    unsafe {
        let level: isize = msg_send![ns, level];
        let behavior: usize = msg_send![ns, collectionBehavior];
        (level, behavior)
    }
}

fn png_from(image: &NSImage) -> Option<Vec<u8>> {
    let tiff = image.TIFFRepresentation()?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
    let props = NSDictionary::new();
    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props) }?;
    Some(png.to_vec())
}

/// A PNG of what the window's page shows right now. Call off the main thread.
pub fn snapshot(win: &tauri::WebviewWindow) -> Option<Vec<u8>> {
    let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
    let ok = win.with_webview(move |wv| {
        let view = wv.inner() as *mut WKWebView;
        let Some(view) = (unsafe { view.as_ref() }) else {
            let _ = tx.send(None);
            return;
        };
        let tx = tx.clone();
        let done = block2::RcBlock::new(move |image: *mut NSImage, _err: *mut NSError| {
            let png = unsafe { image.as_ref() }.and_then(png_from);
            let _ = tx.send(png);
        });
        unsafe { view.takeSnapshotWithConfiguration_completionHandler(None, &done) };
    });
    if ok.is_err() {
        return None;
    }
    rx.recv_timeout(Duration::from_secs(5)).ok().flatten()
}

/// Puts a PNG on the clipboard. Main thread only.
pub fn copy_png(png: &[u8]) -> bool {
    let _ = MainThreadMarker::new();
    let data = NSData::with_bytes(png);
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    unsafe { board.setData_forType(Some(&data), NSPasteboardTypePNG) }
}

// ---- Screen lock -------------------------------------------------------------

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGSessionCopyCurrentDictionary() -> core_foundation::dictionary::CFDictionaryRef;
}

/// Whether the login window is covering the session.
pub fn screen_locked() -> bool {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    let raw = unsafe { CGSessionCopyCurrentDictionary() };
    if raw.is_null() {
        return false;
    }
    let dict: CFDictionary<CFString, core_foundation::base::CFType> = unsafe { CFDictionary::wrap_under_create_rule(raw) };
    dict.find(CFString::from_static_string("CGSSessionScreenIsLocked"))
        .and_then(|v| v.downcast::<CFBoolean>())
        .map(bool::from)
        .unwrap_or(false)
}
