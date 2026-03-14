require('dotenv').config();
const { supabase } = require('./config/supabase');

(async () => {
  try {
    console.log("Fetching friends...");
    const userId = 'd844ef47-d512-40aa-838d-da86104ea5f5'; 

    const result = await supabase
      .from('friends')
      .select('*, friend:friend_id(id, username), requester:user_id(id, username)')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

    console.log("Result:", JSON.stringify(result, null, 2));
    process.exit(0);
  } catch(e) {
    console.error("FATAL ERROR:", e);
    process.exit(1);
  }
})();
