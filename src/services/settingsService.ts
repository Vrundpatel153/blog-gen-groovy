import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

export interface UserProfile {
  id: string;
  fullName: string;
  avatarUrl: string;
  billingTier: 'Free' | 'Pro' | 'Enterprise';
}

export interface UserSettings {
  theme: 'light' | 'dark';
  additionalPrefs: any;
}

const LOCAL_PROFILE_KEY = 'ai_blog_studio_profile';
const LOCAL_SETTINGS_KEY = 'ai_blog_studio_settings';

export const settingsService = {
  /**
   * Get user profile details
   */
  async getProfile(userId: string): Promise<UserProfile | null> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (error) throw error;

        if (data) {
          return {
            id: data.id,
            fullName: data.full_name,
            avatarUrl: data.avatar_url,
            billingTier: data.billing_tier,
          };
        }
      } catch (err) {
        console.error('Supabase getProfile failed, falling back to localStorage:', err);
      }
    }

    // LocalStorage Fallback
    const local = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (local) return JSON.parse(local);

    // Default mock profile if none exists
    const defaultProfile: UserProfile = {
      id: userId,
      fullName: 'Alex Smith',
      avatarUrl: '',
      billingTier: 'Free',
    };
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(defaultProfile));
    return defaultProfile;
  },

  /**
   * Update profile information
   */
  async updateProfile(
    userId: string,
    profile: { fullName?: string; avatarUrl?: string }
  ): Promise<UserProfile> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .update({
            full_name: profile.fullName,
            avatar_url: profile.avatarUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)
          .select()
          .single();

        if (error) throw error;

        if (data) {
          const mapped = {
            id: data.id,
            fullName: data.full_name,
            avatarUrl: data.avatar_url,
            billingTier: data.billing_tier,
          };
          localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(mapped));
          return mapped;
        }
      } catch (err) {
        console.error('Supabase updateProfile failed, falling back to localStorage:', err);
      }
    }

    // LocalStorage Fallback
    const current = await this.getProfile(userId);
    const updated = {
      ...current!,
      fullName: profile.fullName !== undefined ? profile.fullName : current!.fullName,
      avatarUrl: profile.avatarUrl !== undefined ? profile.avatarUrl : current!.avatarUrl,
    };
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(updated));
    return updated;
  },

  /**
   * Get user theme and custom parameters settings
   */
  async getSettings(userId: string): Promise<UserSettings | null> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('user_settings')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (error) throw error;

        if (data) {
          return {
            theme: data.theme,
            additionalPrefs: data.additional_prefs,
          };
        }
      } catch (err) {
        console.error('Supabase getSettings failed, falling back to localStorage:', err);
      }
    }

    // LocalStorage Fallback
    const local = localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (local) return JSON.parse(local);

    const defaultSettings: UserSettings = {
      theme: 'light',
      additionalPrefs: {},
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(defaultSettings));
    return defaultSettings;
  },

  /**
   * Update theme and details settings
   */
  async updateSettings(
    userId: string,
    settings: { theme?: 'light' | 'dark'; additionalPrefs?: any }
  ): Promise<UserSettings> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('user_settings')
          .update({
            theme: settings.theme,
            additional_prefs: settings.additionalPrefs,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .select()
          .single();

        if (error) throw error;

        if (data) {
          const mapped = {
            theme: data.theme,
            additionalPrefs: data.additional_prefs,
          };
          localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(mapped));
          return mapped;
        }
      } catch (err) {
        console.error('Supabase updateSettings failed, falling back to localStorage:', err);
      }
    }

    // LocalStorage Fallback
    const current = await this.getSettings(userId);
    const updated = {
      theme: settings.theme !== undefined ? settings.theme : current!.theme,
      additionalPrefs:
        settings.additionalPrefs !== undefined
          ? settings.additionalPrefs
          : current!.additionalPrefs,
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(updated));
    return updated;
  },
};
