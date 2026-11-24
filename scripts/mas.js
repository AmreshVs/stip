// Builds Stip for the Mac App Store: a sandboxed universal app (the `mas`
// cargo feature) signed for the store, inside a signed installer package.
//
//   npm run dist:mas                    dist/Stip-<version>-universal.pkg
//   npm run dist:mas -- --build 2       the same, with build number 2
//
// Needs, on a Mac:
//   - build/Stip_App_Store.provisionprofile (Mac App Store Connect profile
//     for dev.amreshvs.stip; .gitignore keeps it out of the repo)
//   - an "Apple Distribution" or "3rd Party Mac Developer Application"
//     certificate, and a "3rd Party Mac Developer Installer" or "Mac Installer
//     Distribution" one, in the keychain. Set APPLE_SIGNING_IDENTITY or
//     INSTALLER_SIGNING_IDENTITY to pick others.
//   - the Rust targets aarch64-apple-darwin and x86_64-apple-darwin.
//
// Every upload needs a new build number (CFBundleVersion). It's the version
// unless --build says otherwise.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TAURI_CLI = '@tauri-apps/cli@2.12.4';
const TEAM = 'DRQUZF86A2';
const BUNDLE_ID = 'dev.amreshvs.stip';

const root = path.join(__dirname, '..');
const tauriDir = path.join(root, 'src-tauri');
const pkg = require(path.join(root, 'package.json'));
const profile = path.join(root, 'build', 'Stip_App_Store.provisionprofile');
const entitlements = path.join(root, 'build', 'entitlements.mas.plist');
const app = path.join(tauriDir, 'target', 'universal-apple-darwin', 'release', 'bundle', 'macos', 'Stip.app');
const out = path.join(root, 'dist', `Stip-${pkg.version}-universal.pkg`);

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });

if (process.platform !== 'darwin') fail('The Mac App Store build needs a Mac.');

const buildArg = process.argv.indexOf('--build');
const buildNumber = buildArg > -1 ? process.argv[buildArg + 1] : pkg.version;
if (!/^\d+(\.\d+){0,2}$/.test(buildNumber || '')) fail(`--build takes one to three numbers, like 2 or 1.1.0 (got "${buildNumber}").`);

// The profile must be for this app and team, and still valid.
if (!fs.existsSync(profile)) fail(`No ${path.relative(root, profile)}. Download the Mac App Store Connect profile for ${BUNDLE_ID} from developer.apple.com and save it there.`);
const profilePlist = read('security', ['cms', '-D', '-i', profile]);
const appId = /<key>com\.apple\.application-identifier<\/key>\s*<string>([^<]+)<\/string>/.exec(profilePlist)?.[1];
if (appId !== `${TEAM}.${BUNDLE_ID}`) fail(`The provisioning profile is for ${appId}, not ${TEAM}.${BUNDLE_ID}.`);
const expires = /<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/.exec(profilePlist)?.[1];
if (expires && new Date(expires) < new Date()) fail(`The provisioning profile expired on ${expires}. Make a new one.`);

// The certificates. Installer certificates aren't code-signing ones, so they
// only show up in the full list.
function identity(env, policy, pattern, what) {
  if (process.env[env]) return process.env[env];
  const args = ['find-identity', '-v', ...(policy ? ['-p', policy] : [])];
  const found = read('security', args).split('\n').map((line) => /"([^"]+)"/.exec(line)?.[1]).filter((name) => name && pattern.test(name) && name.includes(`(${TEAM})`));
  if (!found.length) fail(`No ${what} certificate for team ${TEAM} in the keychain. Set ${env} to use another.`);
  return found[0];
}
const appIdentity = identity('APPLE_SIGNING_IDENTITY', 'codesigning', /^(Apple Distribution|3rd Party Mac Developer Application):/, 'Apple Distribution / 3rd Party Mac Developer Application');
const installerIdentity = identity('INSTALLER_SIGNING_IDENTITY', null, /^(3rd Party Mac Developer Installer|Mac Installer Distribution):/, '3rd Party Mac Developer Installer');
console.log(`App:       ${appIdentity}\nInstaller: ${installerIdentity}\nVersion:   ${pkg.version} (build ${buildNumber})\n`);

// Stages the pages and fonts in ui-dist/, which the Tauri CLI looks for first.
run('cargo', ['check', '--locked', '--features', 'mas'], { cwd: tauriDir });

const config = {
  bundle: {
    macOS: {
      signingIdentity: appIdentity,
      entitlements,
      // The store doesn't need the hardened runtime, and the sandbox is what it checks.
      hardenedRuntime: false,
      infoPlist: 'Info.mas.plist',
      bundleVersion: buildNumber,
      files: { 'embedded.provisionprofile': profile },
    },
  },
};
// The Tauri CLI notarizes when it finds Apple credentials; store builds aren't notarized.
const env = { ...process.env };
for (const key of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH']) delete env[key];
run('npx', ['--yes', TAURI_CLI, 'build', '--target', 'universal-apple-darwin', '--bundles', 'app', '--features', 'mas', '--config', JSON.stringify(config)], { cwd: tauriDir, env });

// Check what Apple will check: a valid signature, the sandbox, the profile.
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
const signed = read('codesign', ['-d', '--entitlements', '-', '--xml', app]);
if (!signed.includes('com.apple.security.app-sandbox')) fail('The app was signed without the sandbox entitlement.');
if (!fs.existsSync(path.join(app, 'Contents', 'embedded.provisionprofile'))) fail('The provisioning profile is missing from the app.');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
run('xcrun', ['productbuild', '--component', app, '/Applications', '--sign', installerIdentity, out]);
run('pkgutil', ['--check-signature', out]);
console.log(`\nMac App Store package: ${path.relative(root, out)}. Upload it with Transporter.`);
