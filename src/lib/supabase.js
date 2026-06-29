import { createClient } from '@supabase/supabase-js';
import { assertDemoWriteAllowed } from '../utils/demoAccess.js';

function normalizeSupabaseUrl(url) {
  return (url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

console.info('[myQPMS Supabase] Config check', {
  configured: isSupabaseConfigured,
  urlPresent: Boolean(supabaseUrl),
  anonKeyPresent: Boolean(supabaseAnonKey),
  normalizedUrl: supabaseUrl || 'missing',
});

const supabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 8,
        },
      },
    })
  : null;

const mutatingSupabaseMethods = new Set(['insert', 'update', 'upsert', 'delete']);
const mutatingStorageMethods = new Set([
  'upload',
  'remove',
  'update',
  'move',
  'copy',
  'createSignedUploadUrl',
  'uploadToSignedUrl',
]);

function protectSupabaseBuilder(builder) {
  return new Proxy(builder, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (mutatingSupabaseMethods.has(String(property))) {
        return (...args) => {
          assertDemoWriteAllowed();
          return value.apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function protectSupabaseClient(client) {
  if (!client) return null;
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'from') {
        return (table) => protectSupabaseBuilder(target.from(table));
      }
      if (property === 'storage') {
        return protectStorageClient(target.storage);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function protectStorageBucket(bucket) {
  return new Proxy(bucket, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (mutatingStorageMethods.has(String(property))) {
        return (...args) => {
          assertDemoWriteAllowed();
          return value.apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function protectStorageClient(storage) {
  return new Proxy(storage, {
    get(target, property, receiver) {
      if (property === 'from') {
        return (bucket) => protectStorageBucket(target.from(bucket));
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

export const supabase = protectSupabaseClient(supabaseClient);
