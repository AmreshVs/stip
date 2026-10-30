// Stip's own jokes, drawn in markup so nothing is borrowed from the internet.
// Every entry is static text written here, so building HTML from it is safe.

const FIGURE_UPRIGHT =
  '<svg viewBox="0 0 100 96" aria-hidden="true"><path d="M30 86h44M60 86V62h-28" class="m-line"/><circle cx="40" cy="18" r="8" class="m-line"/><path d="M40 26v32h18v26M40 38l18 6" class="m-line"/><rect x="64" y="40" width="22" height="16" class="m-fill"/></svg>';
const FIGURE_SHRIMP =
  '<svg viewBox="0 0 100 96" aria-hidden="true"><path d="M30 86h44M60 86V62h-28" class="m-line"/><g class="m-slump"><circle cx="40" cy="18" r="8" class="m-line"/><path d="M40 26 Q30 44 40 58" class="m-line"/></g><path d="M40 58h18v26M38 44l20 4" class="m-line"/><rect x="64" y="40" width="22" height="16" class="m-fill"/></svg>';

// Small drawings for the picture memes, in the same flat line style.
const DESK_2000 =
  '<svg viewBox="0 0 100 96" aria-hidden="true"><path d="M20 86h60M64 86V62H36" class="m-line"/><circle cx="34" cy="20" r="8" class="m-line"/><path d="M34 28v30h18v26M34 40l22 4" class="m-line"/><rect x="58" y="22" width="32" height="26" rx="2" class="m-fill"/><path d="M62 29h18M62 35h22M62 41h12" class="m-code"/></svg>';
const DESK_2026 =
  '<svg viewBox="0 0 100 96" aria-hidden="true"><path d="M20 86h60M64 86V62H36" class="m-line"/><circle cx="34" cy="34" r="8" class="m-line"/><path d="M34 42v16h18v26M34 48l22 2" class="m-line"/><path d="M42 4h56v22H60l-6 6v-6H42z" class="m-bubble"/><text x="70" y="18" class="m-svgtext" text-anchor="middle">pls, a regex</text></svg>';
const DOCS_NEAT =
  '<svg viewBox="0 0 100 96" aria-hidden="true"><rect x="12" y="14" width="28" height="18" rx="3" class="m-line"/><rect x="60" y="14" width="28" height="18" rx="3" class="m-line"/><rect x="36" y="62" width="28" height="18" rx="3" class="m-line"/><path d="M40 23h20M26 32l16 30M74 32L58 62" class="m-line"/></svg>';
const DOCS_REAL =
  '<svg viewBox="0 0 100 96" aria-hidden="true"><path d="M14 20c20-14 30 30 50 6s20 30-8 26-36 30-10 20 28 18 30-6-46-8-50 18 4 30 26 20" class="m-line"/><path d="M22 70c8-8 18 6 26-4s14 10 24 0" class="m-line"/><circle cx="78" cy="16" r="5" class="m-line"/></svg>';
const SCENE_FIRE =
  '<svg viewBox="0 0 200 110" aria-hidden="true"><path d="M20 100V40l80-30 80 30v60z" class="m-line"/><path d="M34 100c-6-20 10-26 6-44 12 10 14 22 10 30 6-6 6-14 4-20 12 12 14 26 6 34zM150 100c-8-16 6-24 2-40 14 10 16 26 8 40zM58 52c-4-10 4-14 2-22 8 6 8 14 4 22z" class="m-flame"/><path d="M86 100V78h28v22" class="m-line"/><path d="M90 66h20v14a6 6 0 01-6 6h-8a6 6 0 01-6-6zM110 70h4a4 4 0 010 8h-4" class="m-line"/><path d="M95 60c-2-4 2-6 0-10M103 60c-2-4 2-6 0-10" class="m-line m-steam"/></svg>';
const SCENE_STICK =
  '<svg viewBox="0 0 200 110" aria-hidden="true"><rect x="110" y="6" width="68" height="78" class="m-fill"/><path d="M120 16h8M136 16h8M152 16h8M120 28h8M136 28h8M152 28h8M120 40h8M136 40h8M152 40h8M120 52h8M136 52h8M152 52h8M120 64h8M136 64h8M152 64h8M168 16h4M168 28h4M168 40h4M168 52h4M168 64h4" class="m-window"/><path d="M144 84v22" class="m-line m-thin"/><path d="M84 106h112" class="m-line"/><path d="M140 96l-30-8" class="m-line m-thin"/><text x="106" y="84" class="m-svgtext" text-anchor="end">8-year-old answer,</text><text x="106" y="94" class="m-svgtext" text-anchor="end">0 upvotes</text></svg>';
const SCENE_SEARCH =
  '<svg viewBox="0 0 200 110" aria-hidden="true"><path d="M14 14h60M14 24h90M24 34h70M24 44h110M14 54h50M24 64h96M24 74h60M14 84h120M14 94h80M120 14h50M110 24h70M140 34h40M150 54h30M130 64h50M150 84h30M100 94h70" class="m-code-dark"/><circle cx="140" cy="62" r="24" class="m-glass"/><path d="M157 79l20 20" class="m-line m-thick"/><text x="134" y="68" class="m-svgtext m-big">;</text></svg>';
const SCENE_SPACE =
  '<svg viewBox="0 0 200 110" aria-hidden="true"><rect width="200" height="110" class="m-night"/><circle cx="150" cy="70" r="26" class="m-planet"/><path d="M118 74c20 8 50 6 66-6" class="m-ring"/><circle cx="30" cy="20" r="1.5" class="m-star"/><circle cx="70" cy="40" r="1.2" class="m-star"/><circle cx="110" cy="16" r="1.6" class="m-star"/><circle cx="180" cy="24" r="1.2" class="m-star"/><circle cx="46" cy="86" r="1.4" class="m-star"/><circle cx="20" cy="60" r="1" class="m-star"/><path d="M16 96h14M34 96h14M52 96h14" class="m-tabs"/><text x="72" y="99" class="m-svgtext m-onnight">0 tabs open</text></svg>';
const SCENE_LIGHT =
  '<svg viewBox="0 0 200 110" aria-hidden="true"><path d="M100 4v12M100 94v12M54 55H40M160 55h-14M68 22l-9-9M132 22l9-9M68 88l-9 9M132 88l9 9" class="m-line"/><rect x="66" y="26" width="68" height="58" rx="4" class="m-white"/><path d="M74 38h30M74 48h44M74 58h24M74 68h36" class="m-code-dark"/><circle cx="26" cy="88" r="10" class="m-line"/><path d="M20 85l4 2-4 2M32 85l-4 2 4 2M22 94q4-3 8 0" class="m-line m-thin"/><path d="M14 80l-6-8M38 80l6-8" class="m-line"/><text x="42" y="100" class="m-svgtext">hiss</text></svg>';

window.MEMES = [
  {
    kind: 'panels',
    left: { art: FIGURE_UPRIGHT, label: 'Me at 9 am' },
    right: { art: FIGURE_SHRIMP, label: 'Me at 4 pm' },
    caption: 'Evolving into a shrimp, one commit at a time.',
  },
  {
    kind: 'dialog',
    title: 'spine.exe',
    heading: 'spine.exe is not responding',
    body: 'It has been in the same position for 30 minutes.',
    buttons: ['Wait for it', 'Stand to restart'],
  },
  {
    kind: 'terminal',
    lines: ['$ git commit -m "stood up"', '[main 4f2a1c] 1 human changed', ' 0 regrets, 1 stretch(+)'],
    caption: 'The only commit nobody will review.',
  },
  {
    kind: 'quote',
    text: 'Sitting is the new smoking. Standing is the new not smoking.',
    by: 'Your lower back, probably',
  },
  {
    kind: 'dialog',
    title: 'legs.app',
    heading: 'Low battery: legs at 3%',
    body: 'Connect to the floor to charge.',
    buttons: ['Remind me later', 'Stand up'],
  },
  {
    kind: 'terminal',
    lines: ['$ npm run posture', 'npm ERR! missing script: posture', 'npm ERR! try: stand up'],
    caption: 'Some dependencies you install yourself.',
  },
  {
    kind: 'quote',
    text: 'Your chair is not a long-term relationship. Take a break.',
    by: 'Stip, relationship advice',
  },
  {
    kind: 'dialog',
    title: 'bloodflow.service',
    heading: 'Service degraded in region: legs',
    body: 'Mitigation: stand up and walk to the kitchen.',
    buttons: ['Acknowledge', 'Mitigate'],
  },
  {
    kind: 'terminal',
    lines: ['$ ps aux | grep you', 'you   4012  99.9%  sitting', '$ kill -STOP sitting'],
    caption: 'Some processes need a manual restart.',
  },
  {
    kind: 'quote',
    text: 'It works on my machine. My machine is a chair. Fixing that now.',
    by: 'Every developer, eventually',
  },
  { kind: 'joke', setup: 'Why do programmers wear glasses?', punchline: "Because they can't C#." },
  { kind: 'joke', setup: 'There are 10 types of people in the world:', punchline: "Those who understand binary, and those who don't." },
  { kind: 'joke', setup: 'How many programmers does it take to change a light bulb?', punchline: "None. It's a hardware problem." },
  { kind: 'joke', setup: 'Why did the programmer quit their job?', punchline: "They didn't get arrays." },
  { kind: 'joke', setup: "What's a programmer's favourite hangout?", punchline: 'The Foo Bar.' },
  {
    kind: 'panels',
    left: { art: DESK_2000, label: '2000: writes the algorithm' },
    right: { art: DESK_2026, label: '2026: begs for a regex' },
    caption: 'The evolution of coding.',
  },
  {
    kind: 'chat',
    lines: [
      { who: 'Dev', text: 'But it works on my machine!' },
      { who: 'DevOps', text: "Great. Then we'll ship your machine to production." },
    ],
  },
  { kind: 'scene', art: SCENE_FIRE, caption: 'Senior dev adding one print statement to see where prod crashes.' },
  {
    kind: 'terminal',
    lines: ['$ git log --oneline', 'f9e8d7 please work final v3', 'c4d5e6 fixed typo for real', '...', 'a1b2c3 Feature complete'],
    caption: 'Git history: an honest timeline.',
  },
  { kind: 'scene', art: SCENE_STICK, caption: 'Every production codebase.' },
  { kind: 'joke', setup: "What's the object-oriented way to get rich?", punchline: 'Inheritance.' },
  { kind: 'joke', setup: 'Why do Java developers wear glasses?', punchline: "Because they don't C." },
  { kind: 'joke', setup: 'A SQL query walks into a bar, walks up to two tables and asks:', punchline: '"Can I join you?"' },
  { kind: 'joke', setup: 'Optimist: the glass is half full. Pessimist: half empty.', punchline: 'Programmer: the glass is twice as big as it needs to be.' },
  { kind: 'scene', art: SCENE_SEARCH, caption: 'Me looking for the semicolon that broke a 4,000-line build.' },
  {
    kind: 'panels',
    left: { art: DOCS_NEAT, label: 'The documentation' },
    right: { art: DOCS_REAL, label: 'The actual codebase' },
    caption: 'Code comments vs reality.',
  },
  { kind: 'scene', art: SCENE_SPACE, caption: 'The inner peace of closing 47 tabs after the bug is fixed.' },
  { kind: 'scene', art: SCENE_LIGHT, caption: 'When a config file opens in the light theme.' },
  { kind: 'joke', setup: "What's a machine learning engineer's favourite music?", punchline: 'Algorithm and blues.' },
  { kind: 'joke', setup: 'Why was the computer cold?', punchline: 'It left its Windows open.' },
];

function memeHtml(meme) {
  switch (meme.kind) {
    case 'panels':
      return `<div class="meme meme-panels">
        <div class="m-grid">
          <figure class="m-cell m-a">${meme.left.art}<figcaption>${meme.left.label}</figcaption></figure>
          <figure class="m-cell m-b">${meme.right.art}<figcaption>${meme.right.label}</figcaption></figure>
        </div>
        <p class="m-caption">${meme.caption}</p>
      </div>`;
    case 'dialog':
      return `<div class="meme meme-dialog">
        <div class="m-bar"><span>${meme.title}</span><span class="m-dots"><i></i><i></i></span></div>
        <div class="m-body">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="m-warn"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>
          <div><strong>${meme.heading}</strong><p>${meme.body}</p></div>
        </div>
        <div class="m-buttons"><span>${meme.buttons[0]}</span><span class="m-go">${meme.buttons[1]}</span></div>
      </div>`;
    case 'joke':
      // The punchline lands a few seconds after the setup.
      return `<div class="meme meme-joke">
        <p class="m-setup">${meme.setup}</p>
        <p class="m-punch">${meme.punchline}</p>
      </div>`;
    case 'chat':
      return `<div class="meme meme-chat">
        ${meme.lines.map((line, i) => `<p class="m-say ${i % 2 ? 'm-right' : ''}"><b>${line.who}</b>${line.text}</p>`).join('')}
      </div>`;
    case 'scene':
      return `<div class="meme meme-scene">
        <div class="m-art">${meme.art}</div>
        <p class="m-caption">${meme.caption}</p>
      </div>`;
    case 'terminal':
      return `<div class="meme meme-terminal">
        <pre>${meme.lines.join('\n')}</pre>
        <p class="m-caption">${meme.caption}</p>
      </div>`;
    default:
      return `<div class="meme meme-quote">
        <p class="m-quote">${meme.text}</p>
        <p class="m-by">${meme.by}</p>
      </div>`;
  }
}

window.memeAt = (index) => memeHtml(window.MEMES[((index % window.MEMES.length) + window.MEMES.length) % window.MEMES.length]);
