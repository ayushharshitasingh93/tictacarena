const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Public client (uses anon key, respects RLS)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Create an authenticated client for a specific user
function getSupabaseClient(accessToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

module.exports = { supabase, getSupabaseClient, supabaseUrl, supabaseAnonKey };
