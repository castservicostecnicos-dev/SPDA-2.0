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

/**
 * Converte um Blob leve em DataURL via FileReader (sem alocar buffers pesados de canvas)
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = () => reject(reader.error || new Error('Erro ao converter blob'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Otimiza uma foto (File, Blob ou string DataURL) redimensionando e comprimindo de forma eficiente.
 * - Utiliza URL.createObjectURL para evitar gerar cópias gigantes em base64 na memória.
 * - Dimensões máximas 1080x1080 e qualidade 0.78 geram arquivos levíssimos (~100KB-140KB) com 100% de nitidez no A4.
 */
export async function optimizeImageFileToBlob(
  source: File | Blob | string,
  maxWidth = 1080,
  maxHeight = 1080,
  quality = 0.78
): Promise<OptimizedImageResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrl: string | null = null;

    const cleanup = () => {
      try {
        img.onload = null;
        img.onerror = null;
        img.src = '';
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      } catch {
        // ignore
      }
    };

    const processLoadedImage = () => {
      let width = img.naturalWidth || img.width || 800;
      let height = img.naturalHeight || img.height || 600;

      // Mantém proporção nativa estrita limitando às dimensões máximas de alta resolução
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

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // Converte para Blob primeiro, liberando imediatamente o canvas
      canvas.toBlob(
        async (blob) => {
          disposeCanvas(canvas);
          cleanup();

          if (!blob) {
            reject(new Error('Falha ao gerar blob comprimido'));
            return;
          }

          try {
            // Converte o blob já comprimido e leve (~100KB) em DataURL
            const dataUrl = await blobToDataUrl(blob);
            resolve({
              blob,
              dataUrl,
              width,
              height,
              sizeBytes: blob.size,
            });
          } catch (err) {
            reject(err);
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
      // Uso de createObjectURL evita alocação de dezenas de megabytes no heap do V8
      try {
        objectUrl = URL.createObjectURL(source);
        img.src = objectUrl;
      } catch {
        const reader = new FileReader();
        reader.onload = (e) => {
          img.src = (e.target?.result as string) || '';
        };
        reader.onerror = (err) => {
          cleanup();
          reject(err);
        };
        reader.readAsDataURL(source);
      }
    }
  });
}

/**
 * Otimiza fotos de destaque de alta fidelidade (Vista Aérea, Fachada e Miliohmímetro)
 * Preserva 100% da proporção original sem cortar nada, mas redimensiona fotos gigantes de 48MP
 * para uma resolução nítida e segura (máx 1280px) que não esgota a memória RAM do celular.
 */
export async function optimizeHighFidelityPhoto(
  source: File | Blob | string,
  maxDimension = 1280,
  quality = 0.80
): Promise<OptimizedImageResult> {
  return optimizeImageFileToBlob(source, maxDimension, maxDimension, quality);
}

/**
 * Função mantida para compatibilidade com componentes que esperam string DataURL
 */
export async function optimizeImageFile(
  file: File,
  maxWidth = 1080,
  maxHeight = 1080,
  quality = 0.78
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
