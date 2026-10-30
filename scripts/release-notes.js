// Prints one version's section of CHANGELOG.md, for the GitHub release notes.
//   node scripts/release-notes.js 1.0.0
const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const escaped = version.replace(/\./g, '\\.');
const section = changelog.match(new RegExp(`## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|\\n\\[Unreleased\\]:|$)`));

const notes = section ? section[1].trim() : '';
console.log(notes || `Stip ${version}.`);
console.log(`\n**Download:** the \`.dmg\` for macOS (\`arm64\` for Apple silicon, \`x64\` for Intel), or the \`.AppImage\` or \`.deb\` for Linux.`);
