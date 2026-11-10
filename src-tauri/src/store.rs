// Settings and stats, kept as JSON in the app's data folder. The file format
// and defaults match the Electron app's store.js, so existing data loads.
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub fn defaults() -> Value {
    json!({
        "theme": "flat",
        "sound": true,
        "launchAtLogin": false,
        "showCountdown": true,
        "stand": {
            "everyMin": 30,
            "breakSec": 120,
            "strictness": "balanced",
            "coverAllDisplays": true,
            "waitDuringCalls": true,
            "waitForFlow": true,
            "resetWhenAway": true,
            "awayMin": 3,
            // Snoozes in a row before the break can't be put off. 0 means no limit.
            "maxSnoozes": 2
        },
        "water": {
            "enabled": true,
            "character": "orb",
            "dimScreen": true,
            "everyMin": 30,
            "goalGlasses": 8,
            "glassMl": 250,
            // "always", "work" or "custom". Null follows the working hours switch.
            "schedule": null,
            "hours": { "days": [0, 1, 2, 3, 4, 5, 6], "start": "08:00", "end": "21:00" }
        },
        "report": { "folders": [], "reviewed": null },
        "workHours": { "enabled": false, "days": [1, 2, 3, 4, 5], "start": "09:00", "end": "18:00" }
    })
}

/// Deep merge: objects merge key by key, anything else replaces.
pub fn merge(base: &Value, patch: &Value) -> Value {
    let mut out = base.clone();
    if let (Some(out_map), Some(patch_map)) = (out.as_object_mut(), patch.as_object()) {
        for (key, value) in patch_map {
            let merged = match out_map.get(key) {
                Some(b) if b.is_object() && value.is_object() => merge(b, value),
                _ => value.clone(),
            };
            out_map.insert(key.clone(), merged);
        }
        out
    } else if patch.is_object() {
        patch.clone()
    } else {
        out
    }
}

fn read_json(file: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(file).ok()?).ok()
}

fn write_json(file: &Path, data: &Value) {
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let tmp = file.with_extension("json.tmp");
    if fs::write(&tmp, serde_json::to_string_pretty(data).unwrap()).is_ok() {
        let _ = fs::rename(&tmp, file);
    }
}

// ---- Typed view of the settings, for the logic that reads them -------------

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub days: Vec<i64>,
    pub start: String,
    pub end: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkHours {
    pub enabled: bool,
    #[serde(flatten)]
    pub window: Window,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stand {
    pub every_min: f64,
    pub break_sec: f64,
    pub strictness: String,
    pub cover_all_displays: bool,
    pub wait_during_calls: bool,
    pub wait_for_flow: bool,
    pub reset_when_away: bool,
    pub away_min: f64,
    pub max_snoozes: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Water {
    pub enabled: bool,
    pub character: String,
    #[allow(dead_code)]
    pub dim_screen: bool,
    pub every_min: f64,
    pub goal_glasses: f64,
    #[allow(dead_code)]
    pub glass_ml: f64,
    pub schedule: Option<String>,
    pub hours: Window,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Reviewed {
    pub key: String,
    pub outcome: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Report {
    pub folders: Vec<String>,
    pub reviewed: Option<Reviewed>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub theme: String,
    #[allow(dead_code)]
    pub sound: bool,
    pub launch_at_login: bool,
    pub show_countdown: bool,
    pub stand: Stand,
    pub water: Water,
    pub report: Report,
    pub work_hours: WorkHours,
}

impl Config {
    /// Settings as the logic sees them. Anything unreadable falls back to the
    /// defaults rather than stopping the app.
    pub fn from_value(value: &Value) -> Config {
        serde_json::from_value(value.clone()).unwrap_or_else(|err| {
            eprintln!("stip: settings unreadable ({err}), using defaults");
            serde_json::from_value(defaults()).unwrap()
        })
    }

    #[cfg(test)]
    pub fn from_patch(patch: Value) -> Config {
        Config::from_value(&merge(&defaults(), &patch))
    }
}

pub struct Settings {
    file: PathBuf,
    data: Value,
    config: Config,
}

impl Settings {
    pub fn new(dir: &Path) -> Settings {
        let file = dir.join("settings.json");
        let data = merge(&defaults(), &read_json(&file).unwrap_or_else(|| json!({})));
        let config = Config::from_value(&data);
        Settings { file, data, config }
    }

    pub fn get(&self) -> &Value {
        &self.data
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn set(&mut self, patch: &Value) {
        self.data = merge(&self.data, patch);
        self.config = Config::from_value(&self.data);
        write_json(&self.file, &self.data);
    }
}

// ---- Stats: one record per local day ----------------------------------------

pub fn day_key(date: &DateTime<Local>) -> String {
    date.format("%Y-%m-%d").to_string()
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Day {
    pub breaks: u64,
    pub skipped: u64,
    pub snoozed: u64,
    pub glasses: u64,
    pub hours: BTreeMap<String, u64>,
    pub skipped_hours: BTreeMap<String, u64>,
    pub longest_sit_min: u64,
    // Anything else in the file is kept as it was.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A day record with its date, as the report and the pages see it.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatedDay {
    pub date: String,
    #[serde(flatten)]
    pub day: Day,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekDay {
    pub date: String,
    pub weekday: u32,
    #[serde(flatten)]
    pub day: Day,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Totals {
    pub breaks: u64,
    pub skipped: u64,
    pub snoozed: u64,
    pub glasses: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Week {
    pub days: Vec<WeekDay>,
    pub totals: Totals,
    pub best_hour: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Breaks,
    Skipped,
    Snoozed,
    Glasses,
}

pub struct Stats {
    file: PathBuf,
    days: BTreeMap<String, Day>,
}

fn noon(key: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(key, "%Y-%m-%d").ok()
}

impl Stats {
    pub fn new(dir: &Path) -> Stats {
        let file = dir.join("stats.json");
        let days = read_json(&file)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        Stats { file, days }
    }

    fn save(&self) {
        write_json(&self.file, &serde_json::to_value(&self.days).unwrap());
    }

    fn day(&self, key: &str) -> Day {
        self.days.get(key).cloned().unwrap_or_default()
    }

    pub fn today(&self, now: &DateTime<Local>) -> Day {
        self.day(&day_key(now))
    }

    pub fn record(&mut self, kind: Kind, now: &DateTime<Local>) {
        let key = day_key(now);
        let mut day = self.day(&key);
        let hour = now.hour().to_string();
        match kind {
            Kind::Breaks => {
                day.breaks += 1;
                *day.hours.entry(hour).or_insert(0) += 1;
            }
            Kind::Skipped => {
                day.skipped += 1;
                *day.skipped_hours.entry(hour).or_insert(0) += 1;
            }
            Kind::Snoozed => day.snoozed += 1,
            Kind::Glasses => day.glasses += 1,
        }
        self.days.insert(key, day);
        self.save();
    }

    /// Keeps today's longest stretch of sitting. Written once a minute at most.
    pub fn note_sit(&mut self, minutes: u64, now: &DateTime<Local>) {
        let key = day_key(now);
        let mut day = self.day(&key);
        if minutes <= day.longest_sit_min {
            return;
        }
        day.longest_sit_min = minutes;
        self.days.insert(key, day);
        self.save();
    }

    /// Day records, oldest first: `count` days, ending `ends_ago` days before now.
    pub fn range(&self, count: i64, ends_ago: i64, now: &DateTime<Local>) -> Vec<DatedDay> {
        (ends_ago..count + ends_ago)
            .rev()
            .map(|i| {
                let key = day_key(&(*now - Duration::days(i)));
                DatedDay { day: self.day(&key), date: key }
            })
            .collect()
    }

    fn has_break(&self, key: &str) -> bool {
        self.days.get(key).is_some_and(|d| d.breaks > 0)
    }

    /// Days in a row, ending today or yesterday, with at least one break taken.
    pub fn streak(&self, now: &DateTime<Local>) -> u64 {
        let mut cursor = now.date_naive();
        if !self.has_break(&cursor.format("%Y-%m-%d").to_string()) {
            cursor = cursor.pred_opt().unwrap();
        }
        let mut count = 0;
        while self.has_break(&cursor.format("%Y-%m-%d").to_string()) {
            count += 1;
            cursor = cursor.pred_opt().unwrap();
        }
        count
    }

    /// Days with at least one break, ever.
    pub fn active_days(&self) -> u64 {
        self.days.values().filter(|d| d.breaks > 0).count() as u64
    }

    /// Days since the last break, or None if there hasn't been one.
    pub fn days_since_break(&self, now: &DateTime<Local>) -> Option<i64> {
        let last = self.days.iter().filter(|(_, d)| d.breaks > 0).filter_map(|(k, _)| noon(k)).max()?;
        Some((now.date_naive() - last).num_days())
    }

    pub fn longest_streak(&self) -> u64 {
        let mut best = 0;
        let mut run = 0;
        let mut previous: Option<NaiveDate> = None;
        for (key, day) in &self.days {
            if day.breaks == 0 {
                continue;
            }
            let Some(date) = noon(key) else { continue };
            run = match previous {
                Some(p) if (date - p).num_days() == 1 => run + 1,
                _ => 1,
            };
            previous = Some(date);
            best = best.max(run);
        }
        best
    }

    /// The last seven days, oldest first, with totals and the busiest hour.
    pub fn week(&self, now: &DateTime<Local>) -> Week {
        let mut days = vec![];
        for i in (0..7).rev() {
            let date = *now - Duration::days(i);
            let key = day_key(&date);
            days.push(WeekDay { weekday: date.weekday().num_days_from_sunday(), day: self.day(&key), date: key });
        }
        let mut totals = Totals::default();
        let mut hours: BTreeMap<u32, u64> = BTreeMap::new();
        for d in &days {
            totals.breaks += d.day.breaks;
            totals.skipped += d.day.skipped;
            totals.snoozed += d.day.snoozed;
            totals.glasses += d.day.glasses;
            for (hour, count) in &d.day.hours {
                if let Ok(h) = hour.parse() {
                    *hours.entry(h).or_insert(0) += count;
                }
            }
        }
        // The busiest hour; on a tie, the earliest one, as Object.entries sorts.
        let mut best: Option<(u32, u64)> = None;
        for (h, c) in hours {
            if best.is_none_or(|(_, bc)| c > bc) {
                best = Some((h, c));
            }
        }
        Week { days, totals, best_hour: best.map(|(h, _)| h) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(month: u32, day: u32, hour: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, month, day, hour, 0, 0).unwrap()
    }

    #[test]
    fn settings_merge_with_defaults_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        let mut settings = Settings::new(dir.path());
        assert_eq!(settings.config().stand.every_min, 30.0);
        settings.set(&json!({ "stand": { "everyMin": 45 } }));
        let reloaded = Settings::new(dir.path());
        assert_eq!(reloaded.config().stand.every_min, 45.0);
        assert_eq!(reloaded.config().stand.break_sec, 120.0, "untouched keys keep defaults");
    }

    #[test]
    fn settings_keep_keys_they_dont_know() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), r#"{"theme":"aurora","future":{"x":1}}"#).unwrap();
        let mut settings = Settings::new(dir.path());
        assert_eq!(settings.config().theme, "aurora");
        settings.set(&json!({ "sound": false }));
        let saved = read_json(&dir.path().join("settings.json")).unwrap();
        assert_eq!(saved["future"]["x"], 1);
        assert_eq!(saved["sound"], false);
    }

    #[test]
    fn stats_count_today_and_the_streak() {
        let dir = tempfile::tempdir().unwrap();
        let mut stats = Stats::new(dir.path());
        let day = |d| at(10, d, 11);
        stats.record(Kind::Breaks, &day(27));
        stats.record(Kind::Breaks, &day(28));
        stats.record(Kind::Breaks, &day(29));
        stats.record(Kind::Glasses, &day(29));
        assert_eq!(stats.today(&day(29)).breaks, 1);
        assert_eq!(stats.today(&day(29)).glasses, 1);
        assert_eq!(stats.today(&day(29)).hours["11"], 1);
        assert_eq!(stats.streak(&day(29)), 3);
        assert_eq!(stats.streak(&day(30)), 3, "today with no break yet keeps yesterday's streak");
        assert_eq!(stats.streak(&day(31)), 0);
    }

    #[test]
    fn week_totals_best_hour_and_longest_streak() {
        let dir = tempfile::tempdir().unwrap();
        let mut stats = Stats::new(dir.path());
        for d in [20, 21, 22] {
            stats.record(Kind::Breaks, &at(10, d, 10));
        }
        stats.record(Kind::Breaks, &at(10, 27, 11));
        stats.record(Kind::Breaks, &at(10, 28, 11));
        stats.record(Kind::Snoozed, &at(10, 28, 11));
        stats.record(Kind::Glasses, &at(10, 29, 9));
        let week = stats.week(&at(10, 29, 12));
        assert_eq!(week.days.len(), 7);
        assert_eq!(week.days[6].date, "2026-10-29");
        assert_eq!(week.days[6].day.glasses, 1);
        assert_eq!(week.totals.breaks, 2, "Oct 23 to 29 holds two breaks");
        assert_eq!(week.totals.snoozed, 1);
        assert_eq!(week.best_hour, Some(11));
        assert_eq!(stats.longest_streak(), 3);
    }

    #[test]
    fn active_days_and_days_since_a_break() {
        let dir = tempfile::tempdir().unwrap();
        let mut stats = Stats::new(dir.path());
        let now = at(11, 10, 12);
        assert_eq!(stats.active_days(), 0);
        assert_eq!(stats.days_since_break(&now), None);
        stats.record(Kind::Skipped, &at(11, 9, 12));
        assert_eq!(stats.active_days(), 0, "a skip is not a break");
        stats.record(Kind::Breaks, &at(11, 1, 12));
        stats.record(Kind::Breaks, &at(11, 3, 12));
        assert_eq!(stats.active_days(), 2);
        assert_eq!(stats.days_since_break(&now), Some(7));
    }

    #[test]
    fn reads_an_electron_stats_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("stats.json"),
            r#"{"2026-10-29":{"breaks":2,"skipped":0,"snoozed":1,"glasses":3,"hours":{"10":2},"skippedHours":{},"longestSitMin":42}}"#,
        )
        .unwrap();
        let stats = Stats::new(dir.path());
        let day = stats.today(&at(10, 29, 12));
        assert_eq!((day.breaks, day.glasses, day.longest_sit_min), (2, 3, 42));
        let out = serde_json::to_value(&stats.range(1, 0, &at(10, 29, 12))[0]).unwrap();
        assert_eq!(out["date"], "2026-10-29");
        assert_eq!(out["skippedHours"], json!({}));
        assert_eq!(out["longestSitMin"], 42);
    }
}
