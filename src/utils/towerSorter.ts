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
export function consolidateReportPhotos(report: SpdaReport): SpdaReport {
  // 1. Mapeia todos os dados de torres (as torres já em torresData + a torre ativa atual)
  const currentTower = report.torreAtual || 'Torre 1';
  const allTowersMap: Record<string, TowerData> = {};

  if (report.torresData) {
    Object.entries(report.torresData).forEach(([tNome, data]) => {
      allTowersMap[tNome] = {
        id: data.id || tNome.toLowerCase().replace(/\s+/g, '-'),
        nome: tNome,
        spdaPhotos: [...(data.spdaPhotos || [])],
        measurementPhotos: [...(data.measurementPhotos || [])],
        quadrosPhotos: [...(data.quadrosPhotos || [])],
        localPhotos: [...(data.localPhotos || [])],
        equipmentPhotoUrl: data.equipmentPhotoUrl || report.equipmentPhotoUrl,
        conditions: data.conditions ? { ...data.conditions } : { ...report.conditions },
      };
    });
  }

  // Atualiza com a torre atualmente em edição ativa
  allTowersMap[currentTower] = {
    id: currentTower.toLowerCase().replace(/\s+/g, '-'),
    nome: currentTower,
    spdaPhotos: [...report.spdaPhotos],
    measurementPhotos: [...report.measurementPhotos],
    quadrosPhotos: [...report.quadrosPhotos],
    localPhotos: [...report.localPhotos],
    equipmentPhotoUrl: report.equipmentPhotoUrl,
    conditions: { ...report.conditions },
  };

  // Se não houver torres no mapa, usa a torre padrão
  if (Object.keys(allTowersMap).length === 0) {
    allTowersMap['Torre 1'] = {
      id: 'torre-1',
      nome: 'Torre 1',
      spdaPhotos: [...report.spdaPhotos],
      measurementPhotos: [...report.measurementPhotos],
      quadrosPhotos: [...report.quadrosPhotos],
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
  const consolidatedLocalPhotos: PhotoSlot[] = [];

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

    // As fotos de SPDA, Medições e Quadros são organizadas por torre
    // com identificação garantida da torre em cada foto
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
  return {
    ...report,
    spdaPhotos: consolidatedSpdaPhotos.length > 0 ? consolidatedSpdaPhotos : report.spdaPhotos,
    measurementPhotos: consolidatedMeasurementPhotos.length > 0 ? consolidatedMeasurementPhotos : report.measurementPhotos,
    quadrosPhotos: consolidatedQuadrosPhotos.length > 0 ? consolidatedQuadrosPhotos : report.quadrosPhotos,
    localPhotos: propertyLocalPhotos,
    equipmentPhotoUrl: propertyEquipmentUrl,
    torresData: allTowersMap,
  };
}
