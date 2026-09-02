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

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let initPromise: Promise<Auth> | null = null;

async function ensureAuth(): Promise<Auth> {
  if (auth) return auth;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const res = await apiFetch<{
          ok: boolean;
          data: { firebase: FirebaseWebConfig };
        }>("/api/auth/config");
        const config = res.data.firebase;
        app = getApps().length ? getApps()[0]! : initializeApp(config);
        auth = getAuth(app);
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

export type OAuthProviderId = "google" | "microsoft";

function providerFor(id: OAuthProviderId) {
  if (id === "google") {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    return p;
  }
  const p = new OAuthProvider("microsoft.com");
  p.setCustomParameters({ prompt: "select_account" });
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
