// Pure timing logic, ported from scheduler.js. The caller feeds it the clock,
// idle time and meeting state on every tick, so it can be tested on its own.
// Times are milliseconds since the epoch; days and hours are local.
use crate::store::{Config, Window, WorkHours};
use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Timelike};
use serde::Serialize;

const MIN: i64 = 60 * 1000;
// After a call ends, wait a little before covering the screen.
pub const MEETING_GRACE_MS: i64 = 30 * 1000;
// A break waits for a pause in your work, but not forever.
pub const FLOW_MAX_WAIT_MS: i64 = 10 * MIN;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    /// Show the break.
    Stand,
    /// Due, but in a call.
    StandWaiting,
    /// Show the water reminder.
    Water,
}

pub fn local(ms: i64) -> DateTime<Local> {
    Local.timestamp_millis_opt(ms).single().unwrap_or_else(Local::now)
}

fn minutes_of_day(hhmm: &str) -> i64 {
    let mut parts = hhmm.split(':').map(|p| p.trim().parse::<i64>().unwrap_or(0));
    parts.next().unwrap_or(0) * 60 + parts.next().unwrap_or(0)
}

fn weekday(date: &DateTime<Local>) -> i64 {
    date.weekday().num_days_from_sunday() as i64
}

/// Whether a time falls in a window of days and hours. An end before the
/// start runs past midnight, and counts as part of the day it began on.
pub fn in_window(w: &Window, date: &DateTime<Local>) -> bool {
    let now = (date.hour() * 60 + date.minute()) as i64;
    let from = minutes_of_day(&w.start);
    let to = minutes_of_day(&w.end);
    let today = weekday(date);
    if from == to {
        return w.days.contains(&today);
    }
    if from < to {
        return w.days.contains(&today) && now >= from && now < to;
    }
    if now >= from {
        return w.days.contains(&today);
    }
    now < to && w.days.contains(&((today + 6) % 7))
}

pub fn in_work_hours(work: &WorkHours, date: &DateTime<Local>) -> bool {
    !work.enabled || in_window(&work.window, date)
}

/// Water can run any time, in working hours, or on its own hours. Until
/// someone chooses, it follows the working hours switch, as it always has.
pub fn water_schedule(c: &Config) -> &str {
    match c.water.schedule.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ if c.work_hours.enabled => "work",
        _ => "always",
    }
}

pub fn in_water_hours(c: &Config, date: &DateTime<Local>) -> bool {
    match water_schedule(c) {
        "custom" => in_window(&c.water.hours, date),
        "work" => in_window(&c.work_hours.window, date),
        _ => true,
    }
}

pub fn next_water_start(c: &Config, date: &DateTime<Local>) -> Option<i64> {
    match water_schedule(c) {
        "custom" => next_work_start(&c.water.hours, date),
        "work" => next_work_start(&c.work_hours.window, date),
        _ => None,
    }
}

/// When the window next begins, as a timestamp.
pub fn next_work_start(w: &Window, date: &DateTime<Local>) -> Option<i64> {
    let start = minutes_of_day(&w.start);
    for i in 0..=7 {
        let day = date.date_naive() + Duration::days(i);
        let Some(naive) = day.and_hms_opt((start / 60) as u32, (start % 60) as u32, 0) else { continue };
        let Some(at) = Local.from_local_datetime(&naive).earliest() else { continue };
        if at > *date && w.days.contains(&weekday(&at)) {
            return Some(at.timestamp_millis());
        }
    }
    None
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub off_hours: bool,
    pub resumes_at: Option<i64>,
    pub ms_to_stand: i64,
    pub stand_every_ms: i64,
    pub sitting_ms: i64,
    pub ms_to_water: i64,
    pub water_off: bool,
    pub water_resumes_at: Option<i64>,
    pub paused_until: i64,
    pub waiting_for_meeting: bool,
    pub waiting_for_flow: bool,
    pub on_break: bool,
    pub snoozes_left: Option<i64>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Tick {
    pub idle_sec: f64,
    pub in_meeting: bool,
    pub in_flow: bool,
}

pub struct Scheduler {
    pub config: Config,
    pub last_break_at: i64,
    pub stand_due_at: i64,
    pub water_due_at: i64,
    pub paused_until: i64,
    pub on_break: bool,
    pub waiting_for_meeting: bool,
    meeting_ended_at: i64,
    snooze_count: i64,
    flow_wait_started_at: i64,
    events: Vec<Event>,
}

impl Scheduler {
    pub fn new(config: Config, now: i64) -> Scheduler {
        let mut s = Scheduler {
            config,
            last_break_at: now,
            stand_due_at: 0,
            water_due_at: 0,
            paused_until: 0,
            on_break: false,
            waiting_for_meeting: false,
            meeting_ended_at: 0,
            snooze_count: 0,
            flow_wait_started_at: 0,
            events: vec![],
        };
        s.stand_due_at = now + s.stand_every();
        s.water_due_at = now + s.water_every();
        s
    }

    /// The events since the last call, oldest first.
    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    fn emit(&mut self, e: Event) {
        self.events.push(e);
    }

    pub fn stand_every(&self) -> i64 {
        (self.config.stand.every_min * MIN as f64) as i64
    }

    pub fn water_every(&self) -> i64 {
        (self.config.water.every_min * MIN as f64) as i64
    }

    pub fn is_paused(&self, now: i64) -> bool {
        now < self.paused_until
    }

    pub fn tick(&mut self, now: i64, t: Tick) {
        if self.on_break {
            return;
        }
        let date = local(now);

        // Nothing is due while paused or off the clock; restart fresh after.
        let paused = self.is_paused(now);
        if paused || !in_work_hours(&self.config.work_hours, &date) {
            self.stand_due_at = self.stand_due_at.max(now + self.stand_every());
        } else {
            self.tick_stand(now, t);
        }

        if paused || !in_water_hours(&self.config, &date) {
            self.water_due_at = self.water_due_at.max(now + self.water_every());
        } else if self.config.water.enabled && now >= self.water_due_at && !t.in_meeting {
            self.water_due_at = now + self.water_every();
            self.emit(Event::Water);
        }
    }

    fn tick_stand(&mut self, now: i64, t: Tick) {
        let stand = &self.config.stand;
        // Being away from the keyboard long enough counts as a break.
        if stand.reset_when_away && t.idle_sec >= stand.away_min * 60.0 {
            self.last_break_at = now;
            self.stand_due_at = now + self.stand_every();
            self.waiting_for_meeting = false;
            self.snooze_count = 0;
        }

        if now >= self.stand_due_at {
            let stand = &self.config.stand;
            // Saying "I'm in a meeting" always waits, even with auto-waiting off.
            if t.in_meeting && (stand.wait_during_calls || self.waiting_for_meeting) {
                if !self.waiting_for_meeting {
                    self.waiting_for_meeting = true;
                    self.emit(Event::StandWaiting);
                }
                self.meeting_ended_at = 0;
            } else if self.waiting_for_meeting {
                if self.meeting_ended_at == 0 {
                    self.meeting_ended_at = now;
                }
                if now - self.meeting_ended_at >= MEETING_GRACE_MS {
                    self.start_break();
                }
            } else if stand.wait_for_flow && t.in_flow && !self.flow_wait_over(now) {
                if self.flow_wait_started_at == 0 {
                    self.flow_wait_started_at = now;
                }
            } else {
                self.start_break();
            }
        } else {
            self.flow_wait_started_at = 0;
        }
    }

    fn flow_wait_over(&self, now: i64) -> bool {
        self.flow_wait_started_at > 0 && now - self.flow_wait_started_at >= FLOW_MAX_WAIT_MS
    }

    pub fn start_break(&mut self) {
        self.on_break = true;
        self.flow_wait_started_at = 0;
        self.waiting_for_meeting = false;
        self.meeting_ended_at = 0;
        self.emit(Event::Stand);
    }

    pub fn break_done(&mut self, now: i64) {
        self.on_break = false;
        self.snooze_count = 0;
        self.last_break_at = now;
        self.stand_due_at = now + self.stand_every();
    }

    /// Skip this break but keep the sitting time running.
    pub fn skip(&mut self, now: i64) {
        self.on_break = false;
        self.waiting_for_meeting = false;
        self.stand_due_at = now + self.stand_every();
    }

    pub fn snooze(&mut self, now: i64, minutes: i64) {
        self.on_break = false;
        self.snooze_count += 1;
        self.waiting_for_meeting = false;
        self.stand_due_at = now + minutes * MIN;
    }

    /// "I'm in a meeting": wait until the call ends, then break.
    pub fn defer_for_meeting(&mut self) {
        self.on_break = false;
        self.waiting_for_meeting = true;
        self.meeting_ended_at = 0;
    }

    pub fn water_later(&mut self, now: i64, minutes: i64) {
        self.water_due_at = now + minutes * MIN;
    }

    pub fn sipped(&mut self, now: i64) {
        self.water_due_at = now + self.water_every();
    }

    pub fn pause(&mut self, now: i64, minutes: i64) {
        self.paused_until = now + minutes * MIN;
    }

    pub fn resume(&mut self, now: i64) {
        self.paused_until = 0;
        self.stand_due_at = now + self.stand_every();
        self.water_due_at = now + self.water_every();
    }

    /// After sleep or a locked screen the user was away, so start fresh
    /// instead of firing an overdue break the moment they come back.
    pub fn restart(&mut self, now: i64) {
        if self.on_break {
            return;
        }
        self.last_break_at = now;
        self.stand_due_at = now + self.stand_every();
        self.water_due_at = now + self.water_every();
        self.waiting_for_meeting = false;
        self.snooze_count = 0;
    }

    /// How many more snoozes are allowed in a row, or None for no limit.
    pub fn snoozes_left(&self) -> Option<i64> {
        let max = self.config.stand.max_snoozes as i64;
        (max > 0).then(|| (max - self.snooze_count).max(0))
    }

    /// Settings changed: re-arm the timers from the last break.
    pub fn reschedule(&mut self, config: Config, now: i64) {
        self.config = config;
        self.stand_due_at = now.max(self.last_break_at + self.stand_every());
        self.water_due_at = self.water_due_at.min(now + self.water_every());
    }

    pub fn status(&self, now: i64) -> Status {
        let date = local(now);
        let water_off = !in_water_hours(&self.config, &date);
        let off_hours = !in_work_hours(&self.config.work_hours, &date);
        Status {
            off_hours,
            // Electron sent 0 for "not off hours" and null for "never".
            resumes_at: if off_hours { next_work_start(&self.config.work_hours.window, &date) } else { Some(0) },
            ms_to_stand: (self.stand_due_at - now).max(0),
            stand_every_ms: self.stand_every(),
            sitting_ms: now - self.last_break_at,
            ms_to_water: (self.water_due_at - now).max(0),
            water_off,
            water_resumes_at: if water_off { next_water_start(&self.config, &date) } else { Some(0) },
            paused_until: if self.is_paused(now) { self.paused_until } else { 0 },
            waiting_for_meeting: self.waiting_for_meeting,
            waiting_for_flow: self.flow_wait_started_at > 0,
            on_break: self.on_break,
            snoozes_left: self.snoozes_left(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{defaults, merge};
    use serde_json::{json, Value};

    // Pinned timings, so the tests don't change when the defaults do.
    fn base() -> Value {
        json!({ "stand": { "everyMin": 40, "breakSec": 60, "awayMin": 5 }, "water": { "everyMin": 30 } })
    }

    fn config(patch: Value) -> Config {
        Config::from_value(&merge(&merge(&defaults(), &base()), &patch))
    }

    struct Run {
        s: Scheduler,
        events: Vec<Event>,
    }

    impl Run {
        fn new(patch: Value) -> Run {
            Run::at(patch, 0)
        }
        fn at(patch: Value, start: i64) -> Run {
            Run { s: Scheduler::new(config(patch), start), events: vec![] }
        }
        fn tick(&mut self, now: i64) {
            self.tick_with(now, Tick::default());
        }
        fn tick_with(&mut self, now: i64, t: Tick) {
            self.s.tick(now, t);
            self.collect();
        }
        fn collect(&mut self) {
            self.events.extend(self.s.take_events());
        }
    }

    use Event::*;
    const MEETING: Tick = Tick { idle_sec: 0.0, in_meeting: true, in_flow: false };
    const FLOW: Tick = Tick { idle_sec: 0.0, in_meeting: false, in_flow: true };
    fn no_water() -> Value {
        json!({ "water": { "enabled": false } })
    }

    // The JS tests run from time 0 (1 January 1970), with default hours, so
    // every time is "in hours". These do the same.

    #[test]
    fn break_is_due_after_the_interval() {
        let mut r = Run::new(no_water());
        r.tick(39 * MIN);
        assert_eq!(r.events, vec![]);
        r.tick(40 * MIN);
        assert_eq!(r.events, vec![Stand]);
        r.tick(41 * MIN);
        assert_eq!(r.events, vec![Stand], "no second break while one is showing");
    }

    #[test]
    fn finishing_a_break_restarts_the_timer() {
        let mut r = Run::new(no_water());
        r.tick(40 * MIN);
        r.s.break_done(41 * MIN);
        r.tick(80 * MIN);
        assert_eq!(r.events.len(), 1);
        r.tick(81 * MIN);
        assert_eq!(r.events.len(), 2);
    }

    #[test]
    fn snooze_delays_the_break() {
        let mut r = Run::new(no_water());
        r.tick(40 * MIN);
        r.s.snooze(40 * MIN, 5);
        r.tick(44 * MIN);
        assert_eq!(r.events.len(), 1);
        r.tick(45 * MIN);
        assert_eq!(r.events.len(), 2);
    }

    #[test]
    fn waits_during_a_call_then_breaks_after_a_grace_period() {
        let mut r = Run::new(no_water());
        r.tick_with(40 * MIN, MEETING);
        assert_eq!(r.events, vec![StandWaiting]);
        r.tick_with(50 * MIN, MEETING);
        assert_eq!(r.events, vec![StandWaiting]);
        r.tick(51 * MIN);
        r.tick(51 * MIN + MEETING_GRACE_MS - 1);
        assert_eq!(r.events, vec![StandWaiting]);
        r.tick(51 * MIN + MEETING_GRACE_MS);
        assert_eq!(r.events, vec![StandWaiting, Stand]);
    }

    #[test]
    fn breaks_in_a_call_when_waiting_is_turned_off() {
        let mut r = Run::new(json!({ "water": { "enabled": false }, "stand": { "waitDuringCalls": false } }));
        r.tick_with(40 * MIN, MEETING);
        assert_eq!(r.events, vec![Stand]);
    }

    #[test]
    fn im_in_a_meeting_waits_even_when_auto_waiting_is_off() {
        let mut r = Run::new(json!({ "water": { "enabled": false }, "stand": { "waitDuringCalls": false } }));
        r.tick(40 * MIN);
        r.s.defer_for_meeting();
        r.tick_with(45 * MIN, MEETING);
        assert_eq!(r.events, vec![Stand]);
        r.tick(50 * MIN);
        r.tick(50 * MIN + MEETING_GRACE_MS);
        assert_eq!(r.events, vec![Stand, Stand]);
    }

    #[test]
    fn being_away_counts_as_a_break() {
        let mut r = Run::new(no_water());
        r.tick_with(30 * MIN, Tick { idle_sec: 300.0, ..Tick::default() });
        r.tick(40 * MIN);
        assert_eq!(r.events, vec![]);
        r.tick(70 * MIN);
        assert_eq!(r.events, vec![Stand]);
    }

    #[test]
    fn water_reminder_repeats_and_can_be_put_off() {
        let mut r = Run::new(json!({}));
        r.tick(30 * MIN);
        assert_eq!(r.events, vec![Water]);
        r.s.water_later(30 * MIN, 10);
        r.tick(39 * MIN);
        assert_eq!(r.events, vec![Water]);
        r.tick(40 * MIN);
        assert_eq!(r.events, vec![Water, Stand, Water]);
    }

    #[test]
    fn nothing_fires_while_paused_and_timers_restart_after() {
        let mut r = Run::new(json!({}));
        r.s.pause(0, 60);
        r.tick(45 * MIN);
        assert_eq!(r.events, vec![]);
        r.s.resume(60 * MIN);
        r.tick(89 * MIN);
        assert_eq!(r.events, vec![]);
        r.tick(90 * MIN);
        assert_eq!(r.events, vec![Water]);
    }

    #[test]
    fn waking_from_sleep_starts_fresh_instead_of_firing_at_once() {
        let mut r = Run::new(no_water());
        r.s.restart(300 * MIN);
        r.tick(300 * MIN);
        assert_eq!(r.events, vec![]);
        assert_eq!(r.s.status(300 * MIN).sitting_ms, 0);
        r.tick(340 * MIN);
        assert_eq!(r.events, vec![Stand]);
    }

    fn date(month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, month, day, hour, minute, 0).unwrap()
    }

    fn hours() -> WorkHours {
        serde_json::from_value(json!({ "enabled": true, "days": [1, 2, 3, 4, 5], "start": "09:00", "end": "18:00" })).unwrap()
    }

    #[test]
    fn work_hours() {
        let h = hours();
        assert!(in_work_hours(&h, &date(10, 29, 10, 0))); // Thursday
        assert!(!in_work_hours(&h, &date(10, 29, 18, 0)));
        assert!(!in_work_hours(&h, &date(10, 31, 10, 0))); // Saturday
        let off = WorkHours { enabled: false, ..hours() };
        assert!(in_work_hours(&off, &date(10, 31, 3, 0)));
    }

    #[test]
    fn next_start_of_working_hours() {
        let h = hours();
        let ms = |d: DateTime<Local>| Some(d.timestamp_millis());
        assert_eq!(next_work_start(&h.window, &date(10, 29, 21, 0)), ms(date(10, 30, 9, 0)));
        assert_eq!(next_work_start(&h.window, &date(10, 30, 21, 0)), ms(date(11, 2, 9, 0)), "skips the weekend");
        let none = Window { days: vec![], ..h.window.clone() };
        assert_eq!(next_work_start(&none, &date(10, 30, 21, 0)), None);
    }

    #[test]
    fn snoozes_run_out_after_the_limit_and_a_finished_break_resets_them() {
        let mut r = Run::new(json!({ "water": { "enabled": false }, "stand": { "maxSnoozes": 2 } }));
        assert_eq!(r.s.snoozes_left(), Some(2));
        r.tick(40 * MIN);
        r.s.snooze(40 * MIN, 5);
        r.tick(45 * MIN);
        r.s.snooze(45 * MIN, 5);
        assert_eq!(r.s.snoozes_left(), Some(0));
        r.s.skip(50 * MIN);
        assert_eq!(r.s.snoozes_left(), Some(0), "skipping is not a finished break");
        r.s.break_done(90 * MIN);
        assert_eq!(r.s.snoozes_left(), Some(2));
    }

    #[test]
    fn away_time_also_resets_the_snooze_count() {
        let mut r = Run::new(no_water());
        r.tick(40 * MIN);
        r.s.snooze(40 * MIN, 5);
        r.tick_with(44 * MIN, Tick { idle_sec: 300.0, ..Tick::default() });
        assert_eq!(r.s.snoozes_left(), Some(2));
    }

    #[test]
    fn no_snooze_limit_when_it_is_set_to_0() {
        let mut r = Run::new(json!({ "stand": { "maxSnoozes": 0 } }));
        for i in 0..5 {
            r.s.snooze(i * MIN, 5);
        }
        assert_eq!(r.s.snoozes_left(), None);
    }

    #[test]
    fn defaults_30_minutes_sitting_2_minute_breaks_3_minutes_away_2_snoozes() {
        let d = Config::from_value(&defaults());
        assert_eq!(d.stand.every_min, 30.0);
        assert_eq!(d.stand.break_sec, 120.0);
        assert_eq!(d.stand.away_min, 3.0);
        assert_eq!(d.stand.max_snoozes, 2.0);
    }

    #[test]
    fn a_due_break_waits_for_a_pause_then_starts() {
        let mut r = Run::new(json!({ "water": { "enabled": false }, "stand": { "waitForFlow": true } }));
        r.tick_with(40 * MIN, FLOW);
        assert_eq!(r.events, vec![]);
        assert!(r.s.status(40 * MIN).waiting_for_flow);
        r.tick(41 * MIN);
        assert_eq!(r.events, vec![Stand]);
        assert!(!r.s.status(41 * MIN).waiting_for_flow);
    }

    #[test]
    fn a_break_waits_for_a_pause_for_10_minutes_at_most() {
        let mut r = Run::new(json!({ "water": { "enabled": false }, "stand": { "waitForFlow": true } }));
        r.tick_with(40 * MIN, FLOW);
        r.tick_with(40 * MIN + FLOW_MAX_WAIT_MS - 1, FLOW);
        assert_eq!(r.events, vec![]);
        r.tick_with(40 * MIN + FLOW_MAX_WAIT_MS, FLOW);
        assert_eq!(r.events, vec![Stand]);
    }

    #[test]
    fn being_busy_changes_nothing_when_waiting_for_a_pause_is_off() {
        let mut r = Run::new(json!({ "water": { "enabled": false }, "stand": { "waitForFlow": false } }));
        r.tick_with(40 * MIN, FLOW);
        assert_eq!(r.events, vec![Stand]);
    }

    // Monday 2 November 2026.
    fn at(hour: u32, minute: u32, day: u32) -> DateTime<Local> {
        date(11, day, hour, minute)
    }
    fn ms(hour: u32, minute: u32) -> i64 {
        at(hour, minute, 2).timestamp_millis()
    }
    fn clocked(patch: Value) -> Run {
        Run::at(patch, ms(0, 0))
    }
    fn plain(patch: Value) -> Config {
        Config::from_patch(patch)
    }

    #[test]
    fn water_follows_the_working_hours_switch_until_someone_chooses() {
        let off = plain(json!({ "workHours": { "enabled": false } }));
        let on = plain(json!({ "workHours": { "enabled": true } }));
        assert_eq!(water_schedule(&off), "always");
        assert_eq!(water_schedule(&on), "work");
        assert!(in_water_hours(&off, &at(23, 0, 2)));
        assert!(!in_water_hours(&on, &at(23, 0, 2)));
    }

    #[test]
    fn choosing_working_hours_applies_them_even_with_the_break_switch_off() {
        let c = plain(json!({ "water": { "schedule": "work" }, "workHours": { "enabled": false } }));
        assert!(in_water_hours(&c, &at(10, 0, 2)));
        assert!(!in_water_hours(&c, &at(20, 0, 2)));
    }

    #[test]
    fn any_time_ignores_working_hours() {
        let c = plain(json!({ "water": { "schedule": "always" }, "workHours": { "enabled": true } }));
        assert!(in_water_hours(&c, &at(23, 0, 2)));
    }

    #[test]
    fn custom_water_hours_use_their_own_days_and_times() {
        let c = plain(json!({ "water": { "schedule": "custom", "hours": { "days": [1], "start": "08:00", "end": "21:00" } } }));
        assert!(!in_water_hours(&c, &at(7, 59, 2)));
        assert!(in_water_hours(&c, &at(8, 0, 2)));
        assert!(!in_water_hours(&c, &at(21, 0, 2)));
        assert!(!in_water_hours(&c, &at(10, 0, 3)), "Tuesday is off");
    }

    #[test]
    fn custom_water_hours_can_run_past_midnight() {
        let c = plain(json!({ "water": { "schedule": "custom", "hours": { "days": [1], "start": "22:00", "end": "02:00" } } }));
        assert!(in_water_hours(&c, &at(23, 0, 2)));
        assert!(in_water_hours(&c, &at(1, 0, 3)), "Monday night, into Tuesday");
        assert!(!in_water_hours(&c, &at(23, 0, 3)), "Tuesday night is off");
        assert!(!in_water_hours(&c, &at(12, 0, 2)));
    }

    #[test]
    fn water_reminds_outside_working_hours_when_it_has_its_own_schedule() {
        let mut r = clocked(json!({
            "water": { "schedule": "always", "everyMin": 30 },
            "stand": { "everyMin": 40 },
            "workHours": { "enabled": true, "days": [1], "start": "09:00", "end": "18:00" }
        }));
        r.tick(ms(0, 30));
        assert_eq!(r.events, vec![Water]);
    }

    #[test]
    fn breaks_still_run_while_water_is_off_the_clock() {
        let mut r = clocked(json!({
            "water": { "schedule": "custom", "everyMin": 30, "hours": { "days": [1], "start": "20:00", "end": "21:00" } },
            "stand": { "everyMin": 40 }
        }));
        r.tick(ms(0, 30));
        assert_eq!(r.events, vec![]);
        assert!(r.s.status(ms(0, 30)).water_off);
        assert_eq!(r.s.status(ms(0, 30)).water_resumes_at, Some(ms(20, 0)));
        r.tick(ms(0, 41));
        assert_eq!(r.events, vec![Stand]);
    }

    #[test]
    fn pausing_stops_water_on_every_schedule() {
        let mut r = clocked(json!({ "water": { "schedule": "always", "everyMin": 30 } }));
        r.s.pause(ms(0, 0), 120);
        r.tick(ms(1, 0));
        assert_eq!(r.events, vec![]);
    }

    #[test]
    fn no_water_days_means_no_reminders_and_no_return_time() {
        let r = clocked(json!({ "water": { "schedule": "custom", "hours": { "days": [] } } }));
        assert!(r.s.status(ms(10, 0)).water_off);
        assert_eq!(r.s.status(ms(10, 0)).water_resumes_at, None);
    }

    #[test]
    fn status_matches_the_electron_shape() {
        let r = Run::new(json!({}));
        let v = serde_json::to_value(r.s.status(MIN)).unwrap();
        for key in ["offHours", "resumesAt", "msToStand", "standEveryMs", "sittingMs", "msToWater", "waterOff",
            "waterResumesAt", "pausedUntil", "waitingForMeeting", "waitingForFlow", "onBreak", "snoozesLeft"] {
            assert!(v.get(key).is_some(), "{key}");
        }
        assert_eq!(v["msToStand"], 39 * MIN);
        assert_eq!(v["resumesAt"], 0);
    }
}
