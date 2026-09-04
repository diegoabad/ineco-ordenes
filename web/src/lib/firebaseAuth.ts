import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
  type UserCredential,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";
import { apiFetch } from "../config/api";
import { friendlyLoginError } from "./friendlyLoginError";

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

type AuthPublicConfig = {
  firebase: FirebaseWebConfig;
  authDisabled?: boolean;
  microsoftTenantId?: string | null;
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let firestore: Firestore | null = null;
let microsoftTenantId: string | null = null;
let initPromise: Promise<Auth> | null = null;

async function ensureAuth(): Promise<Auth> {
  if (auth) return auth;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const res = await apiFetch<{
          ok: boolean;
          data: AuthPublicConfig;
        }>("/api/auth/config");
        const config = res.data.firebase;
        microsoftTenantId = res.data.microsoftTenantId?.trim() || null;
        app = getApps().length ? getApps()[0]! : initializeApp(config);
        auth = getAuth(app);
        try {
          firestore = initializeFirestore(app, {
            experimentalForceLongPolling: true,
          });
        } catch {
          firestore = getFirestore(app);
        }
        return auth;
      } catch (err) {
        initPromise = null;
        const friendly = friendlyLoginError(err);
        throw Object.assign(new Error(friendly.message), { code: friendly.code });
      }
    })();
  }
  return initPromise;
}

/** App + Firestore listos (para listeners en tiempo real). */
export async function ensureFirebase(): Promise<{
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
}> {
  const authInstance = await ensureAuth();
  if (!app || !firestore) {
    throw new Error("Firebase no inicializado");
  }
  return { app, auth: authInstance, firestore };
}

export type OAuthProviderId = "google" | "microsoft";

function providerFor(id: OAuthProviderId) {
  if (id === "google") {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    return p;
  }
  const p = new OAuthProvider("microsoft.com");
  const params: Record<string, string> = { prompt: "select_account" };
  // App Azure single-tenant: hay que apuntar al tenant (si no, Firebase usa /common y falla AADSTS50194)
  if (microsoftTenantId) {
    params.tenant = microsoftTenantId;
  }
  p.setCustomParameters(params);
  p.addScope("email");
  p.addScope("openid");
  p.addScope("profile");
  return p;
}

export async function signInWithOAuthProvider(
  providerId: OAuthProviderId,
): Promise<string> {
  const authInstance = await ensureAuth();
  let credential: UserCredential;
  try {
    credential = await signInWithPopup(authInstance, providerFor(providerId));
  } catch (err) {
    const friendly = friendlyLoginError(err);
    throw Object.assign(new Error(friendly.message), {
      code: (err as { code?: string }).code || friendly.code,
    });
  }
  const idToken = await credential.user.getIdToken();
  return idToken;
}

export async function signOutFirebase(): Promise<void> {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch {
    // ignore
  }
}
