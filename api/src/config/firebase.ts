import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
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
export const firestore = getFirestore(app);

export default app;
