// Spots when you're deep in something, so a break can wait for a natural
// pause. It only ever sees how long the computer has been idle and the names
// of running programs, never what you type.
use std::collections::VecDeque;

const WINDOW_SEC: usize = 60;
const ACTIVE_IDLE_SEC: f64 = 3.0;
const BUSY_SEC: usize = 30;
const PAUSE_SEC: f64 = 10.0;

// Compilers and build tools that only run while a build is going.
const BUILD_PROCESSES: &[&str] = &[
    "cargo", "rustc", "xcodebuild", "swiftc", "clang", "clang+", "clang++", "gcc", "g++", "mvn", "gradle",
    "msbuild", "ninja", "make", "bazel",
];

/// The program's own name, from a path or a Windows image name, lowercased
/// and without ".exe".
pub fn base_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).to_lowercase();
    base.strip_suffix(".exe").map(str::to_string).unwrap_or(base)
}

pub fn is_build_process(name: &str) -> bool {
    BUILD_PROCESSES.contains(&base_name(name).as_str())
}

#[derive(Default)]
pub struct Flow {
    samples: VecDeque<bool>,
    idle_sec: f64,
    building: bool,
}

impl Flow {
    /// Called once a second with the system idle time.
    pub fn note(&mut self, idle_sec: f64) {
        self.idle_sec = idle_sec;
        self.samples.push_back(idle_sec < ACTIVE_IDLE_SEC);
        if self.samples.len() > WINDOW_SEC {
            self.samples.pop_front();
        }
    }

    pub fn update_processes<S: AsRef<str>>(&mut self, names: &[S]) {
        self.building = names.iter().any(|n| is_build_process(n.as_ref()));
    }

    /// Busy for most of the last minute and hasn't paused yet, or mid-build.
    pub fn active(&self) -> bool {
        let busy = self.samples.iter().filter(|b| **b).count() >= BUSY_SEC && self.idle_sec < PAUSE_SEC;
        busy || self.building
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn busy_for(flow: &mut Flow, seconds: usize, idle: f64) {
        for _ in 0..seconds {
            flow.note(idle);
        }
    }

    #[test]
    fn in_flow_after_being_busy_for_most_of_a_minute() {
        let mut flow = Flow::default();
        busy_for(&mut flow, 29, 0.0);
        assert!(!flow.active());
        busy_for(&mut flow, 1, 0.0);
        assert!(flow.active());
    }

    #[test]
    fn a_pause_of_10_seconds_ends_flow() {
        let mut flow = Flow::default();
        busy_for(&mut flow, 60, 0.0);
        flow.note(9.0);
        assert!(flow.active());
        flow.note(10.0);
        assert!(!flow.active());
    }

    #[test]
    fn old_activity_falls_out_of_the_last_minute() {
        let mut flow = Flow::default();
        busy_for(&mut flow, 60, 0.0);
        busy_for(&mut flow, 31, 5.0);
        assert!(!flow.active());
    }

    #[test]
    fn a_running_build_counts_as_flow_on_any_platform() {
        let mut flow = Flow::default();
        flow.update_processes(&["/usr/bin/login", "/Users/me/.cargo/bin/cargo"]);
        assert!(flow.active());
        flow.update_processes(&["cl.exe", "MSBuild.exe"]);
        assert!(flow.active());
        flow.update_processes(&["/usr/bin/login", "Cargo Notes"]);
        assert!(!flow.active());
    }
}
