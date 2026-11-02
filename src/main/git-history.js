const { execFile } = require('node:child_process');

const FIX = /\b(fix|fixes|fixed|hotfix|bug|oops|revert)\b/i;

function git(folder, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', folder, ...args], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}

// Your own recent commits in the folders you chose: when, and whether the
// message looks like a fix. Read here, kept in memory, and never sent anywhere.
async function recentCommits(folders, days = 14) {
  const all = await Promise.all(
    folders.map(async (folder) => {
      const email = (await git(folder, ['config', 'user.email'])).trim();
      if (!email) return [];
      const log = await git(folder, ['log', `--since=${days}.days`, `--author=${email}`, '--format=%aI%x09%s']);
      return log.split('\n').filter(Boolean).map(parseLine);
    }),
  );
  return all.flat();
}

function parseLine(line) {
  const [stamp, ...subject] = line.split('\t');
  const date = new Date(stamp);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    hour: date.getHours(),
    fix: FIX.test(subject.join('\t')),
  };
}

module.exports = { recentCommits, parseLine };
