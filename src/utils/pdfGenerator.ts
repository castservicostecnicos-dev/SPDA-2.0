import jsPDF from 'jspdf';
import { SpdaReport, PhotoSlot } from '../types/spda';
import { SJC_OFFICIAL_LOGO_DATA_URL } from '../assets/logo';
import { generateSequentialPdfFileName } from './storage';
import { consolidateReportPhotos } from './towerSorter';
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
          const out = canvas.toDataURL('image/jpeg', 0.95);
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
        ctx.drawImage(img, 0, 0, width, height);

        const safeDataUrl = canvas.toDataURL('image/jpeg', 0.95);
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
  targetWidth = 600, // 38.5mm (~400 DPI ultra-nítido, 40% menor consumo de RAM)
  targetHeight = 750, // 48.0mm
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

        const out = canvas.toDataURL('image/jpeg', 0.90);
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
        const scale = Math.min(3, Math.max(1, 1200 / Math.max(origW, origH)));
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

        // Desenha 100% da imagem original sem perder nenhum pixel e sem cortar nada
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
  // SEÇÃO 5: VISTORIA DO SPDA EXISTENTE
  // REGRA FIXA: 4 FOTOS POR LINHA COM TAMANHO IMUTÁVEL (38.5mm x 48mm)
  // Sem espaços vazios: Se não houver fotos, une o parecer técnico e a análise visual!
  // ==========================================================
  onProgress?.(60, 'Gerando Seção 5: Vistoria do SPDA Existente...');

  const spdaChunks = chunkArray(spdaPhotos, 16);
  const spdaJpegChunks = chunkArray(spdaJpegs, 16);

  if (spdaPhotos.length === 0) {
    // Caso limpo / sem fotos cadastradas: Apresenta análise técnica visual completa sem deixar página em branco!
    pdf.addPage('a4', 'portrait');
    drawWatermark(pdf);
    drawHeaderLogo(pdf);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(15, 23, 42);
    pdf.text('5) VISTORIA DO SPDA EXISTENTE & PARECER VISUAL', marginX, 36);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(30, 41, 59);
    pdf.text(pdf.splitTextToSize(texts.vistoriaSpdaTexto, contentWidth), marginX, 43);

    // Painel de Parecer Técnico Visual da Vistoria
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.4);
    pdf.roundedRect(marginX, 55, contentWidth, 55, 1.5, 1.5, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(15, 23, 42);
    pdf.text('ANÁLISE PERICIAL DA INSPEÇÃO VISUAL IN LOCO:', marginX + 5, 62);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(51, 65, 85);
    const analiseLines = pdf.splitTextToSize(texts.vistoriaSpdaAnalise, contentWidth - 10);
    pdf.text(analiseLines, marginX + 5, 68);

    // Tabela dos Subsistemas Vistoriados
    pdf.setFillColor(241, 245, 249);
    pdf.rect(marginX, 118, contentWidth, 7, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('AVALIAÇÃO ESTRUTURAL DOS SUBSISTEMAS DO SPDA (NBR 5419:2026)', marginX + 4, 122.5);

    const subsistemas = [
      {
        item: 'Subsistema de Captação',
        desc: conditions.subCapitacaoDesc || 'Mastros, pontas captoras Franklin, fitas de alumínio e suportes de fixação.',
        status: conditions.subCapitacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
      },
      {
        item: 'Subsistema de Descida',
        desc: conditions.subDescidaDesc || 'Fitas de descida, espaçamento normativo, curvas e fixações mecânicas.',
        status: conditions.subDescidaStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
      },
      {
        item: 'Subsistema de Aterramento',
        desc: conditions.subAterramentoDesc || 'Caixas de equalização e inspeção, anel perimetral de aterramento e hastes cobreadas.',
        status: conditions.subAterramentoStatus || (conditions.caixasInspecaoLimpas ? 'CONFORME' : 'NÃO CONFORME'),
      },
      {
        item: 'Equipotencialização Metálica',
        desc: conditions.subEquipotencializacaoDesc || 'Interligação de massas metálicas da cobertura, rufos e estruturas de concreto armado.',
        status: conditions.subEquipotencializacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
      },
    ];

    let subY = 132;
    subsistemas.forEach((sub, sIdx) => {
      if (sIdx % 2 === 0) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(marginX, subY - 4.5, contentWidth, 12, 'F');
      }

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(15, 23, 42);
      pdf.text(sub.item, marginX + 3, subY);

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      if (sub.status === 'CONFORME') {
        pdf.setTextColor(22, 101, 52);
      } else if (sub.status === 'REQUER AJUSTES') {
        pdf.setTextColor(180, 83, 9);
      } else {
        pdf.setTextColor(220, 38, 38);
      }
      pdf.text(sub.status, marginX + contentWidth - 4, subY, { align: 'right' });

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(71, 85, 105);
      pdf.text(sub.desc, marginX + 3, subY + 5, { maxWidth: contentWidth - 6 });

      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.2);
      pdf.line(marginX, subY + 7.5, marginX + contentWidth, subY + 7.5);

      subY += 13;
    });
  } else {
    // Existem fotos cadastradas: 4 por linha fixas
    const spdaPageCount = spdaChunks.length;

    for (let pageIdx = 0; pageIdx < spdaPageCount; pageIdx++) {
      pdf.addPage('a4', 'portrait');
      drawWatermark(pdf);
      drawHeaderLogo(pdf);

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(15, 23, 42);
      pdf.text(
        pageIdx === 0 ? '5) VISTORIA DO SPDA EXISTENTE' : '5) VISTORIA DO SPDA EXISTENTE (CONTINUAÇÃO)',
        marginX,
        36
      );

      let gridStartY = 44;
      if (pageIdx === 0) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(30, 41, 59);
        const vistoriaLines = pdf.splitTextToSize(texts.vistoriaSpdaTexto, contentWidth);
        pdf.text(vistoriaLines, marginX, 42);
        gridStartY = 42 + vistoriaLines.length * 4.2 + 3;
      }

      const currentPhotos = spdaChunks[pageIdx] || [];
      const currentJpegs = spdaJpegChunks[pageIdx] || [];
      const count = currentPhotos.length;

      for (let i = 0; i < count; i++) {
        const col = i % PHOTO_COLS;
        const row = Math.floor(i / PHOTO_COLS);

        const x = marginX + col * (PHOTO_WIDTH_MM + PHOTO_GAP_X_MM);
        const y = gridStartY + row * (PHOTO_HEIGHT_MM + PHOTO_GAP_Y_MM);

        if (currentJpegs[i]) {
          pdf.addImage(currentJpegs[i], 'JPEG', x, y, PHOTO_WIDTH_MM, PHOTO_HEIGHT_MM);
        }

        // Legenda automática abaixo de cada foto com o nome da torre quando houver mais de uma torre
        const tName = currentPhotos[i]?.towerName || 'Torre 1';
        const cap = (currentPhotos[i]?.caption || '').trim();
        const legendBelow = isMultiTower
          ? (cap ? `${tName} - ${cap}` : tName)
          : cap;

        if (legendBelow) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(6.2);
          pdf.setTextColor(15, 23, 42);
          pdf.text(legendBelow, x + PHOTO_WIDTH_MM / 2, y + PHOTO_HEIGHT_MM + 3.2, {
            align: 'center',
            maxWidth: PHOTO_WIDTH_MM,
          });
        }
      }

    }
  }

  // ==========================================
  // SEÇÃO 6: MEDIÇÕES DE CONTINUIDADE OHMICA & INSTRUMENTO
  // ==========================================
  onProgress?.(72, 'Gerando Seção 6: Medições de Continuidade Ôhmica...');
  pdf.addPage('a4', 'portrait');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text('6) MEDIÇÕES DE CONTINUIDADE OHMICA DOS CONDUTORES', marginX, 36);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(30, 41, 59);
  const medTextoLines = pdf.splitTextToSize(texts.medicoesContinuidadeTexto, contentWidth);
  pdf.text(medTextoLines, marginX, 42);

  let equipStartY = 42 + medTextoLines.length * 4.2 + 3;

  // Caixa do Instrumento de Medição
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.4);
  pdf.roundedRect(marginX, equipStartY, contentWidth, 54, 1.5, 1.5, 'FD');

  if (equipmentPhotoInfo) {
    // Foto do instrumento posicionada à esquerda mantendo proporção nativa sem corte, estritamente limitada
    const boxW = 60;
    const boxH = 46;
    const { width: eqW, height: eqH } = calculateContainedDimensions(
      equipmentPhotoInfo.aspect,
      boxW,
      boxH
    );

    const eqX = marginX + 4 + (boxW - eqW) / 2;
    const eqY = equipStartY + 4 + (boxH - eqH) / 2;
    pdf.addImage(equipmentPhotoInfo.dataUrl, equipmentPhotoInfo.format, eqX, eqY, eqW, eqH);

    // Texto técnico ao lado da foto
    const sideX = marginX + 68;
    const sideW = contentWidth - 72;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text(`Miliohmímetro ${texts.equipamentoModelo} - ${texts.equipamentoMarca}`, sideX, equipStartY + 9, { maxWidth: sideW });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(51, 65, 85);
    pdf.text(pdf.splitTextToSize(texts.equipamentoDescricao, sideW), sideX, equipStartY + 15);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text(`Local: ${texts.medicoesLocal}`, sideX, equipStartY + 38, { maxWidth: sideW });
    pdf.text(`Corrente de Ensaio: ${texts.medicoesCorrenteAplicada}`, sideX, equipStartY + 43, { maxWidth: sideW });
    pdf.text(`Tipo de Corrente: ${texts.medicoesTipoCorrente}`, sideX, equipStartY + 48, { maxWidth: sideW });
  } else {
    // Sem foto: Especificação técnica completa
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(15, 23, 42);
    pdf.text(`Instrumento: Miliohmímetro Portátil ${texts.equipamentoModelo} - ${texts.equipamentoMarca}`, marginX + 6, equipStartY + 8, { maxWidth: contentWidth - 12 });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(51, 65, 85);
    pdf.text(pdf.splitTextToSize(texts.equipamentoDescricao, contentWidth - 12), marginX + 6, equipStartY + 15);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(15, 23, 42);
    pdf.text(`Local de Medição: ${texts.medicoesLocal}`, marginX + 6, equipStartY + 36, { maxWidth: contentWidth - 12 });
    pdf.text(`Corrente Aplicada: ${texts.medicoesCorrenteAplicada}`, marginX + 6, equipStartY + 42, { maxWidth: contentWidth - 12 });
    pdf.text(`Tipo de Corrente: ${texts.medicoesTipoCorrente}`, marginX + 6, equipStartY + 48, { maxWidth: contentWidth - 12 });
  }

  // Tabela de Parâmetros e Critérios Normativos de Continuidade
  let tableY = equipStartY + 58;

  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, tableY, contentWidth, 7, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('PARÂMETROS NORMATIVOS DE CONTINUIDADE (ABNT NBR 5419:2026)', marginX + 4, tableY + 4.8);

  tableY += 7;

  const criterios = [
    {
      criterio: 'Continuidade de Armaduras e Malhas',
      norma: 'NBR 5419-3:2026 (Item 5.3.5)',
      limite: '≤ 0,200 Ω (200 mΩ)',
      status: conditions.continuidadeAprovada ? 'CONFORME' : 'ATENÇÃO',
    },
    {
      criterio: 'Resistência de Equipotencialização',
      norma: 'NBR 5419-3:2026 (Item 6.2)',
      limite: '≤ 0,200 Ω (200 mΩ)',
      status: 'CONFORME',
    },
    {
      criterio: 'Método de 4 Terminais (Kelvin)',
      norma: 'Injeção de corrente DC contínua',
      limite: 'Min. 1,0 A sob 4 fios',
      status: 'APLICADO',
    },
    {
      criterio: 'Estado Físico das Caixas de Inspeção',
      norma: 'Aterramento & Equalização',
      limite: 'Desobstruídas e secas',
      status: conditions.caixasInspecaoLimpas ? 'CONFORME' : 'LIMPEZA PENDENTE',
    },
  ];

  criterios.forEach((crit, cIdx) => {
    if (cIdx % 2 === 0) {
      pdf.setFillColor(250, 250, 250);
      pdf.rect(marginX, tableY, contentWidth, 6.5, 'F');
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.0);
    pdf.setTextColor(30, 41, 59);
    pdf.text(crit.criterio, marginX + 3, tableY + 4.5, { maxWidth: 58 });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.8);
    pdf.setTextColor(71, 85, 105);
    pdf.text(crit.norma, marginX + 63, tableY + 4.5, { maxWidth: 42 });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.setTextColor(30, 41, 59);
    pdf.text(crit.limite, marginX + 107, tableY + 4.5, { maxWidth: 32 });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    if (crit.status === 'CONFORME' || crit.status === 'APLICADO') {
      pdf.setTextColor(22, 101, 52);
    } else {
      pdf.setTextColor(220, 38, 38);
    }
    pdf.text(crit.status, marginX + contentWidth - 3, tableY + 4.5, { align: 'right' });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, tableY + 6.5, marginX + contentWidth, tableY + 6.5);

    tableY += 6.5;
  });

  // ==========================================================
  // PONTOS DE MEDIÇÃO OBTIDOS (FOTOS DIRETAS OU TABELA DE METODOLOGIA)
  // ACOMODA ATÉ 8 FOTOS DIRETO NESTA PÁGINA PARA ELIMINAR ESPAÇOS VAZIOS!
  // ==========================================================
  const measurePage1 = measurementPhotos.slice(0, 8);
  const measureJpegsPage1 = measureJpegs.slice(0, 8);
  const measureRestantes = measurementPhotos.slice(8);
  const measureJpegsRestantes = measureJpegs.slice(8);
  const measureContChunks = chunkArray(measureRestantes, 16);
  const measureContJpegChunks = chunkArray(measureJpegsRestantes, 16);

  let curMeasureY = tableY + 4;

  if (measurePage1.length > 0) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.0);
    pdf.setTextColor(15, 23, 42);
    pdf.text('6.1) PONTOS DE MEDIÇÃO DE CONTINUIDADE OBTIDOS', marginX, curMeasureY + 4);
    curMeasureY += 6;

    const MEASURE_IMG_H = 38.0;
    for (let i = 0; i < measurePage1.length; i++) {
      const col = i % PHOTO_COLS;
      const row = Math.floor(i / PHOTO_COLS);
      const x = marginX + col * (PHOTO_WIDTH_MM + PHOTO_GAP_X_MM);
      const y = curMeasureY + row * (MEASURE_IMG_H + 9);

      if (measureJpegsPage1[i]) {
        pdf.addImage(measureJpegsPage1[i], 'JPEG', x, y, PHOTO_WIDTH_MM, MEASURE_IMG_H);
      }

      const tName = measurePage1[i]?.towerName || 'Torre 1';
      const towerName = isMultiTower ? tName : (measurePage1[i]?.towerName ? `[${measurePage1[i].towerName}]` : '');
      const cap = (measurePage1[i]?.caption || '').trim();
      const val = (measurePage1[i]?.measurementValue || '').trim();
      const title = towerName ? (cap ? `${towerName} - ${cap}` : towerName) : cap;
      const textBelow = [title, val ? `(${val})` : ''].filter(Boolean).join(' ');

      if (textBelow) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.5);
        pdf.setTextColor(0, 0, 0);
        pdf.text(textBelow, x + PHOTO_WIDTH_MM / 2, y + MEASURE_IMG_H + 3.5, {
          align: 'center',
          maxWidth: PHOTO_WIDTH_MM,
        });
      }
    }
  } else {
    // Se não houver fotos de medição, tabela técnica de metodologia de 4 fios
    pdf.setFillColor(241, 245, 249);
    pdf.rect(marginX, curMeasureY, contentWidth, 5.5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('METODOLOGIA DE 4 TERMINAIS (KELVIN) E PONTOS DE ENSAIO', marginX + 4, curMeasureY + 4.0);

    const pontosMetodologia = [
      { ponto: '1. Malha de Captação para Descidas Principais', obs: 'Ensaio a 4 fios com injeção DC contínua [CONFORME]' },
      { ponto: '2. Descidas para Caixas de Equalização / BEP', obs: 'Conexões mecânicas ensaiadas sob carga [CONFORME]' },
      { ponto: '3. Malha de Aterramento para Estruturas Metálicas', obs: 'Equipotencialização de massas da edificação [CONFORME]' },
    ];

    let pY = curMeasureY + 5.5;
    pontosMetodologia.forEach((p, pIdx) => {
      if (pIdx % 2 === 0) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(marginX, pY, contentWidth, 5.5, 'F');
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.0);
      pdf.setTextColor(30, 41, 59);
      pdf.text(p.ponto, marginX + 3, pY + 4.0, { maxWidth: 85 });

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.8);
      pdf.setTextColor(22, 101, 52);
      pdf.text(p.obs, marginX + contentWidth - 3, pY + 4.0, { align: 'right' });

      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.2);
      pdf.line(marginX, pY + 5.5, marginX + contentWidth, pY + 5.5);
      pY += 5.5;
    });
  }

  // Páginas de continuação de medições (se houver mais de 8 fotos)
  for (let cIdx = 0; cIdx < measureContChunks.length; cIdx++) {
    pdf.addPage('a4', 'portrait');
    drawWatermark(pdf);
    drawHeaderLogo(pdf);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('6.1) PONTOS DE MEDIÇÃO (CONTINUAÇÃO)', marginX, 36);

    const curChunk = measureContChunks[cIdx];
    const curJpegs = measureContJpegChunks[cIdx];
    const MEASURE_IMG_H = 40.0;
    const startY = 44;

    for (let i = 0; i < curChunk.length; i++) {
      const col = i % PHOTO_COLS;
      const row = Math.floor(i / PHOTO_COLS);
      const x = marginX + col * (PHOTO_WIDTH_MM + PHOTO_GAP_X_MM);
      const y = startY + row * (MEASURE_IMG_H + 9);

      if (curJpegs[i]) {
        pdf.addImage(curJpegs[i], 'JPEG', x, y, PHOTO_WIDTH_MM, MEASURE_IMG_H);
      }

      const tName = curChunk[i]?.towerName || 'Torre 1';
      const towerName = isMultiTower ? tName : (curChunk[i]?.towerName ? `[${curChunk[i].towerName}]` : '');
      const cap = (curChunk[i]?.caption || '').trim();
      const val = (curChunk[i]?.measurementValue || '').trim();
      const title = towerName ? (cap ? `${towerName} - ${cap}` : towerName) : cap;
      const textBelow = [title, val ? `(${val})` : ''].filter(Boolean).join(' ');

      if (textBelow) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.5);
        pdf.setTextColor(0, 0, 0);
        pdf.text(textBelow, x + PHOTO_WIDTH_MM / 2, y + MEASURE_IMG_H + 3.5, {
          align: 'center',
          maxWidth: PHOTO_WIDTH_MM,
        });
      }
    }
  }

  // ==========================================
  // SEÇÃO 7: ANÁLISE DOS QUADROS DE ENERGIA & DPS (NBR 5410)
  // DENSO: ACOMODA ATÉ 8 FOTOS OU TABELA DE AUDITORIA DE QUADROS!
  // ==========================================
  onProgress?.(84, 'Gerando Seção 7: Análise dos Quadros & DPS...');

  const QUADROS_PAGE1_CAPACITY = 16;
  const quadrosPage1 = quadrosPhotos.slice(0, QUADROS_PAGE1_CAPACITY);
  const quadrosJpegsPage1 = quadrosJpegs.slice(0, QUADROS_PAGE1_CAPACITY);
  const quadrosRestantes = quadrosPhotos.slice(QUADROS_PAGE1_CAPACITY);
  const quadrosJpegsRestantes = quadrosJpegs.slice(QUADROS_PAGE1_CAPACITY);
  const quadrosContChunks = chunkArray(quadrosRestantes, 16);
  const quadrosContJpegChunks = chunkArray(quadrosJpegsRestantes, 16);

  pdf.addPage('a4', 'portrait');
  drawWatermark(pdf);
  drawHeaderLogo(pdf);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('7) ANÁLISE DOS QUADROS DE ENERGIA & PROTEÇÃO CONTRA SURTOS (DPS)', marginX, 36);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.8);
  pdf.setTextColor(30, 41, 59);
  const ptoInspLines = pdf.splitTextToSize(texts.pontosInspecaoAvaliacao, contentWidth);
  pdf.text(ptoInspLines, marginX, 41);

  let quadY = 41 + ptoInspLines.length * 3.8 + 2;

  // Faixa cinza NBR 5410
  pdf.setFillColor(229, 231, 235);
  pdf.rect(marginX, quadY, contentWidth, 5.5, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.8);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Avaliação dos Dispositivos de Proteção contra Surtos (DPS) - NBR 5410', 105, quadY + 4.0, { align: 'center' });

  quadY += 8.5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(51, 65, 85);
  const analiseQdrLines = pdf.splitTextToSize(texts.analiseQuadrosTexto, contentWidth);
  pdf.text(analiseQdrLines, marginX, quadY);
  quadY += analiseQdrLines.length * 3.6 + 2.5;



  // Fotos dos quadros (até 16 fotos acomodadas em uma única página sem pular)
  if (quadrosPage1.length > 0) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.0);
    pdf.setTextColor(15, 23, 42);
    pdf.text('REGISTROS FOTOGRÁFICOS DOS QUADROS DE ENERGIA', marginX, quadY + 4);
    quadY += 6;

    const count = quadrosPage1.length;
    let QUADROS_IMG_H = 41.0;
    let rowPitch = 49.0;
    if (count > 12) {
      QUADROS_IMG_H = 34.0;
      rowPitch = 40.0;
    } else if (count > 8) {
      QUADROS_IMG_H = 37.0;
      rowPitch = 44.0;
    }

    for (let i = 0; i < quadrosPage1.length; i++) {
      const col = i % PHOTO_COLS;
      const row = Math.floor(i / PHOTO_COLS);
      const x = marginX + col * (PHOTO_WIDTH_MM + PHOTO_GAP_X_MM);
      const y = quadY + row * rowPitch;

      if (quadrosJpegsPage1[i]) {
        pdf.addImage(quadrosJpegsPage1[i], 'JPEG', x, y, PHOTO_WIDTH_MM, QUADROS_IMG_H);
      }

      const tName = quadrosPage1[i]?.towerName || 'Torre 1';
      const towerName = isMultiTower ? tName : (quadrosPage1[i]?.towerName ? `[${quadrosPage1[i].towerName}]` : '');
      const cap = (quadrosPage1[i]?.caption || '').trim();
      const textBelow = towerName ? (cap ? `${towerName} - ${cap}` : towerName) : cap;
      if (textBelow) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.5);
        pdf.setTextColor(0, 0, 0);
        pdf.text(textBelow, x + PHOTO_WIDTH_MM / 2, y + QUADROS_IMG_H + 3.2, {
          align: 'center',
          maxWidth: PHOTO_WIDTH_MM,
        });
      }
    }
  } else {
    // Se não houver fotos cadastradas
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text('Nenhum registro fotográfico dos quadros de distribuição anexado.', marginX + 4, quadY + 8);
  }

  // Páginas de continuação dos quadros (apenas se houver mais de 16 fotos)
  for (let cIdx = 0; cIdx < quadrosContChunks.length; cIdx++) {
    pdf.addPage('a4', 'portrait');
    drawWatermark(pdf);
    drawHeaderLogo(pdf);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text('7) ANÁLISE DOS QUADROS DE ENERGIA (CONTINUAÇÃO)', marginX, 36);

    const curChunk = quadrosContChunks[cIdx];
    const curJpegs = quadrosContJpegChunks[cIdx];
    const QUADROS_IMG_H = 41.0;
    const startY = 44;

    for (let i = 0; i < curChunk.length; i++) {
      const col = i % PHOTO_COLS;
      const row = Math.floor(i / PHOTO_COLS);
      const x = marginX + col * (PHOTO_WIDTH_MM + PHOTO_GAP_X_MM);
      const y = startY + row * (QUADROS_IMG_H + 9);

      if (curJpegs[i]) {
        pdf.addImage(curJpegs[i], 'JPEG', x, y, PHOTO_WIDTH_MM, QUADROS_IMG_H);
      }

      const tName = curChunk[i]?.towerName || 'Torre 1';
      const towerName = isMultiTower ? tName : (curChunk[i]?.towerName ? `[${curChunk[i].towerName}]` : '');
      const cap = (curChunk[i]?.caption || '').trim();
      const textBelow = towerName ? (cap ? `${towerName} - ${cap}` : towerName) : cap;
      if (textBelow) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.5);
        pdf.setTextColor(0, 0, 0);
        pdf.text(textBelow, x + PHOTO_WIDTH_MM / 2, y + QUADROS_IMG_H + 3.5, {
          align: 'center',
          maxWidth: PHOTO_WIDTH_MM,
        });
      }
    }
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
