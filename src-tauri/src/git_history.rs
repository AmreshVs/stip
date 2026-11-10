// Your own recent commits in the folders you chose: when, and whether the
// message looks like a fix. Read here, kept in memory, and never sent anywhere.
use chrono::{DateTime, Local, Timelike};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Clone, Debug, PartialEq)]
pub struct Commit {
    pub date: String,
    pub hour: u32,
    pub fix: bool,
}

const FIX_WORDS: &[&str] = &["fix", "fixes", "fixed", "hotfix", "bug", "oops", "revert"];

/// Like /\b(fix|fixes|...)\b/i: a whole word, ignoring case.
fn looks_like_fix(subject: &str) -> bool {
    subject
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .any(|word| FIX_WORDS.contains(&word.to_ascii_lowercase().as_str()))
}

pub fn parse_line(line: &str) -> Option<Commit> {
    let (stamp, subject) = line.split_once('\t').unwrap_or((line, ""));
    let date = DateTime::parse_from_rfc3339(stamp.trim()).ok()?.with_timezone(&Local);
    Some(Commit { date: date.format("%Y-%m-%d").to_string(), hour: date.hour(), fix: looks_like_fix(subject) })
}

// Runs git, giving up after five seconds.
fn git(folder: &str, args: &[&str]) -> String {
    let Ok(mut child) = Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return String::new();
    };
    let mut stdout = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut out = String::new();
        let _ = std::io::Read::read_to_string(&mut stdout, &mut out);
        let _ = tx.send(out);
    });
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(out) => {
            let ok = child.wait().map(|s| s.success()).unwrap_or(false);
            if ok { out } else { String::new() }
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            String::new()
        }
    }
}

pub fn recent_commits(folders: &[String], days: u32) -> Vec<Commit> {
    let handles: Vec<_> = folders
        .iter()
        .cloned()
        .map(|folder| {
            std::thread::spawn(move || {
                let email = git(&folder, &["config", "user.email"]).trim().to_string();
                if email.is_empty() {
                    return vec![];
                }
                let since = format!("--since={days}.days");
                let author = format!("--author={email}");
                git(&folder, &["log", &since, &author, "--format=%aI%x09%s"])
                    .lines()
                    .filter(|l| !l.is_empty())
                    .filter_map(parse_line)
                    .collect::<Vec<_>>()
            })
        })
        .collect();
    handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_log_lines_parse_and_fixes_are_spotted() {
        let fixed = parse_line("2026-10-30T20:15:00+05:30\tFix the tray\twith a tab").unwrap();
        assert!(fixed.fix);
        assert!(fixed.date.starts_with("2026-10-"));
        assert!(!parse_line("2026-10-30T20:15:00+05:30\tAdd prefix support").unwrap().fix);
        assert!(parse_line("2026-10-30T20:15:00+05:30\tbugfix: not a whole word").is_some_and(|c| !c.fix));
        assert!(parse_line("2026-10-30T20:15:00Z\tRevert \"x\"").unwrap().fix);
    }

    #[test]
    fn reads_this_repository() {
        if cfg!(feature = "mas") {
            return;
        }
        let root = env!("CARGO_MANIFEST_DIR").to_string() + "/..";
        // Whatever the history holds, it parses without trouble.
        let _ = recent_commits(&[root], 14);
        assert_eq!(recent_commits(&["/nonexistent/stip".into()], 14), vec![]);
    }
}
