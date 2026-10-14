// Each packet contains two big-endian uint32 lengths, UTF-8 JSON, then JPEG.
// Zero-length packets are heartbeats. Parsing accepts arbitrary HTTP chunk boundaries.
export class FrameDecoder {
  constructor() { this.pending = new Uint8Array(0); }
  push(chunk) {
    const bytes = new Uint8Array(this.pending.length + chunk.length);
    bytes.set(this.pending); bytes.set(chunk, this.pending.length);
    let offset = 0;
    const frames = [];
    while (bytes.length - offset >= 8) {
      const header = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
      const jsonLength = header.getUint32(0), imageLength = header.getUint32(4);
      if (jsonLength > 131072 || imageLength > 4 * 1024 * 1024 || (!jsonLength !== !imageLength))
        throw new Error("Invalid video packet. Update the phone and companion together.");
      const size = 8 + jsonLength + imageLength;
      if (bytes.length - offset < size) break;
      if (jsonLength) frames.push({
        frame: JSON.parse(new TextDecoder().decode(bytes.subarray(offset + 8, offset + 8 + jsonLength))),
        jpeg: bytes.slice(offset + 8 + jsonLength, offset + size),
      });
      offset += size;
    }
    this.pending = bytes.slice(offset);
    return frames;
  }
}
