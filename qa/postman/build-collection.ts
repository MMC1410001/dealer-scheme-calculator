/**
 * Builds the Postman collection and the environments in this folder:
 *
 *   Scheme_Calculator_Dealer_Status.postman_collection.json   the dealer scheme status API (+ reward choice, iframe token, token endpoint, health)
 *   Local / Dev .postman_environment.json                     environments
 *
 * Edit requests and tests here, not in the JSON. Then make the JSON files again and commit them:
 *   npm run qa:postman
 * qa/postman/collection.test.ts fails when the JSON is stale, when an endpoint of docs/openapi.json has no request,
 * or when a request has no tests.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = path.dirname(fileURLToPath(import.meta.url));
export const COLLECTION_FILE = "Scheme_Calculator_Dealer_Status.postman_collection.json";
const DSS = "{{baseUrl}}/api/v1/dealer-scheme-status";
const DRC = "{{baseUrl}}/api/v1/dealer-reward-choice";
const EMB = "{{baseUrl}}/api/v1/embed-token";
const TOKEN_URL = "{{baseUrl}}/api/v1/auth/token";
const HEALTH = "{{baseUrl}}/api/v1/health";

type Json = Record<string, unknown>;
type Header = { key: string; value: string };

/** UUID v5 (RFC 4122, SHA-1), so that the ids stay the same across rebuilds. Node has no built-in v5. */
export function uuidV5(name: string, namespace = "6ba7b811-9dad-11d1-80b4-00c04fd430c8" /* URL namespace */): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const testScript = (lines: string[]) => ({ listen: "test", script: { type: "text/javascript", exec: lines } });
const preScript = (lines: string[]) => ({ listen: "prerequest", script: { type: "text/javascript", exec: lines } });
const JSON_HEADER: Header[] = [{ key: "Content-Type", value: "application/json" }];

/** A saved example response (Postman "Examples"). The body comes from docs/openapi.json, so it stays real. */
interface Example {
  name: string;
  code: number;
  /** HTTP reason phrase, for example "OK". */
  reason: string;
  body: unknown;
  /** Request body of the example, when it is not the body of the request itself. */
  requestBody?: string;
  headers?: Header[];
}

interface ReqOptions {
  examples?: Example[];
  body?: string;
  form?: Array<[string, string]>;
  headers?: Header[];
  auth?: Json;
  description?: string;
  prerequest?: string[];
}

function req(name: string, method: string, url: string, tests: string[], o: ReqOptions = {}): Json {
  const headers = o.headers ?? (method === "POST" ? (o.form ? [{ key: "Content-Type", value: "application/x-www-form-urlencoded" }] : JSON_HEADER) : []);
  const [host, ...rest] = url.split("/");
  const request: Json = { method, header: headers, url: { raw: url, host: [host], path: rest }, description: o.description ?? "" };
  if (o.auth) request.auth = o.auth;
  if (o.form) request.body = { mode: "urlencoded", urlencoded: o.form.map(([key, value]) => ({ key, value, type: "text" })) };
  else if (o.body !== undefined) request.body = { mode: "raw", raw: o.body, options: { raw: { language: "json" } } };
  const item: Json = { name, request, event: [...(o.prerequest ? [preScript(o.prerequest)] : []), testScript(tests)] };
  if (o.examples) {
    item.response = o.examples.map((e) => ({
      id: uuidV5(`scheme-calculator/postman/example/${name}/${e.name}`),
      name: e.name,
      originalRequest: e.requestBody === undefined ? request : { ...request, body: { mode: "raw", raw: e.requestBody, options: { raw: { language: "json" } } } },
      status: e.reason,
      code: e.code,
      _postman_previewlanguage: "json",
      header: e.headers ?? [
        { key: "Content-Type", value: "application/json" },
        { key: "Cache-Control", value: "no-store" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Request-Id", value: "3f2b8c1e-9d4a-4b7e-8f61-0c5d2a9e7b13" },
      ],
      cookie: [],
      body: JSON.stringify(e.body, null, 2),
    }));
  }
  return item;
}

const NO_AUTH = { type: "noauth" };
const bearer = (token: string) => ({ type: "bearer", bearer: [{ key: "token", value: token, type: "string" }] });
const basicAuth = (user: string, password: string) => ({
  type: "basic",
  basic: [{ key: "username", value: user, type: "string" }, { key: "password", value: password, type: "string" }],
});

const status = (code: number) => `pm.test("Status is ${code}", () => pm.response.to.have.status(${code}));`;
const notEchoed = (value: string) => `pm.test("Input is not echoed back", () => pm.expect(pm.response.text()).to.not.include(${JSON.stringify(value)}));`;
/** The API error envelope {error: {code, message}} with the request ID and nosniff. */
const apiError = (code: number, errorCode: string) => [
  status(code),
  `pm.test("Error code is ${errorCode}", () => pm.expect(pm.response.json().error.code).to.eql("${errorCode}"));`,
  'pm.test("Body is exactly {error: {code, message}}", () => { const b = pm.response.json(); pm.expect(Object.keys(b)).to.eql(["error"]); pm.expect(Object.keys(b.error)).to.have.members(["code", "message"]); });',
  'pm.test("X-Request-Id is set", () => pm.expect(pm.response.headers.get("X-Request-Id")).to.match(/^[0-9a-f-]{36}$/));',
  'pm.test("X-Content-Type-Options: nosniff", () => pm.expect(pm.response.headers.get("X-Content-Type-Options")).to.eql("nosniff"));',
];
const invalid = (echo?: string) => [...apiError(400, "INVALID_REQUEST"), ...(echo ? [notEchoed(echo)] : [])];

const authSkip =
  'if (String(pm.variables.get("authEnabled")) !== "true") { pm.test("SKIPPED: auth is not enabled on this server (authEnabled=false)", () => {}); return; }';
const demoSkip =
  'if (String(pm.variables.get("sampleData")) === "false") { pm.test("SKIPPED: asserts the synthetic DEMO dealers (sampleData=false)", () => {}); return; }';
// Reward choice requests write data: only on a server with the DEMO dealers and a client in AUTH_WRITE_CLIENTS.
const writeSkip =
  'if (String(pm.variables.get("writeEnabled")) !== "true" || String(pm.variables.get("sampleData")) === "false") { pm.test("SKIPPED: needs writeEnabled=true and the DEMO dealers (sampleData=true)", () => {}); return; }';
const cacheSkip =
  'if (String(pm.variables.get("cacheEnabled")) !== "true") { pm.test("SKIPPED: the server has no response cache (cacheEnabled=false)", () => {}); return; }';
const wrap = (guard: string, lines: string[]) => ["(function () {", guard, ...lines, "})();"];

const body = (dealer: string, tags = "{{schemeTags}}") => `{\n  "dealer_code": ${dealer},\n  "scheme_tags": ${tags}\n}`;
const DEALER_BODY = body('"{{dealerCode}}"');

// Checks on any 200 StatusResponse (they hold for real dealers too).
const STATUS_CHECKS = [
  status(200),
  "const b = pm.response.json();",
  'pm.test("Top level is dealer_code, dealer_name, data_as_of, schemes", () => pm.expect(Object.keys(b)).to.have.members(["dealer_code", "dealer_name", "data_as_of", "schemes"]));',
  'pm.test("data_as_of is an IST date-time or null", () => pm.expect(b.data_as_of === null || /\\+05:30$/.test(b.data_as_of)).to.be.true);',
  'pm.test("NOT_IN_SCOPE has only scheme_tag, participation, reason_code, reason", () => b.schemes.filter(s => s.participation === "NOT_IN_SCOPE").forEach(s => pm.expect(Object.keys(s)).to.have.members(["scheme_tag", "participation", "reason_code", "reason"])));',
  'pm.test("UNLOCKED only for the current slab and lower slabs", () => b.schemes.filter(s => s.participation === "IN_SCHEME").forEach(s => s.details.forEach(d => pm.expect(d.lock_status).to.eql(s.current_slab_no !== null && d.slab_no <= s.current_slab_no ? "UNLOCKED" : "LOCKED"))));',
  'pm.test("Slab rule: the dealer is in the slab before the first slab with a failed condition", () => b.schemes.filter(s => s.participation === "IN_SCHEME").forEach(s => { const i = s.details.findIndex(d => d.conditions.some(c => !c.met)); const n = i === -1 ? s.details.length : i; pm.expect(s.current_slab_no || 0).to.eql(n === 0 ? 0 : s.details[n - 1].slab_no); }));',
  'pm.test("Gift value is a number or null (trips); CN is a number", () => b.schemes.filter(s => s.participation === "IN_SCHEME").forEach(s => s.details.forEach(d => { pm.expect(d.gift.value === null || typeof d.gift.value === "number").to.be.true; pm.expect(d.cn_alternative).to.be.a("number"); })));',
  'pm.test("Cache-Control: no-store", () => pm.expect(pm.response.headers.get("Cache-Control")).to.include("no-store"));',
];
const SAME_AS_FIRST = [
  status(200),
  'pm.test("Same body as the first status request", () => pm.expect(JSON.stringify(pm.response.json())).to.eql(pm.collectionVariables.get("statusBody")));',
];
const ORDER_IS = (variable: string) => [
  status(200),
  `pm.test("Schemes are in the order of scheme_tags", () => pm.expect(pm.response.json().schemes.map(s => s.scheme_tag)).to.eql(JSON.parse(pm.variables.get("${variable}"))));`,
];

// Saved examples: the real DEMO0001 response and the error examples of docs/openapi.json.
const OPENAPI = JSON.parse(readFileSync(path.join(OUT, "../../docs/openapi.json"), "utf8")) as {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { example?: unknown; examples?: Record<string, { value: unknown }> }> }> }>>;
};
const DSS_RESPONSES = OPENAPI.paths["/api/v1/dealer-scheme-status"].post.responses;
const dssJson = (code: string) => DSS_RESPONSES[code].content!["application/json"];
const EXAMPLE_200 = dssJson("200").example as { dealer_code: string; schemes: Array<{ scheme_tag: string }> };
const EXAMPLE_200_BODY = body(JSON.stringify(EXAMPLE_200.dealer_code), JSON.stringify(EXAMPLE_200.schemes.map((s) => s.scheme_tag)));

const scheme = (tag: string) => `const s = pm.response.json().schemes.find(x => x.scheme_tag === "${tag}");`;
const functional = [
  req("Status - dealer, all scheme tags", "POST", DSS, [...STATUS_CHECKS,
    'pm.test("One scheme per tag, in request order", () => pm.expect(b.schemes.map(s => s.scheme_tag)).to.eql(JSON.parse(pm.variables.get("schemeTags"))));',
    'pm.test("dealer_code is the requested dealer", () => pm.expect(b.dealer_code).to.eql(pm.variables.get("dealerCode")));',
    'pm.collectionVariables.set("statusBody", JSON.stringify(b));'], {
    body: DEALER_BODY,
    description: "Returns the stored scheme status of one dealer for each requested scheme tag, in the order of `scheme_tags`.",
  }),
  req("Status - scheme tags in reverse order", "POST", DSS, ORDER_IS("reversedTags"), {
    body: body('"{{dealerCode}}"', "{{reversedTags}}"),
    prerequest: ['pm.variables.set("reversedTags", JSON.stringify(JSON.parse(pm.variables.get("schemeTags")).reverse()));'],
  }),
  req("Status - one scheme tag", "POST", DSS, [status(200),
    'pm.test("One scheme", () => pm.expect(pm.response.json().schemes).to.have.length(1));'], {
    body: body('"{{dealerCode}}"', "[{{firstTag}}]"),
    prerequest: ['pm.variables.set("firstTag", JSON.stringify(JSON.parse(pm.variables.get("schemeTags"))[0]));'],
  }),
  req("Status - spaces around the dealer code are trimmed", "POST", DSS, SAME_AS_FIRST, { body: body('"  {{dealerCode}} "') }),
  req("Status - Content-Type Application/JSON; charset=utf-8", "POST", DSS, SAME_AS_FIRST, {
    body: DEALER_BODY, headers: [{ key: "Content-Type", value: "Application/JSON; charset=utf-8" }],
  }),
  req("Status - child dealer returns the parent", "POST", DSS, wrap(
    'if (!pm.variables.get("childDealerCode")) { pm.test("SKIPPED: no childDealerCode in the environment", () => {}); return; }',
    [status(200), 'pm.test("dealer_code is the parent", () => pm.expect(pm.response.json().dealer_code).to.eql(pm.variables.get("parentDealerCode")));']),
  { body: body('"{{childDealerCode}}"'), description: "Sales of a child dealer roll up to the parent. The answer is the parent's." }),
  req("Status - unknown dealer -> 404 DEALER_NOT_FOUND", "POST", DSS, apiError(404, "DEALER_NOT_FOUND"), {
    body: body('"{{unknownDealerCode}}"'),
    examples: [{ name: "404 - DEALER_NOT_FOUND", code: 404, reason: "Not Found", body: { error: { code: "DEALER_NOT_FOUND", message: "Dealer DEMO9999 does not exist." } },
      requestBody: body('"DEMO9999"', '["FB-PAN", "FB-TNHPJK", "SP-Q3"]') }],
  }),
  req("Status - unknown scheme tag -> 400 UNKNOWN_SCHEME_TAG", "POST", DSS, [...apiError(400, "UNKNOWN_SCHEME_TAG"),
    'pm.test("Message names the tag", () => pm.expect(pm.response.json().error.message).to.eql("Scheme tag QA9 does not exist."));'],
  { body: body('"{{dealerCode}}"', '["QA9"]'),
    examples: [{ name: "400 - UNKNOWN_SCHEME_TAG", code: 400, reason: "Bad Request", body: { error: { code: "UNKNOWN_SCHEME_TAG", message: "Scheme tag QA9 does not exist." } } }] }),
  req("Status - repeat is served from the cache (X-Cache HIT)", "POST", DSS, wrap(cacheSkip, [...SAME_AS_FIRST,
    'pm.test("X-Cache: HIT", () => pm.expect(pm.response.headers.get("X-Cache")).to.eql("HIT"));']), { body: DEALER_BODY }),
  req("[demo] DEMO0001 - FB-PAN Slab 1 of 7 (circular example)", "POST", DSS, wrap(demoSkip, [status(200), scheme("FB-PAN"),
    'pm.test("Slab 1, 7 slabs, only Slab 1 UNLOCKED", () => { pm.expect(s.current_slab).to.eql("Slab 1"); pm.expect(s.details.map(d => d.lock_status)).to.eql(["UNLOCKED","LOCKED","LOCKED","LOCKED","LOCKED","LOCKED","LOCKED"]); });',
    'pm.test("Q1 average 1.5 lakh, Oct + Nov 3.6 lakh, growth 20%", () => { pm.expect(s.header.q1_monthly_avg_gsr).to.eql(150000); pm.expect(s.header.metrics.find(m => m.key === "period_gsr").value).to.eql(360000); pm.expect(s.header.metrics.find(m => m.key === "growth_pct").value).to.eql(20); });',
    'pm.test("Slab 1 gift 5,000, CN 4,500", () => { pm.expect(s.details[0].gift.value).to.eql(5000); pm.expect(s.details[0].cn_alternative).to.eql(4500); });',
    'pm.test("FB-TNHPJK region not in scope", () => pm.expect(pm.response.json().schemes.find(x => x.scheme_tag === "FB-TNHPJK").reason_code).to.eql("REGION_NOT_IN_SCOPE"));']),
  { body: body('"DEMO0001"', '["FB-PAN", "FB-TNHPJK", "SP-Q3"]'), description: "Synthetic DEMO dealer (npm run data:demo), not client data. The saved example is the real response for DEMO0001 with FB-PAN and FB-TNHPJK (docs/openapi.json).",
    examples: [{ name: "200 - DEMO0001, FB-PAN and FB-TNHPJK", code: 200, reason: "OK", body: EXAMPLE_200, requestBody: EXAMPLE_200_BODY }] }),
  req("[demo] DEMO0003 - meets Slab 3 but fails Slab 1 growth -> no slab", "POST", DSS, wrap(demoSkip, [status(200), scheme("FB-PAN"),
    'pm.test("No slab, reason SLAB1_GROWTH_NOT_MET", () => { pm.expect(s.current_slab).to.eql(null); pm.expect(s.reason_code).to.eql("SLAB1_GROWTH_NOT_MET"); });',
    'pm.test("All Slab 3 conditions are met (stop at the first failed slab)", () => pm.expect(s.details[2].conditions.every(c => c.met)).to.be.true);']),
  { body: body('"DEMO0003"', '["FB-PAN"]') }),
  req("[demo] DEMO0008 - Star Points beyond Slab 7 (extra benefits)", "POST", DSS, wrap(demoSkip, [status(200), scheme("SP-Q3"),
    'pm.test("Slab 7, 480,000 points", () => { pm.expect(s.current_slab_no).to.eql(7); pm.expect(s.header.metrics.find(m => m.key === "points_earned").value).to.eql(480000); });',
    'pm.test("Two extra-benefit options", () => pm.expect(s.extra_benefits).to.have.length(2));',
    'pm.test("Trip slabs have gift value null", () => pm.expect(s.details[1].gift.value).to.eql(null));']),
  { body: body('"DEMO0008"', '["SP-Q3"]') }),
  req("[demo] DEMO0011 - OD on the check date blocks the benefit", "POST", DSS, wrap(demoSkip, [status(200), scheme("FB-PAN"),
    'pm.test("Slab 1 kept, benefit blocked, od_status OD", () => { pm.expect(s.current_slab_no).to.eql(1); pm.expect(s.benefit_blocked).to.be.true; pm.expect(s.od_status).to.eql("OD"); pm.expect(s.reason_code).to.eql("OD_ON_CHECK_DATE"); });']),
  { body: body('"DEMO0011"', '["FB-PAN"]') }),
  req("[demo] DEMO0012 - zero Q1 sales of any product -> no slab", "POST", DSS, wrap(demoSkip, [status(200), scheme("FB-PAN"),
    'pm.test("No slab, reason SLAB1_GROWTH_NOT_MET", () => { pm.expect(s.current_slab).to.eql(null); pm.expect(s.reason_code).to.eql("SLAB1_GROWTH_NOT_MET"); });',
    'pm.test("GSR conditions of Slab 1 met, growth not met", () => pm.expect(s.details[0].conditions.map(c => [c.key, c.met])).to.eql([["period_gsr", true], ["min_first_month_gsr", true], ["growth_pct", false]]));']),
  { body: body('"DEMO0012"', '["FB-PAN"]'), description: "BA decision 19-10-2026: no Q1 FY 2026-27 sales of any product = growth not met." }),
  req("[demo] DEMO0013 - Q1 sales of other products only -> growth met, Slab 1", "POST", DSS, wrap(demoSkip, [status(200), scheme("FB-PAN"),
    'pm.test("Slab 1 on a zero scheme base", () => { pm.expect(s.current_slab_no).to.eql(1); pm.expect(s.header.q1_monthly_avg_gsr).to.eql(0); });',
    'pm.test("Growth condition met", () => pm.expect(s.details[0].conditions.find(c => c.key === "growth_pct").met).to.be.true);']),
  { body: body('"DEMO0013"', '["FB-PAN"]'), description: "BA decision 19-10-2026: a dealer with Q1 sales of other products passes on a zero scheme base." }),
  req("[demo] DEMO0014 - Star Points growth on total GSR -> Slab 1", "POST", DSS, wrap(demoSkip, [status(200), scheme("SP-Q3"),
    'pm.test("Slab 1, 90,000 points", () => { pm.expect(s.current_slab_no).to.eql(1); pm.expect(s.header.metrics.find(m => m.key === "points_earned").value).to.eql(90000); });',
    'pm.test("Growth 16.66% on total GSR (Table III GSR is flat)", () => pm.expect(s.details[0].conditions.find(c => c.key === "growth_pct")).to.include({ actual: 16.66, met: true }));']),
  { body: body('"DEMO0014"', '["SP-Q3"]'), description: "BA decision 19-10-2026: the Star Points growth uses the total GSR of all products." }),
];

const negative = [
  req("Missing dealer_code -> 400", "POST", DSS, invalid(), { body: '{\n  "scheme_tags": {{schemeTags}}\n}' }),
  req("Empty dealer_code -> 400", "POST", DSS, invalid(), { body: body('""') }),
  req("Whitespace dealer_code -> 400", "POST", DSS, invalid(), { body: body('"   "') }),
  req("Null dealer_code -> 400", "POST", DSS, invalid(), { body: body("null") }),
  req("Number dealer_code -> 400", "POST", DSS, invalid(), { body: body("61000001") }),
  req("Array dealer_code -> 400", "POST", DSS, invalid(), { body: body('["{{dealerCode}}"]') }),
  req("33-character dealer_code -> 400", "POST", DSS, invalid(), { body: body(JSON.stringify("Q".repeat(33))) }),
  req("Dealer code with a space inside -> 400", "POST", DSS, invalid("DEMO 0001"), { body: body('"DEMO 0001"') }),
  req("Dealer code with a dot -> 400", "POST", DSS, invalid("DEMO.0001"), { body: body('"DEMO.0001"') }),
  req("Missing scheme_tags -> 400", "POST", DSS, invalid(), { body: '{\n  "dealer_code": "{{dealerCode}}"\n}' }),
  req("Empty scheme_tags -> 400", "POST", DSS, invalid(), { body: body('"{{dealerCode}}"', "[]") }),
  req("scheme_tags as a string -> 400", "POST", DSS, invalid(), { body: body('"{{dealerCode}}"', '"FB-PAN"') }),
  req("11 scheme tags -> 400", "POST", DSS, invalid(), {
    body: body('"{{dealerCode}}"', JSON.stringify(Array.from({ length: 11 }, (_, i) => `T${i}`))),
  }),
  req("Scheme tag that is a number -> 400", "POST", DSS, invalid(), { body: body('"{{dealerCode}}"', "[1]") }),
  req("Empty scheme tag -> 400", "POST", DSS, invalid(), { body: body('"{{dealerCode}}"', '[""]') }),
  req("Scheme tag longer than 32 characters -> 400", "POST", DSS, invalid(), { body: body('"{{dealerCode}}"', JSON.stringify(["T".repeat(33)])) }),
  req("Scheme tag with a control character -> 400", "POST", DSS, invalid(), { body: body('"{{dealerCode}}"', '["ABC\\n1"]') }),
  req("Duplicate scheme tags -> 400", "POST", DSS, invalid(), { body: body('"{{dealerCode}}"', '["FB-PAN", " FB-PAN "]') }),
  req("Invalid JSON -> 400", "POST", DSS, invalid(), { body: '{"dealer_code": ' }),
  req("Empty body -> 400", "POST", DSS, invalid(), { body: "" }),
  req("Body is a JSON array -> 400", "POST", DSS, invalid(), { body: '["{{dealerCode}}"]' }),
  req("Form-encoded body -> 400", "POST", DSS, invalid(), { form: [["dealer_code", "{{dealerCode}}"]] }),
  req("text/plain body -> 400", "POST", DSS, invalid(), { body: DEALER_BODY, headers: [{ key: "Content-Type", value: "text/plain" }] }),
  req("GET instead of POST -> 405", "GET", DSS, [...apiError(405, "METHOD_NOT_ALLOWED"),
    'pm.test("Allow: POST", () => pm.expect(pm.response.headers.get("Allow")).to.eql("POST"));']),
  req("PUT -> 405", "PUT", DSS, apiError(405, "METHOD_NOT_ALLOWED"), { body: DEALER_BODY, headers: JSON_HEADER }),
  req("PATCH -> 405", "PATCH", DSS, apiError(405, "METHOD_NOT_ALLOWED"), { body: DEALER_BODY, headers: JSON_HEADER }),
  req("DELETE -> 405", "DELETE", DSS, apiError(405, "METHOD_NOT_ALLOWED")),
  req("Unknown route -> 404 NOT_FOUND", "POST", "{{baseUrl}}/api/v1/schemes/unknown", apiError(404, "NOT_FOUND"), { body: DEALER_BODY }),
];

const DENIED = (message: string) => [
  ...apiError(401, "UNAUTHORIZED"),
  `pm.test("Message is ${message}", () => pm.expect(pm.response.json().error.message).to.eql("${message}"));`,
  'pm.test("WWW-Authenticate: Bearer challenge", () => pm.expect(pm.response.headers.get("WWW-Authenticate")).to.match(/^Bearer realm="scheme-calculator"/));',
  ...(message === "Not authenticated"
    ? []
    : ['pm.test("WWW-Authenticate has error=\\"invalid_token\\"", () => pm.expect(pm.response.headers.get("WWW-Authenticate")).to.include(\'error="invalid_token"\'));']),
];
// Flips the first character of the stored token's signature (needs a token: authEnabled=true).
const TAMPER_SCRIPT = [
  'const parts = String(pm.collectionVariables.get("accessToken") || "x.y.z").split(".");',
  'parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);',
  'pm.variables.set("tamperedToken", parts.join("."));',
];

const security = [
  req("No token -> 401 + WWW-Authenticate", "POST", DSS, wrap(authSkip, DENIED("Not authenticated")), {
    body: DEALER_BODY, auth: NO_AUTH, description: "Only when the server requires a token (authEnabled=true).",
  }),
  req("Garbage token -> 401", "POST", DSS, wrap(authSkip, DENIED("Invalid token")), { body: DEALER_BODY, auth: bearer("not-a-jwt") }),
  req("Tampered token signature -> 401", "POST", DSS, wrap(authSkip, DENIED("Invalid token")), {
    body: DEALER_BODY, auth: bearer("{{tamperedToken}}"), prerequest: TAMPER_SCRIPT,
    description: "A real token with one character of its signature changed.",
  }),
  req("X-API-Key only (old phase 2 scheme) -> 401", "POST", DSS, wrap(authSkip, DENIED("Not authenticated")), {
    body: DEALER_BODY, auth: NO_AUTH, headers: [...JSON_HEADER, { key: "X-API-Key", value: "{{clientSecret}}" }],
  }),
  req("Basic scheme on the data endpoint -> 401", "POST", DSS, wrap(authSkip, DENIED("Not authenticated")), {
    body: DEALER_BODY, auth: basicAuth("{{clientId}}", "{{clientSecret}}"),
    description: "Client credentials are only for /api/v1/auth/token. Data needs a Bearer token.",
  }),
  req("Non-ASCII Bearer token -> 401, not 500", "POST", DSS, wrap(authSkip, DENIED("Invalid token")), { body: DEALER_BODY, auth: bearer("kéy") }),
  req("SQL injection payload is rejected and not echoed", "POST", DSS, invalid("1' OR '1'='1"), { body: body(JSON.stringify("1' OR '1'='1")) }),
  req("Script payload is rejected and not echoed", "POST", DSS, invalid("<script>"), { body: body('"<script>alert(1)</script>"') }),
  req("Oversized body -> 413 PAYLOAD_TOO_LARGE", "POST", DSS, apiError(413, "PAYLOAD_TOO_LARGE"), {
    body: JSON.stringify({ dealer_code: "1", scheme_tags: ["FB-PAN"], pad: "x".repeat(9000) }),
  }),
  req("OPTIONS -> 204 without CORS headers", "OPTIONS", DSS, [status(204),
    'pm.test("Allow: POST, OPTIONS", () => pm.expect(pm.response.headers.get("Allow")).to.eql("POST, OPTIONS"));',
    'pm.test("No Access-Control-* header", () => pm.expect(pm.response.headers.filter(h => h.key.toLowerCase().startsWith("access-control-")).length).to.eql(0));'],
  { headers: [{ key: "Origin", value: "https://evil.example.com" }] }),
  req("Security headers are present", "POST", DSS, [
    status(200),
    'pm.test("X-Content-Type-Options: nosniff", () => pm.expect(pm.response.headers.get("X-Content-Type-Options")).to.eql("nosniff"));',
    'pm.test("Cache-Control: no-store", () => pm.expect(pm.response.headers.get("Cache-Control")).to.include("no-store"));',
    'pm.test("HSTS sent once (browsers use only the first)", () => pm.expect(pm.response.headers.filter(h => h.key.toLowerCase() === "strict-transport-security").length).to.eql(1));',
    'pm.test("HSTS max-age >= 1 year", () => pm.expect(Number((pm.response.headers.get("Strict-Transport-Security") || "").match(/max-age=(\\d+)/)[1])).to.be.at.least(31536000));',
    "pm.test(\"Content-Security-Policy: default-src 'none'\", () => pm.expect(pm.response.headers.get(\"Content-Security-Policy\")).to.include(\"default-src 'none'\"));",
    'pm.test("X-Frame-Options: DENY", () => pm.expect(pm.response.headers.get("X-Frame-Options")).to.eql("DENY"));',
    'pm.test("Referrer-Policy: no-referrer", () => pm.expect(pm.response.headers.get("Referrer-Policy")).to.eql("no-referrer"));',
    'pm.test("Cross-Origin-Resource-Policy: same-origin", () => pm.expect(pm.response.headers.get("Cross-Origin-Resource-Policy")).to.eql("same-origin"));',
    'pm.test("No X-Powered-By header", () => pm.expect(pm.response.headers.has("X-Powered-By")).to.be.false);',
    'pm.test("No Access-Control-Allow-Origin", () => pm.expect(pm.response.headers.has("Access-Control-Allow-Origin")).to.be.false);',
  ], { body: DEALER_BODY, headers: [...JSON_HEADER, { key: "Origin", value: "https://evil.example.com" }] }),
  req("Swagger UI loads a pinned release with integrity hashes", "GET", "{{baseUrl}}/api/docs", [
    'if (pm.response.code === 404) { pm.test("SKIPPED: docs are off on this server (DOCS_ENABLED=false)", () => {}); return; }',
    status(200),
    "const html = pm.response.text();",
    'pm.test("Not the floating @5 release", () => pm.expect(html).to.not.include("swagger-ui-dist@5/"));',
    'pm.test("Script pinned with SRI", () => pm.expect(html).to.match(/<script src="https:\\/\\/cdn\\.jsdelivr\\.net\\/npm\\/swagger-ui-dist@\\d+\\.\\d+\\.\\d+\\/swagger-ui-bundle\\.js" integrity="sha384-[^"]+" crossorigin="anonymous">/));',
    'pm.test("Stylesheet pinned with SRI", () => pm.expect(html).to.match(/href="https:\\/\\/cdn\\.jsdelivr\\.net\\/npm\\/swagger-ui-dist@\\d+\\.\\d+\\.\\d+\\/swagger-ui\\.css" integrity="sha384-[^"]+" crossorigin="anonymous">/));',
    'pm.test("CSP allows only that release, no unsafe-inline script", () => { const csp = pm.response.headers.get("Content-Security-Policy"); pm.expect(csp).to.match(/script-src [^;]*https:\\/\\/cdn\\.jsdelivr\\.net\\/npm\\/swagger-ui-dist@\\d+\\.\\d+\\.\\d+\\/;/); pm.expect(csp).to.not.match(/script-src[^;]*unsafe-inline/); });',
  ], { auth: NO_AUTH }),
];

const choiceBody = (o: Record<string, unknown>) => JSON.stringify({ chosen_by: "QA-POSTMAN", ...o }, null, 2);
const CHOICE_OK = (dealer: string, tag: string, choice: string, changed: boolean) => [
  status(200),
  "const r = pm.response.json();",
  'pm.test("Body is dealer_code, scheme_tag, changed, reward_choice", () => pm.expect(Object.keys(r)).to.have.members(["dealer_code", "scheme_tag", "changed", "reward_choice"]));',
  `pm.test("Saved for ${dealer} / ${tag}", () => { pm.expect(r.dealer_code).to.eql("${dealer}"); pm.expect(r.scheme_tag).to.eql("${tag}"); });`,
  `pm.test("choice is ${choice}, source API, chosen_by QA-POSTMAN", () => { pm.expect(r.reward_choice.choice).to.eql("${choice}"); pm.expect(r.reward_choice.source).to.eql("API"); pm.expect(r.reward_choice.chosen_by).to.eql("QA-POSTMAN"); });`,
  `pm.test("changed is ${changed}", () => pm.expect(r.changed).to.eql(${changed}));`,
  'pm.test("updated_at is IST", () => pm.expect(r.reward_choice.updated_at).to.match(/\\+05:30$/));',
];
const DRC_RESPONSES = OPENAPI.paths["/api/v1/dealer-reward-choice"].post.responses;
const choice = [
  req("Choice - CN for DEMO0013 FB-PAN -> 200 changed", "POST", DRC, wrap(writeSkip, CHOICE_OK("DEMO0013", "FB-PAN", "CN", true)), {
    body: choiceBody({ dealer_code: "DEMO0013", scheme_tag: "FB-PAN", choice: "CN" }),
    description: "Saves the dealer's reward choice. Needs a token with the choices:write scope (client in AUTH_WRITE_CLIENTS). " +
      "A later request sets GIFT, so that this request changes the choice on every run.",
    examples: [{ name: "200 - saved", code: 200, reason: "OK", body: DRC_RESPONSES["200"].content!["application/json"].example }],
  }),
  req("Choice - same CN again -> 200, changed false", "POST", DRC, wrap(writeSkip, CHOICE_OK("DEMO0013", "FB-PAN", "CN", false)), {
    body: choiceBody({ dealer_code: "DEMO0013", scheme_tag: "FB-PAN", choice: "CN" }),
  }),
  req("Choice - GIFT for DEMO0013 FB-PAN -> 200 changed", "POST", DRC, wrap(writeSkip, CHOICE_OK("DEMO0013", "FB-PAN", "GIFT", true)), {
    body: choiceBody({ dealer_code: "DEMO0013", scheme_tag: "FB-PAN", choice: "GIFT" }),
  }),
  req("Status - shows the saved reward_choice", "POST", DSS, wrap(writeSkip, [
    status(200),
    'const s = pm.response.json().schemes.find(x => x.scheme_tag === "FB-PAN");',
    'pm.test("reward_choice is GIFT by QA-POSTMAN", () => { pm.expect(s.reward_choice.choice).to.eql("GIFT"); pm.expect(s.reward_choice.chosen_by).to.eql("QA-POSTMAN"); });',
  ]), { body: body('"DEMO0013"', '["FB-PAN"]') }),
  req("Choice - destination OVERSEAS for DEMO0008 (SP Slab 7) -> 200", "POST", DRC, wrap(writeSkip, [
    status(200),
    'pm.test("destination is OVERSEAS", () => pm.expect(pm.response.json().reward_choice.destination).to.eql("OVERSEAS"));',
  ]), { body: choiceBody({ dealer_code: "DEMO0008", scheme_tag: "SP-Q3", choice: "GIFT", destination: "OVERSEAS" }) }),
  req("Choice - child DEMO-C1 is saved under the parent DEMO0010", "POST", DRC, wrap(writeSkip, [
    status(200),
    'pm.test("dealer_code is the parent", () => pm.expect(pm.response.json().dealer_code).to.eql("DEMO0010"));',
  ]), { body: choiceBody({ dealer_code: "DEMO-C1", scheme_tag: "FB-PAN", choice: "CN" }) }),
  req("Choice - dealer not in a slab (DEMO0002) -> 409", "POST", DRC, wrap(writeSkip, apiError(409, "CHOICE_NOT_ALLOWED")), {
    body: choiceBody({ dealer_code: "DEMO0002", scheme_tag: "FB-PAN", choice: "GIFT" }),
  }),
  req("Choice - destination below Slab 7 (DEMO0007) -> 409", "POST", DRC, wrap(writeSkip, apiError(409, "CHOICE_NOT_ALLOWED")), {
    body: choiceBody({ dealer_code: "DEMO0007", scheme_tag: "SP-Q3", choice: "GIFT", destination: "CRUISE" }),
  }),
  req("Choice - unknown dealer -> 404", "POST", DRC, wrap(writeSkip, apiError(404, "DEALER_NOT_FOUND")), {
    body: choiceBody({ dealer_code: "{{unknownDealerCode}}", scheme_tag: "FB-PAN", choice: "GIFT" }),
  }),
  req("Choice - unknown scheme tag -> 400", "POST", DRC, wrap(writeSkip, apiError(400, "UNKNOWN_SCHEME_TAG")), {
    body: choiceBody({ dealer_code: "DEMO0001", scheme_tag: "ABC9", choice: "GIFT" }),
  }),
  req("Choice - choice not GIFT or CN -> 400", "POST", DRC, wrap(writeSkip, invalid()), {
    body: choiceBody({ dealer_code: "DEMO0001", scheme_tag: "FB-PAN", choice: "VOUCHER" }),
  }),
  req("Choice - missing chosen_by -> 400", "POST", DRC, wrap(writeSkip, invalid()), {
    body: JSON.stringify({ dealer_code: "DEMO0001", scheme_tag: "FB-PAN", choice: "GIFT" }, null, 2),
  }),
  req("Choice - GET -> 405", "GET", DRC, [...apiError(405, "METHOD_NOT_ALLOWED"),
    'pm.test("Allow: POST", () => pm.expect(pm.response.headers.get("Allow")).to.eql("POST"));']),
];

const EMBED_OK = [
  status(200),
  "const e = pm.response.json();",
  'pm.test("Body is token, embed_path, expires_at", () => pm.expect(Object.keys(e)).to.have.members(["token", "embed_path", "expires_at"]));',
  'pm.test("token is payload.signature (base64url)", () => pm.expect(e.token).to.match(/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/));',
  'pm.test("embed_path is /embed with the token", () => pm.expect(e.embed_path.startsWith("/embed?token=" + e.token)).to.be.true);',
  'pm.test("Token payload is the dealer, v 1, exp = expires_at", () => { const c = JSON.parse(atob(e.token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))); pm.expect(c.d).to.eql(pm.variables.get("dealerCode")); pm.expect(c.v).to.eql(1); pm.expect(c.exp * 1000).to.eql(Date.parse(e.expires_at)); });',
  'pm.test("Cache-Control: no-store", () => pm.expect(pm.response.headers.get("Cache-Control")).to.include("no-store"));',
  'pm.collectionVariables.set("embedToken", e.token);',
];
const EMB_RESPONSES = OPENAPI.paths["/api/v1/embed-token"].post.responses;
/** GET /embed?token={{embedToken}} (the token of the request before). req() has no query parameters, so set the URL here. */
function embedPage(): Json {
  const item = req("Iframe page - opens with the token -> 200", "GET", "{{baseUrl}}/embed", [
    status(200),
    'pm.test("Not the session expired page", () => pm.expect(pm.response.text()).to.not.include("Session expired"));',
    'pm.test("CSP frame-ancestors is set", () => pm.expect(pm.response.headers.get("Content-Security-Policy")).to.include("frame-ancestors"));',
  ], { auth: NO_AUTH, headers: [], description: "Opens the iframe with the token of the request before. Needs EMBED_SIGNING_SECRET on the server." });
  (item.request as Json).url = {
    raw: "{{baseUrl}}/embed?token={{embedToken}}",
    host: ["{{baseUrl}}"],
    path: ["embed"],
    query: [{ key: "token", value: "{{embedToken}}" }],
  };
  return item;
}
const embed = [
  req("Iframe token - dealer, all schemes -> 200", "POST", EMB, [...EMBED_OK,
    'pm.test("Default lifetime is 1 hour", () => { const s = (Date.parse(e.expires_at) - Date.now()) / 1000; pm.expect(s).to.be.within(3500, 3601); });',
    'pm.test("No tags in the path", () => pm.expect(e.embed_path).to.not.include("tags="));',
  ], {
    body: '{\n  "dealer_code": "{{dealerCode}}"\n}',
    description: "For the SAP Commerce / SFA back end: a signed /embed URL for the logged-in dealer. iframe src = {{baseUrl}} + embed_path. " +
      "Scope schemes:read. The host does not need EMBED_SIGNING_SECRET.",
    examples: [{ name: "200 - iframe token", code: 200, reason: "OK", body: EMB_RESPONSES["200"].content!["application/json"].example }],
  }),
  embedPage(),
  req("Iframe token - one scheme, 15 minutes -> 200", "POST", EMB, [...EMBED_OK,
    'pm.test("Lifetime is 900 s", () => { const s = (Date.parse(e.expires_at) - Date.now()) / 1000; pm.expect(s).to.be.within(800, 901); });',
    'pm.test("Path has tags=FB-PAN", () => pm.expect(e.embed_path).to.match(/&tags=FB-PAN$/));',
  ], { body: '{\n  "dealer_code": "{{dealerCode}}",\n  "scheme_tags": ["FB-PAN"],\n  "ttl_seconds": 900\n}' }),
  req("Iframe token - unknown scheme tag -> 400", "POST", EMB, apiError(400, "UNKNOWN_SCHEME_TAG"), {
    body: '{\n  "dealer_code": "{{dealerCode}}",\n  "scheme_tags": ["ABC9"]\n}',
  }),
  req("Iframe token - ttl_seconds above 24 hours -> 400", "POST", EMB, invalid(), {
    body: '{\n  "dealer_code": "{{dealerCode}}",\n  "ttl_seconds": 100000\n}',
  }),
  req("Iframe token - SQL in dealer_code -> 400, not echoed", "POST", EMB, invalid("OR '1'='1"), {
    body: '{\n  "dealer_code": "1\' OR \'1\'=\'1"\n}',
  }),
  req("Iframe token - no token -> 401", "POST", EMB, wrap(authSkip, apiError(401, "UNAUTHORIZED")), {
    body: '{\n  "dealer_code": "{{dealerCode}}"\n}', auth: NO_AUTH,
  }),
  req("Iframe token - GET -> 405", "GET", EMB, [...apiError(405, "METHOD_NOT_ALLOWED"),
    'pm.test("Allow: POST", () => pm.expect(pm.response.headers.get("Allow")).to.eql("POST"));']),
];

const GOOD_FORM: Array<[string, string]> = [["grant_type", "client_credentials"], ["client_id", "{{clientId}}"], ["client_secret", "{{clientSecret}}"]];
const without = (...keys: string[]) => GOOD_FORM.filter(([k]) => !keys.includes(k));
const NO_STORE = [
  'pm.test("Cache-Control: no-store", () => pm.expect(pm.response.headers.get("Cache-Control")).to.include("no-store"));',
  'pm.test("Pragma: no-cache", () => pm.expect(pm.response.headers.get("Pragma")).to.eql("no-cache"));',
];
const TOKEN_OK = [
  status(200), ...NO_STORE,
  "const t = pm.response.json();",
  'pm.test("Body is exactly access_token, token_type, expires_in, scope", () => pm.expect(Object.keys(t)).to.have.members(["access_token", "token_type", "expires_in", "scope"]));',
  'pm.test("token_type is Bearer, scope has schemes:read", () => { pm.expect(t.token_type).to.eql("Bearer"); pm.expect(t.scope.split(" ")).to.include("schemes:read"); });',
  'pm.test("expires_in is 3600 (JWT_TTL_SECONDS)", () => pm.expect(t.expires_in).to.eql(3600));',
  'pm.test("access_token is a JWT for this client", () => { const parts = t.access_token.split("."); pm.expect(parts).to.have.length(3); const c = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))); pm.expect(c.sub).to.eql(pm.variables.get("clientId")); pm.expect(c.aud).to.eql("scheme-calculator"); pm.expect(c.exp - c.iat).to.eql(t.expires_in); });',
  'pm.test("Client secret is not echoed", () => pm.expect(pm.response.text()).to.not.include(pm.variables.get("clientSecret")));',
];
/** RFC 6749 section 5.2 error body. A 401 has the Basic challenge only when the request used HTTP Basic (challenge). */
const oauthError = (code: number, error: string, challenge = false) => [
  status(code), ...NO_STORE,
  `pm.test("error is ${error}", () => pm.expect(pm.response.json().error).to.eql("${error}"));`,
  'pm.test("Body is {error, error_description}", () => pm.expect(Object.keys(pm.response.json())).to.have.members(["error", "error_description"]));',
  ...(code === 401 && challenge ? ['pm.test("WWW-Authenticate: Basic challenge", () => pm.expect(pm.response.headers.get("WWW-Authenticate")).to.match(/^Basic realm="scheme-calculator"/));'] : []),
  ...(code === 401 && !challenge ? ['pm.test("No Basic challenge (credentials in the body)", () => pm.expect(pm.response.headers.has("WWW-Authenticate")).to.be.false);'] : []),
];
function tokenReq(name: string, tests: string[], o: ReqOptions & { method?: string } = {}): Json {
  const method = o.method ?? "POST";
  const form = o.body !== undefined || method === "GET" ? undefined : (o.form ?? GOOD_FORM);
  return req(name, method, TOKEN_URL, wrap(authSkip, tests), { ...o, form, auth: o.auth ?? NO_AUTH });
}

const auth = [
  tokenReq("Token - form-encoded credentials -> 200", TOKEN_OK, {
    form: [...GOOD_FORM, ["scope", "schemes:read"]],
    description: "RFC 6749 client credentials grant. The collection pre-request script does the same and stores {{accessToken}}.",
    examples: [{
      name: "200 - access token", code: 200, reason: "OK",
      body: OPENAPI.paths["/api/v1/auth/token"].post.responses["200"].content!["application/json"].example,
      headers: [{ key: "Content-Type", value: "application/json" }, { key: "Cache-Control", value: "no-store" }, { key: "Pragma", value: "no-cache" }],
    }],
  }),
  tokenReq("Token - JSON body -> 200", TOKEN_OK, {
    body: '{\n  "grant_type": "client_credentials",\n  "client_id": "{{clientId}}",\n  "client_secret": "{{clientSecret}}"\n}', headers: JSON_HEADER,
  }),
  tokenReq("Token - HTTP Basic client authentication -> 200", TOKEN_OK, {
    form: [["grant_type", "client_credentials"]], auth: basicAuth("{{clientId}}", "{{clientSecret}}"),
  }),
  tokenReq("Token - wrong client_secret -> 401 invalid_client", oauthError(401, "invalid_client"), {
    form: [...without("client_secret"), ["client_secret", "wrong-secret-qa"]],
  }),
  tokenReq("Token - wrong secret in HTTP Basic -> 401 with the Basic challenge", oauthError(401, "invalid_client", true), {
    form: [["grant_type", "client_credentials"]], auth: basicAuth("{{clientId}}", "wrong-secret-qa"),
  }),
  tokenReq("Token - unknown client_id -> 401 invalid_client", oauthError(401, "invalid_client"), {
    form: [["grant_type", "client_credentials"], ["client_id", "unknown-client-qa"], ["client_secret", "{{clientSecret}}"]],
  }),
  tokenReq("Token - missing grant_type -> 400 invalid_request", oauthError(400, "invalid_request"), { form: without("grant_type") }),
  tokenReq("Token - grant_type password -> 400 unsupported_grant_type", oauthError(400, "unsupported_grant_type"), {
    form: [["grant_type", "password"], ...without("grant_type")],
  }),
  tokenReq("Token - invalid scope -> 400 invalid_scope", oauthError(400, "invalid_scope"), { form: [...GOOD_FORM, ["scope", "admin"]] }),
  tokenReq("Token - Basic and body credentials together -> 400 invalid_request", oauthError(400, "invalid_request"), {
    auth: basicAuth("{{clientId}}", "{{clientSecret}}"),
  }),
  tokenReq("Token - JSON parameter sent twice -> 400 invalid_request", oauthError(400, "invalid_request"), {
    body: '{\n  "grant_type": "client_credentials",\n  "client_id": "{{clientId}}",\n  "client_secret": "wrong-secret-qa",\n  "client_secret": "{{clientSecret}}"\n}',
    headers: JSON_HEADER,
    description: "A repeated JSON key must not let a second secret win.",
  }),
  tokenReq("Token - GET -> 405", [status(405), 'pm.test("Allow: POST", () => pm.expect(pm.response.headers.get("Allow")).to.eql("POST"));'], {
    method: "GET", headers: [],
  }),
  tokenReq("Token - response is not cacheable (no-store, Pragma no-cache)", [
    status(200), ...NO_STORE,
    'pm.test("X-Content-Type-Options: nosniff", () => pm.expect(pm.response.headers.get("X-Content-Type-Options")).to.eql("nosniff"));',
  ]),
];

const health = [
  req("Health check", "GET", HEALTH, [status(200),
    'pm.test("Body is {status: \\"ok\\", data_as_of}", () => { const b = pm.response.json(); pm.expect(Object.keys(b)).to.have.members(["status", "data_as_of"]); pm.expect(b.status).to.eql("ok"); });'],
  { auth: NO_AUTH, description: "Readiness probe (checks the database). No token needed. Never rate limited." }),
  req("Health check - HEAD", "HEAD", HEALTH, [status(200), 'pm.test("No body", () => pm.expect(pm.response.text()).to.eql(""));'], { auth: NO_AUTH }),
];

// Collection pre-request: one token per run, reused until 60 s before it expires. POST /api/v1/auth/token has its
// own low per-IP limit (TOKEN_RATE_LIMIT_PER_MINUTE, default 30), so never one per request.
const TOKEN_SCRIPT = [
  "(function () {",
  '  if (String(pm.variables.get("authEnabled")) === "false") return; // server has auth off',
  '  const clientId = pm.variables.get("clientId"), clientSecret = pm.variables.get("clientSecret");',
  '  if (!clientId || !clientSecret) { console.warn("clientId/clientSecret not set: requests go without a token"); return; }',
  '  const expiresAt = Number(pm.collectionVariables.get("accessTokenExpiresAt") || 0);',
  '  if (pm.collectionVariables.get("accessToken") && Date.now() < expiresAt - 60000) return;',
  "  // After a failed token request, do not ask again for 60 s: a retry before each request would keep the",
  "  // per-IP token limit used up (a storm of 429) and hide the cause behind many 401 failures.",
  '  const failedAt = Number(pm.collectionVariables.get("accessTokenFailedAt") || 0);',
  "  if (failedAt && Date.now() - failedAt < 60000) return;",
  "  pm.sendRequest({",
  '    url: pm.variables.replaceIn("{{baseUrl}}") + "/api/v1/auth/token", method: "POST",',
  '    header: [{ key: "Content-Type", value: "application/x-www-form-urlencoded" }],',
  '    body: { mode: "urlencoded", urlencoded: [',
  '      { key: "grant_type", value: "client_credentials" }, { key: "client_id", value: clientId },',
  '      { key: "client_secret", value: clientSecret }] }, // no scope: all scopes of the client (choices:write too, when allowed)',
  "  }, (err, res) => {",
  "    if (err || res.code !== 200) {",
  '      pm.collectionVariables.set("accessToken", ""); pm.collectionVariables.set("accessTokenExpiresAt", "");',
  '      pm.collectionVariables.set("accessTokenFailedAt", String(Date.now()));',
  '      const why = err ? String(err) : res.code + " " + res.text();',
  '      const hint = res && res.code === 429 ? " The token limit (TOKEN_RATE_LIMIT_PER_MINUTE) is used up: wait one minute (for example after a ZAP scan) and run again." : "";',
  '      console.error("Token request failed:", why);',
  '      pm.test("Token request succeeds (requests without a token get 401)", () => { throw new Error("Token request failed: " + why + "." + hint); });',
  "      return;",
  "    }",
  '    pm.collectionVariables.set("accessTokenFailedAt", "");',
  "    const body = res.json();",
  '    pm.collectionVariables.set("accessToken", body.access_token);',
  '    pm.collectionVariables.set("accessTokenExpiresAt", String(Date.now() + body.expires_in * 1000));',
  "  });",
  "})();",
];

function collection(): Json {
  return {
    info: {
      _postman_id: uuidV5("scheme-calculator/postman/collection-dealer-scheme-status"),
      name: "Scheme Calculator - Dealer scheme status API",
      description: [
        "POST /api/v1/dealer-scheme-status with {dealer_code, scheme_tags} returns the stored scheme status of one dealer " +
          "(Festive Bonanza FB-PAN/FB-TNHPJK, Star Points SP-Q3). Contract: docs/api-contract.md.",
        "",
        "1. Import this collection and an environment (Local or Dev) from the same folder.",
        "2. Select the environment and set `clientId` and `clientSecret` (Local has the .env.example values). The collection " +
          "gets one Bearer token from /api/v1/auth/token and reuses it until one minute before it expires. Set " +
          "`authEnabled = false` for a server with auth off.",
        "3. Send a request, or run the whole collection (Runner) to do every test.",
        "",
        "Full guide: qa/README.md and docs/API_GUIDE.md in the repository.",
      ].join("\n"),
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: bearer("{{accessToken}}"),
    event: [
      preScript(TOKEN_SCRIPT),
      testScript([
        'pm.test("Responds within 2 seconds", () => pm.expect(pm.response.responseTime).to.be.below(2000));',
        'pm.test("No stack trace or internal details in the body", () => { const t = pm.response.text(); ["    at ", ".ts:", "node_modules", "SELECT ", "TypeError", "drizzle"].forEach(s => pm.expect(t).to.not.include(s)); });',
      ]),
    ],
    variable: [
      { key: "accessToken", value: "" },
      { key: "accessTokenExpiresAt", value: "" },
      { key: "accessTokenFailedAt", value: "" },
      { key: "statusBody", value: "" },
      { key: "embedToken", value: "" },
    ],
    item: [
      { name: "1. Health", item: health },
      { name: "2. Dealer scheme status", item: functional },
      { name: "3. Negative cases", item: negative },
      { name: "4. Security", item: security },
      { name: "5. Auth", item: auth },
      { name: "6. Reward choice", item: choice },
      { name: "7. Iframe token", item: embed },
    ],
  };
}

interface EnvValues {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  dealerCode: string;
  childDealerCode: string;
  parentDealerCode: string;
  sampleData: string;
  cacheEnabled: string;
  /** "true" when the client is in AUTH_WRITE_CLIENTS (reward choice requests run). */
  writeEnabled: string;
}
function environment(name: string, v: EnvValues): Json {
  const row = (key: string, value: string, type = "default") => ({ key, value, type, enabled: true });
  return {
    id: uuidV5(`scheme-calculator/postman/${name}`),
    name,
    _postman_variable_scope: "environment",
    values: [
      row("baseUrl", v.baseUrl),
      row("clientId", v.clientId),
      row("clientSecret", v.clientSecret, "secret"),
      row("authEnabled", "true"),
      row("dealerCode", v.dealerCode),
      row("childDealerCode", v.childDealerCode),
      row("parentDealerCode", v.parentDealerCode),
      row("unknownDealerCode", "DEMO9999"),
      row("schemeTags", '["FB-PAN", "FB-TNHPJK", "SP-Q3"]'),
      row("sampleData", v.sampleData),
      row("cacheEnabled", v.cacheEnabled),
      row("writeEnabled", v.writeEnabled),
    ],
  };
}

/** Dev server (decision Q8, 18-10-2026). UAT and production follow the same pattern; their hosts are to be confirmed. */
export const DEV_BASE_URL = "https://dev.scheme-calculator.example.com";

/** Every file this script writes, by file name. */
export function buildAll(): Record<string, Json> {
  return {
    [COLLECTION_FILE]: collection(),
    "Local.postman_environment.json": environment("Scheme Calculator - Local", {
      baseUrl: "http://localhost:3400", clientId: "local-client", clientSecret: "local-test-secret", dealerCode: "DEMO0001",
      childDealerCode: "DEMO-C1", parentDealerCode: "DEMO0010", sampleData: "true", cacheEnabled: "false", writeEnabled: "true",
    }),
    // Dev URL: decision Q8 (Mayur, 18-10-2026), the same example pattern as the other Acme API. The QA client and
    // a real dealer code are set in Postman only. Never commit real credentials or dealer codes.
    "Dev.postman_environment.json": environment("Scheme Calculator - Dev", {
      baseUrl: DEV_BASE_URL, clientId: "", clientSecret: "", dealerCode: "<a real dealer code>",
      childDealerCode: "", parentDealerCode: "", sampleData: "false", cacheEnabled: "false", writeEnabled: "false",
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [file, data] of Object.entries(buildAll())) writeFileSync(path.join(OUT, file), JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote qa/postman/: ${Object.keys(buildAll()).join(", ")}`);
}
