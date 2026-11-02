// The Spine report: a week of habits, written as a code review. Pure logic, so
// it can be tested without Electron. It only ever reads what's on this computer.
const TWO_HOURS_MIN = 120;
const FLAG_SIT_MIN = 90;
const MANY_SKIPS = 5;
const LATE_HOUR = 18;
const SKIPPY_DAY = 3;
const MIN_COMPARED = 2;

const addUp = (days, key) => days.reduce((sum, day) => sum + day[key], 0);

function hourLabel(hour) {
  const h = hour % 12 || 12;
  return `${h} ${hour < 12 ? 'am' : 'pm'}`;
}

function sitLabel(minutes) {
  const h = Math.floor(minutes / 60);
  if (!h) return `${minutes} min`;
  return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`;
}

// The latest hour after which most skips happen, if there's a real pattern.
function skipPattern(days) {
  const hours = {};
  for (const day of days) {
    for (const [hour, count] of Object.entries(day.skippedHours || {})) hours[hour] = (hours[hour] || 0) + count;
  }
  const total = Object.values(hours).reduce((a, b) => a + b, 0);
  if (total < MANY_SKIPS) return null;
  for (let hour = 20; hour >= 10; hour -= 1) {
    const after = Object.entries(hours).reduce((sum, [h, count]) => (Number(h) >= hour ? sum + count : sum), 0);
    if (after / total >= 2 / 3) return { hour, after, total };
  }
  return null;
}

function tip(days) {
  const pattern = skipPattern(days);
  return pattern ? `You usually skip after ${hourLabel(pattern.hour)}. A short walk now would help.` : '';
}

function suggestion(settings, { longest, skipped, waterDays }) {
  const { everyMin } = settings.stand;
  if ((longest >= everyMin * 2 || skipped >= MANY_SKIPS) && everyMin > 20) {
    const next = Math.max(20, everyMin - 5);
    return { text: `a break every ${next} min instead of ${everyMin}`, patch: { stand: { everyMin: next } } };
  }
  const water = settings.water;
  if (water.enabled && waterDays < 4 && water.everyMin > 20) {
    const next = Math.max(20, water.everyMin - 10);
    return { text: `a water reminder every ${next} min instead of ${water.everyMin}`, patch: { water: { everyMin: next } } };
  }
  return null;
}

function commitInsight(commits, week) {
  if (!commits || !commits.length) return null;
  const skippy = new Set(week.filter((day) => day.skipped >= SKIPPY_DAY).map((day) => day.date));
  const dates = new Set(week.map((day) => day.date));
  const thisWeek = commits.filter((commit) => dates.has(commit.date));
  const lateFix = (commit) => commit.fix && commit.hour >= LATE_HOUR;
  const rate = (list, dayCount) => (dayCount ? list.filter(lateFix).length / dayCount : 0);
  const skippyCommits = thisWeek.filter((c) => skippy.has(c.date));
  const otherCommits = thisWeek.filter((c) => !skippy.has(c.date));
  const onSkippy = rate(skippyCommits, skippy.size);
  const onOther = rate(otherCommits, week.length - skippy.size);
  // A comparison needs enough commits on both sides to mean anything.
  const enough = skippyCommits.filter(lateFix).length >= MIN_COMPARED && otherCommits.filter(lateFix).length >= MIN_COMPARED;
  if (enough && onSkippy / onOther >= 1.5) {
    return `On days you skipped ${SKIPPY_DAY} or more breaks, you made ${Number((onSkippy / onOther).toFixed(1))} times as many "fix" commits after 6 pm.`;
  }
  const breaks = addUp(week, 'breaks');
  return `${thisWeek.length} ${thisWeek.length === 1 ? 'commit' : 'commits'} and ${breaks} ${breaks === 1 ? 'break' : 'breaks'} this week.`;
}

function weekNumber(now) {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return { year: date.getUTCFullYear(), week: Math.ceil(((date - yearStart) / 86400000 + 1) / 7) };
}

function hoursChart(week) {
  const taken = {};
  const skipped = {};
  for (const day of week) {
    for (const [hour, count] of Object.entries(day.hours)) taken[hour] = (taken[hour] || 0) + count;
    for (const [hour, count] of Object.entries(day.skippedHours)) skipped[hour] = (skipped[hour] || 0) + count;
  }
  const seen = [...Object.keys(taken), ...Object.keys(skipped)].map(Number);
  const first = Math.min(9, ...seen);
  const last = Math.max(17, ...seen);
  const bars = [];
  for (let hour = first; hour <= last; hour += 1) {
    bars.push({ hour, taken: taken[hour] || 0, skipped: skipped[hour] || 0 });
  }
  return bars;
}

// week and lastWeek are arrays of day records, oldest first.
function buildReport({ week, lastWeek, streak, settings, now = new Date(), commits = null }) {
  const breaks = addUp(week, 'breaks');
  const skipped = addUp(week, 'skipped');
  const previous = addUp(lastWeek, 'breaks');
  const waterDays = week.filter((day) => day.glasses >= settings.water.goalGlasses).length;
  const longestDay = week.reduce((best, day) => (day.longestSitMin > best.longestSitMin ? day : best), week[0]);
  const longest = longestDay.longestSitMin;
  const pattern = skipPattern(week);
  const { year, week: number } = weekNumber(now);
  const key = `${year}-W${number}`;
  const base = { number, key, from: week[0].date, to: week[week.length - 1].date, chart: hoursChart(week) };

  if (!breaks && !skipped && !addUp(week, 'glasses')) {
    return {
      ...base,
      verdict: 'draft',
      added: [],
      removed: [],
      review: 'Nothing to review yet. Take a few breaks and check back.',
      suggestion: null,
      reviewed: null,
      commits: commitInsight(commits, week),
    };
  }

  const added = [];
  const removed = [];
  const trend = previous && breaks > previous ? `, up from ${previous}` : '';
  if (breaks) added.push(`${breaks} ${breaks === 1 ? 'break' : 'breaks'} taken${trend}`);
  if (settings.water.enabled && waterDays) added.push(`Water goal met on ${waterDays} of 7 days`);
  if (streak >= 2) added.push(`${streak}-day stand streak`);
  if (skipped) {
    const when = pattern ? `, ${pattern.after} of them after ${hourLabel(pattern.hour)}` : '';
    removed.push(`${skipped} ${skipped === 1 ? 'break' : 'breaks'} skipped${when}`);
  }
  if (previous > breaks) removed.push(`Down from ${previous} breaks the week before`);
  if (longest >= FLAG_SIT_MIN) {
    const day = new Date(`${longestDay.date}T12:00:00`).toLocaleDateString('en', { weekday: 'long' });
    removed.push(`Sat for ${sitLabel(longest)} straight on ${day}`);
  }

  const blocking = longest >= TWO_HOURS_MIN || skipped >= MANY_SKIPS || skipped > breaks;
  let review = blocking ? "Good effort, but I can't approve this yet." : 'Clean week. Nothing blocking from me.';
  if (pattern) review = `Most of the skips come after ${hourLabel(pattern.hour)}. That's where the build breaks, mostly your posture.`;
  if (longest >= TWO_HOURS_MIN) review += ` Blocking on this one: the ${sitLabel(longest)} sit.`;

  const fix = blocking || waterDays < 4 ? suggestion(settings, { longest, skipped, waterDays }) : null;
  const decided = settings.report.reviewed?.key === key ? settings.report.reviewed.outcome : null;
  return {
    ...base,
    verdict: blocking ? 'changes' : 'approved',
    added,
    removed,
    review,
    suggestion: decided ? null : fix,
    reviewed: decided,
    commits: commitInsight(commits, week),
  };
}

module.exports = { buildReport, skipPattern, tip, commitInsight, hourLabel, sitLabel };
