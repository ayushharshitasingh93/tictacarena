const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const cache = require('../utils/cache');

// Get leaderboard (cached 30s)
router.get('/', async (req, res) => {
  try {
    const tab = req.query.tab || 'global';
    const leaderboard = await cache.getOrSet(`leaderboard_${tab}`, 30, async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, level, rank, score, wins, losses, draws, equipped_avatar_url, online')
        .order('score', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((p, i) => ({ ...p, globalRank: i + 1 }));
    });
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
