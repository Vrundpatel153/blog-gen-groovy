// ============================================================================
// Database Initialization Service
// Ensures demo user and settings exist in Supabase Postgres on startup.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

export async function ensureDemoUserExists(): Promise<void> {
  const demoId = config.demoUserId;
  console.log(`[dbInit] Checking if demo user (${demoId}) exists...`);

  try {
    // Check profiles
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', demoId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      // PGRST116 is the PostgREST code for "no rows returned"
      throw profileError;
    }

    if (!profile) {
      console.log(`[dbInit] Demo user profile not found. Creating...`);
      const { error: insertProfileError } = await supabase
        .from('profiles')
        .insert({
          id: demoId,
          full_name: 'Demo User',
          billing_tier: 'Free',
        });

      if (insertProfileError) throw insertProfileError;
      console.log(`[dbInit] Demo user profile created successfully.`);
    } else {
      console.log(`[dbInit] Demo user profile exists.`);
    }

    // Check user settings
    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('user_id')
      .eq('user_id', demoId)
      .single();

    if (settingsError && settingsError.code !== 'PGRST116') {
      throw settingsError;
    }

    if (!settings) {
      console.log(`[dbInit] Demo user settings not found. Creating...`);
      const { error: insertSettingsError } = await supabase
        .from('user_settings')
        .insert({
          user_id: demoId,
          theme: 'light',
          additional_prefs: {},
        });

      if (insertSettingsError) throw insertSettingsError;
      console.log(`[dbInit] Demo user settings created successfully.`);
    } else {
      console.log(`[dbInit] Demo user settings exist.`);
    }
  } catch (err: any) {
    console.error(`[dbInit] Warning: Failed to ensure demo user exists:`, err.message || err);
  }
}
