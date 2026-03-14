const { supabase, getSupabaseClient } = require('../config/supabase');
const { processMatchAchievements } = require('../services/achievements');
// Store connected users: socketId -> { userId, username, avatarUrl }
const connectedUsers = new Map();
// Matchmaking queue
const matchQueue = [];
// Friend rooms: code -> host player object
const friendRooms = new Map();
// Active games: roomId -> { players, board, currentTurn, turnStartTime }
const activeGames = new Map();
// Invite cooldowns: userId -> timestamp
const inviteCooldowns = new Map();

function setupSocket(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return next(new Error('Invalid token'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`User connected: ${userId}`);

    let profile = null;

    // Get user profile async — store promise so handlers can await it
    const profileReady = supabase
      .from('profiles')
      .select('username, equipped_avatar_url, level, rank')
      .eq('id', userId)
      .single()
      .then(async ({ data }) => {
        if (data) {
          profile = data;
          connectedUsers.set(socket.id, { userId, ...profile });
          socket.join(userId);
          await supabase.from('profiles').update({ online: true }).eq('id', userId);
        }
        io.emit('onlineCount', connectedUsers.size);
      })
      .catch(err => console.error('Profile fetch error:', err));

    // ===== WORLD CHAT =====
    socket.on('worldChat:send', async (message) => {
      if (!message || !message.trim()) return;
      const msg = message.trim().substring(0, 500);

      // Save to DB
      await supabase.from('world_chat').insert({ user_id: userId, message: msg });

      // Broadcast
      io.emit('worldChat:message', {
        id: Date.now(),
        user_id: userId,
        username: profile?.username || 'Unknown',
        equipped_avatar_url: profile?.equipped_avatar_url,
        level: profile?.level || 1,
        message: msg,
        created_at: new Date().toISOString()
      });
    });

    // ===== DIRECT MESSAGES =====
    socket.on('dm:send', async ({ receiverId, message }) => {
      if (!message || !message.trim() || !receiverId) return;
      const msg = message.trim().substring(0, 1000);

      const userClient = getSupabaseClient(socket.handshake.auth.token);
      const { data: dm, error } = await userClient.from('direct_messages')
        .insert({ sender_id: userId, receiver_id: receiverId, message: msg })
        .select()
        .single();
        
      if (error || !dm) return console.error('DM insert error:', error);

      // Send to sender
      socket.emit('dm:message', { ...dm, sender: profile });

      // Send to receiver via their personal room
      io.to(receiverId).emit('dm:message', { ...dm, sender: profile });

      // Create a notification for the receiver
      await userClient.from('notifications').insert({
        user_id: receiverId,
        type: 'message',
        title: '💬 New Message',
        message: (profile?.username || 'Someone') + ': ' + msg.substring(0, 80) + (msg.length > 80 ? '...' : ''),
        read: false
      });
      // Push real-time notification
      io.to(receiverId).emit('notification', {
        type: 'message',
        title: '💬 New Message',
        message: (profile?.username || 'Someone') + ' sent you a message'
      });
    });

    socket.on('dm:history', async ({ friendId }) => {
      const userClient = getSupabaseClient(socket.handshake.auth.token);
      const { data: messages } = await userClient
        .from('direct_messages')
        .select('*, sender:sender_id(username, equipped_avatar_url)')
        .or(`and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`)
        .order('created_at', { ascending: true })
        .limit(100);

      socket.emit('dm:historyData', messages || []);
    });

    // ===== MATCHMAKING =====
    socket.on('matchmaking:join', async ({ mode }) => {
      await profileReady; // ensure profile is loaded before using it
      const player = {
        socketId: socket.id,
        userId,
        username: profile?.username || 'Unknown',
        avatarUrl: profile?.equipped_avatar_url,
        level: profile?.level || 1,
        rank: profile?.rank || 'Bronze',
        mode: mode || 'ranked',
        token: socket.handshake.auth.token
      };

      // Check if already in queue
      const existing = matchQueue.findIndex(p => p.userId === userId);
      if (existing >= 0) matchQueue.splice(existing, 1);

      matchQueue.push(player);
      socket.emit('matchmaking:searching');

      // Try to match
      tryMatch(io, player);
    });

    socket.on('matchmaking:cancel', () => {
      const idx = matchQueue.findIndex(p => p.userId === userId);
      if (idx >= 0) matchQueue.splice(idx, 1);
      socket.emit('matchmaking:cancelled');
    });

    // ===== GAME JOIN (after page redirect) =====
    socket.on('game:join', ({ roomId }) => {
      const game = activeGames.get(roomId);
      if (!game) {
        console.log(`[Game Join] Failed: Game ${roomId} not found for user ${userId}`);
        return socket.emit('game:error', { message: 'Game not found' });
      }

      const playerIndex = game.players.findIndex(p => p.userId === userId);
      if (playerIndex === -1) {
        console.log(`[Game Join] Failed: User ${userId} is not in players array:`, game.players);
        return socket.emit('game:error', { message: 'Not a player in this game' });
      }

      // Update socketId (changed after page redirect)
      game.players[playerIndex].socketId = socket.id;

      // Join the socket room
      socket.join(roomId);
      console.log(`[Game Join] Success: Player ${userId} joined room ${roomId}`);

      // Send full game state to this player
      socket.emit('game:init', {
        roomId,
        players: game.players,
        board: game.board,
        currentTurn: game.currentTurn,
        gameOver: game.gameOver || false,
        winner: game.winner !== undefined ? game.winner : null
      });
    });

    // ===== FRIENDS ROOM =====
    socket.on('create_friend_room', async () => {
      await profileReady;
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const host = {
        socketId: socket.id,
        userId,
        username: profile?.username || 'Unknown',
        avatarUrl: profile?.equipped_avatar_url,
        level: profile?.level || 1,
        rank: profile?.rank || 'Bronze',
        mode: 'friend',
        token: socket.handshake.auth.token
      };
      
      // Clean up past rooms by same user
      for (const [key, val] of friendRooms.entries()) {
        if (val.userId === userId) friendRooms.delete(key);
      }
      
      friendRooms.set(code, host);
      socket.emit('room_created', { code });
    });

    socket.on('join_friend_room', async (code) => {
      await profileReady;
      const roomCode = code?.toUpperCase();
      const host = friendRooms.get(roomCode);
      if (!host) {
        return socket.emit('join_error', { message: 'Invalid or expired room code' });
      }
      
      const guest = {
        socketId: socket.id,
        userId,
        username: profile?.username || 'Unknown',
        avatarUrl: profile?.equipped_avatar_url,
        level: profile?.level || 1,
        rank: profile?.rank || 'Bronze',
        mode: 'friend',
        token: socket.handshake.auth.token
      };

      if (host.userId === guest.userId) {
        return socket.emit('join_error', { message: 'Cannot join your own room' });
      }

      friendRooms.delete(roomCode);
      
      const roomId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const game = {
        players: [host, guest],
        board: Array(9).fill(null),
        currentTurn: 0,
        gameOver: false,
        mode: 'friend',
        startTime: Date.now()
      };

      activeGames.set(roomId, game);

      const socket1 = io.sockets.sockets.get(host.socketId);
      const socket2 = io.sockets.sockets.get(guest.socketId);
      if (socket1) socket1.join(roomId);
      if (socket2) socket2.join(roomId);

      io.to(roomId).emit('matchmaking:found', {
        roomId,
        players: game.players,
        board: game.board,
        currentTurn: 0
      });
    });

    // ===== FRIEND INVITE =====
    socket.on('invite_friend', async (data) => {
      await profileReady;
      const { targetId, roomCode } = data || {};
      if (!targetId || !roomCode) return;

      // Check cooldown (10 seconds)
      const now = Date.now();
      const lastInvite = inviteCooldowns.get(userId) || 0;
      if (now - lastInvite < 10000) {
        return socket.emit('invite_error', { message: 'Please wait 10 seconds before inviting again' });
      }
      inviteCooldowns.set(userId, now);

      // Real-time popup
      io.to(targetId).emit('friend_invite', {
        from: profile?.username || 'Someone',
        fromId: userId,
        roomCode
      });

      // Persist notification in DB so it appears in notification box
      const { data: newNotif } = await supabase.from('notifications').insert({
        user_id: targetId,
        type: 'match_invite',
        title: '🎮 Game Invite',
        message: (profile?.username || 'Someone') + ' invited you to play! Code: ' + roomCode,
        read: false
      }).select('id').single();

      // Push notification event
      io.to(targetId).emit('notification', {
        type: 'match_invite',
        title: '🎮 Game Invite',
        message: (profile?.username || 'Someone') + ' invited you to play! Code: ' + roomCode
      });

      // Auto-expire invite notification after 10 seconds
      if (newNotif) {
        setTimeout(async () => {
          try { await supabase.from('notifications').delete().eq('id', newNotif.id); } 
          catch (e) { console.error('Failed to auto-expire invite:', e); }
        }, 10000);
      }
    });

    // ===== GAME =====
    socket.on('game:move', ({ roomId, index }) => {
      const game = activeGames.get(roomId);
      if (!game) return;

      const playerIndex = game.players.findIndex(p => p.userId === userId);
      if (playerIndex === -1) return;
      if (game.currentTurn !== playerIndex) return;
      if (game.board[index] !== null) return;
      if (game.gameOver) return;

      game.board[index] = playerIndex === 0 ? 'X' : 'O';
      game.currentTurn = game.currentTurn === 0 ? 1 : 0;

      // Check winner
      const winner = checkWinner(game.board);
      if (winner) {
        game.gameOver = true;
        game.winner = winner === 'X' ? 0 : 1;
        finishGame(io, roomId, game);
      } else if (game.board.every(c => c !== null)) {
        game.gameOver = true;
        game.winner = -1; // draw
        finishGame(io, roomId, game);
      }

      io.to(roomId).emit('game:state', {
        board: game.board,
        currentTurn: game.currentTurn,
        gameOver: game.gameOver,
        winner: game.winner !== undefined ? game.winner : null
      });
    });

    socket.on('game:chat', ({ roomId, message }) => {
      io.to(roomId).emit('game:chatMessage', {
        userId,
        username: profile?.username || 'Unknown',
        avatarUrl: profile?.equipped_avatar_url,
        message
      });
    });

    socket.on('game:rematch', ({ roomId }) => {
      const game = activeGames.get(roomId);
      if (!game) return;

      if (!game.rematchVotes) game.rematchVotes = new Set();
      game.rematchVotes.add(userId);

      if (game.rematchVotes.size >= 2) {
        // Reset game
        game.board = Array(9).fill(null);
        game.currentTurn = 0;
        game.gameOver = false;
        game.winner = undefined;
        game.rematchVotes = new Set();
        game.startTime = Date.now();

        io.to(roomId).emit('game:rematchStart', {
          board: game.board,
          currentTurn: 0,
          players: game.players
        });
      } else {
        io.to(roomId).emit('game:rematchRequested', { userId });
      }
    });

    // ===== DISCONNECT =====
    socket.on('disconnect', async () => {
      connectedUsers.delete(socket.id);
      await supabase.from('profiles').update({ online: false, last_seen: new Date().toISOString() }).eq('id', userId);

      // Remove from matchmaking queue
      const idx = matchQueue.findIndex(p => p.userId === userId);
      if (idx >= 0) matchQueue.splice(idx, 1);

      // Remove hosted friend rooms
      for (const [key, val] of friendRooms.entries()) {
        if (val.userId === userId) friendRooms.delete(key);
      }

      io.emit('onlineCount', connectedUsers.size);
    });
  });
}

function tryMatch(io, player) {
  // Find another player in same mode
  const match = matchQueue.find(p => p.userId !== player.userId && p.mode === player.mode);
  if (!match) return;

  // Remove both from queue
  matchQueue.splice(matchQueue.indexOf(player), 1);
  matchQueue.splice(matchQueue.indexOf(match), 1);

  // Create game room
  const roomId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const game = {
    players: [
      { userId: player.userId, username: player.username, avatarUrl: player.avatarUrl, level: player.level, rank: player.rank, token: player.token },
      { userId: match.userId, username: match.username, avatarUrl: match.avatarUrl, level: match.level, rank: match.rank, token: match.token }
    ],
    board: Array(9).fill(null),
    currentTurn: 0,
    gameOver: false,
    mode: player.mode,
    startTime: Date.now()
  };

  activeGames.set(roomId, game);

  // Join both sockets to room
  const socket1 = io.sockets.sockets.get(player.socketId);
  const socket2 = io.sockets.sockets.get(match.socketId);
  if (socket1) socket1.join(roomId);
  if (socket2) socket2.join(roomId);

  // Notify both players
  io.to(roomId).emit('matchmaking:found', {
    roomId,
    players: game.players,
    board: game.board,
    currentTurn: 0
  });
}

function checkWinner(board) {
  const patterns = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of patterns) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

async function finishGame(io, roomId, game) {
  const duration = Math.floor((Date.now() - game.startTime) / 1000);
  const p1 = game.players[0];
  const p2 = game.players[1];

  let result, xpP1, xpP2, coinsP1, coinsP2, rpP1, rpP2;
  if (game.winner === 0) {
    result = 'player1';
    xpP1 = 120; xpP2 = 30; coinsP1 = 80; coinsP2 = 10; rpP1 = 15; rpP2 = -10;
  } else if (game.winner === 1) {
    result = 'player2';
    xpP1 = 30; xpP2 = 120; coinsP1 = 10; coinsP2 = 80; rpP1 = -10; rpP2 = 15;
  } else {
    result = 'draw';
    xpP1 = 60; xpP2 = 60; coinsP1 = 40; coinsP2 = 40; rpP1 = 5; rpP2 = 5;
  }

  if (game.mode !== 'ranked') { rpP1 = 0; rpP2 = 0; xpP1 = 0; xpP2 = 0; coinsP1 = 0; coinsP2 = 0; }

  // Use authenticated client from winner or player1 to bypass RLS
  const authClient = getSupabaseClient(p1.token || p2.token);

  // Save match to history (all modes)
  const { error: matchInsertErr } = await authClient.from('matches').insert({
    player1_id: p1.userId, player2_id: p2.userId,
    winner_id: game.winner >= 0 ? game.players[game.winner].userId : null,
    mode: game.mode, result, duration_seconds: duration,
    board_state: game.board,
    xp_player1: xpP1, xp_player2: xpP2,
    coins_player1: coinsP1, coins_player2: coinsP2,
    rank_points_player1: rpP1, rank_points_player2: rpP2
  });
  if (matchInsertErr) console.error('[finishGame] Match insert error:', matchInsertErr);

  // Update player stats ONLY for ranked matches
  if (game.mode === 'ranked') {
    for (const [player, xp, coins, rp, isWinner] of [
      [p1, xpP1, coinsP1, rpP1, game.winner === 0],
      [p2, xpP2, coinsP2, rpP2, game.winner === 1]
    ]) {
      const pClient = getSupabaseClient(player.token);
      const { data: prof, error: profErr } = await pClient.from('profiles').select('*').eq('id', player.userId).single();
      if (profErr) { console.error('[finishGame] Profile fetch error for', player.userId, profErr); continue; }
      if (!prof) continue;
      const updates = {
        xp: prof.xp + xp,
        coins: prof.coins + coins,
        score: Math.max(0, prof.score + rp)
      };
      if (isWinner) updates.wins = prof.wins + 1;
      else if (game.winner === -1) updates.draws = prof.draws + 1;
      else updates.losses = prof.losses + 1;

      // Level up check
      if (updates.xp >= prof.xp_to_next) {
        updates.level = prof.level + 1;
        updates.xp = updates.xp - prof.xp_to_next;
        updates.xp_to_next = Math.floor(prof.xp_to_next * 1.2);
      }

      const { error: updateErr } = await pClient.from('profiles').update(updates).eq('id', player.userId);
      if (updateErr) console.error('[finishGame] Profile update error for', player.userId, updateErr);
      else console.log('[finishGame] Updated stats for', player.userId, updates);
    }
  }

  // Run achievements processor
  try {
    processMatchAchievements(game, p1, p2, io, roomId);
  } catch(e) {
    console.error('[finishGame] Error processing achievements:', e);
  }

  // Emit game result
  io.to(roomId).emit('game:result', {
    result, duration, players: game.players,
    rewards: {
      player1: { xp: xpP1, coins: coinsP1, rankPoints: rpP1 },
      player2: { xp: xpP2, coins: coinsP2, rankPoints: rpP2 }
    }
  });
}

module.exports = { setupSocket };
