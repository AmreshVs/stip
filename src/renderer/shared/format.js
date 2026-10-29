// Small helpers shared by every window. Loaded as a classic script.
window.fmt = {
  clock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  },
  minutes(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  },
};

window.applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme || 'flat';
};
