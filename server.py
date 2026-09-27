"""
RESILIA — Master Development & API Server
Handles static website delivery and /api/appointment endpoint.
Configurable via environment variables or .env file.
"""

import os
import re
import json
import smtplib
from html import escape
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

# Load .env file if present
def load_env_file(filepath=".env"):
    if not os.path.isfile(filepath):
        return
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip("'\"")
            if key and key not in os.environ:
                os.environ[key] = val

load_env_file()

# Configuration
PORT = int(os.environ.get("PORT", 8080))
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")  # App Password for Gmail
TARGET_EMAIL = os.environ.get("TARGET_EMAIL", "resilia.the.resilience@gmail.com")

def validate_email(email_str):
    if not email_str or not isinstance(email_str, str):
        return False
    pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    return bool(re.match(pattern, email_str.strip()))

def validate_phone(phone_str):
    if not phone_str or not isinstance(phone_str, str):
        return False
    digits = re.sub(r"[^\d]", "", phone_str)
    return re.fullmatch(r"[6-9]\d{9}", digits) is not None

def send_smtp_message(msg):
    """Send one message through the configured SMTP account."""
    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)

def log_client_acknowledgment_status(email, status, detail=""):
    """Persist a minimal, privacy-conscious audit entry for client receipts."""
    now_ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    recipient = email.strip()
    if "@" in recipient:
        local, domain = recipient.rsplit("@", 1)
        masked = (local[:1] + "***" if local else "***") + "@" + domain
    else:
        masked = "invalid-recipient"
    safe_detail = re.sub(r"[\r\n\t]+", " ", detail)[:240]
    try:
        os.makedirs("logs", exist_ok=True)
        with open(os.path.join("logs", "mail_delivery.log"), "a", encoding="utf-8") as log:
            log.write(f"{now_ist.strftime('%Y-%m-%d %H:%M:%S IST')} | client_ack | {masked} | {status} | {safe_detail}\n")
    except Exception as exc:
        print(f"[WARN] Could not persist acknowledgment status: {exc}")

def send_appointment_email(data):
    """
    Constructs and sends the appointment request email.
    If SMTP credentials are not configured, logs the email payload safely.
    """
    now_ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    timestamp_str = now_ist.strftime("%Y-%m-%d %H:%M:%S IST")

    name = data.get("name", "").strip()
    phone = data.get("phone", "").strip()
    email = data.get("email", "").strip()
    service = data.get("service", "").strip()
    mode = data.get("mode", "").strip() or "Not specified"
    pref_date = data.get("date", "").strip() or "Flexible / To be coordinated"
    pref_time = data.get("time", "").strip() or "Flexible / To be coordinated"
    message = data.get("message", "").strip() or "None provided"

    # Plain text format strictly per specification
    body_text = f"""NEW RESILIA APPOINTMENT REQUEST

Name: {name}
Phone: {phone}
Email: {email}
Service: {service}
Mode: {mode}
Preferred Date: {pref_date}
Preferred Time: {pref_time}
Message: {message}

Submission Date/Time: {timestamp_str}
"""

    subject = f"NEW RESILIA APPOINTMENT REQUEST: {name} ({service})"

    # Log to file
    try:
        log_dir = "logs"
        os.makedirs(log_dir, exist_ok=True)
        log_file = os.path.join(log_dir, "appointment_requests.log")
        with open(log_file, "a", encoding="utf-8") as lf:
            lf.write(f"\n{'='*60}\n{body_text}\n{'='*60}\n")
    except Exception as e:
        print(f"[WARN] Failed to write log file: {e}")

    print("\n" + "="*60)
    print("[NEW RESILIA APPOINTMENT REQUEST RECEIVED]")
    print(body_text)
    print("="*60 + "\n")

    if SMTP_USER and SMTP_PASS:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = SMTP_USER
            msg["To"] = TARGET_EMAIL
            msg["Reply-To"] = email

            part_text = MIMEText(body_text, "plain", "utf-8")
            msg.attach(part_text)

            send_smtp_message(msg)
            
            print(f"[OK] Notification email successfully dispatched to {TARGET_EMAIL}")
            return True, "Email sent successfully"
        except Exception as e:
            print(f"[WARN] SMTP Send Failed: {e}")
            # Even if SMTP fails, the request has been received on server
            return True, f"Request logged on server (SMTP warning: {e})"
    else:
        print(f"[INFO] SMTP credentials not set. Request logged on server for {TARGET_EMAIL}.")
        return True, "Request received and logged on server"

def send_client_appointment_acknowledgment(data):
    """Acknowledge receipt of an appointment request without implying it is booked."""
    if not SMTP_USER or not SMTP_PASS:
        print("[INFO] Client acknowledgment not sent because SMTP is not configured.")
        log_client_acknowledgment_status(data.get("email", ""), "not_sent", "SMTP is not configured")
        return False

    name = data.get("name", "").strip()
    email = data.get("email", "").strip()
    service = data.get("service", "").strip()
    mode = data.get("mode", "").strip() or "Not specified"
    pref_date = data.get("date", "").strip() or "Flexible / To be coordinated"
    pref_time = data.get("time", "").strip() or "Flexible / To be coordinated"

    body_text = f"""Hello {name},

Thank you for contacting Resilia. We have received your appointment request.

Requested service: {service}
Preferred session mode: {mode}
Preferred date: {pref_date}
Preferred time: {pref_time}

This email confirms receipt of your request only. Your appointment is not yet booked. We will contact you to discuss availability and next steps.

If you did not send this request, you can ignore this email.

Warm regards,
Resilia
resilia.the.resilience@gmail.com
+91 9892589501
"""

    safe_name = escape(name or "there")
    safe_service = escape(service or "Appointment consultation")
    safe_mode = escape(mode)
    safe_date = escape(pref_date)
    safe_time = escape(pref_time)
    body_html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#183657;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">We have received your appointment request and will be in touch.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f8;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#174879;padding:26px 34px;color:#ffffff;">
          <div style="font-size:24px;font-weight:700;letter-spacing:5px;">RESILIA</div>
          <div style="font-size:12px;margin-top:5px;color:#d8e8f8;">Journey of nurturing resilience</div>
        </td></tr>
        <tr><td style="padding:34px;">
          <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#3977ad;font-weight:700;">Appointment request received</div>
          <h1 style="font-size:25px;line-height:1.3;margin:12px 0 14px;color:#183657;">Thank you, {safe_name}.</h1>
          <p style="font-size:15px;line-height:1.7;margin:0 0 22px;color:#4d6073;">Your request has reached our team. We’ll review your preferences and contact you to confirm availability and the next steps.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;border:1px solid #dce7f1;border-radius:12px;">
            <tr><td colspan="2" style="padding:17px 20px 7px;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#3977ad;">Your request details</td></tr>
            <tr><td style="padding:8px 20px;color:#6b7c8d;font-size:14px;">Service</td><td style="padding:8px 20px;text-align:right;color:#183657;font-size:14px;font-weight:700;">{safe_service}</td></tr>
            <tr><td style="padding:8px 20px;color:#6b7c8d;font-size:14px;">Session format</td><td style="padding:8px 20px;text-align:right;color:#183657;font-size:14px;">{safe_mode}</td></tr>
            <tr><td style="padding:8px 20px;color:#6b7c8d;font-size:14px;">Preferred date</td><td style="padding:8px 20px;text-align:right;color:#183657;font-size:14px;">{safe_date}</td></tr>
            <tr><td style="padding:8px 20px 18px;color:#6b7c8d;font-size:14px;">Preferred time</td><td style="padding:8px 20px 18px;text-align:right;color:#183657;font-size:14px;">{safe_time}</td></tr>
          </table>
          <div style="margin-top:20px;padding:14px 16px;border-left:3px solid #4384bd;background:#f7f9fc;color:#4d6073;font-size:13px;line-height:1.6;"><strong style="color:#183657;">Please note:</strong> This is an acknowledgment that we received your request. Your appointment is not confirmed until our team contacts you.</div>
          <p style="font-size:14px;line-height:1.7;margin:24px 0 0;color:#4d6073;">If you didn’t submit this request, you can ignore this email. For help, reply to this message or contact us at <a href="mailto:resilia.the.resilience@gmail.com" style="color:#1d5b91;font-weight:700;">resilia.the.resilience@gmail.com</a>.</p>
          <p style="font-size:14px;line-height:1.7;margin:22px 0 0;color:#183657;">Warm regards,<br><strong>Resilia</strong><br>+91 9892589501</p>
        </td></tr>
        <tr><td style="padding:16px 34px;background:#f3f7fb;color:#7b8b99;font-size:11px;line-height:1.5;">Resilia · Psychological support and wellbeing<br>This is an automated acknowledgment of your request.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "We received your appointment request | Resilia"
    msg["From"] = SMTP_USER
    msg["To"] = email
    msg["Reply-To"] = TARGET_EMAIL
    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        send_smtp_message(msg)
        print("[OK] Appointment acknowledgment accepted by the SMTP server.")
        log_client_acknowledgment_status(email, "smtp_accepted", "SMTP accepted the message; inbox delivery is not confirmed")
        return True
    except Exception as e:
        print(f"[WARN] Client acknowledgment email could not be sent: {e}")
        log_client_acknowledgment_status(email, "failed", str(e))
        return False


class ResiliaRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and disable aggressive caching for API
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        parsed_url = urlparse(self.path)

        if parsed_url.path == "/api/appointment":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)

            try:
                data = json.loads(post_data.decode("utf-8"))
            except Exception:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Invalid JSON format"}).encode("utf-8"))
                return

            # Validation per specifications
            name = (data.get("name") or "").strip()
            phone = (data.get("phone") or "").strip()
            email = (data.get("email") or "").strip()
            service = (data.get("service") or "").strip()

            errors = {}
            if not name:
                errors["name"] = "Full Name is required."
            if not phone:
                errors["phone"] = "Phone Number is required."
            elif not validate_phone(phone):
                errors["phone"] = "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9."

            if not email:
                errors["email"] = "Email Address is required."
            elif not validate_email(email):
                errors["email"] = "Please enter a valid email address."

            if not service:
                errors["service"] = "Please select a service."

            if errors:
                self.send_response(422)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": False, 
                    "error": "Validation failed", 
                    "errors": errors
                }).encode("utf-8"))
                return

            # Process appointment
            success, msg = send_appointment_email(data)
            acknowledgment_sent = send_client_appointment_acknowledgment(data)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "message": "Your request has been received.",
                "submessage": "Thank you for reaching out to Resilia. We will be in touch regarding the next step.",
                "acknowledgmentSent": acknowledgment_sent
            }).encode("utf-8"))
            return

        elif parsed_url.path == "/api/contact":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)

            try:
                data = json.loads(post_data.decode("utf-8"))
            except Exception:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Invalid JSON format"}).encode("utf-8"))
                return

            # Contact form validation
            name = (data.get("name") or "").strip()
            email = (data.get("email") or "").strip()
            subject = (data.get("subject") or "").strip()
            message = (data.get("message") or "").strip()

            errors = {}
            if not name:
                errors["name"] = "Your name is required."
            if not email:
                errors["email"] = "Email address is required."
            elif not validate_email(email):
                errors["email"] = "Please enter a valid email address."
            if not message:
                errors["message"] = "Message is required."

            if errors:
                self.send_response(422)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": False,
                    "error": "Validation failed",
                    "errors": errors
                }).encode("utf-8"))
                return

            data["service"] = f"General Enquiry: {subject}" if subject else "General Enquiry"
            send_appointment_email(data)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "message": "Your enquiry has been received.",
                "submessage": "Thank you for reaching out to Resilia. We will be in touch within 2 working days."
            }).encode("utf-8"))
            return

        else:
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "API route not found"}).encode("utf-8"))


def run():
    # Keep the development server private to this computer.
    server_address = ("127.0.0.1", PORT)
    httpd = HTTPServer(server_address, ResiliaRequestHandler)
    print(f"RESILIA Server running at http://localhost:{PORT}/")
    print(f"Target Email: {TARGET_EMAIL}")
    print(f"SMTP Configured: {'Yes' if SMTP_USER and SMTP_PASS else 'No (Logging mode active)'}")
    httpd.serve_forever()

if __name__ == "__main__":
    run()
