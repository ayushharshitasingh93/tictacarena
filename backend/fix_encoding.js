const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../frontend');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

files.forEach(file => {
  const filePath = path.join(dir, file);
  // Read file as raw binary (latin1)
  const contentLatin1 = fs.readFileSync(filePath, 'latin1');
  
  // Convert latin1 string (where each char represents a raw byte) to UTF-8 encoded string.
  // We can do this by taking the raw bytes and parsing them as UTF-8.
  let fixedContent;
  try {
    const rawBytes = Buffer.from(contentLatin1, 'latin1');
    fixedContent = rawBytes.toString('utf8');
    
    // Check if it actually helped (did it have replacement chars? Was it actually valid UTF8?)
    if (fixedContent.includes('')) {
       // If it produced replacement characters, it means it wasn't a valid UTF-8 byte stream.
       console.log(file, 'Skipping, decoding resulted in replacement chars');
       return;
    }
    
    // Only write back if it's different and actually looks right
    if (contentLatin1 !== fixedContent && !fixedContent.includes('ð')) {
       fs.writeFileSync(filePath, fixedContent, 'utf8');
       console.log('Fixed:', file);
    } else {
       console.log('No fix needed or not confident:', file);
    }
  } catch (err) {
    console.error('Error on', file, err);
  }
});
