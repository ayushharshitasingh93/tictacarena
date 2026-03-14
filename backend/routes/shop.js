const express = require('express');
const router = express.Router();
const { supabase, getSupabaseClient } = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');
const cache = require('../utils/cache');

// Get all shop items (public, cached 60s)
router.get('/', async (req, res) => {
  try {
    const items = await cache.getOrSet('shop_items', 60, async () => {
      const { data, error } = await supabase
        .from('shop_items')
        .select('id, name, type, emoji, image_url, price, rarity, active')
        .eq('active', true)
        .order('price', { ascending: true });
      if (error) throw error;
      return data || [];
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's purchased items
router.get('/owned', authMiddleware, async (req, res) => {
  try {
    const userClient = getSupabaseClient(req.token);
    const { data, error } = await userClient
      .from('user_items')
      .select('*, shop_items(*)')
      .eq('user_id', req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Buy an item
router.post('/buy', authMiddleware, async (req, res) => {
  try {
    const { item_id } = req.body;
    const userClient = getSupabaseClient(req.token);

    // Get item
    const { data: item, error: itemErr } = await supabase
      .from('shop_items')
      .select('*')
      .eq('id', item_id)
      .single();

    if (itemErr || !item) return res.status(404).json({ error: 'Item not found' });

    // Check if already owned
    const { data: existing } = await userClient
      .from('user_items')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('item_id', item_id)
      .single();

    if (existing) return res.status(400).json({ error: 'Item already owned' });

    // Check coins
    const { data: profile } = await userClient
      .from('profiles')
      .select('coins')
      .eq('id', req.user.id)
      .single();

    if (!profile || profile.coins < item.price) {
      return res.status(400).json({ error: 'Not enough coins' });
    }

    // Deduct coins
    await userClient
      .from('profiles')
      .update({ coins: profile.coins - item.price })
      .eq('id', req.user.id);

    // Add to user's items
    const { data: userItem, error: buyErr } = await userClient
      .from('user_items')
      .insert({ user_id: req.user.id, item_id: item_id })
      .select('*, shop_items(*)')
      .single();

    if (buyErr) return res.status(400).json({ error: buyErr.message });

    res.json({ userItem, newBalance: profile.coins - item.price });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Equip an item
router.post('/equip', authMiddleware, async (req, res) => {
  try {
    const { item_id } = req.body;
    const userClient = getSupabaseClient(req.token);

    // Get the user_item with shop_item info
    const { data: userItem, error: uiErr } = await userClient
      .from('user_items')
      .select('*, shop_items(*)')
      .eq('user_id', req.user.id)
      .eq('item_id', item_id)
      .single();

    if (uiErr || !userItem) return res.status(404).json({ error: 'Item not owned' });

    const shopItem = userItem.shop_items;

    // Un-equip all items of same type for this user
    const { data: sameTypeItems } = await userClient
      .from('user_items')
      .select('id, shop_items(type)')
      .eq('user_id', req.user.id);

    const sameType = sameTypeItems.filter(i => i.shop_items?.type === shopItem.type);
    for (const si of sameType) {
      await userClient.from('user_items').update({ equipped: false }).eq('id', si.id);
    }

    // Equip the item
    await userClient.from('user_items').update({ equipped: true }).eq('id', userItem.id);

    // Update profile based on item type
    const profileUpdates = {};
    if (shopItem.type === 'avatar') {
      profileUpdates.equipped_avatar_url = shopItem.image_url;
    } else if (shopItem.type === 'frame') {
      profileUpdates.equipped_frame = shopItem.emoji || shopItem.name;
    } else if (shopItem.type === 'skin') {
      profileUpdates.equipped_skin = shopItem.emoji || shopItem.name;
    } else if (shopItem.type === 'effect') {
      profileUpdates.equipped_effect = shopItem.emoji || shopItem.name;
    }

    await userClient.from('profiles').update(profileUpdates).eq('id', req.user.id);

    res.json({ success: true, equipped: shopItem });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
