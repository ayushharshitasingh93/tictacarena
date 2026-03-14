const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

// Get app settings
router.get('/', async (req, res) => {
  try {
    const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single();
    res.json(data || { maintenance_mode: false });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user settings (profile preferences)
router.get('/user', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('username, email, equipped_avatar_url, equipped_frame, equipped_skin, equipped_effect')
      .eq('id', req.user.id)
      .single();

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
