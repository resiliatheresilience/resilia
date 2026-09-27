import test from "node:test";
import assert from "node:assert/strict";
import { handleAppointmentRequest } from "../netlify/functions/appointment.mjs";

const endpoint = "https://resilia-the-resilience.netlify.app/api/appointment";
const validPayload = {
  name: "Test Visitor",
  phone: "9876543210",
  email: "test@example.com",
  service: "Individual counselling",
  mode: "Online",
  date: "Flexible / To be coordinated",
  time: "Flexible / To be coordinated",
  message: "Automated API validation test",
};

async function invoke({ method = "POST", body, headers = {} } = {}) {
  const requestBody = method === "POST" ? (body === undefined ? JSON.stringify(validPayload) : body) : undefined;
  return handleAppointmentRequest(new Request(endpoint, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: requestBody,
  }), {});
}

test("malformed JSON returns a JSON 400", async () => {
  const response = await invoke({ body: "{" });
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal((await response.json()).success, false);
});

test("invalid phone returns a JSON 422", async () => {
  const response = await invoke({ body: JSON.stringify({ ...validPayload, phone: "123" }) });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).errors.phone, "Enter a valid 10-digit Indian mobile number.");
});

test("missing production credentials fails closed and never reports success", async () => {
  const response = await invoke();
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal((await response.json()).success, false);
});

test("OPTIONS receives JSON and allowed CORS headers", async () => {
  const response = await invoke({ method: "OPTIONS", body: undefined, headers: { origin: "https://resilia-the-resilience.netlify.app" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://resilia-the-resilience.netlify.app");
});

test("unexpected methods return JSON 405", async () => {
  const response = await invoke({ method: "GET", body: undefined });
  assert.equal(response.status, 405);
  assert.match(response.headers.get("content-type"), /application\/json/);
});
