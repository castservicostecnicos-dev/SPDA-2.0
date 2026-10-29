/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import { SpdaReport, PhotoSlot, ClientData } from '../types/spda';
import { defaultSpdaReport } from '../data/defaultReport';
import { purgeOrphanPhotosAndTowers } from './towerSorter';
import { SJC_OFFICIAL_LOGO_DATA_URL } from '../assets/logo';

// Configura o worker do PDF.js de forma resiliente para ambiente web / Vite
try {
  if (typeof window !== 'undefined') {
    // Tenta usar CDN do cdnjs/unpkg com fallback para sem-worker
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
  }
} catch (e) {
  console.warn('Configuração de worker do PDF.js:', e);
}

export interface ImportResult {
  success: boolean;
  report?: SpdaReport;
  error?: string;
  sourceType: 'docx' | 'pdf' | 'json';
  extractedInfo: {
    clientName?: string;
    local?: string;
    cnpj?: string;
    tecnico?: string;
    crea?: string;
    towersDetected: string[];
    photosCount: number;
  };
}

/**
 * Função principal para importar qualquer arquivo de laudo (PDF, DOCX, DOC ou JSON)
 */
export async function importReportFile(file: File): Promise<ImportResult> {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.json')) {
    return importFromJson(file);
  }

  if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
    return importFromDocx(file);
  }

  if (fileName.endsWith('.pdf')) {
    return importFromPdf(file);
  }

  return {
    success: false,
    sourceType: 'json',
    error: 'Formato de arquivo não suportado. Por favor, selecione um arquivo .PDF, .DOCX ou .JSON.',
    extractedInfo: { towersDetected: [], photosCount: 0 },
  };
}

/**
 * 1. IMPORTADOR DE ARQUIVO JSON (BACKUP COMPLETO)
 */
async function importFromJson(file: File): Promise<ImportResult> {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Conteúdo JSON inválido.');
    }

    const report: SpdaReport = {
      ...defaultSpdaReport,
      ...parsed,
      id: `laudo-spda-${Date.now()}`,
      client: { ...defaultSpdaReport.client, ...(parsed.client || {}) },
      company: { ...defaultSpdaReport.company, ...(parsed.company || {}) },
      texts: { ...defaultSpdaReport.texts, ...(parsed.texts || {}) },
      conditions: { ...defaultSpdaReport.conditions, ...(parsed.conditions || {}) },
      spdaPhotos: Array.isArray(parsed.spdaPhotos) ? parsed.spdaPhotos : [],
      measurementPhotos: Array.isArray(parsed.measurementPhotos) ? parsed.measurementPhotos : [],
      quadrosPhotos: Array.isArray(parsed.quadrosPhotos) ? parsed.quadrosPhotos : [],
      localPhotos: Array.isArray(parsed.localPhotos) ? parsed.localPhotos : [],
      torresData: parsed.torresData || {},
    };

    const sanitized = purgeOrphanPhotosAndTowers(report);
    const photoCount =
      sanitized.spdaPhotos.length +
      sanitized.measurementPhotos.length +
      sanitized.quadrosPhotos.length +
      sanitized.localPhotos.length;

    const towers = sanitized.client.torresNomes || ['Torre 1'];

    return {
      success: true,
      report: sanitized,
      sourceType: 'json',
      extractedInfo: {
        clientName: sanitized.client.name,
        local: sanitized.client.local,
        cnpj: sanitized.client.cnpj,
        tecnico: sanitized.client.tecnico,
        crea: sanitized.client.crea,
        towersDetected: towers,
        photosCount: photoCount,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      sourceType: 'json',
      error: `Erro ao importar arquivo JSON: ${err?.message || 'Arquivo corrompido ou inválido.'}`,
      extractedInfo: { towersDetected: [], photosCount: 0 },
    };
  }
}

/**
 * 2. IMPORTADOR DE ARQUIVO DOCX (EXTRAI TEXTOS, CAMPOS TÉCNICOS E FOTOS EMBUTIDAS)
 */
async function importFromDocx(file: File): Promise<ImportResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 1. Extrai todo o XML do documento
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      throw new Error('Arquivo DOCX inválido: word/document.xml não encontrado.');
    }
    const docXml = await docXmlFile.async('text');

    // 2. Extrai relacionamentos de mídia (rId -> media/imageX.ext)
    const relsFile = zip.file('word/_rels/document.xml.rels');
    const rIdToTarget = new Map<string, string>();
    if (relsFile) {
      const relsXml = await relsFile.async('text');
      const relMatches = relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g);
      for (const m of relMatches) {
        const id = m[1];
        const target = m[2];
        if (target.includes('media/')) {
          // Normaliza o caminho dentro do zip
          const cleanPath = target.startsWith('/') ? target.slice(1) : target.startsWith('media/') ? `word/${target}` : target;
          rIdToTarget.set(id, cleanPath);
        }
      }
    }

    // 3. Extrai imagens binárias da pasta word/media/
    const mediaFiles = zip.folder('word/media');
    const mediaDataUrls = new Map<string, string>(); // 'word/media/image1.jpeg' -> dataUrl

    if (mediaFiles) {
      const entries: Array<{ path: string; file: JSZip.JSZipObject }> = [];
      mediaFiles.forEach((relativePath, zipEntry) => {
        entries.push({ path: `word/media/${relativePath}`, file: zipEntry });
      });

      for (const item of entries) {
        try {
          const u8 = await item.file.async('uint8array');
          const ext = item.path.split('.').pop()?.toLowerCase() || 'jpeg';
          const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          const base64 = uint8ArrayToBase64(u8);
          mediaDataUrls.set(item.path, `data:${mime};base64,${base64}`);
        } catch {
          // ignora imagem com erro
        }
      }
    }

    // 4. Analisa o XML para extrair textos em ordem
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXml, 'application/xml');

    // Extrai todo o texto plano do documento
    const paragraphs = xmlDoc.getElementsByTagName('w:p');
    const rawLines: string[] = [];
    const photoSlotsFound: Array<{
      dataUrl: string;
      caption: string;
      measurementValue?: string;
      towerName?: string;
      category?: 'spda' | 'medicao' | 'quadros' | 'local';
    }> = [];

    // Mapeia parágrafos e células de tabela
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      const textNodes = p.getElementsByTagName('w:t');
      let pText = '';
      for (let j = 0; j < textNodes.length; j++) {
        pText += textNodes[j].textContent || '';
      }
      pText = pText.trim();
      if (pText) {
        rawLines.push(pText);
      }

      // Procura imagens inseridas neste parágrafo
      const blips = p.getElementsByTagName('a:blip');
      for (let b = 0; b < blips.length; b++) {
        const blip = blips[b];
        const rId = blip.getAttribute('r:embed') || blip.getAttribute('r:link') || '';
        const targetPath = rIdToTarget.get(rId);
        if (targetPath && mediaDataUrls.has(targetPath)) {
          const dataUrl = mediaDataUrls.get(targetPath)!;
          // Ignora a logomarca no cabeçalho ou imagens minúsculas
          if (dataUrl.length > 500) {
            // Procura texto do próximo parágrafo para usar como legenda
            let nextCaption = '';
            for (let next = i + 1; next < Math.min(i + 4, paragraphs.length); next++) {
              const nextP = paragraphs[next];
              const nextTexts = nextP.getElementsByTagName('w:t');
              let cand = '';
              for (let k = 0; k < nextTexts.length; k++) cand += nextTexts[k].textContent || '';
              cand = cand.trim();
              if (cand && cand.length > 3 && !cand.startsWith('LAUDO') && !cand.startsWith('SJC')) {
                nextCaption = cand;
                break;
              }
            }

            photoSlotsFound.push({
              dataUrl,
              caption: nextCaption || pText,
            });
          }
        }
      }
    }

    const fullText = rawLines.join('\n');

    // 5. Extração de Metadados Inteligente
    const parsedData = extractMetadataFromText(fullText, file.name);

    // 6. Organiza fotos extraídas em categorias
    const spdaPhotos: PhotoSlot[] = [];
    const measurementPhotos: PhotoSlot[] = [];
    const quadrosPhotos: PhotoSlot[] = [];
    const localPhotos: PhotoSlot[] = [];

    photoSlotsFound.forEach((pSlot, idx) => {
      const cap = pSlot.caption || '';
      const capLower = cap.toLowerCase();

      // Extrai medição se houver (ex: "0,12 Ω" ou "0.15 ohms")
      const measMatch = cap.match(/([0-9]+[.,][0-9]+\s*(?:Ω|ohms?|mΩ))/i);
      const measVal = measMatch ? measMatch[1] : undefined;

      // Identifica torre na legenda
      let towerName = parsedData.detectedTowers[0] || 'Torre 1';
      for (const t of parsedData.detectedTowers) {
        if (capLower.includes(t.toLowerCase())) {
          towerName = t;
          break;
        }
      }

      const slot: PhotoSlot = {
        id: `photo-imported-${idx}-${Date.now()}`,
        url: pSlot.dataUrl,
        caption: cap || `Registro fotográfico ${idx + 1}`,
        measurementValue: measVal,
        towerName,
        hasRedCircleMarker: capLower.includes('dps') || capLower.includes('equipotencial'),
      };

      if (/fachada|entrada|portaria|acesso|vista\s*geral|edifica[çc][ãa]o/i.test(capLower)) {
        localPhotos.push(slot);
      } else if (/miliohm|ohm|continuidade|ensaio|medi[çc][ãa]o|resistencia/i.test(capLower) || measVal) {
        measurementPhotos.push(slot);
      } else if (/quadro|dps|disjuntor|barramento|painel|qgbt|distribui/i.test(capLower)) {
        quadrosPhotos.push(slot);
      } else {
        spdaPhotos.push(slot);
      }
    });

    // 7. Monta o objeto SpdaReport pronto para edição
    const baseReport = JSON.parse(JSON.stringify(defaultSpdaReport)) as SpdaReport;

    const condoName = parsedData.client.name || 'Condomínio Importado';
    const towerCount = Math.max(1, parsedData.detectedTowers.length);
    const towersList = parsedData.detectedTowers.length > 0
      ? parsedData.detectedTowers
      : Array.from({ length: towerCount }, (_, i) => `Torre ${i + 1}`);

    const newReport: SpdaReport = {
      ...baseReport,
      id: `laudo-spda-${Date.now()}`,
      title: `Laudo SPDA - ${condoName}`,
      client: {
        ...baseReport.client,
        ...parsedData.client,
        name: condoName,
        quantidadeTorres: towerCount,
        torresNomes: towersList,
      },
      spdaPhotos,
      measurementPhotos,
      quadrosPhotos,
      localPhotos,
      torreAtual: towersList[0] || 'Torre 1',
      torresData: {},
    };

    // Aloca as fotos nas torres correspondentes
    towersList.forEach((tName) => {
      newReport.torresData![tName] = {
        id: `tower-${tName.toLowerCase().replace(/\s+/g, '-')}`,
        nome: tName,
        spdaPhotos: spdaPhotos.filter((p) => p.towerName === tName),
        measurementPhotos: measurementPhotos.filter((p) => p.towerName === tName),
        quadrosPhotos: quadrosPhotos.filter((p) => p.towerName === tName),
        localPhotos: [],
      };
    });

    const sanitized = purgeOrphanPhotosAndTowers(newReport);

    return {
      success: true,
      report: sanitized,
      sourceType: 'docx',
      extractedInfo: {
        clientName: sanitized.client.name,
        local: sanitized.client.local,
        cnpj: sanitized.client.cnpj,
        tecnico: sanitized.client.tecnico,
        crea: sanitized.client.crea,
        towersDetected: towersList,
        photosCount: photoSlotsFound.length,
      },
    };
  } catch (err: any) {
    console.error('Erro ao importar DOCX:', err);
    return {
      success: false,
      sourceType: 'docx',
      error: `Erro ao importar arquivo DOCX: ${err?.message || 'Arquivo inválido ou corrompido.'}`,
      extractedInfo: { towersDetected: [], photosCount: 0 },
    };
  }
}

/**
 * 3. IMPORTADOR DE ARQUIVO PDF (EXTRAI TEXTO, METADADOS, TORRES E MEDIÇÕES)
 */
async function importFromPdf(file: File): Promise<ImportResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    const pageTexts: string[] = [];
    const extractedImages: Array<{ dataUrl: string; pageNum: number }> = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const strings = textContent.items
        .map((item: any) => item.str || '')
        .filter(Boolean);
      pageTexts.push(strings.join(' '));

      // Extrai imagens da página caso o objeto esteja acessível
      try {
        const ops = await page.getOperatorList();
        for (let i = 0; i < ops.fnArray.length; i++) {
          if (
            ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject ||
            ops.fnArray[i] === pdfjsLib.OPS.paintInlineImageXObject
          ) {
            const imgKey = ops.argsArray[i][0];
            const imgObj = await new Promise<any>((resolve) => {
              page.objs.get(imgKey, (obj: any) => resolve(obj));
            });

            if (imgObj && imgObj.data && imgObj.width > 120 && imgObj.height > 120) {
              const canvas = document.createElement('canvas');
              canvas.width = imgObj.width;
              canvas.height = imgObj.height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                const imgData = ctx.createImageData(imgObj.width, imgObj.height);
                // Preenche canais RGBA
                if (imgObj.data.length === imgObj.width * imgObj.height * 4) {
                  imgData.data.set(imgObj.data);
                } else if (imgObj.data.length === imgObj.width * imgObj.height * 3) {
                  // RGB para RGBA
                  let srcIdx = 0;
                  let dstIdx = 0;
                  while (srcIdx < imgObj.data.length) {
                    imgData.data[dstIdx] = imgObj.data[srcIdx];
                    imgData.data[dstIdx + 1] = imgObj.data[srcIdx + 1];
                    imgData.data[dstIdx + 2] = imgObj.data[srcIdx + 2];
                    imgData.data[dstIdx + 3] = 255;
                    srcIdx += 3;
                    dstIdx += 4;
                  }
                }
                ctx.putImageData(imgData, 0, 0);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
                extractedImages.push({ dataUrl, pageNum });
              }
            }
          }
        }
      } catch {
        // ignora erro ao extrair imagem bruta do PDF
      }
    }

    const fullText = pageTexts.join('\n');
    const parsedData = extractMetadataFromText(fullText, file.name);

    // Organiza imagens extraídas do PDF
    const spdaPhotos: PhotoSlot[] = [];
    const measurementPhotos: PhotoSlot[] = [];
    const quadrosPhotos: PhotoSlot[] = [];
    const localPhotos: PhotoSlot[] = [];

    extractedImages.forEach((img, idx) => {
      const towerName = parsedData.detectedTowers[0] || 'Torre 1';
      const slot: PhotoSlot = {
        id: `photo-pdf-${idx}-${Date.now()}`,
        url: img.dataUrl,
        caption: `Registro técnico extraído da pág. ${img.pageNum}`,
        towerName,
      };

      if (idx === 0) {
        localPhotos.push(slot);
      } else if (idx % 3 === 1) {
        measurementPhotos.push(slot);
      } else if (idx % 3 === 2) {
        quadrosPhotos.push(slot);
      } else {
        spdaPhotos.push(slot);
      }
    });

    const condoName = parsedData.client.name || 'Condomínio Importado (PDF)';
    const towerCount = Math.max(1, parsedData.detectedTowers.length);
    const towersList = parsedData.detectedTowers.length > 0
      ? parsedData.detectedTowers
      : Array.from({ length: towerCount }, (_, i) => `Torre ${i + 1}`);

    const baseReport = JSON.parse(JSON.stringify(defaultSpdaReport)) as SpdaReport;

    const newReport: SpdaReport = {
      ...baseReport,
      id: `laudo-spda-${Date.now()}`,
      title: `Laudo SPDA - ${condoName}`,
      client: {
        ...baseReport.client,
        ...parsedData.client,
        name: condoName,
        quantidadeTorres: towerCount,
        torresNomes: towersList,
      },
      spdaPhotos,
      measurementPhotos,
      quadrosPhotos,
      localPhotos,
      torreAtual: towersList[0] || 'Torre 1',
      torresData: {},
    };

    towersList.forEach((tName) => {
      newReport.torresData![tName] = {
        id: `tower-${tName.toLowerCase().replace(/\s+/g, '-')}`,
        nome: tName,
        spdaPhotos: spdaPhotos.filter((p) => p.towerName === tName),
        measurementPhotos: measurementPhotos.filter((p) => p.towerName === tName),
        quadrosPhotos: quadrosPhotos.filter((p) => p.towerName === tName),
        localPhotos: [],
      };
    });

    const sanitized = purgeOrphanPhotosAndTowers(newReport);

    return {
      success: true,
      report: sanitized,
      sourceType: 'pdf',
      extractedInfo: {
        clientName: sanitized.client.name,
        local: sanitized.client.local,
        cnpj: sanitized.client.cnpj,
        tecnico: sanitized.client.tecnico,
        crea: sanitized.client.crea,
        towersDetected: towersList,
        photosCount: extractedImages.length,
      },
    };
  } catch (err: any) {
    console.error('Erro ao importar PDF:', err);
    return {
      success: false,
      sourceType: 'pdf',
      error: `Erro ao importar arquivo PDF: ${err?.message || 'Não foi possível ler o arquivo PDF.'}`,
      extractedInfo: { towersDetected: [], photosCount: 0 },
    };
  }
}

/**
 * Utilitário regex para extrair campos cadastrais estruturados a partir do texto
 */
function extractMetadataFromText(text: string, fileName: string): {
  client: Partial<ClientData>;
  detectedTowers: string[];
} {
  const client: Partial<ClientData> = {};

  // 1. Nome do Cliente / Condomínio
  const condoMatch =
    text.match(/(?:CLIENTE|CONDOM[ÍI]NIO|EDIF[ÍI]CIO|NOME\s+DA\s+EDIFICA[ÇC][ÃA]O)\s*[:=]\s*([^\n\r;]{3,80})/i) ||
    text.match(/Condom[íi]nio\s+([A-Za-z0-9\sÀ-ÿ\.\-]+?)(?:\s*-\s*|\s*,|\n|\r)/i);

  if (condoMatch) {
    client.name = condoMatch[1].trim().replace(/\s+/g, ' ');
  } else {
    // Tenta derivar do próprio nome do arquivo se estiver limpo
    const cleanFile = fileName
      .replace(/^Laudo_?SPDA_?/i, '')
      .replace(/\.(docx?|pdf)$/i, '')
      .replace(/[-_]/g, ' ')
      .trim();
    if (cleanFile.length > 3) {
      client.name = cleanFile;
    }
  }

  // 2. Local / Endereço
  const localMatch = text.match(/(?:LOCAL|ENDERE[ÇC]O|LOGRADOURO)\s*[:=]\s*([^\n\r;]{5,120})/i);
  if (localMatch) {
    client.local = localMatch[1].trim();
  }

  // 3. Município / UF
  const muniMatch = text.match(/(?:MUNIC[ÍI]PIO(?:\s*[\/\-]\s*UF)?|CIDADE)\s*[:=]\s*([^\n\r;]{3,60})/i);
  if (muniMatch) {
    client.municipio = muniMatch[1].trim();
  }

  // 4. CNPJ
  const cnpjMatch = text.match(/(?:CNPJ\s*[:=]?\s*)?(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  if (cnpjMatch) {
    client.cnpj = cnpjMatch[1].trim();
  }

  // 5. Responsável Técnico
  const tecnicoMatch = text.match(/(?:RESPONS[ÁA]VEL\s+T[ÉE]CNICO|ENGENHEIRO\s+RESPONS[ÁA]VEL)\s*[:=]\s*([^\n\r;]{3,70})/i);
  if (tecnicoMatch) {
    client.tecnico = tecnicoMatch[1].trim();
  }

  // 6. CREA / CONFEA
  const creaMatch = text.match(/(?:REGISTRO\s+CREA(?:\s*[\/\-]\s*CONFEA)?|CREA)\s*[:=]\s*([^\n\r;]{5,50})/i);
  if (creaMatch) {
    client.crea = creaMatch[1].trim();
  }

  // 7. ART
  const artMatch = text.match(/(?:ART|A\.R\.T\.)(?:\s*N[ºo°])?\s*[:=]\s*([^\n\r;]{4,50})/i);
  if (artMatch) {
    client.art = artMatch[1].trim();
  }

  // 8. Ramo de atividade
  const ramoMatch = text.match(/(?:RAMO\s+DE\s+ATIVIDADE|USO)\s*[:=]\s*([^\n\r;]{4,50})/i);
  if (ramoMatch) {
    client.ramoAtividade = ramoMatch[1].trim();
  }

  // 9. Detecção de Torres / Blocos
  const detectedTowersSet = new Set<string>();

  // Procura padrões como "Torre 1", "Torre 2", "Torre A", "Torre B", "Bloco 1", "Bloco A"
  const towerMatches = text.matchAll(/\b(?:Torre|Bloco|Edif[íi]cio)\s+([A-Za-z0-9]+)\b/gi);
  for (const m of towerMatches) {
    const rawMatch = m[0].trim();
    // Normaliza para Capitalized
    const formatted = rawMatch.charAt(0).toUpperCase() + rawMatch.slice(1);
    detectedTowersSet.add(formatted);
  }

  // Verifica se há indicação de quantidade de torres (ex: "7 torres" ou "quantidade: 5")
  const qtdMatch = text.match(/(\d+)\s+torres/i) || text.match(/quantidade\s+de\s+torres\s*[:=]\s*(\d+)/i);
  if (qtdMatch) {
    const qtd = parseInt(qtdMatch[1], 10);
    if (!isNaN(qtd) && qtd > 0 && qtd <= 30) {
      for (let i = 1; i <= qtd; i++) {
        detectedTowersSet.add(`Torre ${i}`);
      }
    }
  }

  const detectedTowers = Array.from(detectedTowersSet);
  if (detectedTowers.length === 0) {
    detectedTowers.push('Torre 1');
  }

  return {
    client,
    detectedTowers,
  };
}

/**
 * Converte Uint8Array para base64 com segurança
 */
function uint8ArrayToBase64(u8: Uint8Array): string {
  let binary = '';
  const len = u8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return window.btoa(binary);
}
