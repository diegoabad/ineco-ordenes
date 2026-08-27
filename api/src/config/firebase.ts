import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { env } from "./env.js";

const firebaseConfig = {
  apiKey: env.firebase.apiKey,
  authDomain: env.firebase.authDomain,
  projectId: env.firebase.projectId,
  storageBucket: env.firebase.storageBucket,
  messagingSenderId: env.firebase.messagingSenderId,
  appId: env.firebase.appId,
  measurementId: env.firebase.measurementId,
};

const app = initializeApp(firebaseConfig);

/** Long polling evita gRPC, que suele fallar detrás de proxies/antivirus en Windows. */
export const firestore = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

export default app;
