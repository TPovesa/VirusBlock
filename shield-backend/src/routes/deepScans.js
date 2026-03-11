const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
    createDeepScanJob,
    getDeepScanJob
} = require('../services/deepScanService');

router.post('/start', auth, async (req, res) => {
    try {
        const job = await createDeepScanJob(req.userId, req.body || {});
        if (job.error) {
            return res.status(400).json({ error: job.error });
        }

        return res.status(202).json({
            success: true,
            scan: job
        });
    } catch (error) {
        console.error('Deep scan start error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.get('/:id', auth, async (req, res) => {
    try {
        const scan = await getDeepScanJob(req.params.id, req.userId);
        if (!scan) {
            return res.status(404).json({ error: 'Deep scan not found' });
        }

        return res.json({
            success: true,
            scan
        });
    } catch (error) {
        console.error('Deep scan fetch error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
