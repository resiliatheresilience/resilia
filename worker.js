import { connect } from "cloudflare:sockets";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clean(value, maxLength = 1200) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maxLength)
    : "";
}

function validEmail(value) {
  return /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(value);
}

function validPhone(value) {
  return /^[6-9]\d{9}$/.test(value.replace(/\D/g, ""));
}

function maskEmail(value) {
  const [local, domain] = value.split("@");
  return local && domain ? `${local.slice(0, 1)}***@${domain}` : "invalid-recipient";
}

function htmlEscape(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function utf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

class SmtpSession {
  constructor(socket) {
    this.attach(socket);
    this.buffer = "";
  }

  attach(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  async line() {
    while (!this.buffer.includes("\r\n")) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error("SMTP connection closed unexpectedly");
      this.buffer += new TextDecoder().decode(value, { stream: true });
    }
    const end = this.buffer.indexOf("\r\n");
    const result = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end + 2);
    return result;
  }

  async response() {
    const lines = [];
    let line;
    do {
      line = await this.line();
      lines.push(line);
    } while (/^\d{3}-/.test(line));
    const code = Number(lines.at(-1).slice(0, 3));
    return { code, text: lines.join("\n") };
  }

  async expect(...accepted) {
    const result = await this.response();
    if (!accepted.includes(result.code)) {
      throw new Error(`SMTP returned ${result.code}`);
    }
    return result;
  }

  async command(command, ...accepted) {
    await this.writer.write(new TextEncoder().encode(`${command}\r\n`));
    return this.expect(...accepted);
  }

  async upgradeToTls() {
    this.reader.releaseLock();
    this.writer.releaseLock();
    this.attach(this.socket.startTls());
    await this.socket.opened;
  }

  async close() {
    try { this.reader.releaseLock(); } catch {}
    try { this.writer.releaseLock(); } catch {}
    try { this.socket.close(); } catch {}
  }
}

async function sendMail(env, { to, subject, text, html, replyTo }) {
  const from = clean(env.SMTP_USER, 254);
  const target = clean(to, 254);
  const smtpHost = clean(env.SMTP_HOST || "smtp.gmail.com", 253);
  const smtpPort = Number(env.SMTP_PORT || 587);
  if (!from || !env.SMTP_PASS || !validEmail(from) || !validEmail(target)) {
    throw new Error("Email sending is not configured correctly");
  }
  if (smtpHost !== "smtp.gmail.com" || smtpPort !== 587) {
    throw new Error("Only the configured Gmail STARTTLS endpoint is allowed");
  }

  const boundary = `resilia-${crypto.randomUUID()}`;
  const mime = [
    `From: Resilia <${from}>`,
    `To: ${target}`,
    ...(replyTo && validEmail(replyTo) ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@resilia>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(html),
    `--${boundary}--`,
    "",
  ].join("\r\n").replace(/(^|\r\n)\./g, "$1..");

  const socket = connect({ hostname: smtpHost, port: smtpPort }, { secureTransport: "starttls" });
  await socket.opened;
  const smtp = new SmtpSession(socket);
  let acceptedByServer = false;
  try {
    await smtp.expect(220);
    await smtp.command("EHLO resilia-site", 250);
    await smtp.command("STARTTLS", 220);
    await smtp.upgradeToTls();
    await smtp.command("EHLO resilia-site", 250);
    await smtp.command("AUTH LOGIN", 334);
    await smtp.command(btoa(from), 334);
    await smtp.command(btoa(env.SMTP_PASS), 235);
    await smtp.command(`MAIL FROM:<${from}>`, 250);
    await smtp.command(`RCPT TO:<${target}>`, 250, 251);
    await smtp.command("DATA", 354);
    await smtp.writer.write(new TextEncoder().encode(`${mime}.\r\n`));
    await smtp.expect(250);
    acceptedByServer = true;
    try { await smtp.command("QUIT", 221); } catch {}
    return { accepted: true };
  } finally {
    await smtp.close();
    if (!acceptedByServer) console.warn("SMTP did not accept the message", { recipient: maskEmail(target) });
  }
}

function appointmentReceipt(data) {
  const name = htmlEscape(data.name || "there");
  const rows = [
    ["Service", data.service], ["Session format", data.mode],
    ["Preferred date", data.date], ["Preferred time", data.time],
  ];
  const rowHtml = rows.map(([label, value]) => `<tr><td style="padding:8px 20px;color:#6b7c8d;font-size:14px">${label}</td><td style="padding:8px 20px;text-align:right;color:#183657;font-size:14px">${htmlEscape(value)}</td></tr>`).join("");
  const text = `Hello ${data.name},\n\nThank you for contacting Resilia. We have received your appointment request.\n\nRequested service: ${data.service}\nSession format: ${data.mode}\nPreferred date: ${data.date}\nPreferred time: ${data.time}\n\nThis confirms receipt of your request only. Your appointment is not confirmed until our team contacts you.\n\nWarm regards,\nResilia\nresilia.the.resilience@gmail.com\n+91 9892589501`;
  const html = `<!doctype html><html><body style="margin:0;padding:28px 12px;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#183657"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:#174879;padding:26px 34px;color:#fff"><div style="font-size:24px;font-weight:700;letter-spacing:5px">RESILIA</div><div style="font-size:12px;margin-top:5px;color:#d8e8f8">Journey of nurturing resilience</div></td></tr><tr><td style="padding:34px"><div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#3977ad;font-weight:700">Appointment request received</div><h1 style="font-size:25px;line-height:1.3;margin:12px 0;color:#183657">Thank you, ${name}.</h1><p style="font-size:15px;line-height:1.7;color:#4d6073">Your request has reached our team. We’ll review your preferences and contact you about availability and next steps.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;border:1px solid #dce7f1;border-radius:12px"><tr><td colspan="2" style="padding:17px 20px 7px;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#3977ad">Your request details</td></tr>${rowHtml}</table><div style="margin-top:20px;padding:14px 16px;border-left:3px solid #4384bd;background:#f7f9fc;color:#4d6073;font-size:13px;line-height:1.6"><strong style="color:#183657">Please note:</strong> This acknowledges receipt only. Your appointment is not confirmed until our team contacts you.</div><p style="font-size:14px;line-height:1.7;margin-top:24px;color:#4d6073">If you didn’t submit this request, ignore this email. For help, contact <a href="mailto:resilia.the.resilience@gmail.com" style="color:#1d5b91;font-weight:700">resilia.the.resilience@gmail.com</a>.</p><p style="font-size:14px;line-height:1.7;color:#183657">Warm regards,<br><strong>Resilia</strong><br>+91 9892589501</p></td></tr><tr><td style="padding:16px 34px;background:#f3f7fb;color:#7b8b99;font-size:11px">Resilia · Psychological support and wellbeing</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

function appointmentNotification(data) {
  const text = `NEW RESILIA APPOINTMENT REQUEST\n\nName: ${data.name}\nPhone: +91 ${data.phone}\nEmail: ${data.email}\nService: ${data.service}\nMode: ${data.mode}\nPreferred date: ${data.date}\nPreferred time: ${data.time}\nMessage: ${data.message || "None provided"}\n`;
  const html = `<div style="font-family:Arial,sans-serif;color:#183657;max-width:640px"><h2 style="color:#174879">New appointment request</h2><table cellpadding="8" cellspacing="0" style="border-collapse:collapse">${[["Name",data.name],["Phone",`+91 ${data.phone}`],["Email",data.email],["Service",data.service],["Mode",data.mode],["Preferred date",data.date],["Preferred time",data.time],["Message",data.message || "None provided"]].map(([k,v])=>`<tr><th align="left" style="color:#6b7c8d">${k}</th><td>${htmlEscape(v)}</td></tr>`).join("")}</table></div>`;
  return { text, html };
}

async function handleAppointment(request, env) {
  const data = await readJson(request);
  const fields = {
    name: clean(data.name, 120), phone: clean(data.phone, 32).replace(/\D/g, ""),
    email: clean(data.email, 254).toLowerCase(), service: clean(data.service, 160),
    mode: clean(data.mode, 80) || "Not specified",
    date: clean(data.date, 80) || "Flexible / To be coordinated",
    time: clean(data.time, 80) || "Flexible / To be coordinated",
    message: clean(data.message, 1200),
  };
  const errors = {};
  if (!fields.name) errors.name = "Full name is required.";
  if (!validPhone(fields.phone)) errors.phone = "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.";
  if (!validEmail(fields.email)) errors.email = "Enter a valid email address.";
  if (!fields.service) errors.service = "Please select a service.";
  if (Object.keys(errors).length) return json({ success: false, error: "Validation failed", errors }, 422);
  if (!validEmail(env.TARGET_EMAIL || "")) return json({ success: false, error: "The appointment mailbox is not configured." }, 503);

  try {
    const notification = appointmentNotification(fields);
    await sendMail(env, {
      to: env.TARGET_EMAIL, replyTo: fields.email,
      subject: "New Resilia appointment request",
      ...notification,
    });
  } catch (error) {
    console.error("Appointment notification delivery failed", { type: error?.name || "Error" });
    return json({ success: false, error: "We could not send your request to Resilia. Please call +91 9892589501 before submitting again." }, 502);
  }

  let acknowledgmentSent = false;
  try {
    const receipt = appointmentReceipt(fields);
    await sendMail(env, {
      to: fields.email, replyTo: env.TARGET_EMAIL,
      subject: "We received your appointment request | Resilia",
      ...receipt,
    });
    acknowledgmentSent = true;
    console.info("Appointment receipt accepted by SMTP", { recipient: maskEmail(fields.email) });
  } catch (error) {
    console.error("Client receipt delivery failed", { type: error?.name || "Error" });
  }

  return json({
    success: true,
    message: "Your request has been received by Resilia.",
    acknowledgmentSent,
  });
}

async function handleContact(request, env) {
  const data = await readJson(request);
  const name = clean(data.name, 120);
  const email = clean(data.email, 254).toLowerCase();
  const subject = clean(data.subject, 160);
  const message = clean(data.message, 3000);
  const errors = {};
  if (!name) errors.name = "Your name is required.";
  if (!validEmail(email)) errors.email = "Enter a valid email address.";
  if (!message) errors.message = "Message is required.";
  if (Object.keys(errors).length) return json({ success: false, error: "Validation failed", errors }, 422);
  if (!validEmail(env.TARGET_EMAIL || "")) return json({ success: false, error: "The contact mailbox is not configured." }, 503);
  const text = `NEW RESILIA CONTACT ENQUIRY\n\nName: ${name}\nEmail: ${email}\nSubject: ${subject || "General Enquiry"}\n\n${message}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#183657;max-width:640px"><h2 style="color:#174879">New contact enquiry</h2><p><strong>Name:</strong> ${htmlEscape(name)}</p><p><strong>Email:</strong> ${htmlEscape(email)}</p><p><strong>Subject:</strong> ${htmlEscape(subject || "General Enquiry")}</p><p>${htmlEscape(message).replace(/\n/g,"<br>")}</p></div>`;
  try {
    await sendMail(env, { to: env.TARGET_EMAIL, replyTo: email, subject: "New Resilia website enquiry", text, html });
    return json({ success: true, message: "Your enquiry has been received." });
  } catch (error) {
    console.error("Contact enquiry delivery failed", { type: error?.name || "Error" });
    return json({ success: false, error: "We could not send your enquiry. Please contact resilia.the.resilience@gmail.com." }, 502);
  }
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid JSON");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16000) throw new Error("Request is too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("Invalid JSON"); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/appointment" && url.pathname !== "/api/contact") {
      return json({ success: false, error: "Not found" }, 404);
    }
    if (request.method !== "POST") {
      return json({ success: false, error: "Method not allowed" }, 405);
    }
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== url.host) return json({ success: false, error: "Cross-origin request blocked" }, 403);
      } catch { return json({ success: false, error: "Invalid request origin" }, 403); }
    }
    try {
      return url.pathname === "/api/appointment"
        ? await handleAppointment(request, env)
        : await handleContact(request, env);
    } catch (error) {
      const isBadRequest = error?.message === "Invalid JSON" || error?.message === "Request is too large";
      return json({ success: false, error: isBadRequest ? error.message : "The request could not be processed." }, isBadRequest ? 400 : 500);
    }
  },
};
