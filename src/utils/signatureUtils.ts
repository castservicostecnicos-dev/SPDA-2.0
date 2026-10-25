/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DigitalSignatureData } from '../types/spda';

const STORED_SIGNATURE_KEY = 'spda_stored_engineer_signature_v1';

/**
 * Gera um hash criptográfico determinístico e formatado para validação do laudo pericial
 */
export function generateSignatureHash(
  name: string,
  crea: string,
  art: string = '',
  timestamp: string = ''
): string {
  const seed = `${name.trim().toUpperCase()}|${crea.trim().toUpperCase()}|${art.trim()}|${timestamp}|NBR5419:2026`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0').toUpperCase();
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0').toUpperCase();

  return `SPDA-${hex1.slice(0, 4)}-${hex2.slice(0, 4)}-${hex1.slice(4)}-${hex2.slice(4)}`;
}

/**
 * Salva a assinatura padrão do engenheiro no armazenamento local para reaproveitamento
 */
export function saveStoredSignature(sig: DigitalSignatureData): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORED_SIGNATURE_KEY, JSON.stringify(sig));
    }
  } catch (err) {
    console.warn('Erro ao salvar assinatura padrão no navegador:', err);
  }
}

/**
 * Recupera a assinatura padrão do engenheiro salva no navegador
 */
export function loadStoredSignature(): DigitalSignatureData | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORED_SIGNATURE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (err) {
    console.warn('Erro ao carregar assinatura padrão:', err);
  }
  return null;
}

/**
 * Remove o fundo branco ou claro de uma imagem digitalizada/fotografada de assinatura
 * e intensifica o contraste do traço para um acabamento nítido e profissional.
 */
export async function cleanSignatureImage(
  dataUrl: string,
  threshold = 215,
  boostContrast = true
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;

          // Se for fundo branco/claro, torna transparente
          if (brightness >= threshold) {
            data[i + 3] = 0; // Alpha = 0
          } else {
            if (boostContrast) {
              // Intensifica os tons escuros de tinta
              const factor = brightness / threshold;
              data[i] = Math.max(0, Math.floor(r * factor * 0.8));
              data[i + 1] = Math.max(0, Math.floor(g * factor * 0.8));
              data[i + 2] = Math.max(0, Math.floor(b * factor * 0.8));
              data[i + 3] = 255;
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);
        // Trima o espaço transparente ao redor
        const trimmed = trimCanvas(canvas);
        resolve(trimmed.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };

    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Recorta as bordas transparentes ao redor da assinatura para mantê-la centralizada e proeminente
 */
export function trimCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const width = canvas.width;
  const height = canvas.height;
  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Se nada foi desenhado
  if (minX > maxX || minY > maxY) {
    return canvas;
  }

  // Adiciona pequena margem de respiro
  const padding = 12;
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - minX + padding * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + padding * 2);

  const trimmedCanvas = document.createElement('canvas');
  trimmedCanvas.width = cropWidth;
  trimmedCanvas.height = cropHeight;

  const trimmedCtx = trimmedCanvas.getContext('2d');
  if (trimmedCtx) {
    trimmedCtx.drawImage(
      canvas,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );
  }

  return trimmedCanvas;
}
