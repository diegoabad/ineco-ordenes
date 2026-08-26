import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads/firmas",
  maxFirmaBytes: Number(process.env.MAX_FIRMA_BYTES ?? 5 * 1024 * 1024),
  firebase: {
    apiKey: requireEnv("FIREBASE_API_KEY"),
    authDomain: requireEnv("FIREBASE_AUTH_DOMAIN"),
    projectId: requireEnv("FIREBASE_PROJECT_ID"),
    storageBucket: requireEnv("FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requireEnv("FIREBASE_MESSAGING_SENDER_ID"),
    appId: requireEnv("FIREBASE_APP_ID"),
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  },
};
