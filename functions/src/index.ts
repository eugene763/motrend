/* eslint-disable require-jsdoc */

const INITIAL_CREDITS = 20;

interface UserDoc {
  creditsBalance?: number;
}

function effectiveCreditsBalance(userData?: UserDoc): number {
  return (
    typeof userData?.creditsBalance === "number" &&
    Number.isFinite(userData.creditsBalance)
  ) ? userData.creditsBalance : INITIAL_CREDITS;
}

function isLikelyJpegBuffer(buffer: Buffer): boolean {
  return buffer.length >= 3 &&
    buffer[0] === 0xFF &&
    buffer[1] === 0xD8 &&
    buffer[2] === 0xFF;
}

function readUInt64BEAsNumber(buffer: Buffer, offset: number): number {
  const high = buffer.readUInt32BE(offset);
  const low = buffer.readUInt32BE(offset + 4);
  return high * 2 ** 32 + low;
}

function readIsoBox(
  buffer: Buffer,
  offset: number,
  limit = buffer.length
): {
  type: string;
  size: number;
  headerSize: number;
  start: number;
  end: number;
  contentStart: number;
} | null {
  if (offset < 0 || offset + 8 > limit) return null;

  let size = buffer.readUInt32BE(offset);
  const type = buffer.toString("ascii", offset + 4, offset + 8);
  let headerSize = 8;

  if (size === 1) {
    if (offset + 16 > limit) return null;
    size = readUInt64BEAsNumber(buffer, offset + 8);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }

  if (type === "uuid") {
    if (offset + headerSize + 16 > limit) return null;
    headerSize += 16;
  }

  if (!Number.isFinite(size) || size < headerSize) return null;
  const end = offset + size;
  if (end > limit) return null;

  return {
    type,
    size,
    headerSize,
    start: offset,
    end,
    contentStart: offset + headerSize,
  };
}

function isLikelyIsoBmffVideoBuffer(buffer: Buffer): boolean {
  const box = readIsoBox(buffer, 0, buffer.length);
  if (!box || box.type !== "ftyp") return false;
  if (box.contentStart + 8 > box.end) return false;

  const brands: string[] = [];
  brands.push(buffer.toString("ascii", box.contentStart, box.contentStart + 4));
  for (let offset = box.contentStart + 8; offset + 4 <= box.end; offset += 4) {
    brands.push(buffer.toString("ascii", offset, offset + 4));
  }

  return brands.some((brand) => {
    return [
      "qt  ",
      "isom",
      "iso2",
      "avc1",
      "mp41",
      "mp42",
      "M4V ",
      "MSNV",
    ].includes(brand);
  });
}

function buildProbeRanges(totalBytes: number, windowBytes: number): Array<{
  start: number;
  end: number;
}> {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return [];
  if (totalBytes <= windowBytes * 2) {
    return [{start: 0, end: Math.max(0, totalBytes - 1)}];
  }

  const headEnd = Math.max(0, Math.min(totalBytes - 1, windowBytes - 1));
  const tailStart = Math.max(0, totalBytes - windowBytes);
  const ranges = [{start: 0, end: headEnd}];
  if (tailStart > headEnd) {
    ranges.push({start: tailStart, end: totalBytes - 1});
  }
  return ranges;
}

function parseMvhdDurationSeconds(
  buffer: Buffer,
  boxStart: number,
  boxEnd: number
): number | null {
  const box = readIsoBox(buffer, boxStart, boxEnd);
  if (!box || box.type !== "mvhd") return null;

  const versionOffset = box.contentStart;
  if (versionOffset + 4 > box.end) return null;

  const version = buffer.readUInt8(versionOffset);
  if (version === 0) {
    const timescaleOffset = versionOffset + 12;
    const durationOffset = versionOffset + 16;
    if (durationOffset + 4 > box.end) return null;
    const timescale = buffer.readUInt32BE(timescaleOffset);
    const duration = buffer.readUInt32BE(durationOffset);
    if (!timescale || !Number.isFinite(duration)) return null;
    return duration / timescale;
  }

  if (version === 1) {
    const timescaleOffset = versionOffset + 20;
    const durationOffset = versionOffset + 24;
    if (durationOffset + 8 > box.end) return null;
    const timescale = buffer.readUInt32BE(timescaleOffset);
    const duration = readUInt64BEAsNumber(buffer, durationOffset);
    if (!timescale || !Number.isFinite(duration)) return null;
    return duration / timescale;
  }

  return null;
}

function parseIsoBmffDurationSeconds(buffer: Buffer): number | null {
  for (let offset = 0; offset < buffer.length;) {
    const box = readIsoBox(buffer, offset, buffer.length);
    if (!box) break;

    if (box.type === "moov") {
      for (let innerOffset = box.contentStart; innerOffset < box.end;) {
        const innerBox = readIsoBox(buffer, innerOffset, box.end);
        if (!innerBox) break;
        if (innerBox.type === "mvhd") {
          return parseMvhdDurationSeconds(buffer, innerOffset, box.end);
        }
        innerOffset = innerBox.end;
      }
    }

    offset = box.end;
  }

  return null;
}

export const __test = {
  INITIAL_CREDITS,
  effectiveCreditsBalance,
  buildProbeRanges,
  isLikelyJpegBuffer,
  isLikelyIsoBmffVideoBuffer,
  parseIsoBmffDurationSeconds,
};
