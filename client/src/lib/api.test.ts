import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError } from "./api";

/**
 * The one place that calls fetch. Pins the error taxonomy the UI branches on
 * (network vs. server envelope vs. non-JSON body) and the JSON-body header rule.
 */
function mockFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns the parsed body on success", async () => {
    mockFetch(async () => json(200, { ok: true }));
    await expect(api.get("/x")).resolves.toEqual({ ok: true });
  });

  it("turns the server's error envelope into an ApiError with status, code and message", async () => {
    mockFetch(async () => json(404, { error: { code: "not_found", message: "Repo not found" } }));
    const err = await api.get("/repos/1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "not_found", message: "Repo not found" });
  });

  it("falls back to the status line for a non-JSON error body", async () => {
    mockFetch(async () => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 502, message: "502 Bad Gateway" });
  });

  it("reports an unreachable API as a network_error (status 0)", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(api.get("/x")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("declares a JSON content-type only when a body is sent", async () => {
    const fetchFn = mockFetch(async () => json(200, {}));
    await api.post("/a", { n: 1 });
    await api.post("/b");
    const headersOf = (i: number) => (fetchFn.mock.calls[i]![1]!.headers ?? {}) as Record<string, string>;
    expect(headersOf(0)["content-type"]).toBe("application/json");
    expect(headersOf(1)["content-type"]).toBeUndefined();
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    await expect(api.del("/x")).resolves.toBeUndefined();
  });
});
