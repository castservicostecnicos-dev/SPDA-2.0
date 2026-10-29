import { SpdaReport, TowerData, PhotoSlot } from '../types/spda';

/**
 * Compara dois nomes de torre ou bloco de maneira natural (alfanumérica humana).
 * Exemplos de ordenação correta:
 * - Numérico: "Torre 1" < "Torre 2" < "Torre 4" < "Torre 5" < "Torre 10"
 * - Letras: "Torre A" < "Torre B" < "Torre C" < "Torre D" < "Torre E"
 * - Letras minúsculas: "torre a" < "torre b" < "torre c"
 * - Blocos: "Bloco 1" < "Bloco 2", "Bloco A" < "Bloco B"
 * - Apenas números ou letras: "1" < "2" < "4" < "5" ou "a" < "b" < "c"
 */
const PORTUGUESE_NUMBERS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  'três': 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  meia: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
};

const ROMAN_NUMERALS: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
  xiii: 13,
  xiv: 14,
  xv: 15,
};

/**
 * Extrai o valor ordinal/alfanumérico da torre para ordenação precisa:
 * - Numérico: "Torre 1", "Torre 2", "Torre 4", "Torre 5", "Torre 10"
 * - Letras: "Torre A", "Torre B", "Torre C" ou "a", "b", "c"
 * - Por extenso: "Torre um", "Torre dois", "Torre três", "Torre quatro"
 * - Romanos: "Torre I", "Torre II", "Torre III", "Torre IV"
 */
export function parseTowerIdentifier(name: string): { num?: number; str: string; isNumeric: boolean } {
  const trimmed = (name || '').trim();
  // Remove prefixos como "Torre", "Bloco", "Edifício", "Prédio"
  const cleaned = trimmed.replace(/^(?:torre|bloco|edif[íi]cio|pr[ée]dio|setor)\s+/i, '').trim();
  const lower = cleaned.toLowerCase();

  // 1. Número decimal puro (ex: "1", "2", "5", "10")
  const numInt = parseInt(cleaned, 10);
  if (!isNaN(numInt) && /^\d+$/.test(cleaned)) {
    return { num: numInt, str: trimmed, isNumeric: true };
  }

  // 2. Número por extenso em português (ex: "um", "dois", "três", "quatro", "cinco")
  if (PORTUGUESE_NUMBERS[lower] !== undefined) {
    return { num: PORTUGUESE_NUMBERS[lower], str: trimmed, isNumeric: true };
  }

  // 3. Algarismo Romano (ex: "I", "II", "III", "IV", "V", "VI", "VII")
  if (ROMAN_NUMERALS[lower] !== undefined) {
    return { num: ROMAN_NUMERALS[lower], str: trimmed, isNumeric: true };
  }

  // 4. Letra única (ex: "A", "B", "C", "D", "E" ou "a", "b", "c")
  if (/^[a-z]$/i.test(cleaned)) {
    const letterCode = cleaned.toUpperCase().charCodeAt(0) - 64; // A=1, B=2, C=3...
    return { num: letterCode, str: cleaned.toLowerCase(), isNumeric: false };
  }

  // 5. Se houver número dentro do texto (ex: "Torre Sul 2")
  const embeddedNumber = cleaned.match(/\d+/);
  if (embeddedNumber) {
    const val = parseInt(embeddedNumber[0], 10);
    if (!isNaN(val)) {
      return { num: val, str: trimmed, isNumeric: true };
    }
  }

  return { str: trimmed, isNumeric: false };
}

/**
 * Compara dois nomes de torre ou bloco de maneira natural (alfanumérica humana).
 * Exemplos de ordenação correta:
 * - Numérico: "Torre 1" < "Torre 2" < "Torre 4" < "Torre 5" < "Torre 10"
 * - Letras: "Torre A" < "Torre B" < "Torre C" < "Torre D" < "Torre E"
 * - Extenso: "Torre um" < "Torre dois" < "Torre três" < "Torre quatro"
 * - Romanos: "Torre I" < "Torre II" < "Torre III" < "Torre IV"
 */
export function compareTowerNames(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const cleanA = a.trim().toLowerCase();
  const cleanB = b.trim().toLowerCase();

  // Área Comum tem precedência e fica sempre no topo antes das torres numeradas
  if (cleanA === 'área comum' && cleanB !== 'área comum') return -1;
  if (cleanB === 'área comum' && cleanA !== 'área comum') return 1;

  const parsedA = parseTowerIdentifier(a);
  const parsedB = parseTowerIdentifier(b);

  // Se ambos foram convertidos para números (seja 1 vs 5, ou "um" vs "quatro", ou "A" vs "E")
  if (parsedA.num !== undefined && parsedB.num !== undefined) {
    return parsedA.num - parsedB.num;
  }

  // Se um é numérico e outro não, números vêm primeiro
  if (parsedA.num !== undefined && parsedB.num === undefined) {
    return -1;
  }
  if (parsedA.num === undefined && parsedB.num !== undefined) {
    return 1;
  }

  // Ordenação natural de strings com suporte pt-BR
  return a.trim().localeCompare(b.trim(), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

/**
 * Consolida e organiza automaticamente todas as fotos do laudo por torre e por seção,
 * ordenando estritamente do menor para o maior (ex: Torre 1, depois 2, depois 4, depois 5; ou A, B, C, D...).
 * 
 * Se o usuário tiver fotografado na sequência: Torre 5 -> Torre 2 -> Torre 4 -> Torre 1,
 * esta função reorganiza para: Torre 1 -> Torre 2 -> Torre 4 -> Torre 5 em cada seção do laudo!
 */
/**
 * Retorna os nomes válidos e ativos de torres cadastrados no relatório.
 */
export function getValidTowerNames(report: SpdaReport): string[] {
  const qtd = Math.max(1, report.client?.quantidadeTorres || 1);
  const nomesFromClient = (report.client?.torresNomes || []).slice(0, qtd);
  const validList: string[] = [];
  for (let i = 0; i < qtd; i++) {
    const raw = nomesFromClient[i]?.trim();
    const defaultName = `Torre ${i + 1}`;
    validList.push(raw && raw.length > 0 ? raw : defaultName);
  }
  return validList;
}

/**
 * Remove completamente torres órfãs (torres apagadas ou excluídas) e suas fotos
 * do objeto do laudo, garantindo que nunca permaneçam no banco ou no relatório final.
 */
export function purgeOrphanPhotosAndTowers(report: SpdaReport): SpdaReport {
  const validTowerNames = getValidTowerNames(report);
  const validTowerSet = new Set<string>(validTowerNames);
  validTowerSet.add('Área Comum');

  // Ajusta torreAtual caso tenha sido excluída
  let currentTower = report.torreAtual || validTowerNames[0] || 'Torre 1';
  if (!validTowerSet.has(currentTower)) {
    currentTower = validTowerNames[0] || 'Torre 1';
  }

  // Limpa o mapa torresData
  const cleanedTorresData: Record<string, TowerData> = {};
  if (report.torresData) {
    Object.entries(report.torresData).forEach(([tNome, data]) => {
      if (!validTowerSet.has(tNome)) {
        // Torre órfã descartada!
        return;
      }
      cleanedTorresData[tNome] = {
        ...data,
        nome: tNome,
        spdaPhotos: (data.spdaPhotos || []).filter((p) => !p.towerName || p.towerName === tNome || validTowerSet.has(p.towerName)),
        measurementPhotos: (data.measurementPhotos || []).filter((p) => !p.towerName || p.towerName === tNome || validTowerSet.has(p.towerName)),
        quadrosPhotos: (data.quadrosPhotos || []).filter((p) => !p.towerName || p.towerName === tNome || validTowerSet.has(p.towerName)),
      };
    });
  }

  // Filtra as fotos ativas caso contenham referências a torres apagadas
  const cleanedSpda = (report.spdaPhotos || []).filter((p) => !p.towerName || validTowerSet.has(p.towerName));
  const cleanedMedicao = (report.measurementPhotos || []).filter((p) => !p.towerName || validTowerSet.has(p.towerName));
  const cleanedQuadros = (report.quadrosPhotos || []).filter((p) => !p.towerName || validTowerSet.has(p.towerName));

  return {
    ...report,
    torreAtual: currentTower,
    client: {
      ...report.client,
      quantidadeTorres: validTowerNames.length,
      torresNomes: validTowerNames,
    },
    torresData: cleanedTorresData,
    spdaPhotos: cleanedSpda,
    measurementPhotos: cleanedMedicao,
    quadrosPhotos: cleanedQuadros,
  };
}

/**
 * Conta quantas fotos órfãs (fotos de torres apagadas ou inexistentes)
 * existem atualmente no laudo.
 */
export function countOrphanPhotos(report: SpdaReport): number {
  if (!report) return 0;
  const validTowerNames = getValidTowerNames(report);
  const validTowerSet = new Set<string>(validTowerNames);
  validTowerSet.add('Área Comum');

  let count = 0;

  // Verifica fotos em torresData
  if (report.torresData) {
    Object.entries(report.torresData).forEach(([tNome, data]) => {
      if (!validTowerSet.has(tNome)) {
        count += (data.spdaPhotos?.length || 0) + (data.measurementPhotos?.length || 0) + (data.quadrosPhotos?.length || 0);
      } else {
        const orphanSpda = (data.spdaPhotos || []).filter((p) => p.towerName && !validTowerSet.has(p.towerName)).length;
        const orphanMed = (data.measurementPhotos || []).filter((p) => p.towerName && !validTowerSet.has(p.towerName)).length;
        const orphanQuad = (data.quadrosPhotos || []).filter((p) => p.towerName && !validTowerSet.has(p.towerName)).length;
        count += orphanSpda + orphanMed + orphanQuad;
      }
    });
  }

  // Verifica fotos nos arrays ativos
  const orphanActiveSpda = (report.spdaPhotos || []).filter((p) => p.towerName && !validTowerSet.has(p.towerName)).length;
  const orphanActiveMed = (report.measurementPhotos || []).filter((p) => p.towerName && !validTowerSet.has(p.towerName)).length;
  const orphanActiveQuad = (report.quadrosPhotos || []).filter((p) => p.towerName && !validTowerSet.has(p.towerName)).length;

  return count + orphanActiveSpda + orphanActiveMed + orphanActiveQuad;
}

/**
 * Consolida e organiza automaticamente todas as fotos do laudo por torre e por seção,
 * ordenando estritamente do menor para o maior (ex: Torre 1, depois 2, depois 4, depois 5; ou A, B, C, D...).
 * 
 * Se o usuário tiver fotografado na sequência: Torre 5 -> Torre 2 -> Torre 4 -> Torre 1,
 * esta função reorganiza para: Torre 1 -> Torre 2 -> Torre 4 -> Torre 5 em cada seção do laudo!
 * 
 * GARANTIA ANTIFALHA DE FOTOS ÓRFÃS:
 * Se uma torre foi apagada ou excluída durante a vistoria, todas as suas fotos são
 * sumariamente ignoradas e descartadas da consolidação de visualização, PDF e DOCX.
 */
export function consolidateReportPhotos(report: SpdaReport): SpdaReport {
  const validTowerNames = getValidTowerNames(report);
  const validTowerSet = new Set<string>(validTowerNames);
  validTowerSet.add('Área Comum');

  // Determina a torre ativa garantindo que não aponte para torre apagada
  let currentTower = report.torreAtual || validTowerNames[0] || 'Torre 1';
  if (!validTowerSet.has(currentTower)) {
    currentTower = validTowerNames[0] || 'Torre 1';
  }

  // 1. Mapeia dados apenas de torres VÁLIDAS
  const allTowersMap: Record<string, TowerData> = {};

  if (report.torresData) {
    Object.entries(report.torresData).forEach(([tNome, data]) => {
      // REGRA: Ignora torres que não existem mais na lista válida
      if (!validTowerSet.has(tNome)) {
        return;
      }

      // Se for Área Comum sem fotos e não é a torre ativa, não precisa consolidar
      if (tNome === 'Área Comum') {
        const hasAreaPhotos =
          (data.spdaPhotos && data.spdaPhotos.length > 0) ||
          (data.measurementPhotos && data.measurementPhotos.length > 0) ||
          (data.quadrosPhotos && data.quadrosPhotos.length > 0) ||
          (data.localPhotos && data.localPhotos.length > 0);
        if (!hasAreaPhotos && currentTower !== 'Área Comum') {
          return;
        }
      }

      allTowersMap[tNome] = {
        id: data.id || tNome.toLowerCase().replace(/\s+/g, '-'),
        nome: tNome,
        spdaPhotos: (data.spdaPhotos || []).filter((p) => !p.towerName || validTowerSet.has(p.towerName)),
        measurementPhotos: (data.measurementPhotos || []).filter((p) => !p.towerName || validTowerSet.has(p.towerName)),
        quadrosPhotos: (data.quadrosPhotos || []).filter((p) => !p.towerName || validTowerSet.has(p.towerName)),
        localPhotos: [...(data.localPhotos || [])],
        equipmentPhotoUrl: data.equipmentPhotoUrl || report.equipmentPhotoUrl,
        conditions: data.conditions ? { ...data.conditions } : { ...report.conditions },
      };
    });
  }

  // Atualiza com a torre atualmente em edição ativa (removendo fotos órfãs se houver)
  const safeActiveSpda = (report.spdaPhotos || []).filter((p) => !p.towerName || validTowerSet.has(p.towerName));
  const safeActiveMedicao = (report.measurementPhotos || []).filter((p) => !p.towerName || validTowerSet.has(p.towerName));
  const safeActiveQuadros = (report.quadrosPhotos || []).filter((p) => !p.towerName || validTowerSet.has(p.towerName));

  allTowersMap[currentTower] = {
    id: currentTower.toLowerCase().replace(/\s+/g, '-'),
    nome: currentTower,
    spdaPhotos: [...safeActiveSpda],
    measurementPhotos: [...safeActiveMedicao],
    quadrosPhotos: [...safeActiveQuadros],
    localPhotos: [...report.localPhotos],
    equipmentPhotoUrl: report.equipmentPhotoUrl,
    conditions: { ...report.conditions },
  };

  // Se não houver torres no mapa, usa a primeira torre válida
  if (Object.keys(allTowersMap).length === 0) {
    const fallback = validTowerNames[0] || 'Torre 1';
    allTowersMap[fallback] = {
      id: fallback.toLowerCase().replace(/\s+/g, '-'),
      nome: fallback,
      spdaPhotos: [...safeActiveSpda],
      measurementPhotos: [...safeActiveMedicao],
      quadrosPhotos: [...safeActiveQuadros],
      localPhotos: [...report.localPhotos],
      equipmentPhotoUrl: report.equipmentPhotoUrl,
      conditions: { ...report.conditions },
    };
  }

  // 2. Ordena os nomes das torres do menor para o maior (1, 2, 4, 5... ou A, B, C...)
  const sortedTowerNames = Object.keys(allTowersMap).sort(compareTowerNames);

  // 3. Constrói os arrays de fotos consolidados e ordenados para cada seção
  const consolidatedSpdaPhotos: PhotoSlot[] = [];
  const consolidatedMeasurementPhotos: PhotoSlot[] = [];
  const consolidatedQuadrosPhotos: PhotoSlot[] = [];

  sortedTowerNames.forEach((tNome) => {
    const towerData = allTowersMap[tNome];
    if (!towerData) return;

    // Seção 5: SPDA existente da torre
    towerData.spdaPhotos.forEach((photo) => {
      consolidatedSpdaPhotos.push({
        ...photo,
        towerName: photo.towerName || tNome,
      });
    });

    // Seção 6: Medições de continuidade da torre
    towerData.measurementPhotos.forEach((photo) => {
      consolidatedMeasurementPhotos.push({
        ...photo,
        towerName: photo.towerName || tNome,
      });
    });

    // Seção 7: Quadros com DPS da torre
    towerData.quadrosPhotos.forEach((photo) => {
      consolidatedQuadrosPhotos.push({
        ...photo,
        towerName: photo.towerName || tNome,
      });
    });
  });

  // Seção 3: Fachada, Vista Aérea e Equipamento pertencem exclusivamente ao condomínio / Torre 1
  // Não devem ser duplicadas nem multiplicadas pelas outras torres
  const firstTowerName = sortedTowerNames[0] || 'Torre 1';
  const torre1Data = allTowersMap['Torre 1'] || allTowersMap[firstTowerName];
  
  // Assegura que as fotos do local (aérea e fachada) venham da Torre 1 ou do report geral
  let propertyLocalPhotos: PhotoSlot[] = [];
  if (torre1Data?.localPhotos && torre1Data.localPhotos.length > 0) {
    propertyLocalPhotos = [...torre1Data.localPhotos];
  } else if (report.localPhotos && report.localPhotos.length > 0) {
    propertyLocalPhotos = [...report.localPhotos];
  }

  const propertyEquipmentUrl =
    torre1Data?.equipmentPhotoUrl || report.equipmentPhotoUrl || undefined;

  // Retorna o laudo com as fotos organizadas e ordenadas do menor para o maior em cada seção
  // e com torresData limpo, sem torres órfãs
  return {
    ...report,
    torreAtual: currentTower,
    spdaPhotos: consolidatedSpdaPhotos.length > 0 ? consolidatedSpdaPhotos : safeActiveSpda,
    measurementPhotos: consolidatedMeasurementPhotos.length > 0 ? consolidatedMeasurementPhotos : safeActiveMedicao,
    quadrosPhotos: consolidatedQuadrosPhotos.length > 0 ? consolidatedQuadrosPhotos : safeActiveQuadros,
    localPhotos: propertyLocalPhotos,
    equipmentPhotoUrl: propertyEquipmentUrl,
    torresData: allTowersMap,
  };
}

/**
 * Representa o grupo completo de inspeção de UMA torre no laudo:
 * - Pontos de inspeção e ensaios de continuidade ôhmica
 * - SPDA existente e captores
 * - Quadros elétricos e proteção contra surtos (DPS)
 */
export interface TowerInspectionGroup {
  towerName: string;
  isAreaComum: boolean;
  measurementPhotos: PhotoSlot[]; // 1. Pontos de inspeção / medição
  spdaPhotos: PhotoSlot[];        // 2. SPDA existente
  quadrosPhotos: PhotoSlot[];     // 3. Quadros com DPS
  measurements: PhotoSlot[];      // alias para compatibilidade
  spda: PhotoSlot[];              // alias para compatibilidade
  quadros: PhotoSlot[];           // alias para compatibilidade
  totalPhotos: number;
}

/**
 * Ordenação das torres para apresentação no relatório (PDF, DOCX e Preview):
 * Torres residenciais primeiro em ordem natural (Torre 1, 2... 7 ou A, B, C...),
 * seguidas pela Área Comum (se houver).
 */
export function compareTowerNamesForReport(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const cleanA = a.trim().toLowerCase();
  const cleanB = b.trim().toLowerCase();

  // No relatório final, Área Comum vai após as torres residenciais
  if (cleanA === 'área comum' && cleanB !== 'área comum') return 1;
  if (cleanB === 'área comum' && cleanA !== 'área comum') return -1;

  return compareTowerNames(a, b);
}

/**
 * Separa e agrupa o laudo fotográfico POR TORRE, contendo para cada torre:
 * 1. Pontos de inspeção e ensaios de continuidade
 * 2. SPDA existente
 * 3. Quadros com DPS
 * 
 * Permite a apresentação do laudo no formato solicitado:
 * - Torre 1: Ponto de inspeção, SPDA existente, quadros.
 * - Torre 2: Ponto de inspeção, SPDA existente, quadros.
 * - Torre 3: ...
 */
export function getTowerInspectionGroups(report: SpdaReport): TowerInspectionGroup[] {
  const consolidated = consolidateReportPhotos(report);
  const validTowerNames = getValidTowerNames(consolidated);
  const validTowerSet = new Set<string>(validTowerNames);
  validTowerSet.add('Área Comum');

  const allTowersMap = consolidated.torresData || {};

  // Lista de torres a incluir no laudo
  const towerNamesToConsider = new Set<string>(validTowerNames);

  // Se Área Comum tiver fotos cadastradas, inclui no relatório
  const areaData = allTowersMap['Área Comum'];
  if (
    areaData &&
    ((areaData.spdaPhotos && areaData.spdaPhotos.length > 0) ||
      (areaData.measurementPhotos && areaData.measurementPhotos.length > 0) ||
      (areaData.quadrosPhotos && areaData.quadrosPhotos.length > 0))
  ) {
    towerNamesToConsider.add('Área Comum');
  }

  // Ordena torres
  const sortedNames = Array.from(towerNamesToConsider).sort(compareTowerNamesForReport);

  const groups: TowerInspectionGroup[] = [];

  sortedNames.forEach((tNome) => {
    const data = allTowersMap[tNome];
    const measurementPhotos = data?.measurementPhotos || [];
    const spdaPhotos = data?.spdaPhotos || [];
    const quadrosPhotos = data?.quadrosPhotos || [];

    const total = measurementPhotos.length + spdaPhotos.length + quadrosPhotos.length;

    // Inclui a torre no relatório
    groups.push({
      towerName: tNome,
      isAreaComum: tNome === 'Área Comum',
      measurementPhotos,
      spdaPhotos,
      quadrosPhotos,
      measurements: measurementPhotos,
      spda: spdaPhotos,
      quadros: quadrosPhotos,
      totalPhotos: total,
    });
  });

  return groups;
}

/**
 * Estatísticas e apontamentos de adequação de uma torre
 */
export interface TowerCorrectionStats {
  towerName: string;
  equipotentialCount: number; // Quantidade de pontos a equipotencializar
  dpsMissingCount: number;    // Quantidade de quadros que precisam de DPS
  otherNonCompliantCount: number; // Outras não conformidades marcadas
  totalCorrections: number;
  equipotentialItems: { caption: string; notes?: string; photoId?: string }[];
  dpsItems: { caption: string; notes?: string; photoId?: string }[];
  otherItems: { caption: string; notes?: string; photoId?: string }[];
}

export interface NonComplianceItem {
  type: 'dps' | 'equipotential' | 'other';
  caption: string;
  notes?: string;
}

export interface NonComplianceRow {
  towerName: string;
  pointsNeedingEquipotentialization: number;
  panelsNeedingDps: number;
  otherNonCompliances: number;
  total: number;
  items: NonComplianceItem[];
}

/**
 * Sumário executivo consolidado de não conformidades de todas as torres
 */
export interface ReportNonComplianceSummary {
  byTower: Record<string, TowerCorrectionStats>;
  orderedTowers: string[];
  rows: NonComplianceRow[];
  totalEquipotential: number;
  totalEquipotentialization: number;
  totalDpsMissing: number;
  totalOther: number;
  grandTotal: number;
}

/**
 * Normaliza strings para detecção sem acentos e em minúsculas
 */
function normalizeInspectionText(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Detecta se a legenda/observação indica falta de DPS
 */
export function isDpsMissingCaption(caption: string, notes?: string): boolean {
  const norm = normalizeInspectionText(`${caption || ''} ${notes || ''}`);
  if (!norm) return false;

  return (
    /(falta|sem|precisa|necessita|instalar|ausencia|nao\s+possui|nao\s+tem|ausente|faltante|danificado)\b.*?\bdps\b/.test(norm) ||
    /\bdps\b.*?(falta|ausente|faltante|danificado|necessario|requerido)/.test(norm) ||
    /quadro\s+sem\s+dps/.test(norm) ||
    norm.includes('falta dps') ||
    norm.includes('sem dps')
  );
}

/**
 * Detecta se a legenda/observação indica necessidade de equipotencialização
 */
export function isEquipotentialMissingCaption(caption: string, notes?: string): boolean {
  const norm = normalizeInspectionText(`${caption || ''} ${notes || ''}`);
  if (!norm) return false;

  return (
    /equipotencializ/.test(norm) ||
    /falta\s+equipotencial/.test(norm) ||
    /necessita\s+equipotencial/.test(norm) ||
    /precisa\s+equipotencial/.test(norm) ||
    /sem\s+equipotencial/.test(norm) ||
    /nao\s+equipotencial/.test(norm) ||
    /sem\s+continuidade/.test(norm) ||
    /continuidade\s+reprovada/.test(norm) ||
    norm.includes('falta aterrar') ||
    norm.includes('nao aterrado')
  );
}

/**
 * Detecta outras irregularidades / não conformidades
 */
export function isOtherNonCompliantCaption(caption: string, notes?: string): boolean {
  const norm = normalizeInspectionText(`${caption || ''} ${notes || ''}`);
  if (!norm) return false;

  if (isDpsMissingCaption(caption, notes) || isEquipotentialMissingCaption(caption, notes)) {
    return false;
  }

  return /(nao\s+conforme|reprovado|rompido|corroido|danificado|cabo\s+solto|fora\s+de\s+norma|inadequado|irregular|oxidado)/.test(
    norm
  );
}

/**
 * Analisa e contabiliza automaticamente todas as não conformidades registradas nas legendas
 * das fotos de cada torre:
 * - Pontos que necessitam equipotencialização ("falta equipotencializar", "equipotencializar", etc.)
 * - Quadros que precisam de DPS ("falta DPS", "sem DPS", "instalar DPS", etc.)
 * - Outras adequações
 */
export function analyzeTowerNonConformities(report: SpdaReport): ReportNonComplianceSummary {
  const groups = getTowerInspectionGroups(report);
  const byTower: Record<string, TowerCorrectionStats> = {};
  const orderedTowers: string[] = [];

  let totalEquipotential = 0;
  let totalDpsMissing = 0;
  let totalOther = 0;

  groups.forEach((group) => {
    const tNome = group.towerName;
    orderedTowers.push(tNome);

    const stats: TowerCorrectionStats = {
      towerName: tNome,
      equipotentialCount: 0,
      dpsMissingCount: 0,
      otherNonCompliantCount: 0,
      totalCorrections: 0,
      equipotentialItems: [],
      dpsItems: [],
      otherItems: [],
    };

    // Analisa fotos dos 3 tipos da torre
    const allTowerPhotos: PhotoSlot[] = [
      ...group.measurementPhotos,
      ...group.spdaPhotos,
      ...group.quadrosPhotos,
    ];

    allTowerPhotos.forEach((photo) => {
      const cap = (photo.caption || '').trim();
      const nts = (photo.notes || '').trim();
      if (!cap && !nts) return;

      const hasDpsIssue = isDpsMissingCaption(cap, nts);
      const hasEquipIssue = isEquipotentialMissingCaption(cap, nts);
      const hasOtherIssue = isOtherNonCompliantCaption(cap, nts);

      if (hasDpsIssue) {
        stats.dpsMissingCount++;
        stats.dpsItems.push({
          caption: cap || 'Quadro elétrico necessitando instalação de DPS',
          notes: nts,
          photoId: photo.id,
        });
      }

      if (hasEquipIssue) {
        stats.equipotentialCount++;
        stats.equipotentialItems.push({
          caption: cap || 'Ponto metálico necessitando equipotencialização ao SPDA',
          notes: nts,
          photoId: photo.id,
        });
      }

      if (hasOtherIssue && !hasDpsIssue && !hasEquipIssue) {
        stats.otherNonCompliantCount++;
        stats.otherItems.push({
          caption: cap || 'Item necessitando intervenção/correção técnica',
          notes: nts,
          photoId: photo.id,
        });
      }
    });

    stats.totalCorrections = stats.equipotentialCount + stats.dpsMissingCount + stats.otherNonCompliantCount;

    totalEquipotential += stats.equipotentialCount;
    totalDpsMissing += stats.dpsMissingCount;
    totalOther += stats.otherNonCompliantCount;

    byTower[tNome] = stats;
  });

  const rows: NonComplianceRow[] = orderedTowers.map((tNome) => {
    const stats = byTower[tNome];
    const items: NonComplianceItem[] = [];
    (stats.dpsItems || []).forEach((d) => items.push({ type: 'dps', caption: d.caption, notes: d.notes }));
    (stats.equipotentialItems || []).forEach((e) => items.push({ type: 'equipotential', caption: e.caption, notes: e.notes }));
    (stats.otherItems || []).forEach((o) => items.push({ type: 'other', caption: o.caption, notes: o.notes }));

    return {
      towerName: tNome,
      pointsNeedingEquipotentialization: stats.equipotentialCount,
      panelsNeedingDps: stats.dpsMissingCount,
      otherNonCompliances: stats.otherNonCompliantCount,
      total: stats.totalCorrections,
      items,
    };
  });

  return {
    byTower,
    orderedTowers,
    rows,
    totalEquipotential,
    totalEquipotentialization: totalEquipotential,
    totalDpsMissing,
    totalOther,
    grandTotal: totalEquipotential + totalDpsMissing + totalOther,
  };
}

/**
 * Exporta a planilha Excel / CSV das não conformidades por torre, pronta para abrir no Microsoft Excel
 */
export function exportNonConformitiesToExcelCsv(report: SpdaReport): void {
  const summary = analyzeTowerNonConformities(report);
  const condoName = report.client?.name || 'Condominio';
  const dataHoje = new Date().toLocaleDateString('pt-BR');

  // Constrói CSV com delimitador ponto e vírgula (padrão Brasil/Excel) e BOM UTF-8 (\uFEFF)
  let csv = '\uFEFF';

  // Cabeçalho institucional
  csv += `"LAUDO TÉCNICO DE INSPEÇÃO SPDA - NBR 5419:2026"\n`;
  csv += `"QUADRO RESUMO DE ADEQUAÇÕES E NÃO CONFORMIDADES POR TORRE"\n`;
  csv += `"CLIENTE / CONDOMÍNIO:";"${condoName}"\n`;
  csv += `"LOCAL:";"${report.client?.local || ''}"\n`;
  csv += `"RESPONSÁVEL TÉCNICO:";"${report.client?.tecnico || ''} - ${report.client?.crea || ''}"\n`;
  csv += `"DATA DA EMISSÃO:";"${dataHoje}"\n\n`;

  // Tabela 1: Resumo Quantitativo por Torre
  csv += `"TABELA RESUMO EXECUTIVO POR TORRE"\n`;
  csv += `"TORRE / BLOCO";"PONTOS A EQUIPOTENCIALIZAR";"QUADROS QUE PRECISAM DE DPS";"OUTRAS ADEQUAÇÕES";"TOTAL DE ITENS A CORRIGIR"\n`;

  summary.orderedTowers.forEach((tNome) => {
    const stats = summary.byTower[tNome];
    if (stats) {
      csv += `"${stats.towerName}";${stats.equipotentialCount};${stats.dpsMissingCount};${stats.otherNonCompliantCount};${stats.totalCorrections}\n`;
    }
  });

  // Linha de total geral
  csv += `"TOTAL GERAL DO CONDOMÍNIO";${summary.totalEquipotential};${summary.totalDpsMissing};${summary.totalOther};${summary.grandTotal}\n\n`;

  // Tabela 2: Detalhamento Item a Item por Torre
  csv += `"DETALHAMENTO DAS ADEQUAÇÕES APONTADAS POR TORRE"\n`;
  csv += `"TORRE / BLOCO";"TIPO DE ADEQUAÇÃO";"DESCRIÇÃO / LEGENDA DO ITEM REGISTRADO";"OBSERVAÇÕES"\n`;

  summary.orderedTowers.forEach((tNome) => {
    const stats = summary.byTower[tNome];
    if (stats) {
      stats.equipotentialItems.forEach((item) => {
        csv += `"${tNome}";"FALTA EQUIPOTENCIALIZAR";"${item.caption.replace(/"/g, '""')}";"${(item.notes || '').replace(/"/g, '""')}"\n`;
      });
      stats.dpsItems.forEach((item) => {
        csv += `"${tNome}";"FALTA DPS NO QUADRO";"${item.caption.replace(/"/g, '""')}";"${(item.notes || '').replace(/"/g, '""')}"\n`;
      });
      stats.otherItems.forEach((item) => {
        csv += `"${tNome}";"OUTRA NÃO CONFORMIDADE";"${item.caption.replace(/"/g, '""')}";"${(item.notes || '').replace(/"/g, '""')}"\n`;
      });
    }
  });

  // Trigger download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = condoName.replace(/[^a-zA-Z0-9_-]/g, '_');
  a.href = url;
  a.download = `resumo_adequacoes_spda_${safeName}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

