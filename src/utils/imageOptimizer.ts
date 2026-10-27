/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Otimiza e comprime imagens capturadas e enviadas pelo usuário para uso no laudo e PDF.
 * Reduz fotos pesadas de celulares (10MB-30MB de câmeras modernas 48MP) para dimensões
 * e bytes rigorosamente controlados em JPEG de alta definição.
 * 
 * Implementa descarte e limpeza explícita de memória (GPU/RAM Canvas and Image elements)
 * para eliminar travamentos, vazamento de memória (OOM killer) e fechamento forçado
 * do Google Chrome no Android e celulares.
 */

export interface OptimizedImageResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/**
 * Limpa explicitamente buffers de memória alocados por elementos Canvas no navegador
 */
export function disposeCanvas(canvas?: HTMLCanvasElement | null) {
  if (!canvas) return;
  try {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // ignore
  }
}

export async function optimizeImageFileToBlob(
  source: File | Blob | string,
  maxWidth = 1280,
  maxHeight = 1280,
  quality = 0.82
): Promise<OptimizedImageResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let reader: FileReader | null = null;

    const cleanup = () => {
      try {
        img.onload = null;
        img.onerror = null;
        img.src = '';
        if (reader) {
          reader.onload = null;
          reader.onerror = null;
          reader = null;
        }
      } catch {
        // ignore
      }
    };

    const processLoadedImage = () => {
      let width = img.naturalWidth || img.width || 800;
      let height = img.naturalHeight || img.height || 600;

      // Mantém proporção nativa estrita limitando às dimensões máximas
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      if (!ctx) {
        cleanup();
        disposeCanvas(canvas);
        reject(new Error('Falha ao instanciar canvas 2D para otimização de foto'));
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // Converte para dataUrl e Blob com liberação de memória
      canvas.toBlob(
        (blob) => {
          try {
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            const finalBlob = blob || new Blob([], { type: 'image/jpeg' });
            const sizeBytes = blob ? blob.size : dataUrl.length;

            // Libera imediatamente a memória GPU alocada pelo canvas
            disposeCanvas(canvas);
            cleanup();

            resolve({
              blob: finalBlob,
              dataUrl,
              width,
              height,
              sizeBytes,
            });
          } catch (e) {
            disposeCanvas(canvas);
            cleanup();
            reject(e);
          }
        },
        'image/jpeg',
        quality
      );
    };

    img.onload = processLoadedImage;
    img.onerror = (err) => {
      cleanup();
      reject(err);
    };

    if (typeof source === 'string') {
      img.src = source;
    } else {
      reader = new FileReader();
      reader.onload = (e) => {
        img.src = (e.target?.result as string) || '';
      };
      reader.onerror = (err) => {
        cleanup();
        reject(err);
      };
      reader.readAsDataURL(source);
    }
  });
}

/**
 * Otimiza fotos de destaque de alta fidelidade (Vista Aérea, Fachada e Miliohmímetro)
 * Preserva 100% da proporção original sem cortar nada, mas redimensiona fotos gigantes de 48MP
 * para uma resolução nítida e segura (máx 1600px) que não esgota a memória RAM do celular.
 */
export async function optimizeHighFidelityPhoto(
  source: File | Blob | string,
  maxDimension = 1600,
  quality = 0.85
): Promise<OptimizedImageResult> {
  return optimizeImageFileToBlob(source, maxDimension, maxDimension, quality);
}

/**
 * Função mantida para compatibilidade com componentes que esperam string DataURL
 */
export async function optimizeImageFile(
  file: File,
  maxWidth = 1280,
  maxHeight = 1280,
  quality = 0.82
): Promise<string> {
  if (file.type === 'image/svg+xml') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  try {
    const res = await optimizeImageFileToBlob(file, maxWidth, maxHeight, quality);
    return res.dataUrl;
  } catch {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
