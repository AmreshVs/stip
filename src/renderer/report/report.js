const $ = (id) => document.getElementById(id);
const VERDICT = {
  changes: ['changes requested.', ''],
  approved: ['approved.', 'ok'],
  draft: ['draft.', 'ok'],
};

function dateLabel(key) {
  return new Date(`${key}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function diffLine(number, sign, text) {
  const row = document.createElement('div');
  row.className = sign === '+' ? 'add' : 'del';
  const num = document.createElement('i');
  num.textContent = number;
  const mark = document.createElement('b');
  mark.textContent = sign;
  const body = document.createElement('span');
  body.textContent = text;
  row.append(num, mark, body);
  return row;
}

function renderBars(chart) {
  const max = Math.max(1, ...chart.map((bar) => bar.taken + bar.skipped));
  $('bars').replaceChildren(
    ...chart.map((bar) => {
      const column = document.createElement('span');
      column.title = `${bar.taken} taken, ${bar.skipped} skipped at ${String(bar.hour).padStart(2, '0')}:00`;
      for (const kind of ['skipped', 'taken']) {
        if (!bar[kind]) continue;
        const part = document.createElement('i');
        part.className = kind;
        part.style.height = `${(bar[kind] / max) * 100}%`;
        column.append(part);
      }
      return column;
    }),
  );
  const middle = chart[Math.floor(chart.length / 2)];
  $('axis').replaceChildren(
    ...[chart[0], middle, chart[chart.length - 1]].map((bar) =>
      Object.assign(document.createElement('span'), { textContent: String(bar.hour).padStart(2, '0') }),
    ),
  );
}

function renderFolders(folders) {
  $('folders').replaceChildren(
    ...folders.map((folder) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = folder.split(/[\\/]/).pop();
      name.title = folder;
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${folder}`);
      remove.addEventListener('click', () => window.stip.act('report-remove-folder', { folder }));
      item.append(name, remove);
      return item;
    }),
  );
}

async function refresh() {
  const { report, folders, theme, sandboxed } = await window.stip.getReport();
  applyTheme(theme);
  $('commits').hidden = sandboxed;
  $('commits-rule').hidden = sandboxed;
  $('meta').textContent = `you/spine #${report.number} · ${dateLabel(report.from)} to ${dateLabel(report.to)}`;

  const [word, tone] = VERDICT[report.verdict];
  const verdict = document.createElement('em');
  verdict.textContent = word;
  verdict.className = tone;
  $('title').replaceChildren('Spine report: ', verdict);

  $('plus').textContent = `+${report.added.length}`;
  $('minus').textContent = `-${report.removed.length}`;
  const lines = [
    ...report.added.map((text, i) => diffLine(12 + i, '+', text)),
    ...report.removed.map((text, i) => diffLine(12 + report.added.length + i, '-', text)),
  ];
  if (!lines.length) {
    lines.push(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No changes yet.' }));
  }
  $('diff').replaceChildren(...lines);

  $('review').textContent = report.review;
  $('suggestion-box').hidden = !report.suggestion;
  if (report.suggestion) $('suggestion').textContent = `Suggestion: ${report.suggestion.text}.`;
  $('outcome').hidden = !report.reviewed;
  $('outcome').textContent = report.reviewed === 'applied' ? 'Suggestion applied.' : 'Marked as won\'t fix, for this week.';

  renderBars(report.chart);
  $('insight').textContent = report.commits || 'Add a project folder to see how your breaks line up with your commits.';
  renderFolders(folders);
}

// The image leaves out the buttons, so it's ready to share.
async function capture(action) {
  document.body.classList.add('capturing');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.stip.act(action);
  setTimeout(() => document.body.classList.remove('capturing'), 500);
}

$('copy').addEventListener('click', () => capture('report-copy'));
$('save').addEventListener('click', () => capture('report-save'));
$('apply').addEventListener('click', () => window.stip.act('report-apply'));
$('dismiss').addEventListener('click', () => window.stip.act('report-dismiss'));
$('add-folder').addEventListener('click', () => window.stip.act('report-add-folder'));

window.stip.onState(refresh);
refresh();
