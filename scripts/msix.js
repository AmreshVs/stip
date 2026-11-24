// Packs the Tauri app into an MSIX for the Microsoft Store.
//
//   node scripts/msix.js            dist/Stip-<version>-x64.msix
//
// Run it on Windows after `tauri build`, which leaves the app in
// src-tauri/target/release/stip.exe. The Store identity comes from
// package.json under build.appx (the same values the Electron build used), and
// the tiles from build/appx/. Partner Center signs the package when it
// publishes it, so it isn't signed here.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const appx = pkg.build.appx;
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const exe = path.join(root, 'src-tauri', 'target', 'release', 'stip.exe');
if (!fs.existsSync(exe)) fail(`No ${exe}. Build the app first: npx @tauri-apps/cli build --bundles nsis`);

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The Store wants four numbers, and the last one must be 0.
const version = `${pkg.version.split('-')[0]}.0`;
const executable = 'app\\Stip.exe';
const description = pkg.description;

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap desktop rescap">
  <Identity Name="${xml(appx.identityName)}" ProcessorArchitecture="x64" Publisher="${xml(appx.publisher)}" Version="${version}" />
  <Properties>
    <DisplayName>${xml(appx.displayName)}</DisplayName>
    <PublisherDisplayName>${xml(appx.publisherDisplayName)}</PublisherDisplayName>
    <Description>${xml(description)}</Description>
    <Logo>assets\\StoreLogo.png</Logo>
  </Properties>
  <Resources>
${appx.languages.map((l) => `    <Resource Language="${xml(l)}" />`).join('\n')}
  </Resources>
  <Dependencies>
    <!-- Windows 10 1809: the oldest version WebView2 and Tauri support. -->
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
  <Applications>
    <Application Id="${xml(appx.applicationId)}" Executable="${executable}" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        BackgroundColor="${xml(appx.backgroundColor)}"
        DisplayName="${xml(appx.displayName)}"
        Square150x150Logo="assets\\Square150x150Logo.png"
        Square44x44Logo="assets\\Square44x44Logo.png"
        Description="${xml(description)}">
        <uap:DefaultTile Wide310x150Logo="assets\\Wide310x150Logo.png" Square310x310Logo="assets\\LargeTile.png" Square71x71Logo="assets\\SmallTile.png" />
      </uap:VisualElements>
      <Extensions>
        <!-- Lists Stip under Settings > Apps > Startup, which is how a Store
             app opens at login. Stip hides its own switch there. -->
        <desktop:Extension Category="windows.startupTask" Executable="${executable}" EntryPoint="Windows.FullTrustApplication">
          <desktop:StartupTask TaskId="StipStartup" Enabled="true" DisplayName="${xml(appx.displayName)}" />
        </desktop:Extension>
      </Extensions>
    </Application>
  </Applications>
</Package>
`;

const stage = path.join(root, 'dist', 'msix-stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'app'), { recursive: true });
fs.mkdirSync(path.join(stage, 'assets'), { recursive: true });
fs.copyFileSync(exe, path.join(stage, 'app', 'Stip.exe'));
for (const f of fs.readdirSync(path.join(root, 'build', 'appx'))) {
  if (f.endsWith('.png')) fs.copyFileSync(path.join(root, 'build', 'appx', f), path.join(stage, 'assets', f));
}
fs.writeFileSync(path.join(stage, 'AppxManifest.xml'), manifest);

if (process.argv.includes('--manifest-only')) {
  console.log(`Staged in ${stage}`);
  process.exit(0);
}

// makeappx.exe ships with the Windows SDK, under the newest version folder.
function makeappx() {
  const base = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const versions = fs.existsSync(base) ? fs.readdirSync(base).filter((v) => /^10\./.test(v)) : [];
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const tool = path.join(base, v, 'x64', 'makeappx.exe');
    if (fs.existsSync(tool)) return tool;
  }
  fail('makeappx.exe not found. Install the Windows SDK.');
}

const out = path.join(root, 'dist', `Stip-${pkg.version}-x64.msix`);
execFileSync(makeappx(), ['pack', '/o', '/d', stage, '/p', out], { stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true });
console.log(`Made ${out}`);
