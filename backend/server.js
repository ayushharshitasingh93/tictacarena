require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { setupSocket } = require('./socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use('/frontend', express.static(path.join(__dirname, '..', 'frontend')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// Attach io to req
app.use((req, res, next) => {
  req.io = io;
  next();
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/shop', require('./routes/shop'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/mails', require('./routes/mails'));
app.use('/api/achievements', require('./routes/achievements'));
app.use('/api/banners', require('./routes/banners'));
app.use('/api/topup', require('./routes/topup'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/admin', require('./routes/admin'));

// World chat history endpoint
app.get('/api/world-chat/history', async (req, res) => {
  const { supabase } = require('./config/supabase');
  try {
    const { data } = await supabase
      .from('world_chat')
      .select('*, profiles:user_id(username, equipped_avatar_url, level)')
      .order('created_at', { ascending: false })
      .limit(50);

    res.json((data || []).reverse());
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Root redirect
app.get('/', (req, res) => res.redirect('/frontend/login.html'));

// Setup Socket.IO
setupSocket(io);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 TicTacArena server running on http://localhost:${PORT}`);
  console.log(`📁 Frontend: http://localhost:${PORT}/frontend/`);
  console.log(`🔧 Admin: http://localhost:${PORT}/admin/`);
  console.log(`📡 API: http://localhost:${PORT}/api/`);
});
