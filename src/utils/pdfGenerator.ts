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
          const out = canvas.toDataURL('image/jpeg', 0.96);
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
 * Carrega a foto original enviada pelo usuário SEM redimensionar e SEM cortar.
 * Preserva 100% da imagem na sua proporção nativa para que seja inserida no laudo
 * (PDF e DOCX) exatamente da mesma forma como foi enviada ao sistema.
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
        const width = img.naturalWidth || img.width || 800;
        const height = img.naturalHeight || img.height || 600;
        const aspect = width / height;

        // Se já for data URL JPEG ou PNG, usa diretamente preservando 100% dos bytes originais
        if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) {
          resolve({
            dataUrl: url,
            width,
            height,
            aspect,
            format: 'JPEG',
          });
          return;
        }

        if (url.startsWith('data:image/png')) {
          resolve({
            dataUrl: url,
            width,
            height,
            aspect,
            format: 'PNG',
          });
          return;
        }

        // Para blob, svg, webp ou url externa, desenha na resolução nativa 1:1 sem redimensionar nem cortar
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          disposeCanvas(canvas);
          img.src = '';
          resolve({
            dataUrl: url,
            width,
            height,
            aspect,
            format: 'JPEG',
          });
          return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const safeDataUrl = canvas.toDataURL('image/jpeg', 0.96);
        disposeCanvas(canvas);
        img.src = '';
        resolve({
          dataUrl: safeDataUrl,
          width,
          height,
          aspect,
          format: 'JPEG',
        });
      } catch (err) {
        console.error('Erro ao processar foto original sem corte:', err);
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
  targetWidth = 900, // 38.5mm (~600 DPI para impressão ultra-nítida e sem granulação)
  targetHeight = 1125, // 48.0mm
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
          ctx.lineWidth = Math.max(3, targetWidth * 0.009);
          ctx.strokeStyle = '#dc2626';
          ctx.stroke();

          // Inner center point matching CircleFocusModal
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(2, targetWidth * 0.0045), 0, 2 * Math.PI);
          ctx.fillStyle = '#dc2626';
          ctx.fill();

          ctx.restore();
        }

        const out = canvas.toDataURL('image/jpeg', 0.95);
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
    Promise.all(spdaPhotos.map((p) => processPhotoForPdf(p, 770, 960, p.hasRedCircleMarker ?? true))),
    Promise.all(measurementPhotos.map((p) => processPhotoForPdf(p, 770, 840, false))),
    Promise.all(quadrosPhotos.map((p) => processPhotoForPdf(p, 770, 840, p.hasRedCircleMarker ?? false))),
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
  // PÁGINA 3: 3) CARACTERÍSTICAS DA EDIFICAÇÃO & VISTA AÉREA (EM DESTAQUE)
  // Cada foto do local agora ganha sua própria sessão/seção em destaque com título próprio
  // ==========================================
  const validLocalInfos = localPhotoInfos.filter((item): item is UncroppedPhotoData => Boolean(item));
  const isMultiTower =
    Boolean(client.quantidadeTorres && client.quantidadeTorres > 1) ||
    Boolean(client.torresNomes && client.torresNomes.length > 1) ||
    Object.keys(report.torresData || {}).length > 1 ||
    new Set([...spdaPhotos, ...measurementPhotos, ...quadrosPhotos].map((p) => p.towerName).filter(Boolean)).size > 1;

  onProgress?.(48, 'Gerando Características do Local e Fotos em Destaque...');
  pdf.addPage('a4', 'portrait');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  // 3) CARACTERÍSTICAS DO LOCAL
  let locY = 36;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('3) CARACTERÍSTICAS DA EDIFICAÇÃO & LOCAL', marginX, locY);

  locY += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.8);
  const rawLocDesc = (client.descricaoBloco || texts.caracteristicasLocal || '').trim();
  const isExcludedLocDesc =
    !rawLocDesc ||
    /^(?:torre\s*\d+|torre\s*\/\s*estrutura|estrutura\s*\/\s*torre)$/i.test(rawLocDesc);
  if (!isExcludedLocDesc) {
    const locDescLines = pdf.splitTextToSize(rawLocDesc, contentWidth);
    pdf.text(locDescLines, marginX, locY);
    locY += locDescLines.length * 4.0 + 3;
  }

  if (validLocalInfos.length >= 2) {
    // -------------------------------------------------------------------------
    // CASO COM VISTA AÉREA E FACHADA: CADA UMA EM SUA SESSÃO EM GRANDE DESTAQUE!
    // Mantém a proporção nativa da foto sem cortar e sem redimensionar/esticar
    // -------------------------------------------------------------------------
    // 1. SESSÃO: VISTA AÉREA (NA PÁGINA 3)
    pdf.setFillColor(241, 245, 249);
    pdf.rect(marginX, locY, contentWidth, 6, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.2);
    pdf.setTextColor(15, 23, 42);
    pdf.text('3.1) VISTA AÉREA DA EDIFICAÇÃO / IMAGEM SATÉLITE', marginX + 4, locY + 4.2);
    locY += 8;

    // Foto da Vista Aérea na sua proporção nativa sem corte, estritamente limitada pela largura do documento
    const aereaInfo = validLocalInfos[0];
    const { width: photoWidth, height: photoHeight } = calculateContainedDimensions(
      aereaInfo.aspect,
      contentWidth, // 170mm máximo (largura útil entre margens laterais)
      105 // altura máxima na página 3, permitindo que fotos em proporção paisagem preencham a largura total
    );

    const photoX = marginX + (contentWidth - photoWidth) / 2;
    pdf.addImage(aereaInfo.dataUrl, aereaInfo.format, photoX, locY, photoWidth, photoHeight);
    locY += photoHeight + 3.5;

    // Legenda da Vista Aérea
    const aereaCap = localPhotos[0]?.caption?.trim() || 'Vista aérea da edificação, circunvizinhança e posicionamento geográfico do condomínio.';
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(51, 65, 85);
    pdf.text(aereaCap, 105, locY, { align: 'center', maxWidth: photoWidth });
    locY += 6;

    // Parâmetros construtivos
    pdf.setFillColor(241, 245, 249);
    pdf.rect(marginX, locY, contentWidth, 5.5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('PARÂMETROS CONSTRUTIVOS & INFRAESTRUTURA DA EDIFICAÇÃO (NBR 5419:2026)', marginX + 4, locY + 3.8);

    const parametros = [
      { param: 'Tipologia Construtiva:', valor: 'Alvenaria Convencional / Estrutura em Concreto Armado' },
      { param: 'Topografia & Entorno:', valor: 'Terreno Urbano Plano com Edificações Vizinhas' },
      { param: 'Nível de Proteção Dimensionado:', valor: 'Nível III / IV (NBR 5419-2:2026 - Gerenciamento de Risco)' },
      { param: 'Métodos de Proteção Aplicáveis:', valor: 'Ângulo de Proteção (Franklin) e Condutores em Malha (Faraday)' },
    ];

    let paramY = locY + 5.5;
    parametros.forEach((p, pIdx) => {
      if (pIdx % 2 === 0) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(marginX, paramY, contentWidth, 5.0, 'F');
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.0);
      pdf.setTextColor(30, 41, 59);
      pdf.text(p.param, marginX + 3, paramY + 3.6);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.0);
      pdf.setTextColor(71, 85, 105);
      pdf.text(p.valor, marginX + 55, paramY + 3.6, { maxWidth: contentWidth - 58 });

      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.2);
      pdf.line(marginX, paramY + 5.0, marginX + contentWidth, paramY + 5.0);
      paramY += 5.0;
    });

    // PÁGINA 4: 2. SESSÃO: FACHADA PRINCIPAL EM GRANDE DESTAQUE & 4) HISTÓRICO
    pdf.addPage('a4', 'portrait');
    drawWatermark(pdf);
    drawHeaderLogo(pdf);

    let facY = 36;
    pdf.setFillColor(241, 245, 249);
    pdf.rect(marginX, facY, contentWidth, 6, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.2);
    pdf.setTextColor(15, 23, 42);
    pdf.text('3.2) FACHADA PRINCIPAL DA EDIFICAÇÃO / CONDOMÍNIO', marginX + 4, facY + 4.2);
    facY += 8;

    // Foto da Fachada na sua proporção nativa sem corte, estritamente limitada pela largura do documento
    const facInfo = validLocalInfos[1];
    const facMaxH = validLocalInfos[2] ? 85 : 110;
    const { width: facWidth, height: facHeight } = calculateContainedDimensions(
      facInfo.aspect,
      contentWidth, // 170mm máximo
      facMaxH // altura máxima proporcional na página 4
    );

    const facX = marginX + (contentWidth - facWidth) / 2;
    pdf.addImage(facInfo.dataUrl, facInfo.format, facX, facY, facWidth, facHeight);
    facY += facHeight + 3.5;

    // Legenda da Fachada
    const fachadaCap = localPhotos[1]?.caption?.trim() || 'Fachada principal da edificação, estrutura predial e acessos vistoriados.';
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(51, 65, 85);
    pdf.text(fachadaCap, 105, facY, { align: 'center', maxWidth: facWidth });
    facY += 6;

    // Foto de entrada se existir (3ª foto)
    if (validLocalInfos[2]) {
      pdf.setFillColor(241, 245, 249);
      pdf.rect(marginX, facY, contentWidth, 5.5, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.8);
      pdf.setTextColor(15, 23, 42);
      pdf.text('3.3) ENTRADA / ACESSO PRINCIPAL', marginX + 4, facY + 3.8);
      facY += 7;

      const p3 = validLocalInfos[2];
      const { width: w3, height: h3 } = calculateContainedDimensions(
        p3.aspect,
        Math.min(150, contentWidth),
        55
      );
      const x3 = marginX + (contentWidth - w3) / 2;
      pdf.addImage(p3.dataUrl, p3.format, x3, facY, w3, h3);
      facY += h3 + 3;

      const entradaCap = localPhotos[2]?.caption?.trim() || 'Portaria e acesso principal à edificação.';
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.0);
      pdf.setTextColor(71, 85, 105);
      pdf.text(entradaCap, 105, facY, { align: 'center', maxWidth: w3 });
      facY += 5;
    }

    // Texto de Ramo de atividade e nível de exposição
    const exposicaoText = `A edificação é de uso ${client.ramoAtividade} com presença de moradores e equipamentos eletrônicos e está localizada numa área de ${client.exposicaoNivel || 'baixa EXPOSIÇÃO'} a descargas atmosféricas e seus efeitos indiretos.`;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(30, 41, 59);
    const expLines = pdf.splitTextToSize(exposicaoText, contentWidth);
    pdf.text(expLines, marginX, facY);
    facY += expLines.length * 3.8 + 3;

    // Linha sutil divisória
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.line(marginX, facY, marginX + contentWidth, facY);
    facY += 4;

    // 4) HISTÓRICO DE PROBLEMAS
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS', marginX, facY);

    facY += 5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(30, 41, 59);

    const hist1 = `4.1- Devido à localização e infraestrutura da edificação, constata-se: ${client.historicoQueimaOcorrencias || '2 problemas de queima de equipamentos eletroeletrônicos'}.`;
    const histLines1 = pdf.splitTextToSize(hist1, contentWidth);
    pdf.text(histLines1, marginX, facY);
    facY += histLines1.length * 3.8 + 2;

    const hist2 = `4.2- A ocorrência de problemas com equipamentos se deve ao fato de descargas nas proximidades gerarem pulsos eletromagnéticos que viajam pela rede elétrica sem blindagem suficiente. Com isso, é indispensável a instalação de supressores de surtos (DPS) coordenados nos quadros de distribuição.`;
    const histLines2 = pdf.splitTextToSize(hist2, contentWidth);
    pdf.text(histLines2, marginX, facY);

  } else if (validLocalInfos.length === 1) {
    // 1 foto do local em destaque na Página 3 na proporção nativa sem corte, estritamente limitada pela largura do documento
    pdf.setFillColor(241, 245, 249);
    pdf.rect(marginX, locY, contentWidth, 6, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.2);
    pdf.setTextColor(15, 23, 42);
    pdf.text('3.1) REGISTRO FOTOGRÁFICO DO LOCAL / FACHADA', marginX + 4, locY + 4.2);
    locY += 8;

    const singleInfo = validLocalInfos[0];
    const { width: photoWidth, height: photoHeight } = calculateContainedDimensions(
      singleInfo.aspect,
      contentWidth, // 170mm máximo
      105 // altura máxima na página 3
    );

    const photoX = marginX + (contentWidth - photoWidth) / 2;
    pdf.addImage(singleInfo.dataUrl, singleInfo.format, photoX, locY, photoWidth, photoHeight);
    locY += photoHeight + 3.5;

    const cap = localPhotos[0]?.caption?.trim() || 'Foto do local e estrutura da edificação.';
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(51, 65, 85);
    pdf.text(cap, 105, locY, { align: 'center', maxWidth: photoWidth });
    locY += 6;


    // Ramo de atividade
    const exposicaoText = `A edificação é de uso ${client.ramoAtividade} com presença de moradores e equipamentos eletrônicos e está localizada numa área de ${client.exposicaoNivel || 'baixa EXPOSIÇÃO'} a descargas atmosféricas e seus efeitos indiretos.`;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(30, 41, 59);
    const expLines = pdf.splitTextToSize(exposicaoText, contentWidth);
    pdf.text(expLines, marginX, locY);
    locY += expLines.length * 3.8 + 4;

    // Linha divisória
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.line(marginX, locY, marginX + contentWidth, locY);
    locY += 5;

    // 4) HISTÓRICO DE PROBLEMAS
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS', marginX, locY);

    locY += 5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(30, 41, 59);

    const hist1 = `4.1- Devido à localização e infraestrutura da edificação, constata-se: ${client.historicoQueimaOcorrencias || '2 problemas de queima de equipamentos eletroeletrônicos'}.`;
    const histLines1 = pdf.splitTextToSize(hist1, contentWidth);
    pdf.text(histLines1, marginX, locY);
    locY += histLines1.length * 3.8 + 2;

    const hist2 = `4.2- A ocorrência de problemas com equipamentos se deve ao fato de descargas nas proximidades gerarem pulsos eletromagnéticos que viajam pela rede elétrica sem blindagem suficiente. Com isso, é indispensável a instalação de supressores de surtos (DPS) coordenados nos quadros de distribuição.`;
    const histLines2 = pdf.splitTextToSize(hist2, contentWidth);
    pdf.text(histLines2, marginX, locY);

  } else {
    // Sem fotos do local cadastradas: Página 3 completa sem espaços vazios
    pdf.setFillColor(241, 245, 249);
    pdf.rect(marginX, locY, contentWidth, 6, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.0);
    pdf.setTextColor(15, 23, 42);
    pdf.text('PARÂMETROS CONSTRUTIVOS & INFRAESTRUTURA DA EDIFICAÇÃO (NBR 5419:2026)', marginX + 4, locY + 4.2);

    const parametros = [
      { param: 'Tipologia Construtiva:', valor: 'Alvenaria Convencional / Estrutura em Concreto Armado' },
      { param: 'Topografia & Entorno:', valor: 'Terreno Urbano Plano com Edificações Vizinhas' },
      { param: 'Nível de Proteção Dimensionado:', valor: 'Nível III / IV (NBR 5419-2:2026 - Gerenciamento de Risco)' },
      { param: 'Métodos de Proteção Aplicáveis:', valor: 'Ângulo de Proteção (Franklin) e Condutores em Malha (Faraday)' },
    ];

    let paramY = locY + 6;
    parametros.forEach((p, pIdx) => {
      if (pIdx % 2 === 0) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(marginX, paramY, contentWidth, 6.0, 'F');
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.2);
      pdf.setTextColor(30, 41, 59);
      pdf.text(p.param, marginX + 3, paramY + 4.2);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.2);
      pdf.setTextColor(71, 85, 105);
      pdf.text(p.valor, marginX + 55, paramY + 4.2, { maxWidth: contentWidth - 58 });

      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.2);
      pdf.line(marginX, paramY + 6.0, marginX + contentWidth, paramY + 6.0);
      paramY += 6.0;
    });
    locY = paramY + 3;

    const exposicaoText = `A edificação é de uso ${client.ramoAtividade} com presença de moradores e equipamentos eletrônicos e está localizada numa área de ${client.exposicaoNivel || 'baixa EXPOSIÇÃO'} a descargas atmosféricas e seus efeitos indiretos.`;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(30, 41, 59);
    const expLines = pdf.splitTextToSize(exposicaoText, contentWidth);
    pdf.text(expLines, marginX, locY);
    locY += expLines.length * 3.8 + 4;

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.line(marginX, locY, marginX + contentWidth, locY);
    locY += 5;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS', marginX, locY);

    locY += 5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(30, 41, 59);

    const hist1 = `4.1- Devido à localização e infraestrutura da edificação, constata-se: ${client.historicoQueimaOcorrencias || '2 problemas de queima de equipamentos eletroeletrônicos'}.`;
    const histLines1 = pdf.splitTextToSize(hist1, contentWidth);
    pdf.text(histLines1, marginX, locY);
    locY += histLines1.length * 3.8 + 2;

    const hist2 = `4.2- A ocorrência de problemas com equipamentos se deve ao fato de descargas nas proximidades gerarem pulsos eletromagnéticos que viajam pela rede elétrica sem blindagem suficiente. Com isso, é indispensável a instalação de supressores de surtos (DPS) coordenados nos quadros de distribuição.`;
    const histLines2 = pdf.splitTextToSize(hist2, contentWidth);
    pdf.text(histLines2, marginX, locY);
    locY += histLines2.length * 3.8 + 4;
  }



  // ==========================================================
  // SEÇÃO 5: INSTRUMENTAÇÃO TÉCNICA E PARÂMETROS NORMATIVOS (NBR 5419:2026 / NBR 5410)
  // ==========================================================
  onProgress?.(55, 'Gerando Seção 5: Instrumentação e Critérios Normativos...');
  pdf.addPage('a4', 'portrait');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('5) INSTRUMENTAÇÃO TÉCNICA E CRITÉRIOS DE INSPEÇÃO', marginX, 36);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(30, 41, 59);
  const medContLines = pdf.splitTextToSize(texts.medicoesContinuidadeTexto, contentWidth);
  pdf.text(medContLines, marginX, 41);

  let instY = 41 + medContLines.length * 3.6 + 2;

  // Painel com Foto do Miliohmímetro e Especificações Técnicas
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(marginX, instY, contentWidth, 38, 1, 1, 'FD');

  if (equipmentPhotoInfo?.dataUrl) {
    try {
      const { width: eqW, height: eqH } = calculateContainedDimensions(
        equipmentPhotoInfo.aspect,
        45,
        34
      );
      const eqX = marginX + 3 + (45 - eqW) / 2;
      const eqY = instY + 2 + (34 - eqH) / 2;
      pdf.addImage(equipmentPhotoInfo.dataUrl, equipmentPhotoInfo.format, eqX, eqY, eqW, eqH);
    } catch (e) {
      console.warn('Erro ao inserir foto do miliohmímetro no PDF:', e);
    }
  }

  const eqTextX = equipmentPhotoInfo?.dataUrl ? marginX + 52 : marginX + 5;
  const eqTextW = equipmentPhotoInfo?.dataUrl ? contentWidth - 55 : contentWidth - 10;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.2);
  pdf.setTextColor(15, 23, 42);
  pdf.text(
    `Miliohmímetro ${texts.equipamentoModelo} - Marca: ${texts.equipamentoMarca}`,
    eqTextX,
    instY + 6.5
  );

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.0);
  pdf.setTextColor(71, 85, 105);
  const eqDescLines = pdf.splitTextToSize(texts.equipamentoDescricao, eqTextW);
  pdf.text(eqDescLines, eqTextX, instY + 11);

  let eqDetY = instY + 11 + eqDescLines.length * 3.4 + 2;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.0);
  pdf.setTextColor(30, 41, 59);
  pdf.text(`Local de Aplicação: `, eqTextX, eqDetY);
  pdf.setFont('helvetica', 'normal');
  pdf.text(texts.medicoesLocal || 'Estruturas prediais e barramentos', eqTextX + 27, eqDetY);

  eqDetY += 4.0;
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Corrente Injetada: `, eqTextX, eqDetY);
  pdf.setFont('helvetica', 'normal');
  pdf.text(texts.medicoesCorrenteAplicada || '10 A DC contínua', eqTextX + 25, eqDetY);

  eqDetY += 4.0;
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Tipo de Ensaio: `, eqTextX, eqDetY);
  pdf.setFont('helvetica', 'normal');
  pdf.text(texts.medicoesTipoCorrente || 'Método de 4 Terminais (Kelvin)', eqTextX + 21, eqDetY);

  instY += 41;

  // Tabela de Parâmetros Normativos NBR 5419:2026
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, instY, contentWidth, 5.5, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('PARÂMETROS NORMATIVOS DE CONTINUIDADE (ABNT NBR 5419:2026)', marginX + 4, instY + 4.0);

  const criteriosNormativos = [
    { item: 'Continuidade de Armaduras e Malhas', norma: 'NBR 5419-3:2026 (Item 5.3.5)', limite: '≤ 0,200 Ω (200 mΩ)', status: 'CONFORME' },
    { item: 'Resistência de Equipotencialização', norma: 'NBR 5419-3:2026 (Item 6.2)', limite: '≤ 0,200 Ω (200 mΩ)', status: 'CONFORME' },
    { item: 'Método de 4 Terminais (Kelvin)', norma: 'Injeção de corrente contínua DC', limite: 'Elimina resist. pontas', status: 'APLICADO' },
    { item: 'Estado das Caixas de Inspeção', norma: 'Aterramento & Equalização BEP', limite: 'Limpas e desobstruídas', status: conditions.caixasInspecaoLimpas ? 'CONFORME' : 'LIMPEZA PENDENTE' },
  ];

  let critNormY = instY + 5.5;
  criteriosNormativos.forEach((crit, cIdx) => {
    if (cIdx % 2 === 0) {
      pdf.setFillColor(250, 250, 250);
      pdf.rect(marginX, critNormY, contentWidth, 5.2, 'F');
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.setTextColor(30, 41, 59);
    pdf.text(crit.item, marginX + 3, critNormY + 3.8);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.8);
    pdf.setTextColor(71, 85, 105);
    pdf.text(crit.norma, marginX + 63, critNormY + 3.8);

    pdf.setFont('helvetica', 'bold');
    pdf.text(crit.limite, marginX + 112, critNormY + 3.8);

    pdf.setFont('helvetica', 'bold');
    if (crit.status === 'CONFORME' || crit.status === 'APLICADO') {
      pdf.setTextColor(22, 101, 52);
    } else {
      pdf.setTextColor(217, 119, 6);
    }
    pdf.text(crit.status, marginX + contentWidth - 3, critNormY + 3.8, { align: 'right' });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, critNormY + 5.2, marginX + contentWidth, critNormY + 5.2);
    critNormY += 5.2;
  });

  instY = critNormY + 3.5;

  // Painel de Parecer Técnico Visual da Vistoria
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(marginX, instY, contentWidth, 22, 1, 1, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('ANÁLISE PERICIAL DA INSPEÇÃO VISUAL IN LOCO:', marginX + 4, instY + 4.5);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.8);
  pdf.setTextColor(51, 65, 85);
  const analiseLines = pdf.splitTextToSize(texts.vistoriaSpdaAnalise, contentWidth - 8);
  pdf.text(analiseLines, marginX + 4, instY + 8.5);

  instY += 25.5;

  // Tabela dos Subsistemas Vistoriados
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, instY, contentWidth, 5.5, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('AVALIAÇÃO ESTRUTURAL DOS SUBSISTEMAS DO SPDA (NBR 5419:2026)', marginX + 4, instY + 4.0);

  const subsistemas = [
    { item: 'Subsistema de Captação', desc: conditions.subCapitacaoDesc || 'Mastros, pontas captoras Franklin e fitas condutoras.', status: conditions.subCapitacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME') },
    { item: 'Subsistema de Descida', desc: conditions.subDescidaDesc || 'Fitas de descida, curvas normativas e fixações mecânicas.', status: conditions.subDescidaStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME') },
    { item: 'Subsistema de Aterramento', desc: conditions.subAterramentoDesc || 'Caixas de equalização, anel perimetral e hastes cobreadas.', status: conditions.subAterramentoStatus || (conditions.caixasInspecaoLimpas ? 'CONFORME' : 'NÃO CONFORME') },
    { item: 'Equipotencialização Metálica', desc: conditions.subEquipotencializacaoDesc || 'Interligação de massas metálicas da cobertura e rufos.', status: conditions.subEquipotencializacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME') },
  ];

  let subY = instY + 5.5;
  subsistemas.forEach((sub, sIdx) => {
    if (sIdx % 2 === 0) {
      pdf.setFillColor(250, 250, 250);
      pdf.rect(marginX, subY, contentWidth, 5.2, 'F');
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.setTextColor(30, 41, 59);
    pdf.text(sub.item, marginX + 3, subY + 3.8);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(71, 85, 105);
    pdf.text(sub.desc, marginX + 50, subY + 3.8, { maxWidth: contentWidth - 85 });

    pdf.setFont('helvetica', 'bold');
    if (sub.status === 'CONFORME') {
      pdf.setTextColor(22, 101, 52);
    } else if (sub.status === 'REQUER AJUSTES') {
      pdf.setTextColor(217, 119, 6);
    } else {
      pdf.setTextColor(220, 38, 38);
    }
    pdf.text(sub.status, marginX + contentWidth - 3, subY + 3.8, { align: 'right' });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, subY + 5.2, marginX + contentWidth, subY + 5.2);
    subY += 5.2;
  });

  instY = subY + 3.5;

  // Diretriz NBR 5410 de DPS
  pdf.setFillColor(254, 243, 199);
  pdf.setDrawColor(245, 158, 11);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(marginX, instY, contentWidth, 14, 1, 1, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.0);
  pdf.setTextColor(146, 64, 14);
  pdf.text('PROTEÇÃO CONTRA SURTOS EM QUADROS ELÉTRICOS (ABNT NBR 5410 / NBR 5419-4):', marginX + 4, instY + 4.2);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.4);
  pdf.setTextColor(180, 83, 9);
  const dpsText = 'Todos os quadros de distribuição (QGBTs, parciais e de comando) devem possuir Dispositivos de Proteção contra Surtos (DPS) coordenados tipo 1 e tipo 2 em pleno funcionamento. A ausência de DPS deixa circuitos e edificações vulneráveis a danos catastróficos.';
  pdf.text(pdf.splitTextToSize(dpsText, contentWidth - 8), marginX + 4, instY + 7.8);

  // ==========================================
  // SEÇÃO 6: VISTORIA E ENSAIOS TÉCNICOS POR TORRE
  // ==========================================
  // SEÇÃO 6: VISTORIA E ENSAIOS TÉCNICOS POR TORRE
  // FORMATO POR TORRE ("VÁRIOS LAUDOS DENTRO DE UM LAUDO GERAL"):
  // Para cada torre / bloco:
  //   1) Pontos de Inspeção (Continuidade Elétrica com Miliohmímetro)
  //   2) Vistoria do SPDA Existente & Captores
  //   3) Análise dos Quadros de Energia e DPS (NBR 5410)
  // Ocupa rigorosamente até 4 fotos por linha e o máximo de linhas por página,
  // eliminando páginas semi-vazias e aproveitando 100% da área útil do A4.
  // ==========================================
  onProgress?.(68, 'Gerando Vistorias Técnicas por Torre...');

  const PHOTO_IMG_H = 41.5; // Altura otimizada para fotos nítidas 4:3
  const CELL_H = 49.0;      // Altura da célula compacta (permite até 4 linhas = 16 fotos por página A4)
  let curTowerY = 36;
  let isTowerSectionStarted = false;

  const startTowerPage = (titleStr: string) => {
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

    // Se a seção ainda não começou ou se não há espaço suficiente para o cabeçalho e pelo menos 1 linha de 4 fotos (57mm):
    if (!isTowerSectionStarted || curTowerY + 57 > 274) {
      startTowerPage(towerTitle);
      isTowerSectionStarted = true;
    } else {
      // Inicia a torre na mesma página com divisor compacto, aproveitando as linhas livres
      curTowerY += 2;
      pdf.setFillColor(15, 23, 42);
      pdf.roundedRect(marginX, curTowerY, contentWidth, 7.5, 1, 1, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.8);
      pdf.setTextColor(255, 255, 255);
      pdf.text(towerTitle, marginX + 4, curTowerY + 5.0);
      curTowerY += 10.5;
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

      // Se não couber o cabeçalho da subseção e pelo menos 1 linha de foto (CELL_H + 7 = 56mm), quebra a página
      if (curTowerY + CELL_H + 6 > 275) {
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
        if (curTowerY + CELL_H > 275) {
          startTowerPage(`${towerTitle} — ${sub.title} (CONTINUAÇÃO)`);
        }

        chunk.forEach((p, cIdx) => {
          const x = marginX + cIdx * (PHOTO_WIDTH_MM + PHOTO_GAP_X_MM);
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

          let labelY = y + PHOTO_IMG_H + 2.5;

          if (isFaltaDps) {
            pdf.setFillColor(254, 226, 226);
            pdf.roundedRect(x + 1, labelY - 2.0, PHOTO_WIDTH_MM - 2, 3.0, 0.4, 0.4, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(5.2);
            pdf.setTextColor(185, 28, 28);
            pdf.text('⚠ FALTA DPS', x + PHOTO_WIDTH_MM / 2, labelY + 0.2, { align: 'center' });
            labelY += 3.3;
          } else if (isFaltaEquipot) {
            pdf.setFillColor(254, 243, 199);
            pdf.roundedRect(x + 1, labelY - 2.0, PHOTO_WIDTH_MM - 2, 3.0, 0.4, 0.4, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(5.2);
            pdf.setTextColor(180, 83, 9);
            pdf.text('⚠ FALTA EQUIPOTENCIALIZAR', x + PHOTO_WIDTH_MM / 2, labelY + 0.2, { align: 'center' });
            labelY += 3.3;
          }

          // Texto descritivo
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(6.0);
          pdf.setTextColor(15, 23, 42);
          const fullDesc = [cap || 'Registro de inspeção', val ? `(${val})` : ''].filter(Boolean).join(' ');
          const splitLines = pdf.splitTextToSize(fullDesc, PHOTO_WIDTH_MM);
          pdf.text(splitLines.slice(0, 2), x + PHOTO_WIDTH_MM / 2, labelY, {
            align: 'center',
            maxWidth: PHOTO_WIDTH_MM,
          });
        });

        curTowerY += CELL_H + 1.2;
      });

      curTowerY += 1.5;
    });
  });

  // ==========================================================
  // PÁGINA EXECUTIVA: QUADRO RESUMO DE ADEQUAÇÕES POR TORRE
  // CONTABILIZAÇÃO AUTOMÁTICA DE NÃO CONFORMIDADES:
  // - Pontos a equipotencializar
  // - Quadros que precisam de DPS
  // - Outras não conformidades
  // - Totais por torre e TOTAL GERAL DO CONDOMÍNIO
  // ==========================================================
  onProgress?.(88, 'Gerando Quadro Resumo de Não Conformidades por Torre...');
  pdf.addPage('a4', 'portrait');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('7) QUADRO RESUMO DE ADEQUAÇÕES POR TORRE (NÃO CONFORMIDADES NBR 5419:2026)', marginX, 36);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.2);
  pdf.setTextColor(71, 85, 105);
  const resumoIntro = 'Quadro quantitativo consolidado das não conformidades identificadas nas vistorias de cada torre. A leitura analítica dos pontos críticos fundamenta as correções prioritárias obrigatórias perante as normas ABNT NBR 5419:2026 e ABNT NBR 5410.';
  pdf.text(pdf.splitTextToSize(resumoIntro, contentWidth), marginX, 41.5);

  const nonComplianceSummary = analyzeTowerNonConformities(consolidatedReport);
  let tblY = 49;

  // Cabeçalho da Tabela
  pdf.setFillColor(15, 23, 42);
  pdf.rect(marginX, tblY, contentWidth, 7, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.0);
  pdf.setTextColor(255, 255, 255);
  pdf.text('TORRE / BLOCO', marginX + 3, tblY + 4.8);
  pdf.text('PONTOS A EQUIPOTENCIALIZAR', marginX + 60, tblY + 4.8, { align: 'center' });
  pdf.text('QUADROS SEM DPS (INSTALAR)', marginX + 105, tblY + 4.8, { align: 'center' });
  pdf.text('OUTRAS ADEQUAÇÕES', marginX + 138, tblY + 4.8, { align: 'center' });
  pdf.text('TOTAL POR TORRE', marginX + contentWidth - 3, tblY + 4.8, { align: 'right' });

  tblY += 7;

  // Linhas por Torre
  nonComplianceSummary.rows.forEach((row, rIdx) => {
    if (rIdx % 2 === 0) {
      pdf.setFillColor(255, 255, 255);
    } else {
      pdf.setFillColor(248, 250, 252);
    }
    pdf.rect(marginX, tblY, contentWidth, 6.0, 'F');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(15, 23, 42);
    pdf.text(row.towerName, marginX + 3, tblY + 4.2);

    // Pontos a equipotencializar
    if (row.pointsNeedingEquipotentialization > 0) {
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(180, 83, 9);
      pdf.setFillColor(254, 243, 199);
      pdf.roundedRect(marginX + 53, tblY + 1.2, 14, 3.8, 0.5, 0.5, 'F');
    } else {
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(100, 116, 139);
    }
    pdf.text(String(row.pointsNeedingEquipotentialization), marginX + 60, tblY + 4.2, { align: 'center' });

    // Quadros sem DPS
    if (row.panelsNeedingDps > 0) {
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(185, 28, 28);
      pdf.setFillColor(254, 226, 226);
      pdf.roundedRect(marginX + 98, tblY + 1.2, 14, 3.8, 0.5, 0.5, 'F');
    } else {
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(100, 116, 139);
    }
    pdf.text(String(row.panelsNeedingDps), marginX + 105, tblY + 4.2, { align: 'center' });

    // Outras adequações
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(71, 85, 105);
    pdf.text(String(row.otherNonCompliances), marginX + 138, tblY + 4.2, { align: 'center' });

    // Total por torre
    pdf.setFont('helvetica', 'bold');
    if (row.total > 0) {
      pdf.setTextColor(185, 28, 28);
    } else {
      pdf.setTextColor(22, 101, 52);
    }
    pdf.text(String(row.total), marginX + contentWidth - 4, tblY + 4.2, { align: 'right' });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, tblY + 6.0, marginX + contentWidth, tblY + 6.0);
    tblY += 6.0;
  });

  // Linha de Rodapé: TOTAL GERAL DO CONDOMÍNIO
  pdf.setFillColor(15, 23, 42);
  pdf.rect(marginX, tblY, contentWidth, 7.5, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(255, 255, 255);
  pdf.text('TOTAL GERAL DO CONDOMÍNIO', marginX + 3, tblY + 5.0);

  pdf.setTextColor(252, 211, 77); // Amarelo
  pdf.text(String(nonComplianceSummary.totalEquipotentialization), marginX + 60, tblY + 5.0, { align: 'center' });

  pdf.setTextColor(252, 165, 165); // Vermelho
  pdf.text(String(nonComplianceSummary.totalDpsMissing), marginX + 105, tblY + 5.0, { align: 'center' });

  pdf.setTextColor(226, 232, 240);
  pdf.text(String(nonComplianceSummary.totalOther), marginX + 138, tblY + 5.0, { align: 'center' });

  pdf.setFontSize(8.2);
  pdf.setTextColor(255, 255, 255);
  pdf.text(String(nonComplianceSummary.grandTotal), marginX + contentWidth - 4, tblY + 5.0, { align: 'right' });

  tblY += 12;

  // Detalhamento das Não Conformidades por Torre
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.8);
  pdf.setTextColor(15, 23, 42);
  pdf.text('DETALHAMENTO DAS NÃO CONFORMIDADES IDENTIFICADAS POR TORRE:', marginX, tblY);
  tblY += 4.5;

  const rowsWithItems = nonComplianceSummary.rows.filter((r) => r.items.length > 0);

  if (rowsWithItems.length > 0) {
    rowsWithItems.forEach((r) => {
      if (tblY > 240) return; // Proteção contra overflow de página

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.0);
      pdf.setTextColor(15, 23, 42);
      pdf.text(`• ${r.towerName.toUpperCase()} (${r.total} ${r.total === 1 ? 'item' : 'itens'}):`, marginX + 2, tblY);
      tblY += 3.8;

      r.items.slice(0, 5).forEach((item) => {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.2);
        if (item.type === 'dps') {
          pdf.setTextColor(185, 28, 28);
          pdf.text('[FALTA DPS]', marginX + 6, tblY);
        } else if (item.type === 'equipotential') {
          pdf.setTextColor(180, 83, 9);
          pdf.text('[EQUIPOTENCIAL]', marginX + 6, tblY);
        } else {
          pdf.setTextColor(71, 85, 105);
          pdf.text('[ADEQUAÇÃO]', marginX + 6, tblY);
        }

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(51, 65, 85);
        pdf.text(item.caption, marginX + 28, tblY, { maxWidth: contentWidth - 30 });
        tblY += 3.5;
      });
      tblY += 1.5;
    });
  } else {
    pdf.setFillColor(240, 253, 244);
    pdf.setDrawColor(34, 197, 94);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(marginX, tblY, contentWidth, 14, 1, 1, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(22, 101, 52);
    pdf.text('✓ NENHUMA NÃO CONFORMIDADE CRÍTICA APONTADA NAS LEGENDAS', marginX + 4, tblY + 5.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.8);
    pdf.text('Todas as legendas e ensaios avaliados estão em plena conformidade com as diretrizes normativas.', marginX + 4, tblY + 9.5);
    tblY += 17;
  }

  // Parecer de Ação Corretiva Imediata
  if (tblY <= 245) {
    pdf.setFillColor(254, 242, 242);
    pdf.setDrawColor(239, 68, 68);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(marginX, tblY + 2, contentWidth, 16, 1, 1, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.0);
    pdf.setTextColor(153, 27, 27);
    pdf.text('PARECER TÉCNICO SOBRE AS ADEQUAÇÕES APONTADAS:', marginX + 4, tblY + 6.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.4);
    pdf.setTextColor(185, 28, 28);
    const avisoParecer = 'Todas as irregularidades listadas acima devem ser sanadas prioritariamente por equipe de engenharia e eletricistas qualificados. A falta de equipotencialização compromete o escoamento seguro de descargas elétricas e eleva riscos de centelhamento (NBR 5419-3:2026), e a ausência de DPS deixa circuitos expostos a queimas catastróficas (NBR 5410).';
    pdf.text(pdf.splitTextToSize(avisoParecer, contentWidth - 8), marginX + 4, tblY + 10.5);
  }

  // ==========================================
  // PÁGINA FINAL UNIFICADA: 8) RECOMENDAÇÕES PRIORITÁRIAS,
  // 9) CONCLUSÃO TÉCNICA FINAL, FECHAMENTO & ASSINATURA DO CREA
  // 100% DENSO, COMPLETO E COESO! ZERO ESPAÇO VAZIO!
  // ==========================================
  onProgress?.(94, 'Gerando Página Final: Parecer Técnico & Assinatura...');
  pdf.addPage('a4', 'portrait');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  let finalY = 36;

  // 8) CORREÇÕES NECESSÁRIAS (RECOMENDAÇÕES)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('8) CORREÇÕES NECESSÁRIAS PARA PROTEÇÃO DAS EDIFICAÇÕES', marginX, finalY);

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
    pdf.text(`8.${idx + 1}- `, marginX, finalY);
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

  // 9) CONCLUSÃO FINAL DESTE RELATÓRIO
  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.text('9) CONCLUSÃO FINAL DESTE RELATÓRIO TÉCNICO', marginX, finalY);

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
