import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameDecoder } from "../public/stream.mjs";

export function packet(frame, jpeg = Buffer.from([255, 216, 255, 217])) {
  const json = Buffer.from(JSON.stringify(frame)), header = Buffer.alloc(8);
  header.writeUInt32BE(json.length, 0); header.writeUInt32BE(jpeg.length, 4);
  return Buffer.concat([header, json, jpeg]);
}
test("binary frames survive fragmented headers, JPEGs, heartbeats and batches", () => {
  const bytes = Buffer.concat([Buffer.alloc(8), packet({ time: 1 }), packet({ time: 2 })]);
  for (const chunkSize of [1, 3, 8, 19, bytes.length]) {
    const decoder = new FrameDecoder(), result = [];
    for (let i = 0; i < bytes.length; i += chunkSize) result.push(...decoder.push(bytes.subarray(i, i + chunkSize)));
    assert.deepEqual(result.map(x => x.frame.time), [1, 2]);
    assert.deepEqual([...result[0].jpeg], [255, 216, 255, 217]);
    assert.equal(decoder.pending.length, 0);
  }
});
test("decoder rejects oversized or inconsistent packet lengths", () => {
  for (const [json, jpeg] of [[9999999, 1], [1, 99999999], [0, 1], [1, 0]]) {
    const header = Buffer.alloc(8); header.writeUInt32BE(json); header.writeUInt32BE(jpeg, 4);
    assert.throws(() => new FrameDecoder().push(header), /Invalid video/);
  }
});
