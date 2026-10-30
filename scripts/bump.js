// Sets a new version everywhere it appears and commits it.
//
//   npm run bump -- patch      1.0.0 -> 1.0.1
//   npm run bump -- minor      1.0.0 -> 1.1.0
//   npm run bump -- major      1.0.0 -> 2.0.0
//   npm run bump -- 1.2.3      exact version
//
// The changes listed under "Unreleased" in CHANGELOG.md move under the new
// version. The Release workflow runs this when you pick a bump there.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const file = (name) => path.join(root, name);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

function next(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [major, minor, patch] = current.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  return fail('Say how to bump: patch, minor, major, or an exact version like 1.2.3');
}

function replaceIn(name, from, to) {
  const text = fs.readFileSync(file(name), 'utf8');
  if (!text.includes(from)) fail(`Couldn't find "${from}" in ${name}`);
  fs.writeFileSync(file(name), text.replace(from, to));
}

if (git('status', '--porcelain')) fail('Commit or stash your changes first, so the bump commit has only the version.');

const pkg = JSON.parse(fs.readFileSync(file('package.json'), 'utf8'));
const current = pkg.version;
const version = next(current, process.argv[2]);
if (version === current) fail(`Already at ${current}.`);
const today = new Date().toISOString().slice(0, 10);

// package.json and package-lock.json
execFileSync('npm', ['version', version, '--no-git-tag-version'], { cwd: root, stdio: 'ignore' });

// The changelog: Unreleased notes move under the new version.
const changelog = fs.readFileSync(file('CHANGELOG.md'), 'utf8');
const unreleased = changelog.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## \[)/);
if (!unreleased || !unreleased[1].trim()) {
  console.warn('Note: nothing is listed under "Unreleased" in CHANGELOG.md, so this version has no notes.');
}
replaceIn('CHANGELOG.md', '## [Unreleased]\n', `## [Unreleased]\n\n## [${version}] - ${today}\n`);
replaceIn(
  'CHANGELOG.md',
  `[Unreleased]: https://github.com/AmreshVs/stip/compare/v${current}...HEAD`,
  `[Unreleased]: https://github.com/AmreshVs/stip/compare/v${version}...HEAD\n[${version}]: https://github.com/AmreshVs/stip/compare/v${current}...v${version}`,
);

// The website's structured data and the bug report template.
replaceIn('docs/index.html', `"softwareVersion": "${current}"`, `"softwareVersion": "${version}"`);
replaceIn('.github/ISSUE_TEMPLATE/bug_report.yml', `placeholder: ${current}`, `placeholder: ${version}`);

git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'docs/index.html', '.github/ISSUE_TEMPLATE/bug_report.yml');
git('commit', '-q', '-m', `Release version ${version}`);

console.log(`Bumped ${current} -> ${version} and committed it.`);
console.log('Push it, then run the Release workflow with "Publish a release" ticked.');
