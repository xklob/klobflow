import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createCompanion, phoneAddress } from "../server.mjs";
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    ),
  );
const post = (url, body, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
test("LAN address parser rejects public, credentials, rebinding and ambiguous forms", () => {
  assert.equal(phoneAddress("192.168.12.40"), "http://192.168.12.40:8787");
  assert.equal(phoneAddress("172.16.2.5:8787"), "http://172.16.2.5:8787");
  for (const bad of [
    "example.com",
    "8.8.8.8",
    "169.254.169.254",
    "192.168.0.999",
    "127.1",
    "0177.0.0.1",
    "192.168.1.2:0",
    "192.168.1.2:70000",
    "http://192.168.1.2",
    "user@192.168.1.2",
    "192.168.1.2/secret",
  ])
    assert.throws(() => phoneAddress(bad));
});
test("code-free connection, phone controls, session downloads and disconnect", async (t) => {
  let controls = [];
  const phone = http.createServer(async (req, res) => {
    assert.equal(req.headers["x-klobflow-token"], undefined);
    if (req.url === "/api/live")
      res.end(
        JSON.stringify({
          version: "0.2.0",
          protocol: 2,
          source: "camera",
          metrics: { deviation: 2 },
        }),
      );
    else if (req.url === "/api/clock") res.end(JSON.stringify({time:123456}));
    else if (req.url === "/api/control") {
      let body = "";
      for await (const c of req) body += c;
      controls.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/api/session?"))
      res.end('{"type":"header","schema":1}\n');
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  const phoneUrl = await listen(phone),
    server = createCompanion(),
    url = await listen(server);
  t.after(() => {
    server.closeAllConnections();
    phone.closeAllConnections();
    server.close();
    phone.close();
  });
  assert.equal((await fetch(url + "/api/live")).status, 409);
  assert.equal(
    (
      await post(url + "/api/pair", {
        address: phoneUrl.replace("http://", ""),
      })
    ).status,
    200,
  );
  assert.equal((await (await fetch(url + "/api/status")).json()).paired, true);
  const status = await (await fetch(url + "/api/status")).text();
  assert.ok(!status.includes("0123456789abcdef"));
  const frame = await (await fetch(url + "/api/live")).json();
  assert.equal(frame.metrics.deviation, 2);
  assert.equal(
    (
      await post(url + "/api/control", {
        action: "config",
        config: { mode: "cube" },
      })
    ).status,
    200,
  );
  assert.deepEqual(controls, [{ action: "config", config: { mode: "cube" } }]);
  assert.deepEqual(await (await fetch(url+"/api/clock")).json(),{time:123456});
  for(const action of ["fit","syncBeat","audioStart","audioStop"]){assert.equal((await post(url+"/api/control",{action})).status,200);assert.equal(controls.at(-1).action,action);}
  for(const mode of ["capture","cancel","clear"]){const command={action:"background",mode};assert.equal((await post(url+"/api/control",command)).status,200);assert.deepEqual(controls.at(-1),command);}
  const tempo={action:"audioTempo",bpm:120,origin:123400,confidence:.9,ageMs:25,running:true};
  assert.equal((await post(url+"/api/control",tempo)).status,200);assert.deepEqual(controls.at(-1),tempo);
  assert.equal(
    (await fetch(url + "/api/session?id=klobflow-1780000000000")).status,
    200,
  );
  assert.equal((await fetch(url + "/api/session?id=../../other")).status, 400);
  assert.equal((await post(url + "/api/disconnect", {})).status, 200);
  assert.equal((await fetch(url + "/api/live")).status, 409);
});
test("local app rejects hostile origin, host, non-JSON and oversized control bodies", async (t) => {
  const server = createCompanion(),
    url = await listen(server);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  assert.equal(
    (
      await post(
        url + "/api/disconnect",
        {},
        { Origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    await new Promise((resolve) =>
      http.get(
        url + "/api/status",
        { headers: { Host: "attacker.example" } },
        (r) => {
          r.resume();
          resolve(r.statusCode);
        },
      ),
    ),
    403,
  );
  assert.equal(
    (await fetch(url + "/api/disconnect", { method: "POST", body: "{}" }))
      .status,
    400,
  );
  assert.equal(
    (await post(url + "/api/pair", { padding: "a".repeat(9000) })).status,
    400,
  );
  assert.equal((await fetch(url + "/server.mjs")).status, 404);
  assert.equal((await fetch(url + "/")).status, 200);
});
test("upstream redirect is never followed", async (t) => {
  let reached = false;
  const target = http.createServer((req, res) => {
    reached = true;
    res.end("{}");
  });
  const targetUrl = await listen(target);
  const phone = http.createServer((req, res) => {
    res.writeHead(302, { Location: targetUrl });
    res.end();
  });
  const phoneUrl = await listen(phone),
    server = createCompanion(),
    url = await listen(server);
  t.after(() => {
    for (const s of [target, phone, server]) {
      s.closeAllConnections();
      s.close();
    }
  });
  assert.equal(
    (
      await post(url + "/api/pair", {
        address: phoneUrl.replace("http://", ""),
      })
    ).status,
    502,
  );
  assert.equal(reached, false);
});

test("USB selection relays binary streaming and closes its own tunnel on disconnect", async (t) => {
  let closed = 0, refreshed = 0;
  const payload = Buffer.from([0, 0, 0, 2, 0, 0, 0, 4, 123, 125, 255, 216, 255, 217]);
  const phone = http.createServer((req, res) => {
    if (req.url === "/api/live") res.end(JSON.stringify({ version: "0.2.0", protocol: 2 }));
    else if (req.url === "/api/stream") {
      res.writeHead(200, { "Content-Type": "application/x-klobflow-stream" });
      res.write(payload.subarray(0, 5)); res.end(payload.subarray(5));
    } else res.end("{}");
  });
  const address = await listen(phone);
  const server = createCompanion({ usbConnect: async () => ({
    address, transport: "usb", fetch,
    refresh: async () => { refreshed++; }, close: async () => { closed++; },
  }) });
  const url = await listen(server);
  t.after(() => { server.closeAllConnections(); phone.closeAllConnections(); server.close(); phone.close(); });
  assert.equal((await post(url + "/api/pair", { transport: "usb" })).status, 200);
  assert.equal((await (await fetch(url + "/api/status")).json()).transport, "usb");
  assert.deepEqual(Buffer.from(await (await fetch(url + "/api/stream")).arrayBuffer()), payload);
  assert.equal(refreshed, 1);
  await post(url + "/api/disconnect", {});
  assert.equal(closed, 1);
});
