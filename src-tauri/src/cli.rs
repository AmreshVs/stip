// The `stip` command, built into the app: `Stip --cli status`. It talks to
// the running app over a private local socket and never touches the network.
// The same protocol serves src/cli.js: one JSON line in, one JSON reply out.
use serde_json::{json, Value};
use std::path::PathBuf;

pub const HELP: &str = "Usage: stip <command>

  status            When the next break is, and today's numbers
  break             Start a stand break now
  water             Show the water reminder now
  sip               Log a glass of water
  pause <time>      Pause reminders: 30m, 1h, or today
  resume            Turn reminders back on
  meeting on|off    Turn meeting mode on or off

Add --json to status for machine-readable output.
Example: npm run build && stip break";

pub fn socket_path() -> PathBuf {
    if let Ok(path) = std::env::var("STIP_SOCKET") {
        return PathBuf::from(path);
    }
    if cfg!(windows) {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        return PathBuf::from(format!(r"\\.\pipe\stip-{user}"));
    }
    home().join(".stip.sock")
}

pub fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default()
}

#[derive(Debug, PartialEq)]
pub enum Minutes {
    Day,
    Some(i64),
}

/// "30m", "1h", "90" (minutes) or "today".
pub fn parse_duration(text: Option<&str>) -> Option<Minutes> {
    let text = text?;
    if text == "today" {
        return Some(Minutes::Day);
    }
    let digits: String = text.chars().take_while(|c| c.is_ascii_digit()).collect();
    let unit = &text[digits.len()..];
    let n: i64 = digits.parse().ok()?;
    let factor = match unit {
        "" | "m" | "min" => 1,
        "h" | "hr" => 60,
        _ => return None,
    };
    (n > 0).then_some(Minutes::Some(n * factor))
}

/// Turns the command line into a request, or an error to print.
pub fn parse_args(args: &[String]) -> Result<Value, String> {
    let command = args.first().map(String::as_str);
    let value = args.get(1).map(String::as_str);
    match command {
        Some(c @ ("status" | "break" | "water" | "sip" | "resume")) => Ok(json!({ "command": c })),
        Some("pause") => match parse_duration(value) {
            Some(Minutes::Day) => Ok(json!({ "command": "pause", "minutes": "day" })),
            Some(Minutes::Some(m)) => Ok(json!({ "command": "pause", "minutes": m })),
            None => Err("Say how long, like: stip pause 30m, 1h or today".into()),
        },
        Some("meeting") => match value {
            Some(v @ ("on" | "off")) => Ok(json!({ "command": "meeting", "on": v == "on" })),
            _ => Err("Use: stip meeting on, or stip meeting off".into()),
        },
        _ => Err(HELP.into()),
    }
}

pub fn clock(ms: i64) -> String {
    let total = (ms as f64 / 1000.0).ceil() as i64;
    format!("{}:{:02}", total / 60, total % 60)
}

pub fn describe(reply: &Value) -> String {
    let status = &reply["status"];
    let flag = |k: &str| status[k].as_bool().unwrap_or(false);
    let paused = status["pausedUntil"].as_i64().unwrap_or(0);
    let next = if flag("onBreak") {
        "On a break".to_string()
    } else if paused > 0 {
        format!("Paused until {}", crate::scheduler::local(paused).format("%H:%M"))
    } else if flag("offHours") {
        "Outside working hours".into()
    } else if flag("waitingForMeeting") {
        "Break waiting for your call to end".into()
    } else if flag("waitingForFlow") {
        "Break starts at your next pause".into()
    } else {
        format!("Next break in {}", clock(status["msToStand"].as_i64().unwrap_or(0)))
    };
    let today = &reply["today"];
    let mut lines = vec![
        next,
        format!(
            "Today: {} breaks, {} glasses, {}-day streak",
            today["breaks"].as_u64().unwrap_or(0),
            today["glasses"].as_u64().unwrap_or(0),
            reply["streak"].as_u64().unwrap_or(0)
        ),
    ];
    if reply["meeting"].as_bool().unwrap_or(false) {
        lines.push("Meeting mode is on".into());
    }
    lines.join("\n")
}

/// Sends one request and waits for the reply.
pub fn send(request: &Value, socket: &std::path::Path) -> std::io::Result<Value> {
    use std::io::{Read, Write};
    #[cfg(unix)]
    let mut stream = std::os::unix::net::UnixStream::connect(socket)?;
    #[cfg(windows)]
    let mut stream = std::fs::OpenOptions::new().read(true).write(true).open(socket)?;
    stream.write_all(format!("{request}\n").as_bytes())?;
    let mut data = String::new();
    stream.read_to_string(&mut data)?;
    serde_json::from_str(&data).map_err(std::io::Error::other)
}

/// Runs the command line and returns the exit code.
pub fn main(args: Vec<String>) -> i32 {
    if args.is_empty() || args[0] == "--help" || args[0] == "help" {
        println!("{HELP}");
        return 0;
    }
    let json_out = args.iter().any(|a| a == "--json");
    let args: Vec<String> = args.into_iter().filter(|a| a != "--json").collect();
    let request = match parse_args(&args) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };
    let Ok(reply) = send(&request, &socket_path()) else {
        eprintln!("Stip isn't running. Open it first.");
        return 1;
    };
    if let Some(err) = reply["error"].as_str() {
        eprintln!("{err}");
        return 1;
    }
    if request["command"] == "status" {
        println!("{}", if json_out { reply.to_string() } else { describe(&reply) });
    } else {
        println!("{}", reply["message"].as_str().unwrap_or(""));
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration(Some("30m")), Some(Minutes::Some(30)));
        assert_eq!(parse_duration(Some("90")), Some(Minutes::Some(90)));
        assert_eq!(parse_duration(Some("1h")), Some(Minutes::Some(60)));
        assert_eq!(parse_duration(Some("today")), Some(Minutes::Day));
        assert_eq!(parse_duration(Some("soon")), None);
        assert_eq!(parse_duration(Some("0")), None);
        assert_eq!(parse_duration(None), None);
    }

    #[test]
    fn commands() {
        assert_eq!(parse_args(&args(&["break"])), Ok(json!({ "command": "break" })));
        assert_eq!(parse_args(&args(&["pause", "1h"])), Ok(json!({ "command": "pause", "minutes": 60 })));
        assert_eq!(parse_args(&args(&["meeting", "off"])), Ok(json!({ "command": "meeting", "on": false })));
        assert!(parse_args(&args(&["pause"])).is_err());
        assert!(parse_args(&args(&["meeting", "maybe"])).is_err());
        assert!(parse_args(&args(&["dance"])).is_err());
    }

    #[test]
    fn status_reads_well() {
        let reply = json!({
            "status": { "msToStand": 61_000, "pausedUntil": 0 },
            "today": { "breaks": 2, "glasses": 3 }, "streak": 4, "meeting": true
        });
        assert_eq!(describe(&reply), "Next break in 1:01\nToday: 2 breaks, 3 glasses, 4-day streak\nMeeting mode is on");
    }
}
