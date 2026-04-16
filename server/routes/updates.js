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

// GET /api/updates/download — fetches the .exe asset from GitHub via the API,
// then streams it to the client. Using the API asset URL (not the web URL)
// avoids auth issues when GitHub redirects to S3.
router.get('/download', async (req, res) => {
  const token   = process.env.GH_TOKEN;
  const version = process.env.LATEST_VERSION;

  if (!token)   return res.status(500).send('GH_TOKEN not configured on server');
  if (!version) return res.status(500).send('LATEST_VERSION not configured on server');

  try {
    // 1. Look up the release by tag to get the asset list
    const tag         = `v${version}`;
    const releaseRes  = await fetch(
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
      console.error(`[updates/download] GitHub release lookup failed ${releaseRes.status}: ${text}`);
      return res.status(releaseRes.status).send(`GitHub release lookup failed: ${releaseRes.status}`);
    }

    const release = await releaseRes.json();
    const asset   = release.assets?.find(a => a.name.endsWith('.exe'));

    if (!asset) {
      console.error('[updates/download] No .exe asset found in release', tag);
      return res.status(404).send('No .exe asset found in release');
    }

    console.log(`[updates/download] Found asset: ${asset.name} (${asset.size} bytes) url=${asset.url}`);

    // 2. Fetch the asset via the GitHub API URL with Accept: application/octet-stream.
    //    GitHub returns a 302 to a signed S3 URL. We use redirect:'manual' to grab
    //    that S3 URL, then download from S3 without auth (the signature is in the query string).
    const assetRedirect = await fetch(asset.url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/octet-stream',
        'User-Agent':  'bti-voice-updater',
      },
      redirect: 'manual',
    });

    // Resolve the S3 signed URL from the redirect
    let downloadUrl = assetRedirect.headers.get('location');

    if (!downloadUrl) {
      // Some environments auto-follow; if we already got the binary, stream it directly
      if (assetRedirect.ok && assetRedirect.body) {
        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', `attachment; filename="${asset.name}"`);
        if (asset.size) res.set('Content-Length', String(asset.size));
        const { Readable } = require('stream');
        return Readable.fromWeb(assetRedirect.body).pipe(res);
      }
      console.error('[updates/download] No redirect location and no body');
      return res.status(502).send('Could not resolve asset download URL');
    }

    // 3. Download from S3 (no auth — credentials are in the signed URL query params)
    const s3Res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'bti-voice-updater' },
      redirect: 'follow',
    });

    if (!s3Res.ok) {
      console.error(`[updates/download] S3 download failed: ${s3Res.status}`);
      return res.status(s3Res.status).send('Asset download from storage failed');
    }

    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${asset.name}"`);

    // Forward Content-Length so the client can show download progress
    const contentLength = s3Res.headers.get('content-length') || String(asset.size || '');
    if (contentLength) res.set('Content-Length', contentLength);

    const { Readable } = require('stream');
    Readable.fromWeb(s3Res.body).pipe(res);

  } catch (e) {
    console.error('[updates/download]', e.message);
    res.status(500).send(e.message);
  }
});

module.exports = router;
