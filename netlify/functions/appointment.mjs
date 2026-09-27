import { getStore } from "@netlify/blobs";

const DESTINATION = "resilia.the.resilience@gmail.com";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_RETENTION_DAYS = 30;
const ALLOWED_ORIGINS = new Set([
  "https://resilia-the-resilience.netlify.app",
  "http://localhost:8888",
  "http://127.0.0.1:8888",
]);

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "vary": "Origin",
};

function json(data, status = 200, origin = "") {
  const headers = new Headers(JSON_HEADERS);
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "Content-Type");
    headers.set("access-control-max-age", "600");
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function clean(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function validEmail(value) {
  return /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(value);
}

function validate(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: { request: "Request body must be a JSON object." } };
  }

  const fields = {
    name: clean(data.name, 120),
    phone: clean(data.phone, 24).replace(/\D/g, ""),
    email: clean(data.email, 254).toLowerCase(),
    service: clean(data.service, 160),
    mode: clean(data.mode, 80) || "Not specified",
    date: clean(data.date, 80) || "Flexible / To be coordinated",
    time: clean(data.time, 80) || "Flexible / To be coordinated",
    message: clean(data.message, 1200),
  };
  const errors = {};
  if (!fields.name) errors.name = "Full name is required.";
  if (!/^[6-9]\d{9}$/.test(fields.phone)) errors.phone = "Enter a valid 10-digit Indian mobile number.";
  if (!validEmail(fields.email)) errors.email = "Enter a valid email address.";
  if (!fields.service) errors.service = "Please select a service.";
  return { fields, errors };
}

function decodeBase64(value) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function encryptedRecord(fields, keyText) {
  const rawKey = decodeBase64(keyText);
  if (!rawKey || rawKey.byteLength !== 32) throw new Error("Invalid encryption key");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ receivedAt: new Date().toISOString(), ...fields }));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return JSON.stringify({ version: 1, iv: encodeBase64(iv), ciphertext: encodeBase64(new Uint8Array(ciphertext)) });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function emailContent(fields) {
  const lines = [
    "NEW RESILIA APPOINTMENT REQUEST", "",
    `Name: ${fields.name}`, `Phone: +91 ${fields.phone}`, `Email: ${fields.email}`,
    `Service: ${fields.service}`, `Mode: ${fields.mode}`, `Preferred date: ${fields.date}`,
    `Preferred time: ${fields.time}`, `Message: ${fields.message || "None provided"}`,
  ];
  const rows = [
    ["Name", fields.name], ["Phone", `+91 ${fields.phone}`], ["Email", fields.email],
    ["Service", fields.service], ["Mode", fields.mode], ["Preferred date", fields.date],
    ["Preferred time", fields.time], ["Message", fields.message || "None provided"],
  ].map(([label, value]) => `<tr><th align="left">${label}</th><td>${escapeHtml(value)}</td></tr>`).join("");
  return {
    text: lines.join("\n"),
    html: `<div style="font-family:Arial,sans-serif;color:#183657"><h2>New RESILIA appointment request</h2><table cellpadding="8" cellspacing="0">${rows}</table></div>`,
  };
}

async function notifyResilia(fields, env, idempotencyKey) {
  const sender = clean(env.RESEND_FROM_EMAIL, 254);
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !sender || !sender.includes("@")) throw new Error("Email provider is not configured");

  const content = emailContent(fields);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      from: sender,
      to: [DESTINATION],
      reply_to: fields.email,
      subject: "New Resilia appointment request",
      text: content.text,
      html: content.html,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.error("Appointment email provider rejected request", { status: response.status });
    throw new Error("Email provider rejected request");
  }

  let providerResult;
  try { providerResult = await response.json(); } catch { throw new Error("Email provider returned an invalid response"); }
  if (!providerResult?.id) throw new Error("Email provider did not confirm acceptance");
}

async function sendClientAcknowledgment(fields, env, idempotencyKey) {
  const sender = clean(env.RESEND_FROM_EMAIL, 254);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": `${idempotencyKey}-client-receipt`,
    },
    body: JSON.stringify({
      from: sender,
      to: [fields.email],
      reply_to: DESTINATION,
      subject: "We received your appointment request | Resilia",
      text: `Hello ${fields.name},\n\nWe have received your appointment request for ${fields.service}. Our team will contact you about availability and next steps. Your appointment is not confirmed until our team contacts you.\n\nWarm regards,\nResilia\n${DESTINATION}\n+91 9892589501`,
      html: `<div style="font-family:Arial,sans-serif;color:#183657;max-width:600px"><h1>Appointment request received</h1><p>Hello ${escapeHtml(fields.name)},</p><p>We have received your appointment request for <strong>${escapeHtml(fields.service)}</strong>. Our team will contact you about availability and next steps.</p><p>This confirms receipt only. Your appointment is not confirmed until our team contacts you.</p><p>Warm regards,<br><strong>Resilia</strong><br><a href="mailto:${DESTINATION}">${DESTINATION}</a><br>+91 9892589501</p></div>`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Email provider rejected client receipt");
  let providerResult;
  try { providerResult = await response.json(); } catch { throw new Error("Email provider returned an invalid response"); }
  if (!providerResult?.id) throw new Error("Email provider did not confirm client receipt");
}

export async function handleAppointmentRequest(request, env = process.env) {
  const origin = request.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ success: false, error: "Origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") return json({ success: true }, 200, origin);
  if (request.method !== "POST") {
    const response = json({ success: false, error: "Method not allowed." }, 405, origin);
    response.headers.set("allow", "POST, OPTIONS");
    return response;
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ success: false, error: "Content-Type must be application/json." }, 415, origin);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ success: false, error: "Request is too large." }, 413, origin);

  let raw;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ success: false, error: "Request body is required." }, 400, origin);
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel();
          return json({ success: false, error: "Request is too large." }, 413, origin);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return json({ success: false, error: "Request body could not be read." }, 400, origin);
  }

  let data;
  try { data = JSON.parse(raw); } catch {
    return json({ success: false, error: "Invalid JSON request body." }, 400, origin);
  }
  const { fields, errors } = validate(data);
  if (Object.keys(errors).length) return json({ success: false, error: "Validation failed.", errors }, 422, origin);

  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !env.APPOINTMENT_ENCRYPTION_KEY) {
    return json({ success: false, error: "Appointment service is not configured. Please contact Resilia directly." }, 503, origin);
  }

  const id = crypto.randomUUID();
  const receivedAt = Date.now();
  const key = `appointment-requests/${new Date(receivedAt).toISOString().slice(0, 10)}/${id}.json`;

  let encrypted;
  try {
    encrypted = await encryptedRecord(fields, env.APPOINTMENT_ENCRYPTION_KEY);
  } catch (error) {
    console.error("Appointment encryption failed", { type: error?.name || "Error" });
    return json({ success: false, error: "Appointment service is not configured correctly." }, 503, origin);
  }

  try {
    const store = getStore("resilia-appointment-requests");
    await store.set(key, encrypted, {
      metadata: { expiresAt: receivedAt + MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000 },
      onlyIfNew: true,
    });
  } catch (error) {
    console.error("Appointment storage failed", { type: error?.name || "Error" });
    return json({ success: false, error: "We could not securely store your request. Please call +91 9892589501." }, 503, origin);
  }

  try {
    await notifyResilia(fields, env, id);
  } catch (error) {
    console.error("Appointment notification failed", { type: error?.name || "Error" });
    return json({ success: false, error: "We could not send your request to Resilia. Please call +91 9892589501 before submitting again." }, 502, origin);
  }

  let acknowledgmentSent = false;
  try {
    await sendClientAcknowledgment(fields, env, id);
    acknowledgmentSent = true;
  } catch (error) {
    console.error("Client appointment receipt delivery failed", { type: error?.name || "Error" });
  }
  return json({ success: true, message: "Your appointment request has been received by Resilia.", acknowledgmentSent }, 200, origin);
}

export default async (request) => handleAppointmentRequest(request);

export const config = { path: "/api/appointment" };
