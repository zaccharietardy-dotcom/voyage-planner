/**
 * Generate Apple Client Secret JWT for Supabase Sign In with Apple
 * Usage: node scripts/generate-apple-secret.mjs
 *
 * Requires: path to .p8 key file
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// === CONFIGURE THESE ===
const TEAM_ID = process.argv[2] || '';       // Your Apple Team ID (10 chars)
const KEY_ID = 'QCKJK7CL47';                // Your Key ID
const CLIENT_ID = 'com.naraevoyage.web';     // Your Services ID
const P8_PATH = process.argv[3] || '';       // Path to .p8 file
// ========================

if (!TEAM_ID || !P8_PATH) {
  console.error('Usage: node scripts/generate-apple-secret.mjs <TEAM_ID> <path/to/AuthKey.p8>');
  console.error('Example: node scripts/generate-apple-secret.mjs ABC1234567 ~/Downloads/AuthKey_QCKJK7CL47.p8');
  process.exit(1);
}

const privateKey = fs.readFileSync(path.resolve(P8_PATH), 'utf8');

// JWT Header
const header = {
  alg: 'ES256',
  kid: KEY_ID,
  typ: 'JWT',
};

// JWT Payload (valid for 6 months)
const now = Math.floor(Date.now() / 1000);
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: now + 15777000, // ~6 months
  aud: 'https://appleid.apple.com',
  sub: CLIENT_ID,
};

function base64url(data) {
  return Buffer.from(data).toString('base64url');
}

const headerB64 = base64url(JSON.stringify(header));
const payloadB64 = base64url(JSON.stringify(payload));
const signingInput = `${headerB64}.${payloadB64}`;

const sign = crypto.createSign('SHA256');
sign.update(signingInput);
const signature = sign.sign(privateKey);

// Convert DER signature to raw r||s format for ES256
function derToRaw(derSig) {
  const seq = derSig;
  let offset = 2;
  if (seq[1] & 0x80) offset += (seq[1] & 0x7f);

  // Read r
  offset++; // 0x02 tag
  let rLen = seq[offset++];
  let rStart = offset;
  if (rLen === 33 && seq[rStart] === 0) { rStart++; rLen--; }
  const r = seq.subarray(rStart, rStart + Math.min(rLen, 32));
  offset = rStart + Math.min(rLen, 32);
  if (rLen > 32) offset = rStart - 1 + rLen + 1 - (seq[rStart-1] === 0 ? 1 : 0);
  offset = rStart + (rLen === 33 && seq[rStart-1] === 0 ? 32 : rLen);

  // Read s
  offset++; // 0x02 tag
  let sLen = seq[offset++];
  let sStart = offset;
  if (sLen === 33 && seq[sStart] === 0) { sStart++; sLen--; }
  const s = seq.subarray(sStart, sStart + Math.min(sLen, 32));

  const raw = Buffer.alloc(64);
  r.copy(raw, 32 - r.length);
  s.copy(raw, 64 - s.length);
  return raw;
}

const rawSig = derToRaw(signature);
const signatureB64 = rawSig.toString('base64url');

const jwt = `${signingInput}.${signatureB64}`;

console.log('\n=== Apple Client Secret (paste this in Supabase "Secret Key" field) ===\n');
console.log(jwt);
console.log('\n=== Expires in ~6 months. Re-run this script to regenerate. ===\n');
