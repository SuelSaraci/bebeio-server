import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const getServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return null;
  }

  const required = [
    process.env.FIREBASE_PROJECT_ID,
    process.env.FIREBASE_PRIVATE_KEY,
    process.env.FIREBASE_CLIENT_EMAIL,
  ];

  if (required.some((v) => !v)) {
    throw new Error(
      "Firebase config is missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_PRIVATE_KEY/FIREBASE_CLIENT_EMAIL",
    );
  }

  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n"),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  };
};

if (!admin.apps.length) {
  const serviceAccount = getServiceAccount();
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    admin.initializeApp();
  }
}

export default admin;
