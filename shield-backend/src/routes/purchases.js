const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');

// POST /api/purchases  — save purchase
router.post('/', auth, async (req, res) => {
    try {
        const { product_id, purchase_token, amount, currency, expires_at } = req.body;

        if (!product_id)
            return res.status(400).json({ error: 'product_id required' });

        const now = Date.now();

        const [result] = await pool.query(
            `INSERT INTO purchases
             (user_id, product_id, purchase_token, amount, currency, purchased_at, expires_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
            [req.userId, product_id, purchase_token || null,
             amount || 0, currency || 'USD', now, expires_at || null]
        );

        // Mark user as premium if this is a premium product
        if (product_id.includes('premium') || product_id.includes('pro')) {
            await pool.query(
                'UPDATE users SET is_premium = 1, premium_expires_at = ? WHERE id = ?',
                [expires_at || null, req.userId]
            );
        }

        res.status(201).json({ success: true, id: result.insertId });
    } catch (e) {
        console.error('Purchase error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/purchases  — get user's purchases
router.get('/', auth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, product_id, amount, currency, purchased_at, expires_at, status
             FROM purchases WHERE user_id = ? ORDER BY purchased_at DESC`,
            [req.userId]
        );
        res.json({ success: true, purchases: rows });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/purchases/active  — check if user has active premium
router.get('/active', auth, async (req, res) => {
    try {
        const now = Date.now();
        const [rows] = await pool.query(
            `SELECT id, product_id, expires_at FROM purchases
             WHERE user_id = ? AND status = 'ACTIVE'
             AND (expires_at IS NULL OR expires_at > ?)`,
            [req.userId, now]
        );
        res.json({ success: true, has_premium: rows.length > 0, purchases: rows });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
