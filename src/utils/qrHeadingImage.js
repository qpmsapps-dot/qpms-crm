export const QR_HEADING_MAX_LENGTH = 120;

const HEADING_FONT_FAMILY = 'Inter, "Segoe UI", Arial, sans-serif';

function splitLongWord(context, word, maxWidth) {
  const parts = [];
  let part = '';

  for (const character of word) {
    const candidate = `${part}${character}`;
    if (part && context.measureText(candidate).width > maxWidth) {
      parts.push(part);
      part = character;
    } else {
      part = candidate;
    }
  }

  if (part) parts.push(part);
  return parts;
}

export function wrapQrHeading(context, value, maxWidth) {
  const text = String(value || '').trim().slice(0, QR_HEADING_MAX_LENGTH);
  if (!text) return [];

  const lines = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    let line = '';
    for (const word of words) {
      const parts = context.measureText(word).width > maxWidth
        ? splitLongWord(context, word, maxWidth)
        : [word];

      for (const part of parts) {
        const candidate = line ? `${line} ${part}` : part;
        if (line && context.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = part;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
  }

  return lines;
}

function loadCanvasImage(source, ImageConstructor) {
  return new Promise((resolve, reject) => {
    const image = new ImageConstructor();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to prepare the QR preview image.'));
    image.src = source;
  });
}

export async function composeQrHeadingPng(qrPngDataUrl, heading, {
  documentRef = globalThis.document,
  ImageConstructor = globalThis.Image,
} = {}) {
  const normalizedHeading = String(heading || '').trim().slice(0, QR_HEADING_MAX_LENGTH);
  if (!normalizedHeading) return qrPngDataUrl;
  if (!documentRef || !ImageConstructor) throw new Error('QR image composition is unavailable.');

  const qrImage = await loadCanvasImage(qrPngDataUrl, ImageConstructor);
  const qrWidth = qrImage.naturalWidth || qrImage.width;
  const qrHeight = qrImage.naturalHeight || qrImage.height;
  const canvas = documentRef.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || !qrWidth || !qrHeight) throw new Error('Unable to prepare the QR preview canvas.');

  const fontSize = Math.max(20, Math.min(24, Math.round(qrWidth * 0.043)));
  const lineHeight = Math.round(fontSize * 1.35);
  const horizontalPadding = Math.max(24, Math.round(qrWidth * 0.08));
  const topPadding = Math.max(24, Math.round(qrWidth * 0.055));
  const headingGap = Math.max(22, Math.round(qrWidth * 0.05));

  context.font = `600 ${fontSize}px ${HEADING_FONT_FAMILY}`;
  const lines = wrapQrHeading(context, normalizedHeading, qrWidth - (horizontalPadding * 2));
  const headingHeight = lines.length * lineHeight;
  const qrTop = topPadding + headingHeight + headingGap;

  canvas.width = qrWidth;
  canvas.height = qrTop + qrHeight;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#0f172a';
  context.font = `600 ${fontSize}px ${HEADING_FONT_FAMILY}`;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  lines.forEach((line, index) => {
    context.fillText(line, canvas.width / 2, topPadding + (index * lineHeight));
  });
  context.drawImage(qrImage, 0, qrTop, qrWidth, qrHeight);

  return canvas.toDataURL('image/png');
}
