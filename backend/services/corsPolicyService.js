const LOCAL_VITE_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function resolveAllowedOrigins(configuredOrigins = '') {
  const origins = String(configuredOrigins || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const includesLocalVite = LOCAL_VITE_ORIGINS.some((origin) => origins.includes(origin));
  return [...new Set(includesLocalVite ? [...origins, ...LOCAL_VITE_ORIGINS] : origins)];
}

export function createCorsOptions(allowedOrigins) {
  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  };
}

export { LOCAL_VITE_ORIGINS };
