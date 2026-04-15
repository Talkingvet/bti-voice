// ── Auto-update endpoint ──────────────────────────────────────────────────────
// Proxies GitHub release info so the Electron app can check for updates
// without needing a GitHub token embedded in the installer.
const express = require('express');
const router  = express.Router();

const OWNER = 'Talkingvet';
const REPO  = 'bti-voice';

// GET /api/updates/win32/x64/latest.yml  — electron-updater compatible
// GET /api/updates/latest                — simple version check
router.get('/latest', async (req, res) => {
  try {
    const token = process.env.GH_TOKEN;
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'bti-voice-updater',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const response = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
      { headers }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch release info' });
    }

    const release = await response.json();
    const version = release.tag_name?.replace(/^v/, '') || release.name;

    // Find the Windows installer asset
    const asset = release.assets?.find(a => a.name.endsWith('.exe') && !a.name.includes('uninstall'));

    res.json({
      version,
      releaseDate: release.published_at,
      releaseName: release.name,
      releaseNotes: release.body || '',
      // Proxy the download through this server so auth is handled server-side
      downloadUrl: asset ? `${process.env.SERVER_URL}/api/updates/download/${asset.id}` : null,
    });
  } catch (e) {
    console.error('[updates]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/updates/download/:assetId — proxies the actual file download
router.get('/download/:assetId', async (req, res) => {
  try {
    const token = process.env.GH_TOKEN;
    const response = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${req.params.assetId}`,
      {
        headers: {
          Accept: 'application/octet-stream',
          'User-Agent': 'bti-voice-updater',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        redirect: 'follow',
      }
    );

    if (!response.ok) return res.status(response.status).send('Download failed');

    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="BTI-Voice-Setup.exe"`);

    const { Readable } = require('stream');
    Readable.fromWeb(response.body).pipe(res);
  } catch (e) {
    console.error('[updates/download]', e.message);
    res.status(500).send(e.message);
  }
});

module.exports = router;
