const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');

// POST /api/scans  — save scan result
router.post('/', auth, async (req, res) => {
    try {
        const { scan_type, started_at, completed_at, total_scanned, threats_found, threats_json, status } = req.body;

        const [result] = await pool.query(
            `INSERT INTO scan_sessions
             (user_id, scan_type, started_at, completed_at, total_scanned, threats_found, threats_json, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.userId, scan_type, started_at, completed_at,
             total_scanned || 0, threats_found || 0,
             JSON.stringify(threats_json || []), status || 'COMPLETED']
        );

        res.status(201).json({ success: true, id: result.insertId });
    } catch (e) {
        console.error('Save scan error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/scans  — get all scans for current user
router.get('/', auth, async (req, res) => {
    try {
        const limit  = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const [rows] = await pool.query(
            `SELECT id, scan_type, started_at, completed_at, total_scanned, threats_found, status
             FROM scan_sessions WHERE user_id = ?
             ORDER BY started_at DESC LIMIT ? OFFSET ?`,
            [req.userId, limit, offset]
        );

        res.json({ success: true, scans: rows });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/scans/:id  — get single scan with threats
router.get('/:id', auth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM scan_sessions WHERE id = ? AND user_id = ?',
            [req.params.id, req.userId]
        );
        if (rows.length === 0)
            return res.status(404).json({ error: 'Scan not found' });

        const scan = rows[0];
        try { scan.threats_json = JSON.parse(scan.threats_json); } catch { scan.threats_json = []; }

        res.json({ success: true, scan });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/scans  — clear history
router.delete('/', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM scan_sessions WHERE user_id = ?', [req.userId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/scans/stats  — stats for home screen
router.get('/stats/summary', auth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT
               COUNT(*) as total_scans,
               SUM(threats_found) as total_threats,
               MAX(completed_at) as last_scan_at
             FROM scan_sessions WHERE user_id = ?`,
            [req.userId]
        );
        res.json({ success: true, stats: rows[0] });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
