import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { connectUsb } from "./usb.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("./public/", import.meta.url));
export function phoneAddress(value) {
  if (
    typeof value !== "string" ||
    !/^(\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(value)
  )
    throw new Error(
      "Enter the IPv4 address shown on the phone, such as 192.168.1.20:8787.",
    );
  const [host, rawPort = "8787"] = value.split(":");
  const octets = host.split(".").map(Number);
  if (octets.some((n, i) => n > 255 || String(n) !== host.split(".")[i]))
    throw new Error("Invalid phone address.");
  if (
    !(
      octets[0] === 10 ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      host === "127.0.0.1"
    )
  )
    throw new Error("Use a private LAN address.");
  const port = Number(rawPort);
  if (port < 1 || port > 65535) throw new Error("Invalid port.");
  return `http://${host}:${port}`;
}
async function readJson(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    req.resume();
    throw new Error("JSON required.");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("Request too large."));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
export function createCompanion({ usbConnect = connectUsb } = {}) {
  let pairing = null;
  let pairGeneration = 0;
  const streams = new Set();
  const stopStreams = () => { for (const c of streams) c.abort(); streams.clear(); };
  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host = req.headers.host;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const json = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (
      !allowedHosts.includes(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    )
      return json(403, { error: "Open the companion directly on localhost." });
    try {
      const url = new URL(req.url, `http://${host}`);
      const upstream = async (
        route,
        method = "GET",
        body = undefined,
        pair = pairing,
        signal = undefined,
      ) => {
        if (!pair) {
          const e = new Error("Connect your phone first.");
          e.status = 409;
          throw e;
        }
        const response = await (pair.fetch || fetch)(`${pair.address}${route}`, {
          method,
          headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: signal || AbortSignal.timeout(6000),
          redirect: "error",
        });
        if (!response.ok) {
          const text = await response.text();
          let message;
          try {
            message = JSON.parse(text).error;
          } catch {
            message = "Phone returned an error.";
          }
          const e = new Error(message || `Phone returned ${response.status}.`);
          e.status = response.status;
          throw e;
        }
        return response;
      };
      if (url.pathname === "/api/status" && req.method === "GET")
        return json(200, {
          paired: !!pairing,
          address: pairing?.address,
          transport: pairing?.transport,
          version: "0.8.0",
        });
      if (url.pathname === "/api/pair" && req.method === "POST") {
        const input = await readJson(req);
        if (input.transport && !["lan", "usb"].includes(input.transport)) throw new Error("Choose Wi-Fi or USB.");
        const generation = ++pairGeneration;
        const candidate = input.transport === "usb"
          ? await usbConnect()
          : { address: phoneAddress(input.address), transport: "lan" };
        try {
          const response = await upstream("/api/live", "GET", undefined, candidate);
          const state = await response.json();
          if (state.protocol !== 2 || typeof state.version !== "string")
            throw new Error("Update the phone to Klobflow 0.5.0 or newer.");
          if (generation !== pairGeneration) throw new Error("Connection was canceled.");
          stopStreams();
          await pairing?.close?.();
          pairing = candidate;
          return json(200, { ok: true, address: candidate.address, transport: candidate.transport });
        } catch (e) { await candidate.close?.(); throw e; }
      }
      if (url.pathname === "/api/disconnect" && req.method === "POST") {
        await readJson(req);
        pairGeneration++;
        stopStreams();
        const previous = pairing;
        pairing = null;
        await previous?.close?.();
        return json(200, { ok: true });
      }
      if (url.pathname === "/api/control" && req.method === "POST") {
        const body = await readJson(req);
        if (
          !["config", "reset", "seed", "calibrate", "record", "stop", "fit", "syncBeat", "audioStart", "audioStop", "audioTempo", "background"].includes(body.action)
        )
          throw new Error("Unknown control.");
        return json(
          200,
          await (await upstream("/api/control", "POST", body)).json(),
        );
      }
      if (
        ["/api/live", "/api/sessions", "/api/clock"].includes(url.pathname) &&
        req.method === "GET"
      )
        return json(200, await (await upstream(url.pathname)).json());
      if (url.pathname === "/api/stream" && req.method === "GET") {
        const controller = new AbortController();
        streams.add(controller);
        res.on("close", () => { controller.abort(); streams.delete(controller); });
        const pair = pairing;
        await pair?.refresh?.();
        const response = await upstream("/api/stream", "GET", undefined, pair, controller.signal);
        if (!response.headers.get("content-type")?.startsWith("application/x-klobflow-stream")) {
          controller.abort(); throw new Error("Update Klobflow on the phone to enable streaming.");
        }
        req.socket.setNoDelay(true);
        res.writeHead(200, { "Content-Type": "application/x-klobflow-stream", "X-Accel-Buffering": "no" });
        res.flushHeaders();
        await pipeline(Readable.fromWeb(response.body), res, { signal: controller.signal });
        return;
      }
      if (url.pathname === "/api/session" && req.method === "GET") {
        const id = url.searchParams.get("id");
        if (!/^klobflow-\d{13}$/.test(id ?? ""))
          throw new Error("Invalid session.");
        const response = await upstream(`/api/session?id=${id}`);
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": `attachment; filename="${id}.jsonl"`,
        });
        for await (const chunk of response.body)
          if (!res.write(chunk))
            await new Promise((resolve) => res.once("drain", resolve));
        return res.end();
      }
      const assets = {
        "/": ["index.html", "text/html"],
        "/app.mjs": ["app.mjs", "text/javascript"],
        "/style.css": ["style.css", "text/css"],
        "/demo.mjs": ["demo.mjs", "text/javascript"],
        "/stream.mjs": ["stream.mjs", "text/javascript"],
        "/core.mjs": ["core.mjs", "text/javascript"],
        "/feedback.mjs": ["feedback.mjs", "text/javascript"],
        "/streak.mjs": ["streak.mjs", "text/javascript"],
        "/rolling-errors.mjs": ["rolling-errors.mjs", "text/javascript"],
        "/background.mjs": ["background.mjs", "text/javascript"],
        "/staff-colors.mjs": ["staff-colors.mjs", "text/javascript"],
        "/practice.mjs": ["practice.mjs", "text/javascript"],
        "/system-audio.mjs": ["system-audio.mjs", "text/javascript"],
        "/tempo-core.mjs": ["tempo-core.mjs", "text/javascript"],
        "/tempo-worker.mjs": ["tempo-worker.mjs", "text/javascript"],
        "/audio-worklet.mjs": ["audio-worklet.mjs", "text/javascript"],
        "/practice-guides.json": ["practice-guides.json", "application/json"],
        "/camera.mjs": ["camera.mjs", "text/javascript"],
        "/tracker-worker.mjs": ["tracker-worker.mjs", "text/javascript"],
        "/browser-camera.mjs": ["browser-camera.mjs", "text/javascript"],
        "/sessions.mjs": ["sessions.mjs", "text/javascript"],

      };
      if (req.method === "GET" && assets[url.pathname]) {
        const [file, mime] = assets[url.pathname];
        const content = await readFile(path.join(root, file));
        res.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` });
        return res.end(content);
      }
      return json(404, { error: "Not found." });
    } catch (e) {
      if (res.headersSent) return res.destroy();
      const connectionError =
        e.name === "TimeoutError" || e.message === "fetch failed";
      return json(e.status ?? (connectionError ? 502 : 400), {
        error: connectionError
          ? "Cannot reach the phone. Check the USB cable or Wi-Fi, enable PC sharing, and reopen Klobflow."
          : e.message,
      });
    }
  });
  server.on("close", () => { stopStreams(); pairing?.close?.(); });
  return server;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.KLOBFLOW_PORT || 8788);
  const server = createCompanion();
  server.listen(port, "127.0.0.1", () =>
    process.stdout.write(`Klobflow companion: http://localhost:${port}\n`),
  );
  server.on("error", (e) => {
    process.stderr.write(`Cannot start companion: ${e.message}\n`);
    process.exitCode = 1;
  });
}
