/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import { SpdaReport, PhotoSlot, ClientData, TowerData, TechnicalTexts, InspectionConditions } from '../types/spda';
import { defaultSpdaReport } from '../data/defaultReport';
import { purgeOrphanPhotosAndTowers, compareTowerNames } from './towerSorter';
import { SJC_OFFICIAL_LOGO_DATA_URL } from '../assets/logo';

// Configura o worker do PDF.js de forma resiliente para ambiente web / Vite
try {
  if (typeof window !== 'undefined') {
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
    const towers = sanitized.client.torresNomes || ['Torre 1'];
    const activeTower = sanitized.torreAtual || towers[0] || 'Torre 1';

    // Garante que a torre ativa possua estritamente suas fotos carregadas
    if (sanitized.torresData && sanitized.torresData[activeTower]) {
      const activeData = sanitized.torresData[activeTower];
      sanitized.spdaPhotos = [...(activeData.spdaPhotos || [])];
      sanitized.measurementPhotos = [...(activeData.measurementPhotos || [])];
      sanitized.quadrosPhotos = [...(activeData.quadrosPhotos || [])];
    }

    const photoCount = countTotalPhotosInReport(sanitized);

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
 * 2. IMPORTADOR AVANÇADO DE ARQUIVO DOCX / WORD
 * Analisa a estrutura hierárquica do Word:
 * - Detecta Torres / Blocos a partir dos cabeçalhos de seção (ex: "VISTORIA & ENSAIOS TÉCNICOS: TORRE 1", "TORRE 2", etc.)
 * - Detecta as subseções corretas (Continuidade Ôhmica, SPDA Existente, Quadros e DPS, Fachada/Local, Equipamento)
 * - Extrai fotos de células de tabela mapeando a foto com sua respectiva legenda, medição e torre
 * - Extrai metadados do cliente, textos técnicos e condições
 * - Monta o laudo com torresData preenchido e fotos da torre inicial ativas na tela de edição
 */
async function importFromDocx(file: File): Promise<ImportResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 1. Extrai o XML do documento
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      throw new Error('Arquivo DOCX inválido: word/document.xml não encontrado.');
    }
    const docXml = await docXmlFile.async('text');

    // 2. Extrai relacionamentos de mídia (rId -> word/media/imageX.ext)
    const relsFile = zip.file('word/_rels/document.xml.rels');
    const rIdToTarget = new Map<string, string>();
    if (relsFile) {
      const relsXml = await relsFile.async('text');
      const relMatches = relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g);
      for (const m of relMatches) {
        const id = m[1];
        const target = m[2];
        if (target.includes('media/')) {
          const cleanPath = target.startsWith('/')
            ? target.slice(1)
            : target.startsWith('media/')
            ? `word/${target}`
            : target;
          rIdToTarget.set(id, cleanPath);
        }
      }
    }

    // 3. Extrai imagens binárias da pasta word/media/
    const mediaFiles = zip.folder('word/media');
    const mediaDataUrls = new Map<string, string>();

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

    // 4. Analisa o XML com DOMParser para caminhar pelos elementos em ordem sequencial
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXml, 'application/xml');
    const body = xmlDoc.getElementsByTagName('w:body')[0];
    if (!body) {
      throw new Error('Estrutura de corpo do Word não encontrada.');
    }

    // Estruturas de armazenamento por torre
    const towerSpdaMap = new Map<string, PhotoSlot[]>();
    const towerMeasurementMap = new Map<string, PhotoSlot[]>();
    const towerQuadrosMap = new Map<string, PhotoSlot[]>();
    const localPhotos: PhotoSlot[] = [];
    let equipmentPhotoUrl: string | undefined = undefined;

    const detectedTowersSet = new Set<string>();

    let currentActiveTower = 'Torre 1';
    let currentCategory: 'local' | 'measurement' | 'spda' | 'quadros' | 'equipment' | 'general' = 'general';

    const getOrInitTowerList = (map: Map<string, PhotoSlot[]>, tName: string): PhotoSlot[] => {
      if (!map.has(tName)) map.set(tName, []);
      return map.get(tName)!;
    };

    // Percorre todos os nós filhos diretos de <w:body> (parágrafos e tabelas)
    const bodyChildren = Array.from(body.childNodes);
    const fullTextLines: string[] = [];

    for (let cIdx = 0; cIdx < bodyChildren.length; cIdx++) {
      const node = bodyChildren[cIdx] as Element;
      if (!node.tagName) continue;

      // =====================================================================
      // PARÁGRAFOS: Atualizam Torre Ativa e Categoria Ativa
      // =====================================================================
      if (node.tagName === 'w:p') {
        const pText = getNodeText(node).trim();
        if (pText) {
          fullTextLines.push(pText);

          // 1. Detecção de Troca de Torre nos Cabeçalhos
          // Exemplos:
          // "6.1) VISTORIA & ENSAIOS TÉCNICOS: TORRE 1"
          // "6.2) VISTORIA & ENSAIOS TÉCNICOS: TORRE 2"
          // "VISTORIA TÉCNICA - BLOCO A"
          // "TORRE 3"
          // "ÁREA COMUM"
          const towerHeadingMatch =
            pText.match(/(?:VISTORIA(?:\s*(?:&|E)\s*ENSAIOS)?\s*T[ÉE]CNICOS?\s*[:\-–]\s*|VISTORIA\s+T[ÉE]CNICA\s*[:\-–]\s*)([A-Za-z0-9\sÀ-ÿ\.\-]+)/i) ||
            pText.match(/^(?:TORRE|BLOCO|EDIF[ÍI]CIO)\s+([A-Za-z0-9]+)$/i) ||
            pText.match(/^(ÁREA\s+COMUM)$/i);

          if (towerHeadingMatch) {
            const rawTower = towerHeadingMatch[1].trim();
            const cleanTower = normalizeTowerName(rawTower);
            if (cleanTower) {
              currentActiveTower = cleanTower;
              detectedTowersSet.add(cleanTower);
            }
          }

          // 2. Detecção de Categoria de Fotos nos Subcabeçalhos
          if (/(?:PONTOS?\s+DE\s+ENSAIO|CONTINUIDADE\s+[ÔO]HMICA|MILIOHM[ÍI]METRO|MEDI[ÇC][ÕO][ÃA]O\s+DE\s+CONTINUIDADE)/i.test(pText)) {
            currentCategory = 'measurement';
          } else if (/(?:SPDA\s+EXISTENTE|CAPTORES?\s*(?:&|E)\s*DESCIDAS?|PONTOS?\s+DE\s+INSPE[ÇC][ÃA]O|MALHA\s+DE\s+ATERRAMENTO)/i.test(pText)) {
            currentCategory = 'spda';
          } else if (/(?:QUADROS?\s+DE\s+ENERGIA|QUADROS?\s+EL[ÉE]TRICOS?|DPS|DISPOSITIVOS?\s+DE\s+PROTE[ÇC][ÃA]O\s+CONTRA\s+SURTOS)/i.test(pText)) {
            currentCategory = 'quadros';
          } else if (/(?:REGISTRO\s+FOTOGR[ÁA]FICO\s+DO\s+LOCAL|FACHADA|PORTARIA|ACESSO\s+PRINCIPAL|VISTA\s+GERAL)/i.test(pText)) {
            currentCategory = 'local';
          } else if (/(?:INSTRUMENTA[ÇC][ÃA]O\s+T[ÉE]CNICA|INSTRUMENTO\s+DE\s+MEDI[ÇC][ÃA]O|MILIOHM[ÍI]METRO\s+DIGITAL)/i.test(pText)) {
            currentCategory = 'equipment';
          }
        }

        // Verifica se há foto direta dentro do parágrafo (ex: foto da fachada ou do miliohmímetro)
        const blips = node.getElementsByTagName('a:blip');
        for (let b = 0; b < blips.length; b++) {
          const rId = blips[b].getAttribute('r:embed') || blips[b].getAttribute('r:link') || '';
          const target = rIdToTarget.get(rId);
          if (target && mediaDataUrls.has(target)) {
            const dataUrl = mediaDataUrls.get(target)!;
            if (dataUrl.length > 500 && !isCompanyLogoDataUrl(dataUrl)) {
              if (currentCategory === 'equipment') {
                equipmentPhotoUrl = dataUrl;
              } else if (currentCategory === 'local') {
                localPhotos.push({
                  id: `photo-docx-local-${localPhotos.length + 1}-${Date.now()}`,
                  url: dataUrl,
                  caption: pText || 'Fachada e vista do condomínio',
                  towerName: currentActiveTower,
                });
              } else {
                const catForSlot: 'local' | 'measurement' | 'spda' | 'quadros' | 'equipment' =
                  currentCategory === 'general' ? 'spda' : currentCategory;
                const slot = createPhotoSlot(dataUrl, pText, currentActiveTower, catForSlot);
                if (currentCategory === 'measurement') {
                  getOrInitTowerList(towerMeasurementMap, currentActiveTower).push(slot);
                } else if (currentCategory === 'quadros') {
                  getOrInitTowerList(towerQuadrosMap, currentActiveTower).push(slot);
                } else {
                  getOrInitTowerList(towerSpdaMap, currentActiveTower).push(slot);
                }
              }
            }
          }
        }
      }

      // =====================================================================
      // TABELAS: Grade de Fotos (Cada Célula contém uma Foto com sua Legenda)
      // =====================================================================
      if (node.tagName === 'w:tbl') {
        const rows = Array.from(node.getElementsByTagName('w:tr'));

        // Estrutura 1: Cada célula <w:tc> possui tanto a imagem quanto o parágrafo de legenda
        // Estrutura 2: Linha 1 possui as imagens, Linha 2 possui as legendas correspondentes
        let isDualRowTable = false;
        if (rows.length >= 2) {
          const row0HasImages = rows[0].getElementsByTagName('a:blip').length > 0;
          const row1HasImages = rows[1].getElementsByTagName('a:blip').length > 0;
          if (row0HasImages && !row1HasImages) {
            isDualRowTable = true;
          }
        }

        if (isDualRowTable) {
          // Processa em pares de linhas (linha par: fotos, linha ímpar: legendas)
          for (let rIdx = 0; rIdx < rows.length; rIdx += 2) {
            const photoRow = rows[rIdx];
            const captionRow = rows[rIdx + 1];

            const photoCells = Array.from(photoRow.getElementsByTagName('w:tc'));
            const captionCells = captionRow ? Array.from(captionRow.getElementsByTagName('w:tc')) : [];

            photoCells.forEach((pCell, cellCol) => {
              const blip = pCell.getElementsByTagName('a:blip')[0];
              if (!blip) return;
              const rId = blip.getAttribute('r:embed') || blip.getAttribute('r:link') || '';
              const target = rIdToTarget.get(rId);
              if (!target || !mediaDataUrls.has(target)) return;
              const dataUrl = mediaDataUrls.get(target)!;
              if (isCompanyLogoDataUrl(dataUrl)) return;

              const cCell = captionCells[cellCol];
              const capText = cCell ? getNodeText(cCell).trim() : getNodeText(pCell).trim();

              const photoTower = extractTowerFromCaptionOrFallback(capText, currentActiveTower);
              detectedTowersSet.add(photoTower);

              const photoCategory = extractCategoryFromCaptionOrFallback(capText, currentCategory);
              const slot = createPhotoSlot(dataUrl, capText, photoTower, photoCategory);

              if (photoCategory === 'measurement') {
                getOrInitTowerList(towerMeasurementMap, photoTower).push(slot);
              } else if (photoCategory === 'quadros') {
                getOrInitTowerList(towerQuadrosMap, photoTower).push(slot);
              } else if (photoCategory === 'local') {
                localPhotos.push(slot);
              } else {
                getOrInitTowerList(towerSpdaMap, photoTower).push(slot);
              }
            });
          }
        } else {
          // Cada célula <w:tc> contém a imagem e seu texto
          rows.forEach((row) => {
            const cells = Array.from(row.getElementsByTagName('w:tc'));
            cells.forEach((cell) => {
              const blip = cell.getElementsByTagName('a:blip')[0];
              if (!blip) return;
              const rId = blip.getAttribute('r:embed') || blip.getAttribute('r:link') || '';
              const target = rIdToTarget.get(rId);
              if (!target || !mediaDataUrls.has(target)) return;
              const dataUrl = mediaDataUrls.get(target)!;
              if (isCompanyLogoDataUrl(dataUrl)) return;

              const cellText = getNodeText(cell).trim();
              const photoTower = extractTowerFromCaptionOrFallback(cellText, currentActiveTower);
              detectedTowersSet.add(photoTower);

              const photoCategory = extractCategoryFromCaptionOrFallback(cellText, currentCategory);
              const slot = createPhotoSlot(dataUrl, cellText, photoTower, photoCategory);

              if (photoCategory === 'measurement') {
                getOrInitTowerList(towerMeasurementMap, photoTower).push(slot);
              } else if (photoCategory === 'quadros') {
                getOrInitTowerList(towerQuadrosMap, photoTower).push(slot);
              } else if (photoCategory === 'local') {
                localPhotos.push(slot);
              } else {
                getOrInitTowerList(towerSpdaMap, photoTower).push(slot);
              }
            });
          });
        }
      }
    }

    const fullDocumentText = fullTextLines.join('\n');

    // 5. Extração de Metadados Cadastrais e Textos Técnicos
    const metadata = extractMetadataFromText(fullDocumentText, file.name);

    // Consolida lista de torres detectadas (mesclando cabeçalhos e texto)
    metadata.detectedTowers.forEach((t) => detectedTowersSet.add(t));
    if (detectedTowersSet.size === 0) {
      detectedTowersSet.add('Torre 1');
    }

    const sortedTowers = Array.from(detectedTowersSet).sort(compareTowerNames);
    const initialTower = sortedTowers[0] || 'Torre 1';

    // 6. Monta o mapa torresData estruturado por torre
    const torresData: Record<string, TowerData> = {};
    sortedTowers.forEach((tName) => {
      torresData[tName] = {
        id: `tower-${tName.toLowerCase().replace(/\s+/g, '-')}`,
        nome: tName,
        spdaPhotos: towerSpdaMap.get(tName) || [],
        measurementPhotos: towerMeasurementMap.get(tName) || [],
        quadrosPhotos: towerQuadrosMap.get(tName) || [],
        localPhotos: tName === initialTower ? [...localPhotos] : [],
        equipmentPhotoUrl: tName === initialTower ? equipmentPhotoUrl : undefined,
      };
    });

    // 7. Monta o objeto SpdaReport final pronto para visualização e edição imediata
    const condoName = metadata.client.name || 'Condomínio Importado';
    const baseReport = JSON.parse(JSON.stringify(defaultSpdaReport)) as SpdaReport;

    const newReport: SpdaReport = {
      ...baseReport,
      id: `laudo-spda-${Date.now()}`,
      title: `Laudo SPDA - ${condoName}`,
      client: {
        ...baseReport.client,
        ...metadata.client,
        name: condoName,
        quantidadeTorres: sortedTowers.length,
        torresNomes: sortedTowers,
        descricaoBloco: initialTower,
      },
      texts: {
        ...baseReport.texts,
        ...metadata.texts,
      },
      conditions: {
        ...baseReport.conditions,
        ...metadata.conditions,
      },
      // Fotos ativas na tela de edição pertencem rigorosamente à torre inicial ativa
      torreAtual: initialTower,
      torresData,
      spdaPhotos: [...(torresData[initialTower]?.spdaPhotos || [])],
      measurementPhotos: [...(torresData[initialTower]?.measurementPhotos || [])],
      quadrosPhotos: [...(torresData[initialTower]?.quadrosPhotos || [])],
      localPhotos: [...localPhotos],
      equipmentPhotoUrl,
    };

    const sanitized = purgeOrphanPhotosAndTowers(newReport);
    const totalPhotos = countTotalPhotosInReport(sanitized);

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
        towersDetected: sortedTowers,
        photosCount: totalPhotos,
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
 * 3. IMPORTADOR AVANÇADO DE ARQUIVO PDF
 * - Lê página a página com extração contextual de texto e imagens
 * - Mapeia cada página para sua respectiva Torre e Seção técnica
 * - Extrai fotos incorporadas vinculando-as à sua torre e legenda
 * - Popula os dados estruturados no formato do laudo para edição
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
    const detectedTowersSet = new Set<string>();
    let currentGlobalTower = 'Torre 1';
    let currentGlobalCategory: 'local' | 'measurement' | 'spda' | 'quadros' | 'equipment' = 'spda';
    let equipmentPhotoUrl: string | undefined = undefined;

    // Mapas consolidados por torre e por seção
    const towerSpdaMap = new Map<string, PhotoSlot[]>();
    const towerMeasurementMap = new Map<string, PhotoSlot[]>();
    const towerQuadrosMap = new Map<string, PhotoSlot[]>();
    const localPhotos: PhotoSlot[] = [];

    // Helper para obter/inicializar lista de fotos de uma torre
    const getTowerList = (map: Map<string, PhotoSlot[]>, tName: string) => {
      if (!map.has(tName)) map.set(tName, []);
      return map.get(tName)!;
    };

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      interface TextItemCoord {
        str: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }

      const textItems: TextItemCoord[] = textContent.items
        .map((item: any) => ({
          str: String(item.str || '').trim(),
          x: item.transform?.[4] || 0,
          y: item.transform?.[5] || 0,
          w: item.width || 0,
          h: item.height || 10,
        }))
        .filter((item) => item.str.length > 0);

      // Reúne o texto da página
      const pageString = textItems.map((item) => item.str).join(' ');
      pageTexts.push(pageString);

      // Detecta se a página tem cabeçalhos de torre e subseção com suas posições Y (do topo para a base)
      // No PDF, y=0 é a base e y~842 é o topo. y maior = mais alto na página.
      interface SectionMarker {
        y: number;
        tower?: string;
        category?: 'local' | 'measurement' | 'spda' | 'quadros' | 'equipment';
      }
      const pageMarkers: SectionMarker[] = [];

      textItems.forEach((item) => {
        const text = item.str;

        // 1. Detecção de cabeçalho de Torre
        const tMatch =
          text.match(/(?:VISTORIA(?:\s*(?:&|E)\s*ENSAIOS)?\s*T[ÉE]CNICOS?\s*[:\-–]\s*)(TORRE\s+[A-Za-z0-9]+|BLOCO\s+[A-Za-z0-9]+|[ÁA]REA\s+COMUM)/i) ||
          text.match(/^(?:VISTORIA\s+T[ÉE]CNICA\s*[:\-–]\s*)?(TORRE\s+[A-Za-z0-9]+|BLOCO\s+[A-Za-z0-9]+|[ÁA]REA\s+COMUM)$/i);

        if (tMatch) {
          const matchedName = normalizeTowerName(tMatch[1]);
          if (matchedName) {
            detectedTowersSet.add(matchedName);
            pageMarkers.push({ y: item.y, tower: matchedName });
          }
        }

        // 2. Detecção de cabeçalho de Subseção
        if (/(?:6\.\d+\.1|PONTOS?\s+DE\s+(?:ENSAIO|INSPE[ÇC][ÃA]O)|CONTINUIDADE\s+[ÔO]HMICA|ENSAIOS?\s+DE\s+CONTINUIDADE)/i.test(text)) {
          pageMarkers.push({ y: item.y, category: 'measurement' });
        } else if (/(?:6\.\d+\.2|SPDA\s+EXISTENTE|CAPTORES?\s*(?:&|E)\s*DESCIDAS?|VISTORIA\s+DO\s+SPDA)/i.test(text)) {
          pageMarkers.push({ y: item.y, category: 'spda' });
        } else if (/(?:6\.\d+\.3|QUADROS?\s+DE\s+ENERGIA|QUADROS?\s+EL[ÉE]TRICOS?|PROTE[ÇC][ÃA]O\s+CONTRA\s+SURTOS|\bDPS\b)/i.test(text)) {
          pageMarkers.push({ y: item.y, category: 'quadros' });
        } else if (/(?:3\.\d+|FACHADA\s+PRINCIPAL|VISTA\s+A[ÉE]REA|CARACTER[ÍI]STICAS\s+DA\s+EDIFICA[ÇC][ÃA]O)/i.test(text)) {
          pageMarkers.push({ y: item.y, category: 'local' });
        } else if (/(?:5\)|INSTRUMENTA[ÇC][ÃA]O\s+T[ÉE]CNICA|MILIOHM[ÍI]METRO\s+HTM)/i.test(text)) {
          pageMarkers.push({ y: item.y, category: 'equipment' });
        }
      });

      // Ordena marcadores do topo para a base (y decrescente)
      pageMarkers.sort((a, b) => b.y - a.y);

      // Extrai imagens da página rastreando coordenadas exatas
      interface ExtractedPdfImage {
        dataUrl: string;
        x: number;
        y: number;
        w: number;
        h: number;
        topY: number;
      }
      const pageImages: ExtractedPdfImage[] = [];

      try {
        const ops = await page.getOperatorList();
        let currentCTM = [1, 0, 0, 1, 0, 0];

        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          const args = ops.argsArray[i];

          if (fn === pdfjsLib.OPS.transform) {
            currentCTM = args;
          } else if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintInlineImageXObject) {
            const imgKey = args[0];
            const imgObj = await new Promise<any>((resolve) => {
              page.objs.get(imgKey, (obj: any) => resolve(obj));
            });

            if (imgObj && imgObj.data && imgObj.width > 90 && imgObj.height > 90) {
              const canvas = document.createElement('canvas');
              canvas.width = imgObj.width;
              canvas.height = imgObj.height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                const imgData = ctx.createImageData(imgObj.width, imgObj.height);
                if (imgObj.data.length === imgObj.width * imgObj.height * 4) {
                  imgData.data.set(imgObj.data);
                } else if (imgObj.data.length === imgObj.width * imgObj.height * 3) {
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

                if (!isCompanyLogoDataUrl(dataUrl)) {
                  const w = Math.abs(currentCTM[0]) || imgObj.width;
                  const h = Math.abs(currentCTM[3]) || imgObj.height;
                  const x = currentCTM[4] || 0;
                  const y = currentCTM[5] || 0;
                  pageImages.push({
                    dataUrl,
                    x,
                    y,
                    w,
                    h,
                    topY: y + h,
                  });
                }
              }
            }
          }
        }
      } catch (opErr) {
        console.warn('Erro ao ler operadores da página:', opErr);
      }

      // Ordena imagens no fluxo natural de leitura: linhas de cima para baixo, e da esquerda para a direita
      pageImages.sort((a, b) => {
        // Se a diferença vertical for maior que 25pt, ordena verticalmente (de cima para baixo)
        if (Math.abs(b.topY - a.topY) > 25) {
          return b.topY - a.topY;
        }
        // Na mesma linha, ordena da esquerda para a direita
        return a.x - b.x;
      });

      // Mapeia cada imagem extraída para sua Torre, Seção e Legenda
      pageImages.forEach((img, imgIdx) => {
        // 1. Determina a Torre da foto: o marcador de torre mais próximo ACIMA da imagem
        let towerForImage = currentGlobalTower;
        for (const marker of pageMarkers) {
          if (marker.tower && marker.y > img.y - 10) {
            towerForImage = marker.tower;
            currentGlobalTower = marker.tower;
          }
        }

        // 2. Determina a Subseção da foto: o marcador de subseção mais próximo ACIMA da imagem
        let categoryForImage: 'local' | 'measurement' | 'spda' | 'quadros' | 'equipment' = currentGlobalCategory;
        for (const marker of pageMarkers) {
          if (marker.category && marker.y > img.y - 10) {
            categoryForImage = marker.category;
            currentGlobalCategory = marker.category;
          }
        }

        // Página 3 do laudo padrão é sempre Fachada / Local
        if (pageNum === 3) {
          categoryForImage = 'local';
        }

        // 3. Extrai texto localizado diretamente abaixo da foto (legenda e medição)
        // No PDF, texto embaixo da foto tem y < img.y e y > img.y - 45, com x no alinhamento da foto
        const nearbyTexts = textItems
          .filter((t) => {
            const isBelow = t.y < img.y + 5 && t.y > img.y - 45;
            const isAlignedX = t.x >= img.x - 25 && t.x <= img.x + img.w + 25;
            return isBelow && isAlignedX;
          })
          .sort((a, b) => b.y - a.y || a.x - b.x);

        const captionCombined = nearbyTexts.map((t) => t.str).join(' ').trim();

        // 4. Detecção contextual inteligente a partir da legenda
        const measMatch = captionCombined.match(/([0-9]+[.,][0-9]+\s*(?:Ω|ohms?|mΩ))/i) ||
          pageString.match(/([0-9]+[.,][0-9]+\s*(?:Ω|ohms?|mΩ))/i);
        const measurementValue = measMatch ? measMatch[1] : undefined;

        const isDpsAlert = /falta\s*dps|sem\s*dps|instalar\s*dps|aus[eê]ncia\s*de\s*dps/i.test(captionCombined);
        const isEquipotAlert = /falta\s*equipot|n[aã]o\s*equipot|equipotencializar|precisa\s*equipot/i.test(captionCombined);

        // Se a legenda ou medição indica claramente a categoria, refina a classificação:
        if (measurementValue || /miliohm|continuidade|ensaio/i.test(captionCombined)) {
          categoryForImage = 'measurement';
        } else if (isDpsAlert || /quadro|dps|barramento|painel/i.test(captionCombined)) {
          categoryForImage = 'quadros';
        } else if (isEquipotAlert || /spda|captor|descida|franklin|mastro|haste|aterramento/i.test(captionCombined)) {
          categoryForImage = 'spda';
        } else if (pageNum <= 3 && /fachada|vista\s*a[ée]rea|portaria|acesso/i.test(captionCombined)) {
          categoryForImage = 'local';
        }

        // Gera legenda limpa
        let cleanCaption = cleanCaptionText(captionCombined);
        if (!cleanCaption) {
          if (categoryForImage === 'measurement') {
            cleanCaption = measurementValue
              ? `${measurementValue} - Medição de continuidade ôhmica`
              : `Ponto de inspeção e ensaio - ${towerForImage}`;
          } else if (categoryForImage === 'quadros') {
            cleanCaption = isDpsAlert
              ? `Quadro elétrico - Falta DPS (${towerForImage})`
              : `Quadro de distribuição com DPS (${towerForImage})`;
          } else if (categoryForImage === 'spda') {
            cleanCaption = isEquipotAlert
              ? `SPDA existente - Falta equipotencialização (${towerForImage})`
              : `Registro de inspeção do SPDA - ${towerForImage}`;
          } else if (categoryForImage === 'local') {
            cleanCaption = localPhotos.length === 0
              ? 'Vista aérea e circunvizinhança da edificação'
              : 'Fachada principal e acessos da edificação';
          } else {
            cleanCaption = `Instrumento de medição (Miliohmímetro Digital)`;
          }
        }

        const slot: PhotoSlot = {
          id: `photo-pdf-p${pageNum}-${imgIdx + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          url: img.dataUrl,
          caption: cleanCaption,
          measurementValue,
          towerName: towerForImage,
          hasRedCircleMarker: isDpsAlert || isEquipotAlert,
        };

        // Distribui para a subseção e torre exata
        if (categoryForImage === 'equipment') {
          equipmentPhotoUrl = img.dataUrl;
        } else if (categoryForImage === 'local') {
          localPhotos.push(slot);
        } else if (categoryForImage === 'measurement') {
          getTowerList(towerMeasurementMap, towerForImage).push(slot);
        } else if (categoryForImage === 'quadros') {
          getTowerList(towerQuadrosMap, towerForImage).push(slot);
        } else {
          getTowerList(towerSpdaMap, towerForImage).push(slot);
        }
      });
    }

    const fullPdfText = pageTexts.join('\n');
    const metadata = extractMetadataFromText(fullPdfText, file.name);

    metadata.detectedTowers.forEach((t) => detectedTowersSet.add(t));
    if (detectedTowersSet.size === 0) {
      detectedTowersSet.add('Torre 1');
    }

    const sortedTowers = Array.from(detectedTowersSet).sort(compareTowerNames);
    const initialTower = sortedTowers[0] || 'Torre 1';

    // Monta o mapa completo de todas as torres
    const torresData: Record<string, TowerData> = {};
    sortedTowers.forEach((tName) => {
      torresData[tName] = {
        id: `tower-${tName.toLowerCase().replace(/\s+/g, '-')}`,
        nome: tName,
        spdaPhotos: towerSpdaMap.get(tName) || [],
        measurementPhotos: towerMeasurementMap.get(tName) || [],
        quadrosPhotos: towerQuadrosMap.get(tName) || [],
        localPhotos: tName === initialTower ? [...localPhotos] : [],
        equipmentPhotoUrl: tName === initialTower ? equipmentPhotoUrl : undefined,
      };
    });

    const condoName = metadata.client.name || 'Condomínio Importado';
    const baseReport = JSON.parse(JSON.stringify(defaultSpdaReport)) as SpdaReport;

    const newReport: SpdaReport = {
      ...baseReport,
      id: `laudo-spda-${Date.now()}`,
      title: `Laudo SPDA - ${condoName}`,
      client: {
        ...baseReport.client,
        ...metadata.client,
        name: condoName,
        quantidadeTorres: sortedTowers.length,
        torresNomes: sortedTowers,
        descricaoBloco: initialTower,
      },
      texts: {
        ...baseReport.texts,
        ...metadata.texts,
      },
      conditions: {
        ...baseReport.conditions,
        ...metadata.conditions,
      },
      torreAtual: initialTower,
      torresData,
      spdaPhotos: [...(torresData[initialTower]?.spdaPhotos || [])],
      measurementPhotos: [...(torresData[initialTower]?.measurementPhotos || [])],
      quadrosPhotos: [...(torresData[initialTower]?.quadrosPhotos || [])],
      localPhotos: [...localPhotos],
      equipmentPhotoUrl,
    };

    const sanitized = purgeOrphanPhotosAndTowers(newReport);
    const totalPhotos = countTotalPhotosInReport(sanitized);

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
        towersDetected: sortedTowers,
        photosCount: totalPhotos,
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
 * Utilitário regex para extrair campos cadastrais, textos e condições do laudo
 */
function extractMetadataFromText(
  text: string,
  fileName: string
): {
  client: Partial<ClientData>;
  texts: Partial<TechnicalTexts>;
  conditions: Partial<InspectionConditions>;
  detectedTowers: string[];
} {
  const client: Partial<ClientData> = {};
  const texts: Partial<TechnicalTexts> = {};
  const conditions: Partial<InspectionConditions> = {};

  // 1. Nome do Cliente / Condomínio
  const condoMatch =
    text.match(/(?:CLIENTE|CONDOM[ÍI]NIO|EDIF[ÍI]CIO|NOME\s+DA\s+EDIFICA[ÇC][ÃA]O)\s*[:=]\s*([^\n\r;]{3,80})/i) ||
    text.match(/Condom[íi]nio\s+([A-Za-z0-9\sÀ-ÿ\.\-]+?)(?:\s*-\s*|\s*,|\n|\r)/i);

  if (condoMatch) {
    client.name = condoMatch[1].trim().replace(/\s+/g, ' ');
  } else {
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

  // 9. Nível de exposição
  const expMatch = text.match(/GRAU\s+DE\s+EXPOSI[ÇC][ÃA]O\s*[:=]\s*([^\n\r;]{4,80})/i);
  if (expMatch) {
    client.exposicaoNivel = expMatch[1].trim();
  }

  // 10. Objeto da inspeção
  const objMatch = text.match(/OBJETO\s+DA\s+INSPE[ÇC][ÃA]O\s*[:=]\s*([^\n\r]{10,250})/i);
  if (objMatch) {
    texts.objeto = objMatch[1].trim();
  }

  // 11. Textos técnicos
  const concMatch = text.match(/(?:PARECER\s+T[ÉE]CNICO\s+CONCLUSIVO|CONCLUS[ÃA]O)\s*[:=]?\s*([^\n\r]{15,400})/i);
  if (concMatch) {
    texts.conclusaoFinal = concMatch[1].trim();
  }

  // 12. Detecção de Torres / Blocos
  const detectedTowersSet = new Set<string>();

  const towerMatches = text.matchAll(/\b(?:Torre|Bloco)\s+([A-Za-z0-9]+)\b/gi);
  for (const m of towerMatches) {
    const rawMatch = m[0].trim();
    const formatted = normalizeTowerName(rawMatch);
    if (formatted) detectedTowersSet.add(formatted);
  }

  if (/\b[ÁA]rea\s+Comum\b/i.test(text)) {
    detectedTowersSet.add('Área Comum');
  }

  const qtdMatch = text.match(/(\d+)\s+torres/i) || text.match(/quantidade\s+de\s+torres\s*[:=]\s*(\d+)/i);
  if (qtdMatch) {
    const qtd = parseInt(qtdMatch[1], 10);
    if (!isNaN(qtd) && qtd > 0 && qtd <= 50) {
      for (let i = 1; i <= qtd; i++) {
        detectedTowersSet.add(`Torre ${i}`);
      }
    }
  }

  const detectedTowers = Array.from(detectedTowersSet).sort(compareTowerNames);
  if (detectedTowers.length === 0) {
    detectedTowers.push('Torre 1');
  }

  return {
    client,
    texts,
    conditions,
    detectedTowers,
  };
}

/**
 * Cria um objeto PhotoSlot limpo e estruturado
 */
function createPhotoSlot(
  dataUrl: string,
  rawText: string,
  towerName: string,
  category: 'local' | 'measurement' | 'spda' | 'quadros' | 'equipment'
): PhotoSlot {
  const cap = cleanCaptionText(rawText);
  const measMatch = rawText.match(/([0-9]+[.,][0-9]+\s*(?:Ω|ohms?|mΩ))/i);
  const measVal = measMatch ? measMatch[1] : undefined;
  const isBad = /falta\s*dps|falta\s*equipot|irregular|aus[eê]ncia/i.test(rawText);

  return {
    id: `photo-${category}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    url: dataUrl,
    caption: cap || (category === 'measurement' && measVal ? `${measVal} - Medição` : `Registro técnico - ${towerName}`),
    measurementValue: measVal,
    towerName,
    hasRedCircleMarker: isBad,
  };
}

/**
 * Limpa o texto da legenda removendo termos de badges e cabeçalhos
 */
function cleanCaptionText(rawText: string): string {
  return rawText
    .replace(/⚠\s*FALTA\s*(?:DPS|EQUIPOT\.?)/gi, '')
    .replace(/\[Foto\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrai torre mencionada na legenda ou usa a torre ativa
 */
function extractTowerFromCaptionOrFallback(caption: string, fallbackTower: string): string {
  const match = caption.match(/\b(Torre\s+[A-Za-z0-9]+|Bloco\s+[A-Za-z0-9]+|[ÁA]rea\s+Comum)\b/i);
  if (match) {
    return normalizeTowerName(match[1]);
  }
  return fallbackTower;
}

/**
 * Extrai categoria da foto a partir da legenda ou usa a categoria da seção atual
 */
function extractCategoryFromCaptionOrFallback(
  caption: string,
  fallback: 'local' | 'measurement' | 'spda' | 'quadros' | 'equipment' | 'general'
): 'local' | 'measurement' | 'spda' | 'quadros' | 'equipment' {
  const lower = caption.toLowerCase();
  if (/miliohm|ohm|Ω|continuidade|ensaio/i.test(lower)) return 'measurement';
  if (/quadro|dps|disjuntor|barramento|painel|qgbt/i.test(lower)) return 'quadros';
  if (/fachada|entrada|portaria|acesso|vista\s*geral/i.test(lower)) return 'local';
  if (/instrumento|equipamento/i.test(lower)) return 'equipment';

  if (fallback === 'general') return 'spda';
  return fallback;
}

/**
 * Normaliza nomes de torre para formatação padrão (ex: "Torre 1", "Torre A", "Área Comum")
 */
function normalizeTowerName(raw: string): string {
  const trimmed = raw.trim();
  if (/^[áa]rea\s+comum$/i.test(trimmed)) return 'Área Comum';
  const m = trimmed.match(/^(Torre|Bloco|Edif[íi]cio)\s+([A-Za-z0-9]+)/i);
  if (m) {
    const prefix = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    const id = m[2].toUpperCase();
    return `${prefix} ${id}`;
  }
  return trimmed;
}

/**
 * Conta o total de fotos armazenadas em todo o laudo
 */
function countTotalPhotosInReport(report: SpdaReport): number {
  let count = (report.localPhotos?.length || 0);
  if (report.torresData) {
    Object.values(report.torresData).forEach((tData) => {
      count += (tData.spdaPhotos?.length || 0) + (tData.measurementPhotos?.length || 0) + (tData.quadrosPhotos?.length || 0);
    });
  } else {
    count += (report.spdaPhotos?.length || 0) + (report.measurementPhotos?.length || 0) + (report.quadrosPhotos?.length || 0);
  }
  return count;
}

/**
 * Detecta se a imagem é a logomarca da empresa para não inseri-la como foto de inspeção
 */
function isCompanyLogoDataUrl(dataUrl: string): boolean {
  if (!dataUrl) return false;
  if (dataUrl === SJC_OFFICIAL_LOGO_DATA_URL) return true;
  // Logos da empresa costumam ter tamanho de arquivo característico ou dimensões pequenas
  return false;
}

/**
 * Extrai todo o texto plano de um nó XML DOM
 */
function getNodeText(node: Element): string {
  const textNodes = node.getElementsByTagName('w:t');
  let result = '';
  for (let i = 0; i < textNodes.length; i++) {
    result += textNodes[i].textContent || '';
  }
  return result;
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
