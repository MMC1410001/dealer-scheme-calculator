/**
 * QA-1: TRACE and the methods that Next.js rejects before the route get a JSON answer from the method guard.
 * A plain Node.js HTTP server stands in for Next.js: its listener answers 500 text/plain, like Next.js does for TRACE.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { API_SECURITY_HEADERS } from "@/server/api/http";
import { guardAnswer, installMethodGuard, isRefusedMethod } from "./method-guard";

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function send(port: number, method: string, path: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { "X-Trace-Probe": "qa-trace-probe" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("isRefusedMethod / guardAnswer", () => {
  it("refuses TRACE on every path, and other non-route methods only on /api", () => {
    expect(isRefusedMethod("TRACE", "/api/v1/dealer-scheme-status")).toBe(true);
    expect(isRefusedMethod("TRACE", "/embed?x=1")).toBe(true);
    expect(isRefusedMethod("PROPFIND", "/api/v1/health")).toBe(true);
    expect(isRefusedMethod("PROPFIND", "/api")).toBe(true);
    expect(isRefusedMethod("PROPFIND", "/embed")).toBe(false);
    expect(isRefusedMethod("PROPFIND", "/apix")).toBe(false);
    for (const m of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(isRefusedMethod(m, "/api/v1/dealer-scheme-status")).toBe(false);
    }
  });

  it("answers 405 with Allow for the API routes and pages, 404 NOT_FOUND for an /api path with no route", () => {
    expect(guardAnswer("/api/v1/dealer-scheme-status")).toMatchObject({ status: 405, allow: "POST", message: "Method not allowed. Use POST." });
    expect(guardAnswer("/api/v1/auth/token?x=1")).toMatchObject({ status: 405, allow: "POST" });
    expect(guardAnswer("/api/v1/health")).toMatchObject({ status: 405, allow: "GET, HEAD" });
    expect(guardAnswer("/api/v1/nothing")).toMatchObject({ status: 404, code: "NOT_FOUND", allow: null });
    expect(guardAnswer("/api")).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(guardAnswer("/embed")).toMatchObject({ status: 405, code: "METHOD_NOT_ALLOWED", allow: "GET, HEAD" });
  });
});

describe("installMethodGuard on a running HTTP server", () => {
  let server: http.Server;
  let port = 0;
  let uninstall: () => void = () => undefined;
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

  beforeAll(async () => {
    // Like Next.js: TRACE fails inside the request handler with 500 text/plain.
    server = http.createServer((req, res) => {
      res.statusCode = req.method === "TRACE" ? 500 : 200;
      res.setHeader("Content-Type", "text/plain");
      res.end(req.method === "TRACE" ? "Internal Server Error" : "next");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    uninstall = installMethodGuard(); // installed after the server listens, as in src/instrumentation.ts
  });

  afterAll(async () => {
    uninstall();
    log.mockRestore();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("installs only one time for each process", () => {
    expect(installMethodGuard()).toBe(uninstall);
  });

  it("TRACE on the data endpoint: 405 JSON envelope, Allow, security headers, X-Request-Id, one log line, no echo", async () => {
    log.mockClear();
    const r = await send(port, "TRACE", "/api/v1/dealer-scheme-status");
    expect(r.status).toBe(405);
    expect(JSON.parse(r.body)).toEqual({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed. Use POST." } });
    expect(r.body).not.toContain("qa-trace-probe");
    expect(r.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(r.headers["allow"]).toBe("POST");
    expect(r.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) expect(r.headers[k.toLowerCase()]).toBe(v);
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0][0])) as Record<string, unknown>;
    expect(line).toMatchObject({ evt: "api_request", status: 405, code: "METHOD_NOT_ALLOWED", method: "TRACE" });
    expect(line.request_id).toBe(r.headers["x-request-id"]);
  });

  it("PROPFIND on an unknown /api path: 404 NOT_FOUND; TRACE on a page: 405", async () => {
    const a = await send(port, "PROPFIND", "/api/v1/nothing");
    expect([a.status, JSON.parse(a.body)]).toEqual([404, { error: { code: "NOT_FOUND", message: "Not found." } }]);
    expect(a.headers["allow"]).toBeUndefined();
    const b = await send(port, "TRACE", "/embed");
    expect([b.status, b.headers["allow"], JSON.parse(b.body).error.code]).toEqual([405, "GET, HEAD", "METHOD_NOT_ALLOWED"]);
  });

  it("passes every other request to the server's own handler", async () => {
    for (const m of ["GET", "POST", "DELETE", "OPTIONS"]) {
      const r = await send(port, m, "/api/v1/dealer-scheme-status");
      expect([m, r.status, r.body]).toEqual([m, 200, "next"]);
    }
    expect((await send(port, "PROPFIND", "/embed")).body).toBe("next");
  });

  it("after uninstall, the server's own handler gets TRACE again", async () => {
    uninstall();
    expect((await send(port, "TRACE", "/api/v1/health")).status).toBe(500);
    uninstall = installMethodGuard();
    expect((await send(port, "TRACE", "/api/v1/health")).status).toBe(405);
  });
});
