// ============================================================================
// Server Configuration — loads and validates all environment variables.
// ============================================================================

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the project root (one level up from server/)
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  // Server
  port: parseInt(optionalEnv('BACKEND_PORT', '3001'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  isDev: optionalEnv('NODE_ENV', 'development') === 'development',

  // Supabase
  supabaseUrl: requireEnv('VITE_SUPABASE_URL'),
  supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  // OpenAI / Azure OpenAI Keys
  openaiApiKey: optionalEnv('OPENAI_API_KEY', '') || optionalEnv('AZURE_OPENAI_API_KEY', ''),
  azureOpenaiEndpoint: optionalEnv('AZURE_OPENAI_ENDPOINT', ''),
  azureOpenaiApiVersion: optionalEnv('AZURE_OPENAI_API_VERSION', '2024-08-01-preview'),
  devtoApiKey: optionalEnv('DEVTO_API_KEY', ''),
  devtoApiBaseUrl: optionalEnv('DEVTO_API_BASE_URL', 'https://dev.to/api/articles'),

  // AI model configuration
  ai: {
    provider: optionalEnv('AI_PROVIDER', 'openai'),
    modelGeneration: optionalEnv('AI_MODEL_GENERATION', 'gpt-4o'),
    modelEdit: optionalEnv('AI_MODEL_EDIT', 'gpt-4o-mini'),
    modelChat: optionalEnv('AI_MODEL_CHAT', 'gpt-4o-mini'),
  },

  // Demo user (used when no auth token is present)
  demoUserId: optionalEnv('DEMO_USER_ID', '00000000-0000-0000-0000-000000000000'),
} as const;
