const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

// Get leaderboard
router.get('/', async (req, res) => {
  try {
    const { tab } = req.query; // global, weekly, monthly
    let query = supabase
      .from('profiles')
      .select('id, username, level, rank, score, wins, losses, draws, equipped_avatar_url, online')
      .order('score', { ascending: false })
      .limit(50);

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    const leaderboard = data.map((p, i) => ({ ...p, globalRank: i + 1 }));
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
