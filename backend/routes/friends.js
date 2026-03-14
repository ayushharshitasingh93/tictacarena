const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

// Get friends list
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('friends')
      .select('*, friend:friend_id(id, username, level, rank, score, wins, losses, equipped_avatar_url, online, last_seen), requester:user_id(id, username, level, rank, score, wins, losses, equipped_avatar_url, online, last_seen)')
      .or(`user_id.eq.${req.user.id},friend_id.eq.${req.user.id}`);

    if (error) return res.status(400).json({ error: error.message });

    // Format: return the other person's profile
    const friends = data.map(f => {
      const isRequester = f.user_id === req.user.id;
      return {
        id: f.id,
        status: f.status,
        profile: isRequester ? f.friend : f.requester,
        isSender: isRequester,
        created_at: f.created_at
      };
    });

    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Send friend request
router.post('/request', authMiddleware, async (req, res) => {
  try {
    let { friend_id, username } = req.body;
    
    if (username) {
      const { data: profile, error } = await supabase.from('profiles').select('id, username').ilike('username', username).single();
      if (error || !profile) return res.status(404).json({ error: 'Player not found' });
      friend_id = profile.id;
    }

    if (!friend_id) return res.status(400).json({ error: 'friend_id or username required' });
    if (friend_id === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });

    // Check if already friends/requested
    const { data: existing } = await supabase.from('friends')
      .select('*')
      .or(`and(user_id.eq.${req.user.id},friend_id.eq.${friend_id}),and(user_id.eq.${friend_id},friend_id.eq.${req.user.id})`)
      .maybeSingle();
      
    if (existing) return res.status(400).json({ error: 'You are already friends or have a pending request' });

    const { data, error } = await supabase
      .from('friends')
      .insert({ user_id: req.user.id, friend_id, status: 'pending' })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Fetch requester's username to build the notification
    const { data: myProfile } = await supabase.from('profiles').select('username').eq('id', req.user.id).single();
    const requesterName = myProfile?.username || 'Someone';

    // Send a Notification to the friend
    const notif = {
      user_id: friend_id,
      title: 'New Friend Request',
      message: `${requesterName} sent you a friend request!`,
      type: 'friend_request',
      action_url: '/frontend/friends-list.html'
    };
    const userClient = require('../config/supabase').getSupabaseClient(req.token);
    await userClient.from('notifications').insert(notif);

    if (req.io) {
      req.io.to(friend_id).emit('notification', notif);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Accept friend request
router.put('/accept/:id', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('friends')
      .update({ status: 'accepted' })
      .eq('id', req.params.id)
      .eq('friend_id', req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Block user
router.put('/block/:id', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('friends')
      .update({ status: 'blocked' })
      .eq('id', req.params.id)
      .or(`user_id.eq.${req.user.id},friend_id.eq.${req.user.id}`)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove friend
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase
      .from('friends')
      .delete()
      .eq('id', req.params.id)
      .or(`user_id.eq.${req.user.id},friend_id.eq.${req.user.id}`);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
