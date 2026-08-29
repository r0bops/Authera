import crypto from "node:crypto";

export function b64u(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function unb64u(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized + "=".repeat((4 - (normalized.length % 4)) % 4), "base64");
}

export function sha256Base64Url(input) {
  return b64u(crypto.createHash("sha256").update(input).digest());
}

export function generateEcKeyPair() {
  return crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

export function signBytes(privateKeyPem, bytes) {
  const signer = crypto.createSign("SHA256");
  signer.update(bytes);
  signer.end();
  return signer.sign(privateKeyPem);
}

export function verifyBytes(publicKeyPem, bytes, signature) {
  const verifier = crypto.createVerify("SHA256");
  verifier.update(bytes);
  verifier.end();
  return verifier.verify(publicKeyPem, signature);
}

export function derToJose(derSignature, size = 32) {
  let offset = 2;
  if (derSignature[1] & 0x80) {
    offset = 2 + (derSignature[1] & 0x7f);
  }
  if (derSignature[offset] !== 0x02) throw new Error("Invalid ECDSA DER signature");
  const rLen = derSignature[offset + 1];
  const r = derSignature.subarray(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  if (derSignature[offset] !== 0x02) throw new Error("Invalid ECDSA DER signature");
  const sLen = derSignature[offset + 1];
  const s = derSignature.subarray(offset + 2, offset + 2 + sLen);
  const rFixed = leftPad32(r, size);
  const sFixed = leftPad32(s, size);
  return Buffer.concat([rFixed, sFixed]);
}

function leftPad32(value, size) {
  let v = Buffer.from(value);
  while (v.length > 0 && v[0] === 0) v = v.subarray(1);
  if (v.length > size) throw new Error("ECDSA integer too large");
  return Buffer.concat([Buffer.alloc(size - v.length), v]);
}

function joseToDer(joseSignature) {
  const size = joseSignature.length / 2;
  const r = trimInteger(joseSignature.subarray(0, size));
  const s = trimInteger(joseSignature.subarray(size));
  const body = Buffer.concat([
    Buffer.from([0x02, r.length]), r,
    Buffer.from([0x02, s.length]), s,
  ]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function trimInteger(value) {
  let i = 0;
  while (i < value.length - 1 && value[i] === 0) i += 1;
  let v = value.subarray(i);
  if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
  return v;
}

export function signJwtEs256(privateKeyPem, payload, header = {}) {
  const protectedHeader = { alg: "ES256", typ: "JWT", ...header };
  const encodedHeader = b64u(JSON.stringify(protectedHeader));
  const encodedPayload = b64u(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const der = signBytes(privateKeyPem, Buffer.from(signingInput));
  const jose = derToJose(der, 32);
  return `${signingInput}.${b64u(jose)}`;
}

export function verifyJwtEs256(publicKeyPem, token) {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, error: "JWT format invalid" };
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(unb64u(encodedHeader).toString("utf8"));
    payload = JSON.parse(unb64u(encodedPayload).toString("utf8"));
  } catch {
    return { valid: false, error: "JWT JSON invalid" };
  }
  if (header.alg !== "ES256") return { valid: false, error: "Unsupported JWT algorithm" };
  const signature = joseToDer(unb64u(encodedSignature));
  const valid = verifyBytes(publicKeyPem, Buffer.from(`${encodedHeader}.${encodedPayload}`), signature);
  return { valid, header, payload, error: valid ? null : "JWT signature invalid" };
}

export function createDigestHeader(body) {
  const digest = crypto.createHash("sha256").update(body).digest().toString("base64");
  return `sha-256=:${digest}:`;
}

// RFC 9421-inspired HTTP Message Signature profile for this demo.
// The covered component set is explicit and the signature is ECDSA P-256.
export function buildSignatureBase({ method, targetUri, contentDigest, contentType, created, expires, keyId }) {
  const components = [
    `"@method": ${method.toUpperCase()}`,
    `"@target-uri": ${targetUri}`,
    `"content-digest": ${contentDigest}`,
    `"content-type": ${contentType}`,
  ];
  const signatureParams = `("@method" "@target-uri" "content-digest" "content-type");created=${created};expires=${expires};keyid="${keyId}";alg="ecdsa-p256-sha256"`;
  components.push(`"@signature-params": ${signatureParams}`);
  return { base: components.join("\n"), signatureParams };
}

export function createHttpSignature({ privateKeyPem, keyId, method, targetUri, contentDigest, contentType = "application/json", ttlSeconds = 120 }) {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + ttlSeconds;
  const { base, signatureParams } = buildSignatureBase({ method, targetUri, contentDigest, contentType, created, expires, keyId });
  const der = signBytes(privateKeyPem, Buffer.from(base));
  const signature = b64u(derToJose(der, 32));
  return {
    "Signature-Input": `sig1=${signatureParams}`,
    Signature: `sig1=:${signature}:`,
  };
}

export function parseSignatureInput(header) {
  const match = header?.match(/^sig1=\(([^)]*)\);created=(\d+);expires=(\d+);keyid="([^"]+)";alg="([^"]+)"$/);
  if (!match) return null;
  const components = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return { components, created: Number(match[2]), expires: Number(match[3]), keyId: match[4], alg: match[5], raw: match[0] };
}

export function parseSignature(header) {
  const match = header?.match(/^sig1=:([^:]+):$/);
  return match ? unb64u(match[1]) : null;
}

export function verifyHttpSignature({ publicKeyPem, headers, method, targetUri, nowSeconds = Math.floor(Date.now() / 1000), maxClockSkewSeconds = 60 }) {
  const input = parseSignatureInput(headers["signature-input"] || headers["Signature-Input"]);
  const signature = parseSignature(headers.signature || headers.Signature);
  if (!input || !signature) return { valid: false, reason: "Missing or malformed HTTP signature" };
  if (input.alg !== "ecdsa-p256-sha256") return { valid: false, reason: "Unsupported HTTP signature algorithm" };
  if (nowSeconds < input.created - maxClockSkewSeconds || nowSeconds > input.expires + maxClockSkewSeconds) {
    return { valid: false, reason: "HTTP signature outside validity window" };
  }
  const contentDigest = headers["content-digest"] || headers["Content-Digest"] || "";
  const contentType = headers["content-type"] || headers["Content-Type"] || "application/json";
  const { base } = buildSignatureBase({
    method,
    targetUri,
    contentDigest,
    contentType,
    created: input.created,
    expires: input.expires,
    keyId: input.keyId,
  });
  const valid = verifyBytes(publicKeyPem, Buffer.from(base), joseToDer(signature));
  return { valid, reason: valid ? "HTTP signature valid" : "HTTP signature invalid", keyId: input.keyId, created: input.created, expires: input.expires };
}
