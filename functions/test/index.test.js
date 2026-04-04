const test = require("node:test");
const assert = require("node:assert/strict");

const {__test} = require("../lib/index.js");

test("buildProbeRanges returns one range for small files", () => {
  assert.deepEqual(__test.buildProbeRanges(1024, 2048), [
    {start: 0, end: 1023},
  ]);
});

test("buildProbeRanges returns head and tail ranges for larger files", () => {
  assert.deepEqual(__test.buildProbeRanges(10_000, 2_000), [
    {start: 0, end: 1_999},
    {start: 8_000, end: 9_999},
  ]);
});

test("isLikelyJpegBuffer detects jpeg header", () => {
  const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
  assert.equal(__test.isLikelyJpegBuffer(jpegHeader), true);
  assert.equal(__test.isLikelyJpegBuffer(pngHeader), false);
});

test("isLikelyIsoBmffVideoBuffer detects mp4/mov signatures", () => {
  const ftypMp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftyp", "ascii"),
    Buffer.from("isom", "ascii"),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from("isom", "ascii"),
    Buffer.from("mp41", "ascii"),
  ]);
  const notVideo = Buffer.from("not-a-video");

  assert.equal(__test.isLikelyIsoBmffVideoBuffer(ftypMp4), true);
  assert.equal(__test.isLikelyIsoBmffVideoBuffer(notVideo), false);
});
