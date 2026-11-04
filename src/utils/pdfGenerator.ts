import jsPDF from 'jspdf';
import { SpdaReport, PhotoSlot } from '../types/spda';
import { SJC_OFFICIAL_LOGO_DATA_URL } from '../assets/logo';
import { generateSequentialPdfFileName } from './storage';
import {
  consolidateReportPhotos,
  getTowerInspectionGroups,
  analyzeTowerNonConformities,
  isDpsMissingCaption,
  isEquipotentialMissingCaption,
  TowerInspectionGroup,
} from './towerSorter';
import { disposeCanvas } from './imageOptimizer';

export interface GeneratePdfOptions {
  fileName?: string;
  onProgress?: (progress: number, message: string) => void;
}

// ============================================================================
// PADRÃO IMUTÁVEL DE DIMENSÕES: 4 FOTOS POR LINHA (LARGURA E ALTURA FIXAS)
// Largura da folha A4 = 210mm. Margens = 20mm de cada lado => Largura útil = 170mm.
// 4 fotos * 38.5mm = 154mm + 3 espaçamentos * 5.33mm = 16mm => Total = 170mm exatos!
// ============================================================================
const PHOTO_COLS = 4;
const PHOTO_WIDTH_MM = 38.5;  // 3,85 cm de largura fixa
const PHOTO_HEIGHT_MM = 48.0; // 4,80 cm de altura fixa
const PHOTO_GAP_X_MM = 5.33;  // Espaçamento horizontal fixo
const PHOTO_GAP_Y_MM = 5.0;   // Espaçamento vertical entre linhas

// Converts any image URL (SVG data URL, external URL, PNG, JPG) to a safe JPEG data URL for jsPDF / docx
export async function safeJpegDataUrl(url?: string, width = 540, height = 230, fillBackground = '#ffffff'): Promise<string> {
  if (!url) return '';

  return new Promise((resolve) => {
    // Timeout de segurança para evitar travamentos
    const timer = setTimeout(() => {
      resolve(url.startsWith('data:') ? url : '');
    }, 4500);

    const img = new Image();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      clearTimeout(timer);
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = fillBackground;
          ctx.fillRect(0, 0, width, height);

          // Contain fit to maintain aspect ratio without cropping anything
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          const imgRatio = img.width / img.height;
          const targetRatio = width / height;
          let dw = width;
          let dh = height;
          let dx = 0;
          let dy = 0;

          if (imgRatio >= targetRatio) {
            dw = width;
            dh = width / imgRatio;
            dy = (height - dh) / 2;
          } else {
            dh = height;
            dw = height * imgRatio;
            dx = (width - dw) / 2;
          }

          ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
          const out = canvas.toDataURL('image/jpeg', 0.80);
          disposeCanvas(canvas);
          img.src = '';
          resolve(out);
        } else {
          disposeCanvas(canvas);
          img.src = '';
          resolve('');
        }
      } catch {
        disposeCanvas(canvas);
        img.src = '';
        resolve('');
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      img.src = '';
      resolve('');
    };

    img.src = url;
  });
}

export interface UncroppedPhotoData {
  dataUrl: string;
  width: number;
  height: number;
  aspect: number;
  format: 'JPEG' | 'PNG';
}

/**
 * Carrega a foto original enviada pelo usuário SEM distorcer e SEM cortar,
 * redimensionando apenas se exceder 1600px para manter o arquivo leve e veloz.
 */
export async function loadUncroppedPhoto(url?: string): Promise<UncroppedPhotoData | null> {
  if (!url) return null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, 5000);

    const img = new Image();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      clearTimeout(timer);
      try {
        const origWidth = img.naturalWidth || img.width || 800;
        const origHeight = img.naturalHeight || img.height || 600;
        const aspect = origWidth / origHeight;

        const maxDim = 1600;
        let targetW = origWidth;
        let targetH = origHeight;
        const needsResize = origWidth > maxDim || origHeight > maxDim;

        if (needsResize) {
          if (origWidth >= origHeight) {
            targetW = maxDim;
            targetH = Math.round((origHeight * maxDim) / origWidth);
          } else {
            targetH = maxDim;
            targetW = Math.round((origWidth * maxDim) / origHeight);
          }
        }

        // Se já for JPEG razoavelmente leve (< 450KB) e não precisa redimensionar, usa direto
        if (!needsResize && url.length < 450000 && (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg'))) {
          resolve({
            dataUrl: url,
            width: origWidth,
            height: origHeight,
            aspect,
            format: 'JPEG',
          });
          return;
        }

        // Desenha no canvas otimizado para manter o arquivo do laudo leve
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          disposeCanvas(canvas);
          img.src = '';
          resolve({
            dataUrl: url,
            width: origWidth,
            height: origHeight,
            aspect,
            format: 'JPEG',
          });
          return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const safeDataUrl = canvas.toDataURL('image/jpeg', 0.82);
        disposeCanvas(canvas);
        img.src = '';
        resolve({
          dataUrl: safeDataUrl,
          width: targetW,
          height: targetH,
          aspect,
          format: 'JPEG',
        });
      } catch (err) {
        console.error('Erro ao processar foto original:', err);
        img.src = '';
        resolve(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      img.src = '';
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * Calcula dimensões contidas rigorosamente dentro dos limites de largura e altura especificados,
 * preservando 100% da proporção nativa da foto sem distorcer e sem cortar nada.
 * Garante que a largura NUNCA ultrapasse a largura útil do documento (contentWidth = 170mm no PDF),
 * impedindo que qualquer foto extravase as margens do documento.
 */
export function calculateContainedDimensions(
  aspect: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const safeAspect = aspect && !isNaN(aspect) && isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;

  // Inicia limitando pela largura máxima disponível
  let width = maxWidth;
  let height = width / safeAspect;

  // Se a altura calculada ultrapassar a altura máxima permitida, recalcula com base na altura
  if (height > maxHeight) {
    height = maxHeight;
    width = height * safeAspect;
  }

  // Trava de segurança absoluta: se a largura resultante ultrapassar maxWidth, recolapsa na largura máxima
  if (width > maxWidth) {
    width = maxWidth;
    height = width / safeAspect;
  }

  return {
    width: Number(width.toFixed(2)),
    height: Number(height.toFixed(2)),
  };
}

/**
 * Pre-processes a photo for the PDF:
 * 1. Exact CSS `object-cover` framing matching the UI preview and CircleFocusModal.
 * 2. If photo has a red circle marker (`hasRedCircleMarker`), burns the red focus circle
 *    and center dot onto the image with pixel-perfect alignment.
 * 3. STRICTLY CLIPS all drawing to the photo canvas boundaries (0, 0, width, height) so
 *    the circle CAN NEVER spill outside the image into the document!
 */
export async function processPhotoForPdf(
  photo: PhotoSlot,
  targetWidth = 600, // Resolução gráfica em alta definição otimizada (423 DPI em 36x48mm no papel)
  targetHeight = 800,
  allowCircle = true
): Promise<string> {
  if (!photo?.url) return '';

  return new Promise((resolve) => {
    // Timeout de segurança por imagem para garantir que o PDF seja sempre gerado sem travar
    const timer = setTimeout(() => {
      resolve(photo.url || '');
    }, 4500);

    const img = new Image();
    if (!photo.url.startsWith('data:') && !photo.url.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      clearTimeout(timer);
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          disposeCanvas(canvas);
          img.src = '';
          resolve('');
          return;
        }

        // Clean white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        // Ativa suavização bicúbica de altíssima definição (elimina granulação em impressão)
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Exact CSS object-cover mathematics (identical to UI preview and CircleFocusModal)
        const imgRatio = img.width / img.height;
        const targetRatio = targetWidth / targetHeight;
        let sx = 0;
        let sy = 0;
        let sw = img.width;
        let sh = img.height;

        if (imgRatio > targetRatio) {
          // Source is wider than target container: crop left and right
          sw = img.height * targetRatio;
          sx = (img.width - sw) / 2;
        } else {
          // Source is taller than target container: crop top and bottom
          sh = img.width / targetRatio;
          sy = (img.height - sh) / 2;
        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

        // Render red highlight circle if enabled
        const hasCircle = allowCircle && (photo.hasRedCircleMarker ?? false);
        if (hasCircle) {
          const circleX = photo.circleX !== undefined ? photo.circleX : 50;
          const circleY = photo.circleY !== undefined ? photo.circleY : 50;
          const radius = photo.circleRadius !== undefined ? photo.circleRadius : 24;

          const cx = (circleX / 100) * targetWidth;
          const cy = (circleY / 100) * targetHeight;
          const rw = ((radius * 2.2) / 100) * targetWidth;
          const rh = ((radius * 1.8) / 100) * targetHeight;
          const rx = rw / 2;
          const ry = rh / 2;

          ctx.save();
          // STRICT CLIPPING TO CANVAS BOUNDS: Guarantees circle NEVER escapes image!
          ctx.beginPath();
          ctx.rect(0, 0, targetWidth, targetHeight);
          ctx.clip();

          // Outer red circle matching UI (#dc2626)
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
          ctx.lineWidth = Math.max(2.5, targetWidth * 0.012);
          ctx.strokeStyle = '#dc2626';
          ctx.stroke();

          // Inner center point matching CircleFocusModal
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(2, targetWidth * 0.006), 0, 2 * Math.PI);
          ctx.fillStyle = '#dc2626';
          ctx.fill();

          ctx.restore();
        }

        const out = canvas.toDataURL('image/jpeg', 0.80);
        disposeCanvas(canvas);
        img.src = '';
        resolve(out);
      } catch (e) {
        console.error('Error processing photo for PDF', e);
        disposeCanvas(canvas);
        img.src = '';
        resolve(photo.url);
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      img.src = '';
      resolve('');
    };

    img.src = photo.url;
  });
}

// Helper to chunk array
function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export interface HeaderLogoLayout {
  dataUrl: string;
  format: 'PNG' | 'JPEG';
  x: number;
  y: number;
  width: number;
  height: number;
}

// Holds the active pre-processed header logo layout and image
let activeHeaderLogo: HeaderLogoLayout | null = null;

/**
 * Adapta a imagem da logo ao espaço destinado no documento (A4):
 * Espaço máximo destinado no cabeçalho: largura 45mm, altura 18mm, alinhado à margem direita (x=192mm).
 * - Se for maior em largura: alinha pela largura máxima (45mm) e diminui a altura proporcionalmente.
 * - Se for maior na altura: alinha pela altura máxima (18mm) e diminui a largura proporcionalmente.
 * - A imagem NUNCA é cortada. 100% da imagem é preservada sem perder nada.
 */
export async function processHeaderLogo(
  url?: string,
  maxWidthMm = 45,
  maxHeightMm = 18,
  rightBoundaryX = 192,
  topY = 8.5
): Promise<HeaderLogoLayout | null> {
  const logoSrc = url || SJC_OFFICIAL_LOGO_DATA_URL;
  if (!logoSrc) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const origW = img.naturalWidth || img.width || 540;
        const origH = img.naturalHeight || img.height || 230;
        const imgAspect = origW / origH;
        const boxAspect = maxWidthMm / maxHeightMm;

        let renderWidth = maxWidthMm;
        let renderHeight = maxHeightMm;

        if (imgAspect >= boxAspect) {
          // Se for maior em largura: alinha pela largura máxima e diminui a altura
          renderWidth = maxWidthMm;
          renderHeight = maxWidthMm / imgAspect;
        } else {
          // Se for maior na altura: alinha pela altura máxima e diminui a largura
          renderHeight = maxHeightMm;
          renderWidth = maxHeightMm * imgAspect;
        }

        // Alinha à margem direita do documento
        const renderX = rightBoundaryX - renderWidth;
        // Centraliza verticalmente no espaço de 18mm do cabeçalho
        const renderY = topY + (maxHeightMm - renderHeight) / 2;

        // Renderiza no canvas sem cortar absolutamente nada (proporção 1:1 integral)
        const scale = Math.min(4, Math.max(2, 1600 / Math.max(origW, origH)));
        const canvasW = Math.round(origW * scale);
        const canvasH = Math.round(origH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        // Desenha 100% da imagem original com alta nitidez e sem granular na impressão
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvasW, canvasH);

        // Gera PNG para preservar qualidade e transparência original
        const dataUrl = canvas.toDataURL('image/png');

        resolve({
          dataUrl,
          format: 'PNG',
          x: Number(renderX.toFixed(2)),
          y: Number(renderY.toFixed(2)),
          width: Number(renderWidth.toFixed(2)),
          height: Number(renderHeight.toFixed(2)),
        });
      } catch (err) {
        console.error('Erro ao processar logo para cabeçalho do PDF', err);
        resolve(null);
      }
    };

    img.onerror = () => {
      console.warn('Erro ao carregar imagem da logo para o PDF');
      resolve(null);
    };

    img.src = logoSrc;
  });
}

// Desenha a logo no cabeçalho adaptada perfeitamente ao espaço destinado
function drawHeaderLogo(pdf: jsPDF) {
  if (activeHeaderLogo?.dataUrl) {
    try {
      pdf.addImage(
        activeHeaderLogo.dataUrl,
        activeHeaderLogo.format,
        activeHeaderLogo.x,
        activeHeaderLogo.y,
        activeHeaderLogo.width,
        activeHeaderLogo.height
      );
      return;
    } catch (e) {
      console.warn('Erro ao renderizar imagem da logo no PDF, usando fallback', e);
    }
  }

  // Fallback vector caso não haja logo carregada
  pdf.setFillColor(57, 57, 57);
  pdf.roundedRect(147, 8.5, 45, 18, 1, 1, 'F');

  pdf.setTextColor(195, 196, 200);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text('SJC', 169.5, 22.5, { align: 'center' });

  pdf.setTextColor(229, 38, 50);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(5.8);
  pdf.text('ENGENHARIA & SOLUÇÕES', 169.5, 18.8, { align: 'center' });
}

// Draw footer with dynamic page number
function drawFooter(pdf: jsPDF, pageNum?: number, totalPages?: number) {
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.3);
  pdf.line(20, 281, 190, 281);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(0, 0, 0);
  pdf.text(
    'SJC ENGENHARIA E SOLUÇÕES - CNPJ: 18.472.071/0001-52 – FONE: (12) 98106-3344',
    105,
    285,
    { align: 'center' }
  );
  pdf.text(
    'RUA ISAAC NEWTON, 98 JD. ORIENTE – SÃO JOSE DOS CAMPOS - SP',
    105,
    289,
    { align: 'center' }
  );

  if (pageNum && totalPages) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Página ${pageNum} de ${totalPages}`, 190, 289, { align: 'right' });
  }
}

// Draw watermark
function drawWatermark(pdf: jsPDF, text = 'SPDA 2026') {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(70);
  pdf.setTextColor(225, 228, 233);
  pdf.text(text, 105, 155, { align: 'center', angle: 45 });
}

export const printReport = () => {
  window.print();
};

// Generates an authentic, compact, organized PDF with ZERO awkward empty spaces
export const generatePdfBlob = async (
  report: SpdaReport,
  onProgress?: (percent: number, message: string) => void
): Promise<{ blob: Blob; url: string; fileName: string }> => {
  // Consolida e organiza automaticamente todas as fotos do laudo por torre e por seção,
  // ordenando estritamente do menor para o maior (ex: Torre 1 -> 2 -> 4 -> 5... ou A -> B -> C...)
  const consolidatedReport = consolidateReportPhotos(report);
  const { client, texts, conditions, spdaPhotos, measurementPhotos, quadrosPhotos, localPhotos, equipmentPhotoUrl } = consolidatedReport;

  onProgress?.(5, 'Iniciando compilação do laudo...');

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const marginX = 20;
  const contentWidth = 170;

  // Convert photos to safe JPEG data URLs in parallel
  onProgress?.(15, `Processando ${spdaPhotos.length + measurementPhotos.length + quadrosPhotos.length + localPhotos.length} fotos do laudo...`);

  const [
    localPhotoInfos,
    spdaJpegs,
    measureJpegs,
    quadrosJpegs,
    equipmentPhotoInfo,
    headerLogoLayout,
  ] = await Promise.all([
    Promise.all(localPhotos.map((p) => loadUncroppedPhoto(p.url))),
    Promise.all(spdaPhotos.map((p) => processPhotoForPdf(p, 600, 800, p.hasRedCircleMarker ?? true))),
    Promise.all(measurementPhotos.map((p) => processPhotoForPdf(p, 600, 800, false))),
    Promise.all(quadrosPhotos.map((p) => processPhotoForPdf(p, 600, 800, p.hasRedCircleMarker ?? false))),
    loadUncroppedPhoto(equipmentPhotoUrl),
    processHeaderLogo(report.company.logoUrl || SJC_OFFICIAL_LOGO_DATA_URL),
  ]);

  activeHeaderLogo = headerLogoLayout;

  const photoJpegMap = new Map<string, string>();
  spdaPhotos.forEach((p, i) => {
    const k = p.id || p.url;
    if (k && spdaJpegs[i]) photoJpegMap.set(k, spdaJpegs[i]);
  });
  measurementPhotos.forEach((p, i) => {
    const k = p.id || p.url;
    if (k && measureJpegs[i]) photoJpegMap.set(k, measureJpegs[i]);
  });
  quadrosPhotos.forEach((p, i) => {
    const k = p.id || p.url;
    if (k && quadrosJpegs[i]) photoJpegMap.set(k, quadrosJpegs[i]);
  });

  const towerGroups = getTowerInspectionGroups(consolidatedReport);

  // ==========================================
  // PÁGINA 1: CAPA EXECUTIVA (SEM ESPAÇOS VAZIOS)
  // ==========================================
  onProgress?.(25, 'Gerando Página 1: Capa Executiva...');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  // Faixa Superior da Capa
  pdf.setFillColor(243, 244, 246);
  pdf.roundedRect(marginX, 36, contentWidth, 9, 1, 1, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(217, 56, 58);
  pdf.text('LAUDO TÉCNICO PERICIAL DE ENGENHARIA ELÉTRICA', 105, 42, { align: 'center' });

  // Título Principal
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(15, 23, 42);
  pdf.text('SISTEMA DE PROTEÇÃO CONTRA', 105, 56, { align: 'center' });
  pdf.text('DESCARGAS ATMOSFÉRICAS (SPDA)', 105, 63, { align: 'center' });

  // Subtítulo com norma técnica
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(71, 85, 105);
  pdf.text('Inspeção Visual, Medições de Continuidade Ôhmica & Avaliação NBR 5419:2026', 105, 70, { align: 'center' });

  // OBJETO em caixa destacada
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.4);
  pdf.roundedRect(marginX, 76, contentWidth, 20, 1.5, 1.5, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('OBJETO DA INSPEÇÃO:', marginX + 4, 82);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(51, 65, 85);
  const objetoLines = pdf.splitTextToSize(texts.objeto, contentWidth - 8);
  pdf.text(objetoLines, marginX + 4, 87);

  // DADOS DO CLIENTE - Tabela Estruturada
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, 101, contentWidth, 7, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(15, 23, 42);
  pdf.text('DADOS DA EDIFICAÇÃO / CLIENTE', marginX + 4, 105.5);

  const clientInfo = [
    { label: 'CLIENTE:', val: client.name },
    { label: 'LOCAL:', val: client.local },
    { label: 'MUNICÍPIO / UF:', val: client.municipio },
    { label: 'CNPJ:', val: client.cnpj },
    { label: 'RAMO DE ATIVIDADE:', val: client.ramoAtividade },
    { label: 'PERÍODO DE AVALIAÇÃO:', val: client.periodoAvaliacao },
    { label: 'GRAU DE EXPOSIÇÃO:', val: client.exposicaoNivel || 'Baixa exposição a descargas atmosféricas' },
  ];

  let curY = 114;
  pdf.setFontSize(8.5);
  clientInfo.forEach((item, idx) => {
    // Linha zebrada suave
    if (idx % 2 === 0) {
      pdf.setFillColor(250, 250, 250);
      pdf.rect(marginX, curY - 4.5, contentWidth, 6.5, 'F');
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59);
    pdf.text(item.label, marginX + 3, curY);

    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(51, 65, 85);
    pdf.text(item.val || '—', marginX + 50, curY, { maxWidth: contentWidth - 52 });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, curY + 2, marginX + contentWidth, curY + 2);

    curY += 6.5;
  });

  // DADOS DO RESPONSÁVEL TÉCNICO & EMISSÃO
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, curY + 4, contentWidth, 7, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(15, 23, 42);
  pdf.text('RESPONSABILIDADE TÉCNICA & REGISTRO PROFISSIONAL', marginX + 4, curY + 8.5);

  const techInfo = [
    { label: 'RESPONSÁVEL TÉCNICO:', val: client.tecnico },
    { label: 'QUALIFICAÇÃO PROFISSIONAL:', val: client.cargo },
    { label: 'REGISTRO CREA / CONFEA:', val: client.crea },
    { label: 'CIDADE & DATA DE EMISSÃO:', val: `${client.cidadeEmissao}, ${client.dataEmissaoExtenso}` },
  ];

  if (report.digitalSignature?.enabled) {
    techInfo.push({
      label: 'AUTENTICAÇÃO DIGITAL:',
      val: 'DOCUMENTO ASSINADO DIGITALMENTE (PÁGINA FINAL)',
    });
  }

  let techY = curY + 17;
  techInfo.forEach((item, idx) => {
    if (idx % 2 === 0) {
      pdf.setFillColor(250, 250, 250);
      pdf.rect(marginX, techY - 4.5, contentWidth, 6.5, 'F');
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59);
    pdf.text(item.label, marginX + 3, techY);

    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(51, 65, 85);
    pdf.text(item.val || '—', marginX + 62, techY, { maxWidth: contentWidth - 64 });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, techY + 2, marginX + contentWidth, techY + 2);

    techY += 6.5;
  });

  // ==========================================
  // PÁGINA 2: INTRODUÇÃO, REFERÊNCIAS NORMATIVAS & 2) DICIONÁRIO
  // UNIFICADOS: 100% DENSO E COMPLETO SEM ESPAÇOS VAZIOS
  // ==========================================
  onProgress?.(35, 'Gerando Página 2: Introdução, Normas & Dicionário...');
  pdf.addPage('a4', 'portrait');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('1) INTRODUÇÃO', marginX, 36);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.6);
  pdf.setTextColor(30, 41, 59);

  const intro1 = `1.1- Este LAUDO tem como objetivo fazer uma avaliação sucinta do SPDA existente na edificação do ${client.name}, verificar o estado de conservação das peças e acessórios e checar a sua conformidade com a norma técnica NBR 5419:2026 da ABNT em vigência. 1.2- Serão apresentadas as sugestões técnicas necessárias para conformidade à norma e apresentados desenhos e/ou detalhes caso seja necessário.`;
  pdf.text(pdf.splitTextToSize(intro1, contentWidth), marginX, 41);

  const intro2 = `1.3- A avaliação apresentada neste laudo teve como base as inspeções e medições efetuadas nas instalações e por informações obtidas junto a colaboradores e engenheiros da SJC Engenharia.`;
  pdf.text(pdf.splitTextToSize(intro2, contentWidth), marginX, 52);

  const intro3 = `1.4- Segundo a ABNT NBR 5419-1:2026, Proteção contra descargas atmosféricas – Parte 1: Princípios Gerais, item 9.4.1.2, as funções do SPDA externo são:\na) Interceptar uma descarga atmosférica para a estrutura (com um subsistema de captação);\nb) Conduzir a corrente da descarga atmosférica seguramente para a terra (com um subsistema de descida);\nc) Dispersar esta corrente na terra (com um subsistema de aterramento).`;
  pdf.text(pdf.splitTextToSize(intro3, contentWidth), marginX, 60);

  const intro4 = `As inspeções e levantamentos de informações foram efetuados na seguinte ordem:\na) Análise das informações fornecidas pelos ANEXOS (Projetos e relatórios fornecidos pelo cliente);\nb) Relatório de inspeção de SPDA e Caixas de Inspeção de Hastes de Aterramento;\nc) Relatório de Inspeção de Medição de Continuidade de Malha de Aterramento;\nd) Relatório de Inspeção de Pontos de aterramento e avaliação dos quadros de energia;\ne) Avaliação Geral do Sistema de Proteção contra Descargas Atmosféricas e Laudo Técnico Final.`;
  pdf.text(pdf.splitTextToSize(intro4, contentWidth), marginX, 81);

  // Faixa Divisória: Referências Normativas
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, 108, contentWidth, 6, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('REFERÊNCIAS NORMATIVAS APLICÁVEIS', 105, 112.2, { align: 'center' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.3);
  pdf.setTextColor(51, 65, 85);
  const refText = 'Documentos indispensáveis à aplicação deste documento (edições mais recentes e emendas vigentes):';
  pdf.text(pdf.splitTextToSize(refText, contentWidth), marginX, 118);

  let normY = 123;
  texts.referenciasNormativas.forEach((norma) => {
    pdf.setFillColor(217, 56, 58);
    pdf.circle(marginX + 2.5, normY - 1, 0.7, 'F');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.2);
    pdf.setTextColor(30, 41, 59);
    const lines = pdf.splitTextToSize(norma, contentWidth - 10);
    pdf.text(lines, marginX + 5.5, normY);
    normY += lines.length * 3.6 + 1.6;
  });

  // 2) DICIONÁRIO E ABREVIATURAS EM GRADE DE 2 COLUNAS (COMPACTO E DENSO)
  let dictStartY = normY + 3;
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, dictStartY, contentWidth, 6, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('2) DICIONÁRIO E ABREVIATURAS USADAS NESTE DOCUMENTO', 105, dictStartY + 4.2, { align: 'center' });

  const dictItems = texts.dicionario.slice(0, 8);
  const colW = (contentWidth - 8) / 2;
  let leftY = dictStartY + 10;
  let rightY = dictStartY + 10;

  dictItems.forEach((d, idx) => {
    const isRight = idx >= 4;
    const curX = isRight ? marginX + colW + 8 : marginX;
    let curY = isRight ? rightY : leftY;

    const termStr = `${d.termo}: `;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.0);
    const termW = pdf.getTextWidth(termStr);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.0);
    pdf.setTextColor(51, 65, 85);
    const fullText = `${d.termo}: ${d.definicao}`;
    const lines = pdf.splitTextToSize(fullText, colW - 3);

    lines.forEach((line: string, lineIdx: number) => {
      if (lineIdx === 0) {
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(15, 23, 42);
        pdf.text(termStr, curX, curY);

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(51, 65, 85);
        const rest = line.startsWith(termStr)
          ? line.slice(termStr.length)
          : line.replace(new RegExp(`^${d.termo}:?\\s*`), '');
        pdf.text(rest, curX + termW, curY, { maxWidth: Math.max(10, colW - termW - 3) });
      } else {
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(51, 65, 85);
        pdf.text(line, curX, curY, { maxWidth: colW - 3 });
      }
      curY += 3.4;
    });

    curY += 1.8;
    if (isRight) {
      rightY = curY;
    } else {
      leftY = curY;
    }
  });

  const finalDictY = Math.max(leftY, rightY);

  // Nota de Conselho de Classe (CREA)
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(marginX, finalDictY + 3, contentWidth, 12, 1, 1, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('CREA – CONSELHO REGIONAL DE ENGENHARIA E AGRONOMIA', marginX + 4, finalDictY + 7);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.0);
  pdf.setTextColor(71, 85, 105);
  pdf.text(
    'Inspeção realizada por engenheiro legalmente habilitado, com registro ativo e emissão da ART correspondente, assegurando o rigor técnico e legalidade das medições.',
    marginX + 4,
    finalDictY + 11.5,
    { maxWidth: contentWidth - 8 }
  );

  // ==========================================
  // PÁGINA 3: 3) CARACTERÍSTICAS DA EDIFICAÇÃO & LOCAL,
  // 3.1 VISTA AÉREA, 3.2 FACHADA PRINCIPAL,
  // PARÂMETROS CONSTRUTIVOS & 4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS
  // INÍCIO EM NOVA PÁGINA CONFORME SOLICITADO
  // ==========================================
  onProgress?.(48, 'Gerando Características do Local, Fachadas e Histórico...');
  pdf.addPage('a4', 'portrait');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  let p3Y = 36;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.0);
  pdf.setTextColor(15, 23, 42);
  pdf.text('3) CARACTERÍSTICAS DA EDIFICAÇÃO & LOCAL', marginX, p3Y);
  p3Y += 4.5;

  const rawLocDesc = (client.descricaoBloco || texts.caracteristicasLocal || '').trim();
  const isExcludedLocDesc =
    !rawLocDesc ||
    /^(?:torre\s*\d+|torre\s*\/\s*estrutura|estrutura\s*\/\s*torre)$/i.test(rawLocDesc);
  if (!isExcludedLocDesc) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(30, 41, 59);
    const locDescLines = pdf.splitTextToSize(rawLocDesc, contentWidth);
    pdf.text(locDescLines, marginX, p3Y);
    p3Y += locDescLines.length * 3.6 + 2.5;
  }

  const aerialInfo = localPhotoInfos[0]?.dataUrl ? localPhotoInfos[0] : null;
  const facadeInfo = localPhotoInfos[1]?.dataUrl ? localPhotoInfos[1] : null;

  if (aerialInfo) {
    pdf.setFillColor(241, 245, 249);
    pdf.rect(marginX, p3Y, contentWidth, 5.0, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.6);
    pdf.setTextColor(15, 23, 42);
    pdf.text('3.1) VISTA AÉREA DA EDIFICAÇÃO / SATÉLITE', marginX + 3, p3Y + 3.5);
    p3Y += 6.0;

    const { width: w1, height: h1 } = calculateContainedDimensions(aerialInfo.aspect, contentWidth, 62);
    const x1 = marginX + (contentWidth - w1) / 2;
    pdf.addImage(aerialInfo.dataUrl, aerialInfo.format, x1, p3Y, w1, h1);
    p3Y += h1 + 2.0;

    const cap1 = localPhotos[0]?.caption?.trim() || 'Vista aérea da circunvizinhança e posicionamento geográfico da edificação.';
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.setTextColor(71, 85, 105);
    pdf.text(cap1, marginX + contentWidth / 2, p3Y, { align: 'center', maxWidth: contentWidth });
    p3Y += 4.5;
  }

  if (facadeInfo) {
    pdf.setFillColor(241, 245, 249);
    pdf.rect(marginX, p3Y, contentWidth, 5.0, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.6);
    pdf.setTextColor(15, 23, 42);
    const facadeTitle = aerialInfo ? '3.2) FACHADA PRINCIPAL DA EDIFICAÇÃO' : '3.1) FACHADA PRINCIPAL DA EDIFICAÇÃO';
    pdf.text(facadeTitle, marginX + 3, p3Y + 3.5);
    p3Y += 6.0;

    const { width: w2, height: h2 } = calculateContainedDimensions(facadeInfo.aspect, contentWidth, 62);
    const x2 = marginX + (contentWidth - w2) / 2;
    pdf.addImage(facadeInfo.dataUrl, facadeInfo.format, x2, p3Y, w2, h2);
    p3Y += h2 + 2.0;

    const cap2 = localPhotos[1]?.caption?.trim() || 'Fachada principal da edificação e acessos vistoriados.';
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.setTextColor(71, 85, 105);
    pdf.text(cap2, marginX + contentWidth / 2, p3Y, { align: 'center', maxWidth: contentWidth });
    p3Y += 4.5;
  }

  // Parâmetros construtivos em sequência contínua
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, p3Y, contentWidth, 4.8, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.0);
  pdf.setTextColor(15, 23, 42);
  pdf.text('PARÂMETROS CONSTRUTIVOS & INFRAESTRUTURA DA EDIFICAÇÃO (NBR 5419:2026)', marginX + 3, p3Y + 3.4);

  const parametros = [
    { param: 'Tipologia Construtiva:', valor: 'Alvenaria Convencional / Estrutura em Concreto Armado' },
    { param: 'Topografia & Entorno:', valor: 'Terreno Urbano Plano com Edificações Vizinhas' },
    { param: 'Nível de Proteção Dimensionado:', valor: 'Nível III / IV (NBR 5419-2:2026 - Gerenciamento de Risco)' },
    { param: 'Métodos de Proteção Aplicáveis:', valor: 'Ângulo de Proteção (Franklin) e Condutores em Malha (Faraday)' },
  ];

  let paramY = p3Y + 4.8;
  parametros.forEach((p, pIdx) => {
    if (pIdx % 2 === 0) {
      pdf.setFillColor(250, 250, 250);
      pdf.rect(marginX, paramY, contentWidth, 4.2, 'F');
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.setTextColor(30, 41, 59);
    pdf.text(p.param, marginX + 3, paramY + 3.0);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(71, 85, 105);
    pdf.text(p.valor, marginX + 55, paramY + 3.0, { maxWidth: contentWidth - 58 });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, paramY + 4.2, marginX + contentWidth, paramY + 4.2);
    paramY += 4.2;
  });

  p3Y = paramY + 2.5;

  // Texto de Ramo de atividade e nível de exposição
  const exposicaoText = `A edificação é de uso ${client.ramoAtividade} com presença de ocupantes e equipamentos eletroeletrônicos e está localizada numa área de ${client.exposicaoNivel || 'baixa EXPOSIÇÃO'} a descargas atmosféricas e seus efeitos indiretos.`;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.0);
  pdf.setTextColor(30, 41, 59);
  const expLines = pdf.splitTextToSize(exposicaoText, contentWidth);
  pdf.text(expLines, marginX, p3Y);
  p3Y += expLines.length * 3.4 + 2.5;

  // Linha sutil divisória
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.3);
  pdf.line(marginX, p3Y, marginX + contentWidth, p3Y);
  p3Y += 3.5;

  // 4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS', marginX, p3Y);

  p3Y += 4.0;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.0);
  pdf.setTextColor(30, 41, 59);

  const hist1 = `4.1- Devido à localização e infraestrutura da edificação, constata-se: ${client.historicoQueimaOcorrencias || '2 problemas de queima de equipamentos eletroeletrônicos'}.`;
  const histLines1 = pdf.splitTextToSize(hist1, contentWidth);
  pdf.text(histLines1, marginX, p3Y);
  p3Y += histLines1.length * 3.4 + 1.5;

  const hist2 = `4.2- A ocorrência de problemas com equipamentos se deve ao fato de descargas nas proximidades gerarem pulsos eletromagnéticos que viajam pela rede elétrica sem blindagem suficiente. Com isso, é indispensável a instalação de supressores de surtos (DPS) coordenados nos quadros de distribuição.`;
  const histLines2 = pdf.splitTextToSize(hist2, contentWidth);
  pdf.text(histLines2, marginX, p3Y);
  p3Y += histLines2.length * 3.4 + 2.0;

  // ==========================================
  // PÁGINA 4: 5) INSTRUMENTAÇÃO TÉCNICA E CRITÉRIOS DE INSPEÇÃO
  // FLUXO CONTÍNUO: SEGUIDA DIRETAMENTE POR SEÇÃO 6 (TORRE 1)
  // ==========================================
  onProgress?.(58, 'Gerando Instrumentação Técnica e Vistorias...');
  pdf.addPage('a4', 'portrait');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  let p4Y = 36;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('5) INSTRUMENTAÇÃO TÉCNICA E CRITÉRIOS DE INSPEÇÃO', marginX, p4Y);

  p4Y += 4.0;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.0);
  pdf.setTextColor(30, 41, 59);
  const medContLines = pdf.splitTextToSize(texts.medicoesContinuidadeTexto, contentWidth);
  pdf.text(medContLines, marginX, p4Y);
  p4Y += medContLines.length * 3.4 + 2.0;

  // Painel com Foto do Miliohmímetro e Especificações Técnicas
  const eqBoxH = 25.0;
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(marginX, p4Y, contentWidth, eqBoxH, 1, 1, 'FD');

  if (equipmentPhotoInfo?.dataUrl) {
    try {
      const { width: eqW, height: eqH } = calculateContainedDimensions(
        equipmentPhotoInfo.aspect,
        38,
        21
      );
      const eqX = marginX + 3 + (38 - eqW) / 2;
      const eqY = p4Y + 2 + (21 - eqH) / 2;
      pdf.addImage(equipmentPhotoInfo.dataUrl, equipmentPhotoInfo.format, eqX, eqY, eqW, eqH);
    } catch (e) {
      console.warn('Erro ao inserir foto do miliohmímetro no PDF:', e);
    }
  }

  const eqTextX = equipmentPhotoInfo?.dataUrl ? marginX + 44 : marginX + 4;
  const eqTextW = equipmentPhotoInfo?.dataUrl ? contentWidth - 47 : contentWidth - 8;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.6);
  pdf.setTextColor(15, 23, 42);
  pdf.text(`Miliohmímetro ${texts.equipamentoModelo} - Marca: ${texts.equipamentoMarca}`, eqTextX, p4Y + 5.0);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.4);
  pdf.setTextColor(71, 85, 105);
  const eqDescLines = pdf.splitTextToSize(texts.equipamentoDescricao, eqTextW);
  pdf.text(eqDescLines, eqTextX, p4Y + 8.5);

  let eqDetY = p4Y + 8.5 + eqDescLines.length * 3.0 + 1.5;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6.4);
  pdf.setTextColor(30, 41, 59);
  pdf.text(`Local de Aplicação: `, eqTextX, eqDetY);
  pdf.setFont('helvetica', 'normal');
  pdf.text(texts.medicoesLocal || 'Estruturas prediais e barramentos', eqTextX + 25, eqDetY);

  eqDetY += 3.2;
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Corrente Injetada: `, eqTextX, eqDetY);
  pdf.setFont('helvetica', 'normal');
  pdf.text(texts.medicoesCorrenteAplicada || '10 A DC contínua', eqTextX + 23, eqDetY);

  p4Y += eqBoxH + 2.5;

  // Tabela de Parâmetros Normativos NBR 5419:2026
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, p4Y, contentWidth, 4.8, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.0);
  pdf.setTextColor(15, 23, 42);
  pdf.text('PARÂMETROS NORMATIVOS DE CONTINUIDADE (ABNT NBR 5419:2026)', marginX + 3, p4Y + 3.4);

  const criteriosNormativos = [
    { item: 'Continuidade de Armaduras e Malhas', norma: 'NBR 5419-3:2026 (Item 5.3.5)', limite: '≤ 0,200 Ω (200 mΩ)', status: 'CONFORME' },
    { item: 'Resistência de Equipotencialização', norma: 'NBR 5419-3:2026 (Item 6.2)', limite: '≤ 0,200 Ω (200 mΩ)', status: 'CONFORME' },
    { item: 'Método de 4 Terminais (Kelvin)', norma: 'Injeção de corrente contínua DC', limite: 'Elimina resist. pontas', status: 'APLICADO' },
    { item: 'Estado das Caixas de Inspeção', norma: 'Aterramento & Equalização BEP', limite: 'Limpas e desobstruídas', status: conditions.caixasInspecaoLimpas ? 'CONFORME' : 'LIMPEZA PENDENTE' },
  ];

  let critNormY = p4Y + 4.8;
  criteriosNormativos.forEach((crit, cIdx) => {
    if (cIdx % 2 === 0) {
      pdf.setFillColor(250, 250, 250);
      pdf.rect(marginX, critNormY, contentWidth, 4.4, 'F');
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.4);
    pdf.setTextColor(30, 41, 59);
    pdf.text(crit.item, marginX + 3, critNormY + 3.1);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.4);
    pdf.setTextColor(71, 85, 105);
    pdf.text(crit.norma, marginX + 63, critNormY + 3.1);

    pdf.setFont('helvetica', 'bold');
    pdf.text(crit.limite, marginX + 112, critNormY + 3.1);

    if (crit.status === 'CONFORME' || crit.status === 'APLICADO') {
      pdf.setTextColor(22, 101, 52);
    } else {
      pdf.setTextColor(217, 119, 6);
    }
    pdf.text(crit.status, marginX + contentWidth - 3, critNormY + 3.1, { align: 'right' });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, critNormY + 4.4, marginX + contentWidth, critNormY + 4.4);
    critNormY += 4.4;
  });

  p4Y = critNormY + 2.5;

  // Tabela dos Subsistemas Vistoriados
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, p4Y, contentWidth, 4.8, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.0);
  pdf.setTextColor(15, 23, 42);
  pdf.text('AVALIAÇÃO ESTRUTURAL DOS SUBSISTEMAS DO SPDA (NBR 5419:2026)', marginX + 3, p4Y + 3.4);

  const subsistemas = [
    { item: 'Subsistema de Captação', desc: conditions.subCapitacaoDesc || 'Mastros, pontas captoras Franklin e fitas condutoras.', status: conditions.subCapitacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME') },
    { item: 'Subsistema de Descida', desc: conditions.subDescidaDesc || 'Fitas de descida, curvas normativas e fixações mecânicas.', status: conditions.subDescidaStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME') },
    { item: 'Subsistema de Aterramento', desc: conditions.subAterramentoDesc || 'Caixas de equalização, anel perimetral e hastes cobreadas.', status: conditions.subAterramentoStatus || (conditions.caixasInspecaoLimpas ? 'CONFORME' : 'NÃO CONFORME') },
    { item: 'Equipotencialização Metálica', desc: conditions.subEquipotencializacaoDesc || 'Interligação de massas metálicas da cobertura e rufos.', status: conditions.subEquipotencializacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME') },
  ];

  let subY = p4Y + 4.8;
  subsistemas.forEach((sub, sIdx) => {
    if (sIdx % 2 === 0) {
      pdf.setFillColor(250, 250, 250);
      pdf.rect(marginX, subY, contentWidth, 4.4, 'F');
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.4);
    pdf.setTextColor(30, 41, 59);
    pdf.text(sub.item, marginX + 3, subY + 3.1);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.2);
    pdf.setTextColor(71, 85, 105);
    pdf.text(sub.desc, marginX + 50, subY + 3.1, { maxWidth: contentWidth - 85 });

    pdf.setFont('helvetica', 'bold');
    if (sub.status === 'CONFORME') {
      pdf.setTextColor(22, 101, 52);
    } else if (sub.status === 'REQUER AJUSTES') {
      pdf.setTextColor(217, 119, 6);
    } else {
      pdf.setTextColor(220, 38, 38);
    }
    pdf.text(sub.status, marginX + contentWidth - 3, subY + 3.1, { align: 'right' });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, subY + 4.4, marginX + contentWidth, subY + 4.4);
    subY += 4.4;
  });

  p4Y = subY + 2.5;

  // Diretriz NBR 5410 de DPS
  pdf.setFillColor(254, 243, 199);
  pdf.setDrawColor(245, 158, 11);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(marginX, p4Y, contentWidth, 13.5, 1, 1, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.0);
  pdf.setTextColor(146, 64, 14);
  pdf.text('PROTEÇÃO CONTRA SURTOS EM QUADROS ELÉTRICOS (ABNT NBR 5410 / NBR 5419-4):', marginX + 4, p4Y + 4.2);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.4);
  pdf.setTextColor(180, 83, 9);
  const dpsText = 'Todos os quadros de distribuição (QGBTs, parciais e de comando) devem possuir Dispositivos de Proteção contra Surtos (DPS) coordenados tipo 1 e tipo 2 em pleno funcionamento. A ausência de DPS deixa circuitos e edificações vulneráveis a danos catastróficos.';
  pdf.text(pdf.splitTextToSize(dpsText, contentWidth - 8), marginX + 4, p4Y + 7.8);

  p4Y += 16.5;

  // ==========================================
  // SEÇÃO 6: VISTORIA E ENSAIOS TÉCNICOS POR TORRE
  // FLUXO CONTÍNUO INICIANDO NA PÁGINA 4 LOGO ABAIXO DA SEÇÃO 5
  // ==========================================
  onProgress?.(68, 'Gerando Vistorias Técnicas por Torre...');

  const PHOTO_COLS = 4;
  const PHOTO_WIDTH_MM = 36.0;  // Formato 3:4 vertical com tamanho aumentado (36.0mm)
  const PHOTO_IMG_H = 48.0;     // Proporção 3:4 vertical (36.0 * 4 / 3 = 48.0mm)
  const ROW_STEP = 54.0;        // 48.0mm imagem + 6.0mm legenda e espaçamento
  const FOOTER_SAFE_Y = 277.0;  // Linha do rodapé está em 281.0mm (margem de segurança)
  const MAX_ROWS_PER_PAGE = 5;  // Limite de 5 linhas por página

  let curTowerY = p4Y + 2.0;
  let isTowerSectionStarted = false;
  let rowsOnCurrentPage = 0;
  let currentPageHasSection5 = true;

  const startTowerPage = (titleStr: string) => {
    if (!isTowerSectionStarted) {
      // Primeira página de vistorias aproveita o espaço restante na Página 4 abaixo de Seção 5
      pdf.setFillColor(15, 23, 42);
      pdf.roundedRect(marginX, curTowerY, contentWidth, 7.5, 1, 1, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.8);
      pdf.setTextColor(255, 255, 255);
      pdf.text(titleStr, marginX + 4, curTowerY + 5.0);

      curTowerY += 10.5;
      rowsOnCurrentPage = 0;
      isTowerSectionStarted = true;
      currentPageHasSection5 = true;
      return;
    }

    pdf.addPage('a4', 'portrait');
    drawWatermark(pdf);
    drawHeaderLogo(pdf);

    pdf.setFillColor(15, 23, 42); // Azul escuro executivo
    pdf.roundedRect(marginX, 36, contentWidth, 7.5, 1, 1, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.8);
    pdf.setTextColor(255, 255, 255);
    pdf.text(titleStr, marginX + 4, 41.0);

    curTowerY = 46.5;
    rowsOnCurrentPage = 0;
    currentPageHasSection5 = false;
    isTowerSectionStarted = true;
  };

  towerGroups.forEach((group, gIdx) => {
    const totalPhotos = group.totalPhotos;
    if (totalPhotos === 0 && towerGroups.length > 1) {
      return;
    }

    onProgress?.(
      68 + Math.round(((gIdx + 1) / towerGroups.length) * 18),
      `Gerando Vistoria: ${group.towerName}...`
    );

    const towerTitle = `6.${gIdx + 1}) VISTORIA & ENSAIOS TÉCNICOS: ${group.towerName.toUpperCase()}`;
    const maxRowsForPage = currentPageHasSection5 ? 2 : MAX_ROWS_PER_PAGE;

    // Só inicia nova página se a seção não começou ou se o cabeçalho + 1 linha de fotos NÃO couberem
    if (!isTowerSectionStarted) {
      startTowerPage(towerTitle);
      isTowerSectionStarted = true;
    } else {
      if (rowsOnCurrentPage >= maxRowsForPage || curTowerY + 7.5 + 5.5 + PHOTO_IMG_H + 5.5 > FOOTER_SAFE_Y) {
        startTowerPage(towerTitle);
      } else {
        // Inicia a torre na mesma página em sequência contínua, preenchendo o espaço disponível
        curTowerY += 2;
        pdf.setFillColor(15, 23, 42);
        pdf.roundedRect(marginX, curTowerY, contentWidth, 7.5, 1, 1, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.8);
        pdf.setTextColor(255, 255, 255);
        pdf.text(towerTitle, marginX + 4, curTowerY + 5.0);
        curTowerY += 10.5;
      }
    }

    // 3 subseções canônicas por torre
    const subsections: Array<{
      num: string;
      title: string;
      photos: PhotoSlot[];
      isMeasure: boolean;
    }> = [
      {
        num: `6.${gIdx + 1}.1`,
        title: 'PONTOS DE INSPEÇÃO & ENSAIOS DE CONTINUIDADE ÔHMICA (MILIOHMÍMETRO)',
        photos: group.measurementPhotos,
        isMeasure: true,
      },
      {
        num: `6.${gIdx + 1}.2`,
        title: 'VISTORIA DO SPDA EXISTENTE, CAPTORES & DESCIDAS',
        photos: group.spdaPhotos,
        isMeasure: false,
      },
      {
        num: `6.${gIdx + 1}.3`,
        title: 'ANÁLISE DOS QUADROS DE ENERGIA & DPS (ABNT NBR 5410)',
        photos: group.quadrosPhotos,
        isMeasure: false,
      },
    ];

    subsections.forEach((sub) => {
      // Pula subseções que não possuem fotos para NÃO deixar faixas ou espaços vazios
      if (sub.photos.length === 0) return;

      const maxRowsForSub = currentPageHasSection5 ? 2 : MAX_ROWS_PER_PAGE;
      // Só quebra a página se realmente não couber o título da subseção e a primeira linha de fotos
      if (rowsOnCurrentPage >= maxRowsForSub || curTowerY + 5.5 + PHOTO_IMG_H + 5.5 > FOOTER_SAFE_Y) {
        startTowerPage(`${towerTitle} — ${sub.title} (CONTINUAÇÃO)`);
      }

      // Faixa compacta da subseção
      pdf.setFillColor(241, 245, 249);
      pdf.rect(marginX, curTowerY, contentWidth, 5.5, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.4);
      pdf.setTextColor(15, 23, 42);
      pdf.text(`${sub.num}) ${sub.title}`, marginX + 3, curTowerY + 3.8);
      curTowerY += 7.0;

      // Renderizar fotos em linhas de até 4 colunas preenchendo a página ao máximo
      const photoChunks = chunkArray(sub.photos, PHOTO_COLS);
      photoChunks.forEach((chunk) => {
        const maxRowsInChunk = currentPageHasSection5 ? 2 : MAX_ROWS_PER_PAGE;
        // Só quebra a página se a foto e sua legenda realmente forem ultrapassar a margem de segurança do rodapé
        if (rowsOnCurrentPage >= maxRowsInChunk || curTowerY + PHOTO_IMG_H + 5.5 > FOOTER_SAFE_Y) {
          startTowerPage(`${towerTitle} — ${sub.title} (CONTINUAÇÃO)`);
        }

        chunk.forEach((p, cIdx) => {
          const colSlot = contentWidth / PHOTO_COLS; // 42.5 mm por coluna
          const colLeft = marginX + cIdx * colSlot;
          const colCenter = colLeft + colSlot / 2;
          const x = colLeft + (colSlot - PHOTO_WIDTH_MM) / 2;
          const y = curTowerY;
          const imgData = photoJpegMap.get(p.id || p.url) || p.url;

          if (imgData) {
            pdf.addImage(imgData, 'JPEG', x, y, PHOTO_WIDTH_MM, PHOTO_IMG_H);
          }

          // Moldura sutil
          pdf.setDrawColor(226, 232, 240);
          pdf.setLineWidth(0.2);
          pdf.rect(x, y, PHOTO_WIDTH_MM, PHOTO_IMG_H);

          // Legenda e identificador de não-conformidade
          const cap = (p.caption || '').trim();
          const val = (p.measurementValue || '').trim();
          const capLower = cap.toLowerCase();

          const isFaltaDps = /falta\s*dps|sem\s*dps|instalar\s*dps|aus[eê]ncia\s*de\s*dps/i.test(capLower);
          const isFaltaEquipot = /falta\s*equipot|n[aã]o\s*equipot|equipotencializar|precisa\s*equipot/i.test(capLower);

          let labelY = y + PHOTO_IMG_H + 1.8;

          if (isFaltaDps) {
            pdf.setFillColor(254, 226, 226);
            pdf.roundedRect(colLeft + 2, labelY - 1.6, colSlot - 4, 2.8, 0.4, 0.4, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(5.0);
            pdf.setTextColor(185, 28, 28);
            pdf.text('⚠ FALTA DPS', colCenter, labelY + 0.3, { align: 'center' });
            labelY += 3.2;
          } else if (isFaltaEquipot) {
            pdf.setFillColor(254, 243, 199);
            pdf.roundedRect(colLeft + 2, labelY - 1.6, colSlot - 4, 2.8, 0.4, 0.4, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(5.0);
            pdf.setTextColor(180, 83, 9);
            pdf.text('⚠ FALTA EQUIPOTENCIALIZAR', colCenter, labelY + 0.3, { align: 'center' });
            labelY += 3.2;
          }

          // Texto descritivo
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(5.8);
          pdf.setTextColor(15, 23, 42);
          const fullDesc = [cap || 'Registro de inspeção', val ? `(${val})` : ''].filter(Boolean).join(' ');
          const splitLines = pdf.splitTextToSize(fullDesc, colSlot - 2);
          pdf.text(splitLines.slice(0, 2), colCenter, labelY, {
            align: 'center',
            maxWidth: colSlot - 2,
          });
        });

        curTowerY += ROW_STEP;
        rowsOnCurrentPage++;
      });

      curTowerY += 1.5;
    });
  });

  // ==========================================
  // PÁGINA FINAL UNIFICADA: 7) RECOMENDAÇÕES PRIORITÁRIAS,
  // 8) CONCLUSÃO TÉCNICA FINAL, FECHAMENTO & ASSINATURA DO CREA
  // Alocados em sequência contínua sem criar espaço vazio
  // ==========================================
  onProgress?.(94, 'Gerando Recomendações Técnicas, Conclusão & Assinatura...');

  let finalY: number;
  if (!currentPageHasSection5 && curTowerY + 115 <= FOOTER_SAFE_Y && rowsOnCurrentPage <= 2) {
    // Se a última torre terminou no início/meio da página e sobra espaço, aloca em sequência contínua
    finalY = curTowerY + 6;
  } else {
    pdf.addPage('a4', 'portrait');
    drawWatermark(pdf);
    drawHeaderLogo(pdf);
    finalY = 36;
  }

  // 7) CORREÇÕES NECESSÁRIAS (RECOMENDAÇÕES)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('7) CORREÇÕES NECESSÁRIAS PARA PROTEÇÃO DAS EDIFICAÇÕES', marginX, finalY);

  finalY += 4.5;
  pdf.setFillColor(229, 231, 235);
  pdf.rect(marginX, finalY, contentWidth, 5.5, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.8);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Recomendações Técnicas Prioritárias', 105, finalY + 4.0, { align: 'center' });

  finalY += 8.5;
  pdf.setTextColor(220, 38, 38);
  pdf.setFontSize(7.5);
  texts.recomendacoes.forEach((rec, idx) => {
    pdf.setFont('helvetica', 'bold');
    pdf.text(`7.${idx + 1}- `, marginX, finalY);
    pdf.setFont('helvetica', 'normal');
    const recLines = pdf.splitTextToSize(rec, contentWidth - 12);
    pdf.text(recLines, marginX + 8, finalY);
    finalY += recLines.length * 3.6 + 1.8;
  });

  // Frase final de fechamento das recomendações
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.8);
  pdf.setTextColor(220, 38, 38);
  const fraseFinalLines = pdf.splitTextToSize(texts.recomendacoesTextoFinal, contentWidth);
  pdf.text(fraseFinalLines, marginX, finalY + 2);
  finalY += fraseFinalLines.length * 3.8 + 6;

  // Linha divisória suave
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.3);
  pdf.line(marginX, finalY, marginX + contentWidth, finalY);
  finalY += 6;

  // 8) CONCLUSÃO FINAL DESTE RELATÓRIO
  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.text('8) CONCLUSÃO FINAL DESTE RELATÓRIO TÉCNICO', marginX, finalY);

  finalY += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.6);
  pdf.setTextColor(30, 41, 59);
  const conclusaoLines = pdf.splitTextToSize(texts.conclusaoFinal, contentWidth);
  pdf.text(conclusaoLines, marginX, finalY);
  finalY += conclusaoLines.length * 3.8 + 5;

  // Termo de Encerramento e ART
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(marginX, finalY, contentWidth, 18, 1, 1, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('DISPOSIÇÕES FINAIS & VALIDADE DA INSPEÇÃO:', marginX + 4, finalY + 5);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.8);
  pdf.setTextColor(51, 65, 85);
  const artTermo = `Este laudo possui validade técnica de 1 (um) ano a partir da data de emissão, ou conforme periodicidade de inspeção estipulada pela NBR 5419-3:2026 (Tabela 6). O responsável técnico declara que todas as medições foram efetuadas conforme os preceitos éticos e regulamentares do CREA.`;
  pdf.text(pdf.splitTextToSize(artTermo, contentWidth - 8), marginX + 4, finalY + 9.5);

  finalY += 23;

  // Cidade e Data
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text(`${client.cidadeEmissao}, ${client.dataEmissaoExtenso}.`, marginX, finalY, { maxWidth: contentWidth });

  const sig = report.digitalSignature;
  const isSigEnabled = sig?.enabled ?? false;
  const signerName = sig?.signerName || client.tecnico;
  const signerRole = sig?.signerRole || client.cargo;
  const signerCrea = sig?.signerCrea || client.crea;
  const signerArt = sig?.signerArt || client.art;

  if (isSigEnabled) {
    finalY += 14;

    // Se houver imagem da assinatura, desenha acima da linha com destaque
    if (sig?.imageUrl) {
      try {
        const sigW = 46;
        const sigH = 15;
        const sigX = 105 - sigW / 2;
        const sigY = finalY - 14;
        const format = sig.imageUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(sig.imageUrl, format, sigX, sigY, sigW, sigH, undefined, 'FAST');
      } catch (e) {
        console.warn('Erro ao inserir imagem de assinatura no PDF:', e);
      }
    } else {
      // Assinatura digital estilizada em texto
      pdf.setFont('times', 'italic');
      pdf.setFontSize(13);
      pdf.setTextColor(30, 58, 138); // Blue 900
      pdf.text(signerName, 105, finalY - 2.5, { align: 'center', maxWidth: 120 });
    }

    // Linha de Assinatura Centralizada
    pdf.setDrawColor(15, 23, 42);
    pdf.setLineWidth(0.4);
    pdf.line(60, finalY, 150, finalY);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.0);
    pdf.setTextColor(15, 23, 42);
    pdf.text(signerName, 105, finalY + 4.5, { align: 'center', maxWidth: 140 });

    pdf.setFontSize(7.8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(51, 65, 85);
    pdf.text(signerRole, 105, finalY + 8.5, { align: 'center', maxWidth: 140 });

    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(15, 23, 42);
    const creaArtText = signerArt ? `${signerCrea} | ART: ${signerArt}` : signerCrea;
    pdf.text(creaArtText, 105, finalY + 12.5, { align: 'center', maxWidth: 140 });

    // Selo de Autenticação Digital e Validação ICP / CREA
    if (sig?.showValidationStamp) {
      const stampY = finalY + 15.5;
      const stampW = 126;
      const stampH = 15.5;
      const stampX = 105 - stampW / 2;

      pdf.setFillColor(248, 250, 252);
      pdf.setDrawColor(37, 99, 235);
      pdf.setLineWidth(0.4);
      pdf.roundedRect(stampX, stampY, stampW, stampH, 1, 1, 'FD');

      pdf.setDrawColor(191, 219, 254);
      pdf.setLineWidth(0.2);
      pdf.rect(stampX + 0.8, stampY + 0.8, stampW - 1.6, stampH - 1.6);

      // Título do Certificado
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.5);
      pdf.setTextColor(30, 58, 138);
      pdf.text('CERTIFICAÇÃO DIGITAL - PADRÃO CREA / NBR 5419:2026', stampX + 3.5, stampY + 4);

      pdf.setFontSize(5.8);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(51, 65, 85);
      pdf.text(`Assinado digitalmente por: ${signerName} (${signerCrea})`, stampX + 3.5, stampY + 7.5);
      pdf.text(`Data/Hora: ${sig.signedAt || client.dataEmissaoExtenso}${signerArt ? ` | ART: ${signerArt}` : ''}`, stampX + 3.5, stampY + 10.8);

      pdf.setFont('courier', 'bold');
      pdf.setFontSize(5.2);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Hash SHA-256: ${sig.hashSha256 || 'VALID-SIGNATURE'}`, stampX + 3.5, stampY + 13.8);
    }
  } else {
    finalY += 18;

    // Bloco Centralizado Tradicional (sem assinatura digital)
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.4);
    pdf.line(65, finalY, 145, finalY);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.0);
    pdf.setTextColor(0, 0, 0);
    pdf.text(client.tecnico, 105, finalY + 5, { align: 'center', maxWidth: 140 });

    pdf.setFontSize(8.0);
    pdf.setFont('helvetica', 'normal');
    pdf.text(client.cargo, 105, finalY + 9.5, { align: 'center', maxWidth: 140 });

    pdf.setFont('helvetica', 'bold');
    pdf.text(client.crea, 105, finalY + 14, { align: 'center', maxWidth: 140 });
  }

  // ==========================================================
  // SEGUNDO PASSO: APLICAÇÃO DE RODAPÉS COM NÚMERO TOTAL REAL DE PÁGINAS
  // ==========================================================
  const totalRealPages = pdf.getNumberOfPages();
  for (let p = 1; p <= totalRealPages; p++) {
    pdf.setPage(p);
    drawFooter(pdf, p, totalRealPages);
  }

  onProgress?.(100, 'Arquivo PDF compilado com sucesso!');

  const now = new Date();
  const fileName = generateSequentialPdfFileName(client.name, now, report.torreAtual);

  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);

  return { blob, url, fileName };
};
