const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

// Get topup packages
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('topup_packages')
      .select('*')
      .eq('active', true)
      .order('sort_order');

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
