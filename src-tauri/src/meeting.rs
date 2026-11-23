// Tracks whether the user is in a call: either they said so (meeting mode),
// or a known call process is running.
use crate::flow::base_name;

// Processes that only run while a call is live. Zoom spawns CptHost when
// you join a meeting and quits it when you leave.
const CALL_PROCESSES: &[&str] = &["cpthost"];

pub fn is_call_process(name: &str) -> bool {
    CALL_PROCESSES.contains(&base_name(name).as_str())
}

/// Names (or paths) of running programs. Empty if they can't be listed.
pub fn list_processes() -> Vec<String> {
    #[cfg(windows)]
    let out = {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW, so no console flashes up every 15 seconds.
        std::process::Command::new("tasklist").args(["/fo", "csv", "/nh"]).creation_flags(0x0800_0000).output()
    };
    #[cfg(not(windows))]
    let out = std::process::Command::new("ps").args(["-A", "-o", "comm="]).output();
    let Ok(out) = out else { return vec![] };
    if !out.status.success() {
        return vec![];
    }
    parse_list(&String::from_utf8_lossy(&out.stdout), cfg!(windows))
}

fn parse_list(stdout: &str, windows: bool) -> Vec<String> {
    stdout
        .lines()
        .map(|line| {
            if windows {
                line.split("\",\"").next().unwrap_or("").trim_start_matches('"').to_string()
            } else {
                line.trim().to_string()
            }
        })
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Default)]
pub struct Meeting {
    pub manual_until: i64,
    pub auto_detected: bool,
}

impl Meeting {
    pub fn update_processes<S: AsRef<str>>(&mut self, names: &[S]) {
        self.auto_detected = names.iter().any(|n| is_call_process(n.as_ref()));
    }

    /// Meeting mode switches itself off after a while in case it's forgotten.
    pub fn set_manual(&mut self, on: bool, now: i64) {
        const MAX_MINUTES: i64 = 90;
        self.manual_until = if on { now + MAX_MINUTES * 60 * 1000 } else { 0 };
    }

    pub fn manual(&self, now: i64) -> bool {
        now < self.manual_until
    }

    pub fn active(&self, now: i64) -> bool {
        self.manual(now) || self.auto_detected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_calls_are_spotted_by_their_helper() {
        let mut m = Meeting::default();
        m.update_processes(&["/Applications/zoom.us.app/Contents/Frameworks/CptHost.app/Contents/MacOS/CptHost"]);
        assert!(m.active(0));
        m.update_processes(&["CptHost.exe"]);
        assert!(m.active(0));
        m.update_processes(&["/Applications/zoom.us.app/Contents/MacOS/zoom.us"]);
        assert!(!m.active(0));
    }

    #[test]
    fn meeting_mode_runs_out_after_90_minutes() {
        let mut m = Meeting::default();
        m.set_manual(true, 0);
        assert!(m.manual(89 * 60 * 1000));
        assert!(!m.manual(90 * 60 * 1000));
        m.set_manual(false, 0);
        assert!(!m.active(0));
    }

    #[test]
    fn process_lists_parse_on_each_platform() {
        assert_eq!(parse_list("  /sbin/launchd\n/usr/bin/ps\n\n", false), vec!["/sbin/launchd", "/usr/bin/ps"]);
        assert_eq!(
            parse_list("\"System\",\"4\",\"Services\"\r\n\"CptHost.exe\",\"99\",\"Console\"\r\n", true),
            vec!["System", "CptHost.exe"]
        );
    }

    #[test]
    fn this_computer_lists_its_programs() {
        if cfg!(feature = "mas") {
            return;
        }
        assert!(!list_processes().is_empty());
    }
}
