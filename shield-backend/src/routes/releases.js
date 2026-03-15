const express = require('express');
const router = express.Router();
const { getReleaseManifest } = require('../services/releaseManifestService');

router.get('/manifest', async (req, res) => {
    try {
        const manifest = await getReleaseManifest();
        const artifacts = Array.isArray(manifest.artifacts)
            ? manifest.artifacts
            : Object.values(manifest.artifacts || {});
        return res.json({
            success: true,
            generated_at: manifest.generated_at,
            release_channel: manifest.release_channel || 'split-builds',
            artifacts,
            manifest: {
                ...manifest,
                artifacts
            }
        });
    } catch (error) {
        console.error('Release manifest error:', error);
        return res.status(500).json({ error: 'Release manifest is unavailable' });
    }
});

module.exports = router;
