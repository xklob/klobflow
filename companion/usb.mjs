import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import { PassThrough, Readable } from "node:stream";
import path from "node:path";

const exec = promisify(execFile);
const powershell = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const windowsCurl = "/mnt/c/Windows/System32/curl.exe";

// Windows owns the USB device on a WSL host. curl's binary stdout is a local
// pipe into WSL, so the forwarded camera port never needs a LAN listener.
export function windowsFetch(url, options = {}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url))
    throw new Error("The Windows USB bridge only accepts loopback URLs.");
  return new Promise((resolve, reject) => {
    const args = ["--silent", "--show-error", "--no-buffer", "--include", "--noproxy", "*", "--connect-timeout", "5", "--request", options.method || "GET"];
    if (options.body) args.push("--header", "Content-Type: application/json", "--data-binary", "@-");
    args.push(url);
    const child = spawn(windowsCurl, args, { stdio: ["pipe", "pipe", "pipe"] });
    let header = Buffer.alloc(0), parsed = false, stderr = "";
    const body = new PassThrough({ highWaterMark: 65536 });
    body.on("error", () => {});
    const abort = () => { child.kill(); body.destroy(new Error("USB request canceled")); reject(new Error("USB request canceled")); };
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (e) => { reject(e); body.destroy(e); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2048); });
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (code !== 0) { const e = new Error("USB connection interrupted. " + stderr.trim()); reject(e); body.destroy(e); }
      else if (!parsed) reject(new Error("No response from the phone over USB."));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.body);
    const onHeader = (chunk) => {
      header = Buffer.concat([header, chunk]);
      const end = header.indexOf("\r\n\r\n");
      if (end < 0) {
        if (header.length > 32768) { child.kill(); reject(new Error("Invalid USB response headers.")); }
        return;
      }
      parsed = true;
      child.stdout.removeListener("data", onHeader);
      child.stdout.pause();
      const lines = header.subarray(0, end).toString().split("\r\n");
      const status = Number(lines.shift().split(" ")[1]);
      if (status < 200 || status > 599) { child.kill(); reject(new Error("Invalid USB response.")); return; }
      const headers = new Headers();
      for (const line of lines) {
        const colon = line.indexOf(":");
        if (colon > 0) headers.set(line.slice(0, colon), line.slice(colon + 1).trim());
      }
      // curl has already decoded HTTP transfer framing.
      headers.delete("transfer-encoding");
      body.write(header.subarray(end + 4));
      child.stdout.pipe(body);
      body.on("close", () => child.kill());
      resolve(new Response(Readable.toWeb(body), { status, headers }));
    };
    child.stdout.on("data", onHeader);
  });
}

export async function findAdb() {
  if (process.env.KLOBFLOW_ADB) return process.env.KLOBFLOW_ADB;
  const wsl = process.platform === "linux" && /microsoft/i.test(await readFile("/proc/version", "utf8").catch(() => ""));
  if (wsl) {
    const { stdout } = await exec(powershell, ["-NoProfile", "-Command", "$a=(Get-Command adb.exe -ErrorAction SilentlyContinue).Source; if (!$a) {$a=Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'}; Write-Output $a"], { timeout: 10000 });
    const { stdout: linuxPath } = await exec("wslpath", ["-u", stdout.trim()]);
    await access(linuxPath.trim());
    return linuxPath.trim();
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  return sdk ? path.join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : "adb";
}

export async function connectUsb() {
  let adb;
  try { adb = await findAdb(); }
  catch { throw new Error("Install Android platform-tools, or set KLOBFLOW_ADB to adb. Enable USB debugging and allow this PC on the phone."); }
  const run = async (args) => {
    try { return (await exec(adb, args, { timeout: 10000, windowsHide: true })).stdout.trim(); }
    catch { throw new Error("Connect one Android phone by USB, enable USB debugging, and allow this computer on the phone."); }
  };
  const serial = await run(["-d", "get-serialno"]);
  const port = await run(["-s", serial, "forward", "tcp:0", "tcp:8787"]);
  if (!/^\d+$/.test(port)) throw new Error("Could not open a USB camera tunnel.");
  const bridge = process.platform !== "win32" && adb.toLowerCase().endsWith(".exe");
  return {
    address: `http://127.0.0.1:${port}`, transport: "usb", label: "USB cable",
    fetch: bridge ? windowsFetch : fetch,
    refresh: () => run(["-s", serial, "forward", `tcp:${port}`, "tcp:8787"]),
    close: () => run(["-s", serial, "forward", "--remove", `tcp:${port}`]).catch(() => {}),
  };
}
