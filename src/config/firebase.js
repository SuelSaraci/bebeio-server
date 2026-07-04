import fs from "fs";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const formatPrivateKey = (key) => {
  if (!key) {
    throw new Error("FIREBASE_PRIVATE_KEY is not set");
  }

  let formatted = String(key).trim();
  if (
    (formatted.startsWith('"') && formatted.endsWith('"')) ||
    (formatted.startsWith("'") && formatted.endsWith("'"))
  ) {
    formatted = formatted.slice(1, -1);
  }

  if (formatted.includes("\\n")) {
    formatted = formatted.replace(/\\n/g, "\n");
  }

  return formatted;
};

const resolveServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    return JSON.parse(fs.readFileSync(credPath, "utf8"));
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (projectId && privateKey && clientEmail) {
    return {
      type: "service_account",
      project_id: projectId,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: formatPrivateKey(privateKey),
      client_email: clientEmail,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri:
        process.env.FIREBASE_AUTH_URI ||
        "https://accounts.google.com/o/oauth2/auth",
      token_uri:
        process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url:
        process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL ||
        "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    };
  }

  const hint =
    process.env.NODE_ENV === "production"
      ? "On Railway, set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL (run: npm run extract:firebase ./bebeio-firebase-adminsdk-*.json)."
      : "Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON file, or set FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL.";

  throw new Error(`Firebase Admin credentials are missing. ${hint}`);
};

if (!admin.apps.length) {
  const serviceAccount = resolveServiceAccount();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log(
    `Firebase Admin initialized (project: ${serviceAccount.project_id})`,
  );
}

export default admin;
