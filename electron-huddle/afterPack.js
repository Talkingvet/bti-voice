// afterPack hook for electron-builder.
//
// Runs after electron-builder has packaged the .app bundle but before code
// signing. Performs three cleanup steps that, together, prevent the
// "resource fork, Finder information, or similar detritus not allowed"
// error that codesign throws on Apple Silicon when it can't replace
// pre-existing helper signatures cleanly.
//
//   1. Delete any .DS_Store / macOS metadata files inside the bundle.
//   2. Strip extended attributes from every file recursively.
//   3. Remove pre-existing code signatures from the main app and all
//      nested .app bundles (helpers), so the upcoming signing phase
//      lays down fresh signatures without getting tangled in residue.
//   4. Strip xattrs once more (signature removal can add some).

const { execSync } = require('child_process');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', ...opts });
  } catch (err) {
    return null;
  }
}

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  console.log(`[afterPack] Pre-sign cleanup of ${appPath}`);

  // 1. Delete macOS metadata files
  run(`find "${appPath}" -name '.DS_Store' -delete`);

  // 2. Strip extended attributes recursively
  run(`xattr -cr "${appPath}"`);

  // 3. Remove pre-existing signatures from main app and nested .app bundles
  const apps = (run(`find "${appPath}" -name '*.app' -type d`) || '')
    .trim()
    .split('\n')
    .filter(Boolean);

  for (const a of apps) {
    const result = run(`codesign --remove-signature "${a}"`);
    if (result !== null) {
      console.log(`[afterPack]   removed signature: ${a.split('/').pop()}`);
    }
  }

  // 4. Final xattr sweep in case signature removal added attrs
  run(`xattr -cr "${appPath}"`);

  console.log(`[afterPack] Cleanup complete`);
};
