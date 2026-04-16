// ── Auto-update endpoint ──────────────────────────────────────────────────────
// Version check uses LATEST_VERSION env var (set in Railway on each release).
// Download uses the GitHub API to find the release asset — no LATEST_DOWNLOAD_URL needed.
// Required Railway vars: LATEST_VERSION, GH_TOKEN
const express = require('express');
const router  = express.Router();

const GH_OWNER = 'Talkingvet';
const GH_REPO  = 'bti-voice';

// GET /api/updates/latest — version check used by the Electron app
router.get('/latest', (req, res) => {
  const version = process.env.LATEST_VERSION;
  if (!version) {
    return res.status(500).json({ error: 'LATEST_VERSION not configured on server' });
  }
  res.json({ version });
});

// GET /api/updates/download-url — resolves the signed S3 download URL for the
// latest .exe release asset. Returns JSON { url, size, name } so the Electron
// client can download directly from S3 (avoiding Railway proxy timeouts on ~80MB files).
// The GitHub token stays server-side; the S3 URL is a time-limited signed URL (valid ~1hr).
router.get('/download-url', async (req, res) => {
  const token   = process.env.GH_TOKEN;
  const version = process.env.LATEST_VERSION;

  if (!token)   return res.status(500).json({ error: 'GH_TOKEN not configured on server' });
  if (!version) return res.status(500).json({ error: 'LATEST_VERSION not configured on server' });

  try {
    // 1. Find the release by tag
    const tag        = `v${version}`;
    const releaseRes = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/tags/${tag}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:        'application/vnd.github.v3+json',
          'User-Agent':  'bti-voice-updater',
        },
      }
    );

    if (!releaseRes.ok) {
      const text = await releaseRes.text();
      console.error(`[updates/download-url] GitHub API ${releaseRes.status}: ${text}`);
      return res.status(releaseRes.status).json({ error: `GitHub API error: ${releaseRes.status}` });
    }

    const release = await releaseRes.json();
    const asset   = release.assets?.find(a => a.name.endsWith('.exe'));

    if (!asset) {
      console.error('[updates/download-url] No .exe asset in release', tag);
      return res.status(404).json({ error: 'No .exe asset found in release' });
    }

    // 2. Resolve the signed S3 URL — request with redirect:manual so we get
    //    the Location header without following it (S3 URL has auth in query string)
    const redirectRes = await fetch(asset.url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/octet-stream',
        'User-Agent':  'bti-voice-updater',
      },
      redirect: 'manual',
    });

    const s3Url = redirectRes.headers.get('location');
    if (!s3Url) {
      console.error('[updates/download-url] No redirect location from GitHub asset URL');
      return res.status(502).json({ error: 'Could not resolve S3 download URL' });
    }

    console.log(`[updates/download-url] Resolved asset: ${asset.name} (${asset.size} bytes)`);
    res.json({ url: s3Url, size: asset.size, name: asset.name });

  } catch (e) {
    console.error('[updates/download-url]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
