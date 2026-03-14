const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

// Get achievements with user progress
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Get all achievement definitions
    const { data: defs } = await supabase.from('achievements_def').select('*').order('created_at');

    // Get user progress
    const { data: progress } = await supabase
      .from('user_achievements')
      .select('*')
      .eq('user_id', req.user.id);

    const progressMap = {};
    (progress || []).forEach(p => { progressMap[p.achievement_id] = p; });

    const achievements = (defs || []).map(d => ({
      ...d,
      progress: progressMap[d.id]?.progress || 0,
      unlocked: progressMap[d.id]?.unlocked || false,
      unlocked_at: progressMap[d.id]?.unlocked_at || null
    }));

    res.json(achievements);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
