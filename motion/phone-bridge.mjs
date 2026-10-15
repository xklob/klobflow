// Reuse only the shipped, tested camera transport. The old tracker never runs
// in this process and its detections are not consumed by the new engine.
import { connectUsb } from '../companion/usb.mjs';
import { phoneAddress } from '../companion/server.mjs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

let connection;
const abort = new AbortController();
process.on('SIGTERM', () => abort.abort());
process.on('SIGINT', () => abort.abort());
try {
  connection = process.argv[2] === 'usb'
    ? await connectUsb()
    : { address: phoneAddress(process.argv[3]), fetch };
  const response = await connection.fetch(`${connection.address}/api/stream`, {
    signal: abort.signal, redirect: 'error',
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/x-klobflow-stream'))
    throw Error('Enable camera sharing in Klobflow on the phone, then reconnect.');
  await pipeline(Readable.fromWeb(response.body), process.stdout, { signal: abort.signal });
} catch (error) {
  if (!abort.signal.aborted) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
} finally {
  await connection?.close?.();
}
