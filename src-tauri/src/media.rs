// Pauses music and videos while a break covers the screen, and plays them
// again after. Ported from src/main/media.js. macOS only: it presses the
// keyboard's play/pause key, which goes to whatever is playing (YouTube in a
// browser, Spotify, Music...).
//
// Pressing that key when nothing plays would start something, so Stip only
// presses it when the system says sound is coming out, and undoes the press
// if it started a player that wasn't playing before.
use std::collections::HashSet;
use std::sync::Mutex;

#[derive(Default)]
struct State {
    paused: bool,
    asked: bool,
    needs_access: bool,
    session: u64,
}

static STATE: Mutex<State> = Mutex::new(State { paused: false, asked: false, needs_access: false, session: 0 });

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Whether this build can pause media at all.
pub fn supported(sandboxed: bool) -> bool {
    cfg!(target_os = "macos") && !sandboxed
}

/// Posting a key press needs Accessibility access. With `prompt`, macOS asks
/// for it (once; after that the user turns it on in System Settings).
pub fn allowed(prompt: bool) -> bool {
    #[cfg(target_os = "macos")]
    {
        mac::trusted(prompt)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = prompt;
        false
    }
}

/// Processes sending sound to a speaker or headphones right now. Core Audio
/// holds a power assertion for each, which `pmset` lists with the owner's pid.
pub fn playing_pids() -> HashSet<u32> {
    let Ok(out) = std::process::Command::new("/usr/bin/pmset").args(["-g", "assertions"]).output() else {
        return HashSet::new();
    };
    parse_pmset(&String::from_utf8_lossy(&out.stdout), std::process::id())
}

fn parse_pmset(out: &str, ours: u32) -> HashSet<u32> {
    let mut pids = HashSet::new();
    let mut audio = false;
    let mut owner: Option<u32> = None;
    for line in out.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("pid ") && trimmed.contains('(') {
            audio = trimmed.contains("(coreaudiod)");
            owner = None;
        }
        if !audio {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("Created for PID: ") {
            owner = rest.trim_end_matches('.').trim().parse().ok();
        }
        if trimmed.starts_with("Resources:") && trimmed.split_whitespace().any(|w| w == "audio-out") {
            if let Some(pid) = owner.filter(|&p| p != ours) {
                pids.insert(pid);
            }
        }
    }
    pids
}

// The play/pause media key, as the keyboard sends it.
const PRESS_PLAY_PAUSE: &str = r#"
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
for (const flags of [0xa00, 0xb00]) {
  const event = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
    14, $.NSMakePoint(0, 0), flags, 0, 0, $(), 8, (16 << 16) | flags, -1);
  $.CGEventPost(0, event.CGEvent);
}"#;

fn press_play_pause() {
    let _ = std::process::Command::new("/usr/bin/osascript").args(["-l", "JavaScript", "-e", PRESS_PLAY_PAUSE]).output();
}

/// The break started: pause whatever is playing. Runs off the caller's thread.
pub fn pause() {
    let session = {
        let mut s = state();
        if s.paused {
            return;
        }
        s.session += 1;
        s.session
    };
    std::thread::spawn(move || {
        let before = playing_pids();
        if before.is_empty() || state().session != session {
            return;
        }
        if !allowed(false) {
            state().needs_access = true;
            return;
        }
        press_play_pause();
        {
            let mut s = state();
            // The break ended while the key was on its way: put it back.
            if s.session != session {
                drop(s);
                press_play_pause();
                return;
            }
            s.paused = true;
        }
        // Long enough for a player that wasn't playing to start making sound.
        std::thread::sleep(std::time::Duration::from_secs(4));
        if state().session != session || !state().paused {
            return;
        }
        // Something new started playing: the key went to an idle player.
        if playing_pids().iter().any(|pid| !before.contains(pid)) {
            state().paused = false;
            press_play_pause();
        }
    });
}

/// The break ended: play again what the break paused.
pub fn resume() {
    let (press, ask) = {
        let mut s = state();
        s.session += 1;
        // Ask once, after the break, so the system dialog isn't hidden under it.
        let ask = s.needs_access && !s.asked;
        if ask {
            s.asked = true;
        }
        s.needs_access = false;
        (std::mem::take(&mut s.paused), ask)
    };
    if ask {
        allowed(true);
    }
    if press {
        std::thread::spawn(press_play_pause);
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    }

    pub fn trusted(prompt: bool) -> bool {
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::from(prompt))]);
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"Listed by owning process:
   pid 647(coreaudiod): [0x1] 00:03:40 PreventUserIdleSystemSleep named: "com.apple.audio.context1.preventuseridlesleep"
	Created for PID: 4321.
	Resources: audio-out BuiltInSpeakerDevice
   pid 647(coreaudiod): [0x2] 01:14:02 PreventUserIdleSystemSleep named: "com.apple.audio.AudioTap.context.preventuseridlesleep"
	Created for PID: 976.
	Resources: audio-in 03055878
   pid 647(coreaudiod): [0x3] 00:00:10 PreventUserIdleSystemSleep named: "com.apple.audio.context2.preventuseridlesleep"
	Created for PID: 99.
	Resources: audio-out BuiltInSpeakerDevice
   pid 1016(Amphetamine): [0x4] 05:15:11 PreventUserIdleSystemSleep named: "Amphetamine"
	Created for PID: 555.
	Resources: audio-out Fake
"#;

    #[test]
    fn finds_programs_playing_sound_but_not_recording_or_us() {
        let pids = parse_pmset(SAMPLE, 99);
        assert_eq!(pids, HashSet::from([4321]));
    }
}
