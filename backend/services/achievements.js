const { supabase } = require('../config/supabase');

async function processMatchAchievements(game, p1, p2, io, roomId) {
  try {
    const { data: defs } = await supabase.from('achievements_def').select('*');
    if (!defs || defs.length === 0) return;

    for (const [idx, player] of game.players.entries()) {
      const isWinner = game.winner === idx;
      const isDraw = game.winner === -1;
      
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', player.userId).single();
      const { data: userAchvs } = await supabase.from('user_achievements').select('*').eq('user_id', player.userId);
      const progMap = {};
      (userAchvs || []).forEach(a => progMap[a.achievement_id] = a);

      for (const def of defs) {
        if (progMap[def.id]?.unlocked) continue; // Already unlocked

        let newProg = progMap[def.id]?.progress || 0;
        let shouldUnlock = false;

        // Generic / Dynamic Rules based on Name/Description keywords
        const searchText = (def.name + ' ' + def.description).toLowerCase();
        
        let increment = 0;
        let isStreak = searchText.includes('streak') || searchText.includes('in a row') || searchText.includes('consecutive');

        if (searchText.includes('win') || searchText.includes('won') || searchText.includes('victory') || searchText.includes('triumph')) {
          if (isWinner) increment = 1;
        } else if (searchText.includes('draw') || searchText.includes('tie') || searchText.includes('stalemate')) {
          if (isDraw) increment = 1;
        } else if (searchText.includes('lose') || searchText.includes('lost') || searchText.includes('defeat')) {
          if (!isWinner && !isDraw) increment = 1;
        } else {
          // Default: Just participating in a match (e.g. "Play 10 matches", "Match Machine")
          increment = 1;
        }

        if (isStreak) {
          if (increment > 0) newProg += increment;
          else newProg = 0; // Reset streak if condition not met
        } else {
          newProg += increment; // Standard cumulative
        }

        if (newProg >= def.max_progress) {
          newProg = def.max_progress;
          shouldUnlock = true;
        }

        if (progMap[def.id]) {
          if (newProg !== progMap[def.id].progress) {
            await supabase.from('user_achievements').update({
              progress: newProg,
              unlocked: shouldUnlock,
              unlocked_at: shouldUnlock ? new Date().toISOString() : null
            }).eq('id', progMap[def.id].id);
          }
        } else if (newProg > 0) {
          await supabase.from('user_achievements').insert({
            user_id: player.userId,
            achievement_id: def.id,
            progress: newProg,
            unlocked: shouldUnlock,
            unlocked_at: shouldUnlock ? new Date().toISOString() : null
          });
        }

        if (shouldUnlock && io && player.socketId) {
          // Send notification socket event
          if (prof) {
            await supabase.from('profiles').update({
              xp: prof.xp + (def.xp_reward || 0)
            }).eq('id', player.userId);
          }

          io.to(player.socketId).emit('notification', {
            type: 'achievement',
            title: `🏆 Achievement Unlocked!`,
            message: `You unlocked: ${def.name} (+${def.xp_reward} XP)`
          });
        }
      }
    }
  } catch (err) {
    console.error('Error processing match achievements:', err);
  }
}

module.exports = { processMatchAchievements };
