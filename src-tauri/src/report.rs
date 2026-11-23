// The Spine report: a week of habits, written as a code review. Pure logic,
// ported from report.js. It only ever reads what's on this computer.
use crate::git_history::Commit;
use crate::store::{Config, DatedDay};
use chrono::{DateTime, Datelike, Local, NaiveDate};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

const TWO_HOURS_MIN: u64 = 120;
const FLAG_SIT_MIN: u64 = 90;
const MANY_SKIPS: u64 = 5;
const LATE_HOUR: u32 = 18;
const SKIPPY_DAY: u64 = 3;
const MIN_COMPARED: usize = 2;

fn add_up(days: &[DatedDay], key: fn(&DatedDay) -> u64) -> u64 {
    days.iter().map(key).sum()
}

pub fn hour_label(hour: u32) -> String {
    let h = if hour % 12 == 0 { 12 } else { hour % 12 };
    format!("{h} {}", if hour < 12 { "am" } else { "pm" })
}

pub fn sit_label(minutes: u64) -> String {
    let h = minutes / 60;
    if h == 0 {
        return format!("{minutes} min");
    }
    if minutes % 60 > 0 {
        format!("{h} h {} min", minutes % 60)
    } else {
        format!("{h} h")
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

#[derive(Debug, PartialEq)]
pub struct Pattern {
    pub hour: u32,
    pub after: u64,
    pub total: u64,
}

fn hour_counts(days: &[DatedDay], pick: fn(&DatedDay) -> &BTreeMap<String, u64>) -> BTreeMap<u32, u64> {
    let mut hours = BTreeMap::new();
    for day in days {
        for (hour, count) in pick(day) {
            if let Ok(h) = hour.parse() {
                *hours.entry(h).or_insert(0) += count;
            }
        }
    }
    hours
}

/// The latest hour after which most skips happen, if there's a real pattern.
pub fn skip_pattern(days: &[DatedDay]) -> Option<Pattern> {
    let hours = hour_counts(days, |d| &d.day.skipped_hours);
    let total: u64 = hours.values().sum();
    if total < MANY_SKIPS {
        return None;
    }
    for hour in (10..=20).rev() {
        let after: u64 = hours.iter().filter(|(h, _)| **h >= hour).map(|(_, c)| c).sum();
        if after as f64 / total as f64 >= 2.0 / 3.0 {
            return Some(Pattern { hour, after, total });
        }
    }
    None
}

pub fn tip(days: &[DatedDay]) -> String {
    match skip_pattern(days) {
        Some(p) => format!("You usually skip after {}. A short walk now would help.", hour_label(p.hour)),
        None => String::new(),
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Suggestion {
    pub text: String,
    pub patch: Value,
}

fn suggestion(settings: &Config, longest: u64, skipped: u64, water_days: usize) -> Option<Suggestion> {
    let every = settings.stand.every_min;
    if (longest as f64 >= every * 2.0 || skipped >= MANY_SKIPS) && every > 20.0 {
        let next = (every - 5.0).max(20.0);
        return Some(Suggestion {
            text: format!("a break every {next} min instead of {every}"),
            patch: json!({ "stand": { "everyMin": num(next) } }),
        });
    }
    let water = &settings.water;
    if water.enabled && water_days < 4 && water.every_min > 20.0 {
        let next = (water.every_min - 10.0).max(20.0);
        return Some(Suggestion {
            text: format!("a water reminder every {next} min instead of {}", water.every_min),
            patch: json!({ "water": { "everyMin": num(next) } }),
        });
    }
    None
}

// Whole numbers stay whole in the saved settings, as they were in Electron.
fn num(x: f64) -> Value {
    if x.fract() == 0.0 { json!(x as i64) } else { json!(x) }
}

// One decimal at most, the way Number(x.toFixed(1)) prints.
fn short_number(x: f64) -> String {
    let s = format!("{x:.1}");
    s.strip_suffix(".0").map(str::to_string).unwrap_or(s)
}

pub fn commit_insight(commits: Option<&[Commit]>, week: &[DatedDay]) -> Option<String> {
    let commits = commits.filter(|c| !c.is_empty())?;
    let skippy: HashSet<&str> = week.iter().filter(|d| d.day.skipped >= SKIPPY_DAY).map(|d| d.date.as_str()).collect();
    let dates: HashSet<&str> = week.iter().map(|d| d.date.as_str()).collect();
    let this_week: Vec<&Commit> = commits.iter().filter(|c| dates.contains(c.date.as_str())).collect();
    let late_fix = |c: &&&&Commit| c.fix && c.hour >= LATE_HOUR;
    let skippy_commits: Vec<&&Commit> = this_week.iter().filter(|c| skippy.contains(c.date.as_str())).collect();
    let other_commits: Vec<&&Commit> = this_week.iter().filter(|c| !skippy.contains(c.date.as_str())).collect();
    let skippy_fixes = skippy_commits.iter().filter(late_fix).count();
    let other_fixes = other_commits.iter().filter(late_fix).count();
    let rate = |fixes: usize, days: usize| if days > 0 { fixes as f64 / days as f64 } else { 0.0 };
    let on_skippy = rate(skippy_fixes, skippy.len());
    let on_other = rate(other_fixes, week.len() - skippy.len());
    // A comparison needs enough commits on both sides to mean anything.
    if skippy_fixes >= MIN_COMPARED && other_fixes >= MIN_COMPARED && on_skippy / on_other >= 1.5 {
        return Some(format!(
            "On days you skipped {SKIPPY_DAY} or more breaks, you made {} times as many \"fix\" commits after 6 pm.",
            short_number(on_skippy / on_other)
        ));
    }
    let breaks = add_up(week, |d| d.day.breaks) as usize;
    Some(format!("{} and {} this week.", plural(this_week.len(), "commit", "commits"), plural(breaks, "break", "breaks")))
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Bar {
    pub hour: u32,
    pub taken: u64,
    pub skipped: u64,
}

fn hours_chart(week: &[DatedDay]) -> Vec<Bar> {
    let taken = hour_counts(week, |d| &d.day.hours);
    let skipped = hour_counts(week, |d| &d.day.skipped_hours);
    let seen = || taken.keys().chain(skipped.keys()).copied();
    let first = seen().min().unwrap_or(9).min(9);
    let last = seen().max().unwrap_or(17).max(17);
    (first..=last)
        .map(|hour| Bar {
            hour,
            taken: taken.get(&hour).copied().unwrap_or(0),
            skipped: skipped.get(&hour).copied().unwrap_or(0),
        })
        .collect()
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Report {
    pub number: u32,
    pub key: String,
    pub from: String,
    pub to: String,
    pub chart: Vec<Bar>,
    pub verdict: &'static str,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub review: String,
    pub suggestion: Option<Suggestion>,
    pub reviewed: Option<String>,
    pub commits: Option<String>,
}

pub struct Input<'a> {
    pub week: &'a [DatedDay],
    pub last_week: &'a [DatedDay],
    pub streak: u64,
    pub settings: &'a Config,
    pub now: DateTime<Local>,
    pub commits: Option<&'a [Commit]>,
}

/// `week` and `last_week` are day records, oldest first.
pub fn build_report(i: Input) -> Report {
    let week = i.week;
    let breaks = add_up(week, |d| d.day.breaks);
    let skipped = add_up(week, |d| d.day.skipped);
    let previous = add_up(i.last_week, |d| d.day.breaks);
    let water_days = week.iter().filter(|d| d.day.glasses as f64 >= i.settings.water.goal_glasses).count();
    let mut longest_day = &week[0];
    for d in week {
        if d.day.longest_sit_min > longest_day.day.longest_sit_min {
            longest_day = d;
        }
    }
    let longest = longest_day.day.longest_sit_min;
    let pattern = skip_pattern(week);
    let iso = i.now.date_naive().iso_week();
    let key = format!("{}-W{}", iso.year(), iso.week());
    let mut report = Report {
        number: iso.week(),
        key: key.clone(),
        from: week[0].date.clone(),
        to: week[week.len() - 1].date.clone(),
        chart: hours_chart(week),
        verdict: "draft",
        added: vec![],
        removed: vec![],
        review: "Nothing to review yet. Take a few breaks and check back.".into(),
        suggestion: None,
        reviewed: None,
        commits: commit_insight(i.commits, week),
    };

    if breaks == 0 && skipped == 0 && add_up(week, |d| d.day.glasses) == 0 {
        return report;
    }

    let trend = if previous > 0 && breaks > previous { format!(", up from {previous}") } else { String::new() };
    if breaks > 0 {
        report.added.push(format!("{} taken{trend}", plural(breaks as usize, "break", "breaks")));
    }
    if i.settings.water.enabled && water_days > 0 {
        report.added.push(format!("Water goal met on {water_days} of 7 days"));
    }
    if i.streak >= 2 {
        report.added.push(format!("{}-day stand streak", i.streak));
    }
    if skipped > 0 {
        let when = match &pattern {
            Some(p) => format!(", {} of them after {}", p.after, hour_label(p.hour)),
            None => String::new(),
        };
        report.removed.push(format!("{} skipped{when}", plural(skipped as usize, "break", "breaks")));
    }
    if previous > breaks {
        report.removed.push(format!("Down from {previous} breaks the week before"));
    }
    if longest >= FLAG_SIT_MIN {
        let day = NaiveDate::parse_from_str(&longest_day.date, "%Y-%m-%d").map(|d| d.format("%A").to_string()).unwrap_or_default();
        report.removed.push(format!("Sat for {} straight on {day}", sit_label(longest)));
    }

    let blocking = longest >= TWO_HOURS_MIN || skipped >= MANY_SKIPS || skipped > breaks;
    report.review = if blocking { "Good effort, but I can't approve this yet." } else { "Clean week. Nothing blocking from me." }.into();
    if let Some(p) = &pattern {
        report.review = format!("Most of the skips come after {}. That's where the build breaks, mostly your posture.", hour_label(p.hour));
    }
    if longest >= TWO_HOURS_MIN {
        report.review += &format!(" Blocking on this one: the {} sit.", sit_label(longest));
    }

    let fix = if blocking || water_days < 4 { suggestion(i.settings, longest, skipped, water_days) } else { None };
    let decided = i.settings.report.reviewed.as_ref().filter(|r| r.key == key).map(|r| r.outcome.clone());
    report.verdict = if blocking { "changes" } else { "approved" };
    report.suggestion = if decided.is_some() { None } else { fix };
    report.reviewed = decided;
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{defaults, merge, Day};
    use chrono::TimeZone;

    fn now() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 11, 2, 12, 0, 0).unwrap()
    }

    fn week_with(patches: &[(usize, Value)]) -> Vec<DatedDay> {
        (0..7)
            .map(|i| {
                let mut day = json!({});
                for (n, patch) in patches {
                    if *n == i {
                        day = patch.clone();
                    }
                }
                DatedDay { date: format!("2026-10-{:02}", 27 + i), day: serde_json::from_value::<Day>(day).unwrap() }
            })
            .collect()
    }

    fn report_with(patches: &[(usize, Value)], streak: u64, settings: &Config) -> Report {
        let week = week_with(patches);
        let last = week_with(&[]);
        build_report(Input { week: &week, last_week: &last, streak, settings, now: now(), commits: None })
    }

    fn report(patches: &[(usize, Value)]) -> Report {
        report_with(patches, 0, &Config::from_value(&defaults()))
    }

    #[test]
    fn labels() {
        assert_eq!(hour_label(15), "3 pm");
        assert_eq!(hour_label(0), "12 am");
        assert_eq!(sit_label(45), "45 min");
        assert_eq!(sit_label(120), "2 h");
        assert_eq!(sit_label(160), "2 h 40 min");
    }

    #[test]
    fn an_empty_week_is_a_draft_not_a_telling_off() {
        let r = report(&[]);
        assert_eq!(r.verdict, "draft");
        assert!(r.added.is_empty());
        assert_eq!(r.suggestion, None);
    }

    #[test]
    fn a_good_week_is_approved() {
        let good = json!({ "breaks": 8, "glasses": 8 });
        let water = json!({ "glasses": 8 });
        let r = report_with(&[(0, good.clone()), (1, good), (2, water.clone()), (3, water)], 3, &Config::from_value(&defaults()));
        assert_eq!(r.verdict, "approved");
        assert_eq!(r.added, vec!["16 breaks taken", "Water goal met on 4 of 7 days", "3-day stand streak"]);
        assert!(r.removed.is_empty());
        assert_eq!(r.suggestion, None);
    }

    #[test]
    fn a_long_sit_blocks_approval_and_names_the_day() {
        let r = report(&[(0, json!({ "breaks": 8, "longestSitMin": 160 }))]);
        assert_eq!(r.verdict, "changes");
        assert!(r.removed.contains(&"Sat for 2 h 40 min straight on Tuesday".to_string()));
        assert!(r.review.contains("2 h 40 min"));
    }

    #[test]
    fn breaks_compare_with_last_week_either_way() {
        let d = Config::from_value(&defaults());
        let run = |this: u64, last: u64| {
            let week = week_with(&[(0, json!({ "breaks": this }))]);
            let last = week_with(&[(0, json!({ "breaks": last }))]);
            build_report(Input { week: &week, last_week: &last, streak: 0, settings: &d, now: now(), commits: None })
        };
        assert_eq!(run(8, 5).added[0], "8 breaks taken, up from 5");
        assert!(run(2, 5).removed.contains(&"Down from 5 breaks the week before".to_string()));
    }

    #[test]
    fn skips_show_a_pattern_only_when_there_is_one() {
        assert_eq!(skip_pattern(&week_with(&[(0, json!({ "skippedHours": { "15": 1, "16": 1 } }))])), None, "too few");
        let late = week_with(&[(0, json!({ "skippedHours": { "10": 1, "15": 3, "16": 2 } }))]);
        assert_eq!(skip_pattern(&late).unwrap().hour, 15);
        assert!(tip(&late).contains("after 3 pm"));
        assert_eq!(tip(&week_with(&[])), "");
    }

    #[test]
    fn a_suggestion_shortens_the_interval_and_has_a_floor() {
        let long_sit = [(0, json!({ "breaks": 2, "longestSitMin": 130 }))];
        assert_eq!(report(&long_sit).suggestion.unwrap().patch, json!({ "stand": { "everyMin": 25 } }));
        let low = Config::from_value(&merge(&defaults(), &json!({ "stand": { "everyMin": 20 }, "water": { "everyMin": 20 } })));
        assert_eq!(report_with(&long_sit, 0, &low).suggestion, None);
    }

    #[test]
    fn suggestion_text_reads_like_the_electron_one() {
        let r = report(&[(0, json!({ "breaks": 2, "longestSitMin": 130 }))]);
        assert_eq!(r.suggestion.unwrap().text, "a break every 25 min instead of 30");
    }

    #[test]
    fn a_settled_suggestion_stays_settled_for_that_week_only() {
        let long_sit = [(0, json!({ "breaks": 2, "longestSitMin": 130 }))];
        let key = report(&long_sit).key;
        let settled = Config::from_patch(json!({ "report": { "reviewed": { "key": key, "outcome": "applied" } } }));
        let r = report_with(&long_sit, 0, &settled);
        assert_eq!(r.suggestion, None);
        assert_eq!(r.reviewed.as_deref(), Some("applied"));
        let older = Config::from_patch(json!({ "report": { "reviewed": { "key": "2020-W1", "outcome": "applied" } } }));
        assert!(report_with(&long_sit, 0, &older).suggestion.is_some());
    }

    #[test]
    fn the_chart_covers_working_hours_and_anything_outside_them() {
        let r = report(&[(0, json!({ "breaks": 1, "hours": { "7": 1 }, "skipped": 1, "skippedHours": { "21": 1 } }))]);
        assert_eq!(r.chart[0], Bar { hour: 7, taken: 1, skipped: 0 });
        assert_eq!(r.chart.last().unwrap(), &Bar { hour: 21, taken: 0, skipped: 1 });
    }

    #[test]
    fn commit_insight_compares_skip_days_only_when_the_numbers_say_so() {
        let days = week_with(&[(0, json!({ "skipped": 4, "breaks": 1 }))]);
        let c = |d: usize, hour, fix| Commit { date: days[d].date.clone(), hour, fix };
        let many = [c(0, 20, true), c(0, 21, true), c(1, 20, true), c(2, 20, true)];
        assert!(commit_insight(Some(&many), &days).unwrap().contains("6 times as many \"fix\" commits"));
        let few = [c(0, 20, true), c(0, 21, true), c(1, 20, true)];
        assert_eq!(commit_insight(Some(&few), &days).unwrap(), "3 commits and 1 break this week.", "too few to compare");
        assert_eq!(commit_insight(Some(&[c(1, 10, false)]), &days).unwrap(), "1 commit and 1 break this week.");
        assert_eq!(commit_insight(Some(&[]), &days), None);
        assert_eq!(commit_insight(None, &days), None);
    }

    #[test]
    fn the_report_serializes_like_the_electron_one() {
        let v = serde_json::to_value(report(&[(0, json!({ "breaks": 1 }))])).unwrap();
        assert_eq!(v["key"], "2026-W45");
        assert_eq!(v["number"], 45);
        assert_eq!(v["from"], "2026-10-27");
        assert_eq!(v["chart"][0], json!({ "hour": 9, "taken": 0, "skipped": 0 }));
        assert!(v["suggestion"].is_object() || v["suggestion"].is_null());
    }
}
