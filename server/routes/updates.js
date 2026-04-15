// ── Auto-update endpoint ──────────────────────────────────────────────────────
// Returns the latest version info from environment variables.
// Set LATEST_VERSION and LATEST_DOWNLOAD_URL in Railway whenever you publish
// a new release. No GitHub token required.
const express = require('express');
const router  = express.Router();

// GET /api/updates/latest — simple version check used by the Electron app
router.get('/latest', (req, res) => {
  const version     = process.env.LATEST_VERSION;
  const downloadUrl = process.env.LATEST_DOWNLOAD_URL;

  if (!version) {
    return res.status(500).json({ error: 'LATEST_VERSION not configured on server' });
  }

  res.json({
    version,
    downloadUrl: downloadUrl || null,
  });
});

// GET /api/updates/download — proxies the installer download
// Streams directly from LATEST_DOWNLOAD_URL (set this in Railway env vars).
// If LATEST_DOWNLOAD_URL points to a private GitHub release asset,
// also set GH_TOKEN so the Authorization header is forwarded.
router.get('/download', async (req, res) => {
  try {
    const downloadUrl = process.env.LATEST_DOWNLOAD_URL;
    if (!downloadUrl) {
      return res.status(500).send('LATEST_DOWNLOAD_URL not configured on server');
    }

    const token = process.env.GH_TOKEN;
    const response = await fetch(downloadUrl, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'bti-voice-updater',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'follow',
    });

    if (!response.ok) return res.status(response.status).send('Download failed');

    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment; filename="BTI-Voice-Setup.exe"');

    const { Readable } = require('stream');
    Readable.fromWeb(response.body).pipe(res);
  } catch (e) {
    console.error('[updates/download]', e.message);
    res.status(500).send(e.message);
  }
});

module.exports = router;
