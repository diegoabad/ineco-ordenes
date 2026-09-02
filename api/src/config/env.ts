import dotenv from "dotenv";

dotenv.config();

// En Windows con antivirus/proxy a veces falla el TLS hacia Firebase.
// Solo para desarrollo local: ALLOW_INSECURE_TLS=1 en api/.env
if (process.env.ALLOW_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

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
  isProd: process.env.NODE_ENV === "production",
  firebase: {
    apiKey: requireEnv("FIREBASE_API_KEY"),
    authDomain: requireEnv("FIREBASE_AUTH_DOMAIN"),
    projectId: requireEnv("FIREBASE_PROJECT_ID"),
    storageBucket: requireEnv("FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requireEnv("FIREBASE_MESSAGING_SENDER_ID"),
    appId: requireEnv("FIREBASE_APP_ID"),
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  },
  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY?.trim() || "",
    fromEmail: process.env.SENDGRID_FROM_EMAIL?.trim() || "informes@ineco.ar",
    fromName: process.env.SENDGRID_FROM_NAME?.trim() || "Órdenes Ineco",
  },
  auth: {
    jwtSecret: requireEnv("JWT_SECRET"),
    jwtDays: Math.max(1, Number(process.env.JWT_DAYS ?? 7)),
    cookieSecure:
      process.env.COOKIE_SECURE === "1" || process.env.NODE_ENV === "production",
    bootstrapAdminEmail: process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || "",
    /** Solo desarrollo: saltea login hasta configurar Google/Microsoft. */
    disabled: process.env.AUTH_DISABLED === "1",
  },
  medexis: {
    baseUrl: (process.env.MEDEXIS_BASE_URL || "").trim().replace(/\/?$/, "") || "",
    password: process.env.MEDEXIS_PASSWORD || "",
    token: process.env.MEDEXIS_TOKEN || "",
  },
};
