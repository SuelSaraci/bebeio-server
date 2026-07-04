#!/usr/bin/env node

import fs from "fs";

const filePath = process.argv[2];
if (!filePath) {
  console.error(
    "Usage: npm run extract:firebase -- ./bebeio-firebase-adminsdk-*.json",
  );
  process.exit(1);
}

const credentials = JSON.parse(fs.readFileSync(filePath, "utf8"));
const privateKeyFormatted = credentials.private_key.replace(/\n/g, "\\n");

console.log("\nAdd these to Railway (bebeio-server) and remove GOOGLE_APPLICATION_CREDENTIALS:\n");
console.log(`FIREBASE_PROJECT_ID=${credentials.project_id}`);
console.log(`FIREBASE_PRIVATE_KEY_ID=${credentials.private_key_id}`);
console.log(`FIREBASE_PRIVATE_KEY="${privateKeyFormatted}"`);
console.log(`FIREBASE_CLIENT_EMAIL=${credentials.client_email}`);
console.log(`FIREBASE_CLIENT_ID=${credentials.client_id}`);
console.log(`FIREBASE_CLIENT_X509_CERT_URL=${credentials.client_x509_cert_url}`);
console.log("");
