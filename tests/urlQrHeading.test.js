import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  composeQrHeadingPng,
  QR_HEADING_MAX_LENGTH,
  wrapQrHeading,
} from '../src/utils/qrHeadingImage.js';

function fakeContext() {
  return {
    draws: [],
    fills: [],
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    measureText: (text) => ({ width: text.length * 10 }),
    fillRect() {},
    fillText(text, x, y) { this.fills.push({ text, x, y }); },
    drawImage(image, x, y, width, height) { this.draws.push({ image, x, y, width, height }); },
  };
}

function compositionHarness() {
  const context = fakeContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => `data:image/png;base64,combined-${canvas.width}x${canvas.height}`,
  };
  class FakeImage {
    naturalWidth = 512;
    naturalHeight = 512;
    set src(value) {
      this.source = value;
      queueMicrotask(() => this.onload());
    }
  }
  return {
    context,
    canvas,
    options: {
      documentRef: { createElement: () => canvas },
      ImageConstructor: FakeImage,
    },
  };
}

test('blank heading preserves the existing branded QR PNG exactly', async () => {
  const source = 'data:image/png;base64,existing-branded-qr';
  assert.equal(await composeQrHeadingPng(source, '   '), source);
});

test('short heading is centered above the intact QR with white spacing', async () => {
  const harness = compositionHarness();
  const output = await composeQrHeadingPng(
    'data:image/png;base64,existing-branded-qr',
    'Scan here to share your feedback',
    harness.options,
  );

  assert.match(output, /^data:image\/png;base64,combined-512x/);
  assert.equal(harness.context.fills.length, 1);
  assert.equal(harness.context.fills[0].x, 256);
  assert.equal(harness.context.textAlign, 'center');
  assert.equal(harness.context.draws.length, 1);
  assert.ok(harness.context.draws[0].y > harness.context.fills[0].y);
  assert.deepEqual(
    { x: harness.context.draws[0].x, width: harness.context.draws[0].width, height: harness.context.draws[0].height },
    { x: 0, width: 512, height: 512 },
  );
});

test('long headings wrap before the QR and support numbers and punctuation', async () => {
  const harness = compositionHarness();
  const heading = 'Ward 12: Scan here to share feedback — quick, secure & available 24/7. Thank you for helping QPMS improve!';
  await composeQrHeadingPng('data:image/png;base64,qr', heading, harness.options);

  assert.ok(harness.context.fills.length > 1);
  assert.equal(harness.context.fills.map(({ text }) => text).join(' '), heading);
  const lastHeadingBottom = harness.context.fills.at(-1).y + 24;
  assert.ok(harness.context.draws[0].y > lastHeadingBottom);
  assert.ok(harness.canvas.height > 512);
});

test('wrapping constrains unbroken text and the heading limit is 120 characters', () => {
  const context = fakeContext();
  const lines = wrapQrHeading(context, 'A'.repeat(150), 100);
  assert.equal(QR_HEADING_MAX_LENGTH, 120);
  assert.equal(lines.join('').length, 120);
  assert.ok(lines.every((line) => context.measureText(line).width <= 100));
});

test('URL QR UI keeps URL-only API encoding and one composed image for preview and download', () => {
  const page = readFileSync(new URL('../src/pages/HospitalFeedbackQrGenerator.jsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8');

  assert.match(page, /QR Heading \/ Display Text/);
  assert.match(page, /maxLength=\{QR_HEADING_MAX_LENGTH\}/);
  assert.match(page, /generateUrlQr\(urlInput\)/);
  assert.match(page, /composeQrHeadingPng\(generated\.qr_png_data_url, headingInput\)/);
  assert.match(page, /src=\{result\.qr_png_data_url\}/);
  assert.match(page, /link\.href = result\.qr_png_data_url/);
  assert.match(page, /navigator\.clipboard\.writeText\(result\.url\)/);
  assert.match(api, /data: \{ url \}/);
  assert.doesNotMatch(api, /data: \{ url, heading/);
});
