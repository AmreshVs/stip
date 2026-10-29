// Stip's own jokes, drawn in markup so nothing is borrowed from the internet.
// Every entry is static text written here, so building HTML from it is safe.

const FIGURE_UPRIGHT =
  '<svg viewBox="0 0 100 96" aria-hidden="true"><path d="M30 86h44M60 86V62h-28" class="m-line"/><circle cx="40" cy="18" r="8" class="m-line"/><path d="M40 26v32h18v26M40 38l18 6" class="m-line"/><rect x="64" y="40" width="22" height="16" class="m-fill"/></svg>';
const FIGURE_SHRIMP =
  '<svg viewBox="0 0 100 96" aria-hidden="true"><path d="M30 86h44M60 86V62h-28" class="m-line"/><g class="m-slump"><circle cx="40" cy="18" r="8" class="m-line"/><path d="M40 26 Q30 44 40 58" class="m-line"/></g><path d="M40 58h18v26M38 44l20 4" class="m-line"/><rect x="64" y="40" width="22" height="16" class="m-fill"/></svg>';

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
    body: 'It has been in the same position for 40 minutes.',
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
