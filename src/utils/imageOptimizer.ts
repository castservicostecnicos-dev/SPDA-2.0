/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Otimiza e comprime imagens capturadas e enviadas pelo usuário para uso no laudo e PDF.
 * Reduz fotos pesadas de celulares (10MB+) para dimensões controladas (máx 1280px) em JPEG com qualidade 0.8.
 * Utiliza geração nativa de Blob binário e DataURL controlada para prevenir esgotamento de memória e travamentos (crashes) do Chrome.
 */

export interface OptimizedImageResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export async function optimizeImageFileToBlob(
  source: File | Blob | string,
  maxWidth = 1280,
  maxHeight = 1280,
  quality = 0.8
): Promise<OptimizedImageResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    const processLoadedImage = () => {
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      // Mantém proporção limitando aos máximos
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

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        reject(new Error('Falha ao instanciar canvas 2D'));
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // Gera o Blob binário nativo (evita memory leaks de strings gigantes no motor V8 do Chrome)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            // Fallback caso toBlob falhe
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve({
              blob: new Blob([], { type: 'image/jpeg' }),
              dataUrl,
              width,
              height,
              sizeBytes: dataUrl.length,
            });
            return;
          }

          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({
            blob,
            dataUrl,
            width,
            height,
            sizeBytes: blob.size,
          });
        },
        'image/jpeg',
        quality
      );
    };

    img.onload = processLoadedImage;
    img.onerror = (err) => reject(err);

    if (typeof source === 'string') {
      img.src = source;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(source);
    }
  });
}

/**
 * Função mantida para retrocompatibilidade com componentes que esperam string DataURL
 */
export async function optimizeImageFile(
  file: File,
  maxWidth = 1280,
  maxHeight = 1280,
  quality = 0.8
): Promise<string> {
  // Se o arquivo for SVG, não precisa de redimensionamento
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
