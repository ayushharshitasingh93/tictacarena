const fs = require('fs');
const path = require('path');

const replacements = {
  'ðŸ’¬': '💬',
  'ðŸ‘‘': '👑',
  'ðŸ”¥': '🔥',
  'ðŸ¦‰': '🦉',
  'âš¡': '⚡',
  'ðŸ¦Š': '🦊',
  'ðŸŒŒ': '🌌',
  'ðŸ ¦': '🐦',
  'ðŸŒ‘': '🌑',
  'â­': '⭐',
  'ðŸ¥Š': '🥊',
  'ðŸ’': '💎',
  'ðŸ”´': '🔴',
  'ðŸ‘¥': '👥',
  'ðŸŽ®': '🎮',
  'ðŸŽ ': '🎁',
  'ðŸ †': '🏆',
  'ðŸ“¬': '📬',
  'ðŸ’°': '💰',
  'ðŸŽ¨': '🎨',
  'ðŸ–¼ï¸ ': '🖼️',
  'ðŸ¦¸â€ â™‚ï¸ ': '🦸',
  'ðŸ ‰': '🐉',
  '❄ï¸ ': '❄️',
  'ðŸ’ ': '💍',
  'ðŸ‘»': '👻',
  'ðŸŒˆ': '🌈',
  'ðŸŽ\xAD': '🎭',
  'â¬›': '⬛',
  'ðŸ‘¤': '👤',
  'ðŸ¥‡': '🥇',
  'ðŸ¥ˆ': '🥈',
  'ðŸ¥‰': '🥉',
  'ðŸ’\xA0': '💠',
  'âš™ï¸ ': '⚙️',
  'ðŸŽ': '🎭',
  'ðŸ’ ': '💠',
  'ðŸ”': '🔥',
  'ðŸ’¬': '💬',
  'âœŒï¸ ': '✌️',
  'ðŸ‘ ': '👍',
  'âš”ï¸ ': '⚔️',
  'ðŸ›¡ï¸ ': '🛡️',
  'ðŸš€': '🚀',
  'ðŸŽ¯': '🎯',
  'ðŸ” ': '🔒', // added lock
  'ðŸ“ ': '📋', // added history 
  'ðŸ‘€': '👀',
  'ðŸ’¡': '💡',
  'ðŸ”\x8D': '🔍',
  'ðŸš«': '🚫',
  'ðŸ’\x94': '💔',
  'ðŸ’\x80': '💀',
  'ðŸ˜Ž': '😎',
  'ðŸ¤\xAF': '🤯'
};

const dir = path.join(__dirname, '../frontend');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') || f.endsWith('.js'));

files.forEach(file => {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  
  for (const [bad, good] of Object.entries(replacements)) {
    content = content.split(bad).join(good);
  }
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed emojis in', file);
  }
});
