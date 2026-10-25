import JSZip from 'jszip';
import { PhotoSlot, SpdaReport, TowerData } from '../types/spda';
import { optimizeImageFile } from './imageOptimizer';

export interface PhotoLocationInfo {
  condoName?: string;
  towerName?: string;
  section: 'spda' | 'medicao' | 'quadros' | 'local';
  photoIndex: number;
  caption?: string;
}

export interface RestoredTowerData {
  spdaPhotos: PhotoSlot[];
  measurementPhotos: PhotoSlot[];
  quadrosPhotos: PhotoSlot[];
  localPhotos: PhotoSlot[];
}

export interface ParsedRestoreResult {
  condoName?: string;
  torres: Record<string, RestoredTowerData>;
  totalPhotosCount: number;
}

// Chave para armazenar no IndexedDB a referência da pasta local conectada
const DIRECTORY_HANDLE_KEY = 'spda_device_folder_handle';
export const LS_FOLDER_NAME_KEY = 'spda_device_folder_name';
const DB_NAME = 'SPDA_DEVICE_STORAGE';
const DB_STORE = 'handles';

/**
 * Normaliza o nome do condomínio para uso seguro em pastas do celular / computador.
 * Mantém o nome completo do condomínio, removendo apenas caracteres inválidos em sistemas de arquivos (\ / : * ? " < > |).
 */
export function sanitizeFolderName(name?: string, fallback = 'Condominio'): string {
  if (!name || !name.trim()) return fallback;
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

/**
 * Retorna o nome exato da subpasta para a seção conforme especificado pelo usuário:
 * spda existente, quadros e pontos de inspeção
 */
export function getSectionSubfolderName(section: 'spda' | 'medicao' | 'quadros' | 'local'): string {
  switch (section) {
    case 'spda':
      return 'spda existente';
    case 'medicao':
      return 'pontos de inspeção';
    case 'quadros':
      return 'quadros';
    case 'local':
      return 'Fachada e Vista Aérea';
  }
}

/**
 * Converte Data URL (base64) para Blob binário JPEG
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  try {
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (err) {
    console.error('Erro ao converter dataUrl para Blob:', err);
    return new Blob([], { type: 'image/jpeg' });
  }
}

/**
 * Converte Data URL para Blob de forma nativa e assíncrona com fetch (10x mais rápido que atob em JS)
 */
export async function dataUrlToBlobAsync(dataUrl: string): Promise<Blob> {
  try {
    if (dataUrl.startsWith('data:')) {
      const res = await fetch(dataUrl);
      return await res.blob();
    }
    return dataUrlToBlob(dataUrl);
  } catch {
    return dataUrlToBlob(dataUrl);
  }
}

/**
 * Abre o banco IndexedDB para guardar o handle da pasta conectada no celular/computador
 */
function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Verifica se a aplicação está rodando dentro de um iframe (subframe cross-origin ou sandbox)
 */
export function isInsideIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Verifica se o dispositivo é mobile
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Verifica se o navegador suporta a API File System Access (showDirectoryPicker)
 * e garante que não está em um iframe/subframe cross-origin onde o navegador bloqueia
 */
export function hasDirectoryPickerSupport(): boolean {
  if (typeof window === 'undefined') return false;
  if (isInsideIframe()) return false;
  return typeof (window as any).showDirectoryPicker === 'function';
}

/**
 * Solicita ao usuário a seleção da pasta no computador/celular (preferencialmente Documentos)
 * e salva o handle no IndexedDB para gravação direta automática de todas as fotos
 */
export async function pickAndConnectDeviceFolder(): Promise<{ success: boolean; folderName?: string; error?: string }> {
  if (isInsideIframe()) {
    return {
      success: false,
      error: 'O navegador bloqueia seleção direta de pastas dentro do visualizador embutido (iframe). Abra o aplicativo em uma nova aba para permitir acesso direto à pasta Documentos.',
    };
  }

  if (typeof (window as any).showDirectoryPicker !== 'function') {
    return {
      success: false,
      error: 'Seu navegador não suporta a gravação direta de pastas no disco. Utilize a opção "BAIXAR PASTAS (ZIP / DOCUMENTOS)" para criar a estrutura exata no seu aparelho.',
    };
  }

  try {
    const handle = await (window as any).showDirectoryPicker({
      id: 'laudos_spda_documentos',
      mode: 'readwrite',
      startIn: 'documents',
    });

    // Salva o handle no IndexedDB
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(handle, DIRECTORY_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Salva o nome da pasta no localStorage para exibição imediata em qualquer reinício
    if (handle.name && typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_FOLDER_NAME_KEY, handle.name);
    }

    return { success: true, folderName: handle.name };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Seleção de pasta cancelada.' };
    }
    return {
      success: false,
      error: err?.message || 'Erro ao selecionar a pasta no disco.',
    };
  }
}

export interface StoredDeviceFolderInfo {
  hasStoredHandle: boolean;
  folderName: string | null;
  permissionStatus: 'granted' | 'prompt' | 'denied' | 'none';
  handle: any | null;
}

/**
 * Consulta as informações da pasta memorizada no dispositivo (IndexedDB e localStorage)
 * Não solicita permissão via prompt para ser 100% seguro de executar no carregamento de tela.
 */
export async function getStoredDeviceFolderInfo(): Promise<StoredDeviceFolderInfo> {
  const savedName = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_FOLDER_NAME_KEY) : null;
  if (!hasDirectoryPickerSupport()) {
    return {
      hasStoredHandle: false,
      folderName: savedName,
      permissionStatus: 'none',
      handle: null,
    };
  }

  try {
    const db = await openHandleDb();
    const handle = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DIRECTORY_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (!handle) {
      return {
        hasStoredHandle: false,
        folderName: savedName,
        permissionStatus: 'none',
        handle: null,
      };
    }

    const name = handle.name || savedName;
    if (name && typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_FOLDER_NAME_KEY, name);
    }

    let perm: 'granted' | 'prompt' | 'denied' = 'prompt';
    try {
      perm = await handle.queryPermission({ mode: 'readwrite' });
    } catch {
      perm = 'prompt';
    }

    return {
      hasStoredHandle: true,
      folderName: name,
      permissionStatus: perm,
      handle: perm === 'granted' ? handle : null,
    };
  } catch {
    return {
      hasStoredHandle: false,
      folderName: savedName,
      permissionStatus: 'none',
      handle: null,
    };
  }
}

/**
 * Reativa a conexão com a pasta salva anteriormente sem precisar abrir o explorador de arquivos
 * Chama handle.requestPermission diretamente sobre o handle já memorizado (requer clique do usuário)
 */
export async function reconnectStoredDeviceFolder(): Promise<{
  success: boolean;
  folderName?: string;
  handle?: any;
  error?: string;
}> {
  if (!hasDirectoryPickerSupport()) {
    return { success: false, error: 'File System API não suportada.' };
  }

  try {
    const db = await openHandleDb();
    const handle = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DIRECTORY_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (!handle) {
      // Se não tem handle no IndexedDB, abre a seleção
      return await pickAndConnectDeviceFolder();
    }

    // Solicita permissão diretamente no handle já salvo (1 clique sem reabrir árvore de pastas)
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await handle.requestPermission({ mode: 'readwrite' });
    }

    if (perm === 'granted') {
      if (handle.name && typeof localStorage !== 'undefined') {
        localStorage.setItem(LS_FOLDER_NAME_KEY, handle.name);
      }
      return { success: true, folderName: handle.name, handle };
    } else {
      return { success: false, error: 'Permissão para a pasta salva não foi concedida.' };
    }
  } catch {
    // Se falhar a permissão direta (ex: handle expirado), recorre à seleção
    return await pickAndConnectDeviceFolder();
  }
}

/**
 * Obtém o handle da pasta conectada se a permissão já estiver concedida (seguro para useEffect/background)
 */
export async function getConnectedDeviceFolderHandle(): Promise<any | null> {
  const info = await getStoredDeviceFolderInfo();
  return info.handle;
}

/**
 * Obtém o handle e solicita permissão ao usuário se necessário (deve ser chamado a partir de um clique/gesto)
 */
export async function getOrRequestConnectedDeviceFolderHandle(): Promise<any | null> {
  if (!hasDirectoryPickerSupport()) return null;
  const res = await reconnectStoredDeviceFolder();
  return res.success ? res.handle : null;
}

/**
 * Desconecta a pasta local e limpa tanto IndexedDB quanto localStorage
 */
export async function disconnectDeviceFolder(): Promise<void> {
  try {
    const db = await openHandleDb();
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(DIRECTORY_HANDLE_KEY);
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LS_FOLDER_NAME_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Localiza de maneira resiliente um subdiretório existente por nome (insensível a maiúsculas, espaços e acentos)
 */
export async function findExistingDirectory(parentHandle: any, targetName: string): Promise<any | null> {
  if (!parentHandle || !targetName) return null;

  // 1. Tenta acesso direto com o nome exato
  try {
    const direct = await parentHandle.getDirectoryHandle(targetName, { create: false });
    if (direct) return direct;
  } catch {
    // continua para busca tolerante
  }

  // 2. Busca tolerante iterando diretórios existentes
  try {
    const targetNorm = targetName.trim().toLowerCase().normalize('NFC');
    const targetNoCondo = targetNorm.replace(/^condom[íi]nio\s+/i, '').trim();

    if (typeof parentHandle.values === 'function') {
      for await (const entry of parentHandle.values()) {
        if (entry.kind === 'directory') {
          const entryNorm = entry.name.trim().toLowerCase().normalize('NFC');
          const entryNoCondo = entryNorm.replace(/^condom[íi]nio\s+/i, '').trim();

          if (
            entryNorm === targetNorm ||
            entryNoCondo === targetNoCondo ||
            entryNorm === targetNoCondo ||
            entryNoCondo === targetNorm
          ) {
            return entry;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Erro ao iterar diretórios no disco:', err);
  }

  return null;
}

/**
 * Localiza ou cria a pasta "LAUDOS SPDA"
 */
export async function findOrCreateLaudosSpdaDirectory(rootHandle: any, create = false): Promise<any | null> {
  if (!rootHandle) return null;
  if (rootHandle.name.trim().toUpperCase() === 'LAUDOS SPDA') {
    return rootHandle;
  }

  const existing = await findExistingDirectory(rootHandle, 'LAUDOS SPDA');
  if (existing) return existing;

  if (create) {
    return await rootHandle.getDirectoryHandle('LAUDOS SPDA', { create: true });
  }

  return null;
}

/**
 * Localiza ou cria a pasta do condomínio dentro de LAUDOS SPDA
 */
export async function findOrCreateCondoDirectory(
  laudosSpdaBase: any,
  condoName: string,
  create = false
): Promise<any | null> {
  if (!laudosSpdaBase || !condoName) return null;
  const safeName = sanitizeFolderName(condoName);
  const existing = await findExistingDirectory(laudosSpdaBase, safeName);
  if (existing) return existing;

  if (create) {
    return await laudosSpdaBase.getDirectoryHandle(safeName, { create: true });
  }

  return null;
}

/**
 * Localiza ou cria a pasta da torre
 */
export async function findOrCreateTowerDirectory(
  condoHandle: any,
  towerName: string,
  create = false
): Promise<any | null> {
  if (!condoHandle || !towerName) return null;
  const safeTower = sanitizeFolderName(towerName, 'Torre 1');
  const existing = await findExistingDirectory(condoHandle, safeTower);
  if (existing) return existing;

  if (create) {
    return await condoHandle.getDirectoryHandle(safeTower, { create: true });
  }

  return null;
}

/**
 * Localiza ou cria a subpasta de seção (spda existente, quadros, pontos de inspeção, Fachada e Vista Aérea)
 */
export async function findOrCreateSectionDirectory(
  towerHandle: any,
  sectionFolderName: string,
  create = false
): Promise<any | null> {
  if (!towerHandle || !sectionFolderName) return null;
  const existing = await findExistingDirectory(towerHandle, sectionFolderName);
  if (existing) return existing;

  if (create) {
    return await towerHandle.getDirectoryHandle(sectionFolderName, { create: true });
  }

  return null;
}

/**
 * Consolida todas as torres cadastradas no laudo (torres cadastradas, torresData e torre atual)
 */
export function getConsolidatedTowersMap(report: SpdaReport): Record<string, RestoredTowerData> {
  const currentTower = report.torreAtual || 'Torre 1';
  const allTowersMap: Record<string, RestoredTowerData> = {};

  // 0. Área Comum é entidade comum a todos os laudos e tratada como torre
  const areaComumData = report.torresData?.['Área Comum'];
  const isAreaComumCurrent = currentTower === 'Área Comum';
  allTowersMap['Área Comum'] = {
    spdaPhotos: isAreaComumCurrent ? report.spdaPhotos || [] : areaComumData?.spdaPhotos || [],
    measurementPhotos: isAreaComumCurrent ? report.measurementPhotos || [] : areaComumData?.measurementPhotos || [],
    quadrosPhotos: isAreaComumCurrent ? report.quadrosPhotos || [] : areaComumData?.quadrosPhotos || [],
    localPhotos: isAreaComumCurrent ? report.localPhotos || [] : areaComumData?.localPhotos || [],
  };

  // 1. Inclui todas as torres cadastradas no condomínio
  if (report.client?.torresNomes && Array.isArray(report.client.torresNomes) && report.client.torresNomes.length > 0) {
    report.client.torresNomes.forEach((tNome) => {
      if (tNome && tNome.trim()) {
        allTowersMap[tNome.trim()] = {
          spdaPhotos: [],
          measurementPhotos: [],
          quadrosPhotos: [],
          localPhotos: [],
        };
      }
    });
  } else if (report.client?.quantidadeTorres && report.client.quantidadeTorres > 1) {
    for (let i = 1; i <= report.client.quantidadeTorres; i++) {
      allTowersMap[`Torre ${i}`] = {
        spdaPhotos: [],
        measurementPhotos: [],
        quadrosPhotos: [],
        localPhotos: [],
      };
    }
  }

  // 2. Inclui torres que possuem dados em torresData
  if (report.torresData) {
    Object.entries(report.torresData).forEach(([tNome, data]) => {
      allTowersMap[tNome] = {
        spdaPhotos: data.spdaPhotos || [],
        measurementPhotos: data.measurementPhotos || [],
        quadrosPhotos: data.quadrosPhotos || [],
        localPhotos: data.localPhotos || [],
      };
    });
  }

  // 3. Torre atual em edição na tela
  allTowersMap[currentTower] = {
    spdaPhotos: report.spdaPhotos || [],
    measurementPhotos: report.measurementPhotos || [],
    quadrosPhotos: report.quadrosPhotos || [],
    localPhotos: report.localPhotos || [],
  };

  if (Object.keys(allTowersMap).length === 0) {
    allTowersMap['Torre 1'] = {
      spdaPhotos: report.spdaPhotos || [],
      measurementPhotos: report.measurementPhotos || [],
      quadrosPhotos: report.quadrosPhotos || [],
      localPhotos: report.localPhotos || [],
    };
  }

  return allTowersMap;
}

/**
 * Retorna o nome padrão do arquivo de foto no disco
 */
export function getPhotoDiskFileName(
  section: 'spda' | 'medicao' | 'quadros' | 'local',
  index: number,
  photo: PhotoSlot
): string {
  const pad = String(index + 1).padStart(2, '0');
  const cap = photo.caption ? `_${photo.caption.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}` : '';
  if (section === 'medicao') {
    const val = photo.measurementValue ? `_${photo.measurementValue.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
    return `foto_${pad}${val}${cap}.jpg`;
  }
  return `foto_${pad}${cap}.jpg`;
}

/**
 * Leitura ultra-rápida de todos os arquivos existentes dentro de uma pasta (File System Access API)
 * Utiliza dirHandle.keys() ou iteradores assíncronos e normaliza nomes (NFC, NFD e minúsculas)
 * Retorna um Set com os nomes dos arquivos já criados em poucos milissegundos.
 */
export async function getExistingFileNamesInDirectory(dirHandle: any): Promise<Set<string>> {
  const set = new Set<string>();
  if (!dirHandle) return set;
  try {
    if (typeof dirHandle.keys === 'function') {
      for await (const name of dirHandle.keys()) {
        set.add(name);
        set.add(name.toLowerCase());
        set.add(name.normalize('NFC'));
        set.add(name.normalize('NFD'));
      }
    } else if (typeof dirHandle.values === 'function') {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          set.add(entry.name);
          set.add(entry.name.toLowerCase());
          set.add(entry.name.normalize('NFC'));
          set.add(entry.name.normalize('NFD'));
        }
      }
    } else if (typeof dirHandle.entries === 'function') {
      for await (const [name] of dirHandle.entries()) {
        set.add(name);
        set.add(name.toLowerCase());
        set.add(name.normalize('NFC'));
        set.add(name.normalize('NFD'));
      }
    }
  } catch (err) {
    console.warn('Leitura de diretório:', err);
  }
  return set;
}

export interface FileSyncMeta {
  fileName: string;
  photoId: string;
  section: string;
  tower: string;
  urlLength: number;
  syncedAt: string;
  syncedTimestamp?: number;
}

export interface SyncJournal {
  condoKey: string;
  lastSyncedAt: string;
  lastSyncedTimestamp?: number;
  lastSyncedFormatted: string;
  files: Record<string, FileSyncMeta>;
}

export function getSyncJournalStorageKey(condoName?: string): string {
  const clean = sanitizeFolderName(condoName);
  return `spda_sync_journal_${clean}`;
}

export function loadSyncJournal(condoName?: string): SyncJournal {
  const key = getSyncJournalStorageKey(condoName);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return {
    condoKey: sanitizeFolderName(condoName),
    lastSyncedAt: '',
    lastSyncedFormatted: '',
    files: {},
  };
}

export function saveSyncJournal(journal: SyncJournal): void {
  const key = getSyncJournalStorageKey(journal.condoKey);
  try {
    localStorage.setItem(key, JSON.stringify(journal));
  } catch (err) {
    console.warn('Erro ao salvar journal de sincronização:', err);
  }
}

export function getLastSyncTimeFormatted(condoName?: string): string | null {
  const journal = loadSyncJournal(condoName);
  return journal.lastSyncedFormatted || null;
}

export interface SyncInspectionResult {
  connected: boolean;
  hasStoredHandle?: boolean;
  permissionStatus?: 'granted' | 'prompt' | 'denied' | 'none';
  connectedFolderName?: string;
  condoName: string;
  totalReportPhotos: number;
  alreadySyncedCount: number;
  missingCount: number;
  lastSyncedFormatted?: string;
  missingSummary: string[];
}

/**
 * Localiza o arquivo da foto no diretório se ele já existe (mesmo com outro sufixo de legenda ou foto_XX.jpg)
 */
function findExistingPhotoFileName(
  padIndex: string,
  preferredFileName: string,
  diskFileName: string | undefined,
  existingFiles: Set<string>
): string | null {
  // 1. Nome preferencial com legenda
  if (existingFiles.has(preferredFileName)) return preferredFileName;
  if (existingFiles.has(preferredFileName.toLowerCase())) return preferredFileName.toLowerCase();

  // 2. Nome gravado diretamente no slot (ex: foto_01.jpg)
  if (diskFileName) {
    if (existingFiles.has(diskFileName)) return diskFileName;
    if (existingFiles.has(diskFileName.toLowerCase())) return diskFileName.toLowerCase();
  }

  // 3. Nome base padrão foto_XX.jpg
  const baseName = `foto_${padIndex}.jpg`;
  if (existingFiles.has(baseName)) return baseName;
  if (existingFiles.has(baseName.toLowerCase())) return baseName.toLowerCase();

  // 4. Qualquer arquivo na pasta que inicie pelo prefixo foto_XX
  const prefix = `foto_${padIndex}`.toLowerCase();
  for (const f of existingFiles) {
    const fLower = f.toLowerCase();
    if (fLower.startsWith(prefix) && (fLower.endsWith('.jpg') || fLower.endsWith('.jpeg') || fLower.endsWith('.png'))) {
      return f;
    }
  }

  return null;
}

/**
 * Verifica com precisão se uma foto já foi sincronizada no disco
 */
function isPhotoAlreadySyncedOnDisk(
  photo: PhotoSlot,
  padIndex: string,
  preferredFileName: string,
  existingFiles: Set<string>,
  journalMeta?: FileSyncMeta,
  lastSyncTimestamp?: number
): boolean {
  // 1. Se tem syncedAt registrado e não foi alterada depois, já está sincronizada
  if (photo.syncedAt && (!photo.updatedAt || photo.updatedAt <= photo.syncedAt)) {
    return true;
  }

  // 2. Se está registrada no diário de sincronização
  if (journalMeta) {
    const jTime = journalMeta.syncedTimestamp || (journalMeta.syncedAt ? new Date(journalMeta.syncedAt).getTime() : 0);
    if (!photo.updatedAt || photo.updatedAt <= jTime) {
      if (!photo.syncedAt) photo.syncedAt = jTime || Date.now();
      if (!photo.diskFileName && journalMeta.fileName) photo.diskFileName = journalMeta.fileName;
      return true;
    }
  }

  // 3. Se o arquivo existe no disco
  const existingOnDiskName = findExistingPhotoFileName(
    padIndex,
    preferredFileName,
    photo.diskFileName,
    existingFiles
  );

  if (existingOnDiskName) {
    if (!photo.diskFileName) photo.diskFileName = existingOnDiskName;
    if (!photo.syncedAt) photo.syncedAt = lastSyncTimestamp || Date.now();
    if (!photo.updatedAt || (lastSyncTimestamp && photo.updatedAt <= lastSyncTimestamp)) {
      return true;
    }
  }

  // 4. Se a foto foi adicionada no app antes ou durante o último salvamento registrado (ex: 10h50)
  if (lastSyncTimestamp && photo.addedAt && photo.addedAt <= lastSyncTimestamp) {
    if (!photo.updatedAt || photo.updatedAt <= lastSyncTimestamp) {
      if (!photo.syncedAt) photo.syncedAt = lastSyncTimestamp;
      return true;
    }
  }

  // 5. Se o arquivo já existe no disco e não houve atualização recente
  if (existingOnDiskName && !photo.updatedAt) {
    return true;
  }

  return false;
}

/**
 * LEITURA DINÂMICA ULTRA-RÁPIDA DO STATUS DE ARQUIVOS NO DISCO
 * Verifica em paralelo quantos arquivos já foram criados no disco e quantos ainda faltam ser sincronizados.
 */
export async function inspectReportSyncStatus(report: SpdaReport): Promise<SyncInspectionResult> {
  const condoName = sanitizeFolderName(report.client?.name);
  const allTowersMap = getConsolidatedTowersMap(report);

  let totalReportPhotos = 0;
  Object.values(allTowersMap).forEach((t) => {
    totalReportPhotos +=
      t.spdaPhotos.length +
      t.measurementPhotos.length +
      t.quadrosPhotos.length +
      t.localPhotos.length;
  });

  const journal = loadSyncJournal(report.client?.name);
  const lastSyncTimeFormatted = report.lastSyncedFormatted || journal.lastSyncedFormatted || undefined;
  const lastSyncTimestamp =
    report.lastSyncedAt ||
    journal.lastSyncedTimestamp ||
    (journal.lastSyncedAt ? new Date(journal.lastSyncedAt).getTime() : undefined);

  const storedFolderInfo = await getStoredDeviceFolderInfo();
  const rootHandle = storedFolderInfo.handle;

  // Quando o handle direto ainda não está com permissão 'granted' (estado padrão do Chrome ao recarregar a tela),
  // consultamos photo.syncedAt, journal.files e lastSyncTimestamp para reconhecer instantaneamente as fotos JÁ SALVAS!
  if (!rootHandle) {
    let alreadySyncedCount = 0;
    let missingCount = 0;
    const missingSummary: string[] = [];

    const journalFileIds = new Set<string>();
    const journalFileNames = new Set<string>();
    if (journal.files) {
      Object.values(journal.files).forEach((meta) => {
        if (meta.photoId) journalFileIds.add(meta.photoId);
        if (meta.fileName) journalFileNames.add(meta.fileName.toLowerCase());
      });
    }

    Object.entries(allTowersMap).forEach(([towerName, towerData]) => {
      const checkPhotosList = (photos: PhotoSlot[], secName: string) => {
        let secMissing = 0;
        photos.forEach((photo, idx) => {
          if (!photo.url) return;
          const padIndex = String(idx + 1).padStart(2, '0');
          const defaultName = `foto_${padIndex}.jpg`;
          const isSynced =
            Boolean(photo.syncedAt && (!photo.updatedAt || photo.updatedAt <= photo.syncedAt)) ||
            (photo.id && journalFileIds.has(photo.id)) ||
            (photo.diskFileName && journalFileNames.has(photo.diskFileName.toLowerCase())) ||
            journalFileNames.has(defaultName.toLowerCase()) ||
            Boolean(lastSyncTimestamp && photo.addedAt && photo.addedAt <= lastSyncTimestamp);

          if (isSynced) {
            alreadySyncedCount++;
            if (!photo.syncedAt) {
              photo.syncedAt = lastSyncTimestamp || Date.now();
            }
          } else {
            missingCount++;
            secMissing++;
          }
        });
        if (secMissing > 0) {
          missingSummary.push(`${towerName} > ${secName} (${secMissing} nova(s))`);
        }
      };

      checkPhotosList(towerData.spdaPhotos, 'spda existente');
      checkPhotosList(towerData.measurementPhotos, 'pontos de inspeção');
      checkPhotosList(towerData.quadrosPhotos, 'quadros');
      checkPhotosList(towerData.localPhotos, 'Fachada e Vista Aérea');
    });

    return {
      connected: false,
      hasStoredHandle: storedFolderInfo.hasStoredHandle,
      permissionStatus: storedFolderInfo.permissionStatus,
      connectedFolderName: storedFolderInfo.folderName || undefined,
      condoName,
      totalReportPhotos,
      alreadySyncedCount,
      missingCount,
      lastSyncedFormatted: lastSyncTimeFormatted,
      missingSummary,
    };
  }

  try {
    const laudosSpdaBase = await findOrCreateLaudosSpdaDirectory(rootHandle, false);

    if (!laudosSpdaBase) {
      // Se a pasta base não foi criada ainda no disco físico
      let alreadySyncedCount = 0;
      let missingCount = 0;
      Object.values(allTowersMap).forEach((t) => {
        [...t.spdaPhotos, ...t.measurementPhotos, ...t.quadrosPhotos, ...t.localPhotos].forEach((p) => {
          if (!p.url) return;
          if (p.syncedAt) alreadySyncedCount++;
          else missingCount++;
        });
      });

      return {
        connected: true,
        hasStoredHandle: true,
        permissionStatus: 'granted',
        connectedFolderName: rootHandle.name,
        condoName,
        totalReportPhotos,
        alreadySyncedCount,
        missingCount,
        lastSyncedFormatted: lastSyncTimeFormatted,
        missingSummary: missingCount > 0 ? [`${missingCount} fotos aguardando gravação na pasta LAUDOS SPDA`] : [],
      };
    }

    const condoHandle = await findOrCreateCondoDirectory(laudosSpdaBase, condoName, false);
    if (!condoHandle) {
      let alreadySyncedCount = 0;
      let missingCount = 0;
      Object.values(allTowersMap).forEach((t) => {
        [...t.spdaPhotos, ...t.measurementPhotos, ...t.quadrosPhotos, ...t.localPhotos].forEach((p) => {
          if (!p.url) return;
          if (p.syncedAt) alreadySyncedCount++;
          else missingCount++;
        });
      });

      return {
        connected: true,
        hasStoredHandle: true,
        permissionStatus: 'granted',
        connectedFolderName: rootHandle.name,
        condoName,
        totalReportPhotos,
        alreadySyncedCount,
        missingCount,
        lastSyncedFormatted: lastSyncTimeFormatted,
        missingSummary: missingCount > 0 ? [`${missingCount} fotos para salvar na pasta do condomínio "${condoName}"`] : [],
      };
    }

    let alreadySyncedCount = 0;
    let missingCount = 0;
    const missingSummary: string[] = [];

    const towerEntries = Object.entries(allTowersMap);

    // Executa leitura concorrente em paralelo de todas as torres
    await Promise.all(
      towerEntries.map(async ([towerName, towerData]) => {
        const safeTower = sanitizeFolderName(towerName, 'Torre 1');
        const towerHandle = await findOrCreateTowerDirectory(condoHandle, safeTower, false);

        let spdaExisting = new Set<string>();
        let quadrosExisting = new Set<string>();
        let medicaoExisting = new Set<string>();
        let localExisting = new Set<string>();

        if (towerHandle) {
          const [spdaH, quadrosH, medicaoH, localH] = await Promise.all([
            findOrCreateSectionDirectory(towerHandle, 'spda existente', false),
            findOrCreateSectionDirectory(towerHandle, 'quadros', false),
            findOrCreateSectionDirectory(towerHandle, 'pontos de inspeção', false),
            towerData.localPhotos.length > 0
              ? findOrCreateSectionDirectory(towerHandle, 'Fachada e Vista Aérea', false)
              : Promise.resolve(null),
          ]);

          const [spdaSet, quadrosSet, medicaoSet, localSet] = await Promise.all([
            getExistingFileNamesInDirectory(spdaH),
            getExistingFileNamesInDirectory(quadrosH),
            getExistingFileNamesInDirectory(medicaoH),
            getExistingFileNamesInDirectory(localH),
          ]);

          spdaExisting = spdaSet;
          quadrosExisting = quadrosSet;
          medicaoExisting = medicaoSet;
          localExisting = localSet;
        }

        // 1. Checa SPDA
        let spdaMissingTower = 0;
        towerData.spdaPhotos.forEach((photo, idx) => {
          if (!photo.url) return;
          const padIndex = String(idx + 1).padStart(2, '0');
          const fileName = photo.diskFileName || getPhotoDiskFileName('spda', idx, photo);
          const journalKey = `${safeTower}/spda existente/${fileName}`;
          if (isPhotoAlreadySyncedOnDisk(photo, padIndex, fileName, spdaExisting, journal.files[journalKey], lastSyncTimestamp)) {
            alreadySyncedCount++;
            if (!photo.syncedAt) photo.syncedAt = lastSyncTimestamp || Date.now();
            if (!photo.diskFileName) photo.diskFileName = fileName;
          } else {
            missingCount++;
            spdaMissingTower++;
          }
        });
        if (spdaMissingTower > 0) {
          missingSummary.push(`${towerName} > spda existente (${spdaMissingTower} nova(s))`);
        }

        // 2. Checa Pontos de Inspeção
        let medicaoMissingTower = 0;
        towerData.measurementPhotos.forEach((photo, idx) => {
          if (!photo.url) return;
          const padIndex = String(idx + 1).padStart(2, '0');
          const fileName = photo.diskFileName || getPhotoDiskFileName('medicao', idx, photo);
          const journalKey = `${safeTower}/pontos de inspeção/${fileName}`;
          if (isPhotoAlreadySyncedOnDisk(photo, padIndex, fileName, medicaoExisting, journal.files[journalKey], lastSyncTimestamp)) {
            alreadySyncedCount++;
            if (!photo.syncedAt) photo.syncedAt = lastSyncTimestamp || Date.now();
            if (!photo.diskFileName) photo.diskFileName = fileName;
          } else {
            missingCount++;
            medicaoMissingTower++;
          }
        });
        if (medicaoMissingTower > 0) {
          missingSummary.push(`${towerName} > pontos de inspeção (${medicaoMissingTower} nova(s))`);
        }

        // 3. Checa Quadros
        let quadrosMissingTower = 0;
        towerData.quadrosPhotos.forEach((photo, idx) => {
          if (!photo.url) return;
          const padIndex = String(idx + 1).padStart(2, '0');
          const fileName = photo.diskFileName || getPhotoDiskFileName('quadros', idx, photo);
          const journalKey = `${safeTower}/quadros/${fileName}`;
          if (isPhotoAlreadySyncedOnDisk(photo, padIndex, fileName, quadrosExisting, journal.files[journalKey], lastSyncTimestamp)) {
            alreadySyncedCount++;
            if (!photo.syncedAt) photo.syncedAt = lastSyncTimestamp || Date.now();
            if (!photo.diskFileName) photo.diskFileName = fileName;
          } else {
            missingCount++;
            quadrosMissingTower++;
          }
        });
        if (quadrosMissingTower > 0) {
          missingSummary.push(`${towerName} > quadros (${quadrosMissingTower} nova(s))`);
        }

        // 4. Checa Fachada e Vista Aérea
        let localMissingTower = 0;
        towerData.localPhotos.forEach((photo, idx) => {
          if (!photo.url) return;
          const padIndex = String(idx + 1).padStart(2, '0');
          const fileName = photo.diskFileName || getPhotoDiskFileName('local', idx, photo);
          const journalKey = `${safeTower}/Fachada e Vista Aérea/${fileName}`;
          if (isPhotoAlreadySyncedOnDisk(photo, padIndex, fileName, localExisting, journal.files[journalKey], lastSyncTimestamp)) {
            alreadySyncedCount++;
            if (!photo.syncedAt) photo.syncedAt = lastSyncTimestamp || Date.now();
            if (!photo.diskFileName) photo.diskFileName = fileName;
          } else {
            missingCount++;
            localMissingTower++;
          }
        });
        if (localMissingTower > 0) {
          missingSummary.push(`${towerName} > Fachada e Vista Aérea (${localMissingTower} nova(s))`);
        }
      })
    );

    return {
      connected: true,
      hasStoredHandle: true,
      permissionStatus: 'granted',
      connectedFolderName: rootHandle.name,
      condoName,
      totalReportPhotos,
      alreadySyncedCount,
      missingCount,
      lastSyncedFormatted: lastSyncTimeFormatted,
      missingSummary,
    };
  } catch (err: any) {
    console.warn('Erro ao inspecionar status de sincronização:', err);
    let alreadySyncedCount = 0;
    let missingCount = 0;
    Object.values(allTowersMap).forEach((t) => {
      [...t.spdaPhotos, ...t.measurementPhotos, ...t.quadrosPhotos, ...t.localPhotos].forEach((p) => {
        if (!p.url) return;
        if (p.syncedAt) alreadySyncedCount++;
        else missingCount++;
      });
    });

    return {
      connected: true,
      connectedFolderName: rootHandle.name,
      condoName,
      totalReportPhotos,
      alreadySyncedCount,
      missingCount,
      lastSyncedFormatted: lastSyncTimeFormatted,
      missingSummary: [],
    };
  }
}

export interface EnsureFoldersOptions {
  forceFull?: boolean;
  onProgress?: (percent: number, message: string) => void;
}

export interface RealFolderSyncResult {
  success: boolean;
  folderPath: string;
  syncedPhotos: number;
  totalOnDisk: number;
  newlySyncedPhotos: number;
  alreadyExistingPhotos: number;
  lastSyncedFormatted: string;
  updatedReport?: SpdaReport;
  error?: string;
}

/**
 * SINCRONIZAÇÃO INTELIGENTE E INCREMENTAL (File System Access API):
 * 1. Faz a leitura rápida em milissegundos dos arquivos que JÁ foram criados no disco.
 * 2. Grava APENAS os arquivos novos e faltantes adicionados desde o salvamento anterior (ex: após 10h50)!
 * 3. Nunca regrava arquivos já existentes no disco, garantindo velocidade instantânea e sem atrasos.
 */
export async function ensureRealDocumentFoldersCreated(
  report: SpdaReport,
  optionsOrProgress?: EnsureFoldersOptions | ((percent: number, message: string) => void)
): Promise<RealFolderSyncResult> {
  const options: EnsureFoldersOptions =
    typeof optionsOrProgress === 'function' ? { onProgress: optionsOrProgress } : (optionsOrProgress || {});
  const onProgress = options.onProgress;
  const forceFull = options.forceFull === true;

  // Tenta obter o handle conectado
  let rootHandle = await getOrRequestConnectedDeviceFolderHandle();
  if (!rootHandle) {
    rootHandle = await getConnectedDeviceFolderHandle();
  }

  if (!rootHandle) {
    return {
      success: false,
      folderPath: '',
      syncedPhotos: 0,
      totalOnDisk: 0,
      newlySyncedPhotos: 0,
      alreadyExistingPhotos: 0,
      lastSyncedFormatted: '',
      error: 'Pasta de Documentos não conectada ainda. Conecte a pasta para criar as pastas físicas no disco.',
    };
  }

  try {
    onProgress?.(10, 'Acessando pasta no disco e verificando arquivos anteriores...');

    // Localiza ou cria a pasta "LAUDOS SPDA"
    const laudosSpdaBase = await findOrCreateLaudosSpdaDirectory(rootHandle, true);
    if (!laudosSpdaBase) {
      throw new Error('Não foi possível acessar ou criar a pasta LAUDOS SPDA no disco.');
    }

    const condoName = sanitizeFolderName(report.client?.name);
    const condoHandle = await findOrCreateCondoDirectory(laudosSpdaBase, condoName, true);
    if (!condoHandle) {
      throw new Error(`Não foi possível acessar ou criar a pasta do condomínio "${condoName}".`);
    }

    const journal = loadSyncJournal(report.client?.name);
    const allTowersMap = getConsolidatedTowersMap(report);

    const lastSyncTimestamp =
      report.lastSyncedAt ||
      journal.lastSyncedTimestamp ||
      (journal.lastSyncedAt ? new Date(journal.lastSyncedAt).getTime() : undefined);

    // Estruturas de planejamento da sincronização
    interface PendingWriteItem {
      dirHandle: any;
      fileName: string;
      photo: PhotoSlot;
      towerName: string;
      sectionName: string;
      journalKey: string;
    }

    const pendingItems: PendingWriteItem[] = [];
    let alreadyExistingCount = 0;

    onProgress?.(25, 'Leitura dinâmica e verificação dos arquivos já criados no disco...');

    const towerEntries = Object.entries(allTowersMap);

    // 1. FASE DE LEITURA RÁPIDA: Identifica em paralelo o que já existe vs o que falta
    for (let i = 0; i < towerEntries.length; i++) {
      const [towerName, towerData] = towerEntries[i];
      const safeTower = sanitizeFolderName(towerName, 'Torre 1');

      const towerHandle = await findOrCreateTowerDirectory(condoHandle, safeTower, true);
      const [spdaHandle, quadrosHandle, medicaoHandle, localHandle] = await Promise.all([
        findOrCreateSectionDirectory(towerHandle, 'spda existente', true),
        findOrCreateSectionDirectory(towerHandle, 'quadros', true),
        findOrCreateSectionDirectory(towerHandle, 'pontos de inspeção', true),
        towerData.localPhotos.length > 0
          ? findOrCreateSectionDirectory(towerHandle, 'Fachada e Vista Aérea', true)
          : Promise.resolve(null),
      ]);

      // Leitura rápida dos arquivos existentes nas subpastas
      const [spdaExisting, quadrosExisting, medicaoExisting, localExisting] = await Promise.all([
        getExistingFileNamesInDirectory(spdaHandle),
        getExistingFileNamesInDirectory(quadrosHandle),
        getExistingFileNamesInDirectory(medicaoHandle),
        localHandle ? getExistingFileNamesInDirectory(localHandle) : Promise.resolve(new Set<string>()),
      ]);

      // Verifica SPDA
      towerData.spdaPhotos.forEach((photo, idx) => {
        if (!photo.url) return;
        const padIndex = String(idx + 1).padStart(2, '0');
        const fileName = photo.diskFileName || getPhotoDiskFileName('spda', idx, photo);
        const journalKey = `${safeTower}/spda existente/${fileName}`;
        const alreadySynced =
          !forceFull &&
          isPhotoAlreadySyncedOnDisk(photo, padIndex, fileName, spdaExisting, journal.files[journalKey], lastSyncTimestamp);

        if (alreadySynced) {
          alreadyExistingCount++;
          if (!journal.files[journalKey]) {
            journal.files[journalKey] = {
              fileName,
              photoId: photo.id,
              section: 'spda',
              tower: safeTower,
              urlLength: photo.url.length,
              syncedAt: journal.lastSyncedAt || new Date().toISOString(),
              syncedTimestamp: lastSyncTimestamp || Date.now(),
            };
          }
        } else {
          pendingItems.push({
            dirHandle: spdaHandle,
            fileName,
            photo,
            towerName,
            sectionName: 'spda existente',
            journalKey,
          });
        }
      });

      // Verifica Pontos de Inspeção
      towerData.measurementPhotos.forEach((photo, idx) => {
        if (!photo.url) return;
        const padIndex = String(idx + 1).padStart(2, '0');
        const fileName = photo.diskFileName || getPhotoDiskFileName('medicao', idx, photo);
        const journalKey = `${safeTower}/pontos de inspeção/${fileName}`;
        const alreadySynced =
          !forceFull &&
          isPhotoAlreadySyncedOnDisk(photo, padIndex, fileName, medicaoExisting, journal.files[journalKey], lastSyncTimestamp);

        if (alreadySynced) {
          alreadyExistingCount++;
          if (!journal.files[journalKey]) {
            journal.files[journalKey] = {
              fileName,
              photoId: photo.id,
              section: 'medicao',
              tower: safeTower,
              urlLength: photo.url.length,
              syncedAt: journal.lastSyncedAt || new Date().toISOString(),
              syncedTimestamp: lastSyncTimestamp || Date.now(),
            };
          }
        } else {
          pendingItems.push({
            dirHandle: medicaoHandle,
            fileName,
            photo,
            towerName,
            sectionName: 'pontos de inspeção',
            journalKey,
          });
        }
      });

      // Verifica Quadros
      towerData.quadrosPhotos.forEach((photo, idx) => {
        if (!photo.url) return;
        const padIndex = String(idx + 1).padStart(2, '0');
        const fileName = photo.diskFileName || getPhotoDiskFileName('quadros', idx, photo);
        const journalKey = `${safeTower}/quadros/${fileName}`;
        const alreadySynced =
          !forceFull &&
          isPhotoAlreadySyncedOnDisk(photo, padIndex, fileName, quadrosExisting, journal.files[journalKey], lastSyncTimestamp);

        if (alreadySynced) {
          alreadyExistingCount++;
          if (!journal.files[journalKey]) {
            journal.files[journalKey] = {
              fileName,
              photoId: photo.id,
              section: 'quadros',
              tower: safeTower,
              urlLength: photo.url.length,
              syncedAt: journal.lastSyncedAt || new Date().toISOString(),
              syncedTimestamp: lastSyncTimestamp || Date.now(),
            };
          }
        } else {
          pendingItems.push({
            dirHandle: quadrosHandle,
            fileName,
            photo,
            towerName,
            sectionName: 'quadros',
            journalKey,
          });
        }
      });

      // Verifica Fachada e Vista Aérea
      if (localHandle) {
        towerData.localPhotos.forEach((photo, idx) => {
          if (!photo.url) return;
          const padIndex = String(idx + 1).padStart(2, '0');
          const fileName = photo.diskFileName || getPhotoDiskFileName('local', idx, photo);
          const journalKey = `${safeTower}/Fachada e Vista Aérea/${fileName}`;
          const alreadySynced =
            !forceFull &&
            isPhotoAlreadySyncedOnDisk(photo, padIndex, fileName, localExisting, journal.files[journalKey], lastSyncTimestamp);

          if (alreadySynced) {
            alreadyExistingCount++;
            if (!journal.files[journalKey]) {
              journal.files[journalKey] = {
                fileName,
                photoId: photo.id,
                section: 'local',
                tower: safeTower,
                urlLength: photo.url.length,
                syncedAt: journal.lastSyncedAt || new Date().toISOString(),
                syncedTimestamp: lastSyncTimestamp || Date.now(),
              };
            }
          } else {
            pendingItems.push({
              dirHandle: localHandle,
              fileName,
              photo,
              towerName,
              sectionName: 'Fachada e Vista Aérea',
              journalKey,
            });
          }
        });
      }
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const timestampIso = now.toISOString();
    const timestampMs = now.getTime();

    let newlySyncedCount = 0;

    // 2. FASE DE GRAVAÇÃO: Grava APENAS os arquivos faltantes!
    if (pendingItems.length === 0) {
      onProgress?.(
        100,
        `✓ Leitura rápida concluída: Todos os ${alreadyExistingCount} arquivos já estão em dia no disco (nenhuma regravação necessária)!`
      );
    } else {
      onProgress?.(
        35,
        `Identificados ${alreadyExistingCount} arquivos já criados. Sincronizando apenas os ${pendingItems.length} arquivos faltantes...`
      );

      // Gravação concorrente rápida (lotes de 3 arquivos) para máxima performance
      const batchSize = 3;
      for (let i = 0; i < pendingItems.length; i += batchSize) {
        const batch = pendingItems.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (item, bIdx) => {
            const globalIdx = i + bIdx;
            const currentPct = 35 + Math.round(((globalIdx + 1) / pendingItems.length) * 55);
            onProgress?.(
              currentPct,
              `Gravando foto faltante ${globalIdx + 1} de ${pendingItems.length}: ${item.towerName} > ${item.fileName}...`
            );

            try {
              const fHandle = await item.dirHandle.getFileHandle(item.fileName, { create: true });
              const w = await fHandle.createWritable();
              const blob = await dataUrlToBlobAsync(item.photo.url);
              await w.write(blob);
              await w.close();

              newlySyncedCount++;
              item.photo.syncedAt = timestampMs;

              journal.files[item.journalKey] = {
                fileName: item.fileName,
                photoId: item.photo.id,
                section: item.sectionName,
                tower: item.towerName,
                urlLength: item.photo.url.length,
                syncedAt: timestampIso,
                syncedTimestamp: timestampMs,
              };
            } catch (writeErr) {
              console.error(`Erro ao gravar arquivo ${item.fileName}:`, writeErr);
            }
          })
        );
      }
    }

    // 3. Atualiza o diário com o horário atual desta sincronização
    journal.condoKey = condoName;
    journal.lastSyncedAt = timestampIso;
    journal.lastSyncedTimestamp = timestampMs;
    journal.lastSyncedFormatted = timeFormatted;
    saveSyncJournal(journal);

    const totalOnDisk = alreadyExistingCount + newlySyncedCount;

    onProgress?.(95, 'Atualizando índice do condomínio e informações do laudo no disco...');

    // 4. Grava / atualiza o arquivo de informações do laudo (txt)
    try {
      const infoFile = await condoHandle.getFileHandle('INFORMACOES_DO_LAUDO.txt', { create: true });
      const infoWriter = await infoFile.createWritable();
      const infoText = [
        `LAUDOS SPDA - NBR 5419:2026`,
        `Condomínio: ${report.client.name || 'Condomínio'}`,
        `Data da Vistoria: ${report.client.periodoAvaliacao || new Date().toLocaleDateString('pt-BR')}`,
        `Última Sincronização Incremental: ${timeFormatted} (${now.toLocaleDateString('pt-BR')})`,
        `Total de Fotos no Disco: ${totalOnDisk}`,
        `Novos Arquivos Gravados Nesta Sincronização: ${newlySyncedCount}`,
        `Arquivos Preexistentes Mantidos (sem recriação): ${alreadyExistingCount}`,
        `Torres Vistoriadas: ${Object.keys(allTowersMap).join(', ')}`,
        ``,
        `Estrutura Criada em Documentos:`,
        `LAUDOS SPDA/`,
        `  └── ${condoName}/`,
        `        ├── [Torre]/`,
        `        │     ├── spda existente/`,
        `        │     ├── quadros/`,
        `        │     └── pontos de inspeção/`,
        `        └── Fachada e Vista Aérea/`,
      ].join('\n');
      await infoWriter.write(new Blob([infoText], { type: 'text/plain' }));
      await infoWriter.close();
    } catch {
      // ignore
    }

    const finalMsg =
      newlySyncedCount > 0
        ? `✓ Sincronização concluída: ${newlySyncedCount} novo(s) arquivo(s) gravado(s)! Total no disco: ${totalOnDisk}.`
        : `✓ Tudo atualizado! Todos os ${totalOnDisk} arquivos já estão sincronizados no disco.`;

    onProgress?.(100, finalMsg);

    // Constrói o laudo com timestamps de sincronização atualizados
    const currentTower = report.torreAtual || 'Torre 1';
    const updatedTorresData = { ...(report.torresData || {}) };
    Object.entries(allTowersMap).forEach(([tNome, tData]) => {
      updatedTorresData[tNome] = {
        ...(updatedTorresData[tNome] || {
          id: tNome.toLowerCase().replace(/\s+/g, '-'),
          nome: tNome,
          spdaPhotos: [],
          measurementPhotos: [],
          quadrosPhotos: [],
          localPhotos: [],
        }),
        spdaPhotos: tData.spdaPhotos.map((p) => ({ ...p, syncedAt: p.syncedAt || timestampMs, diskFileName: p.diskFileName })),
        measurementPhotos: tData.measurementPhotos.map((p) => ({ ...p, syncedAt: p.syncedAt || timestampMs, diskFileName: p.diskFileName })),
        quadrosPhotos: tData.quadrosPhotos.map((p) => ({ ...p, syncedAt: p.syncedAt || timestampMs, diskFileName: p.diskFileName })),
        localPhotos: tData.localPhotos.map((p) => ({ ...p, syncedAt: p.syncedAt || timestampMs, diskFileName: p.diskFileName })),
      };
    });

    const currentTowerData = updatedTorresData[currentTower];
    const updatedReport: SpdaReport = {
      ...report,
      lastSyncedAt: timestampMs,
      lastSyncedFormatted: timeFormatted,
      spdaPhotos: currentTowerData ? [...currentTowerData.spdaPhotos] : report.spdaPhotos.map((p) => ({ ...p, syncedAt: p.syncedAt || timestampMs })),
      measurementPhotos: currentTowerData ? [...currentTowerData.measurementPhotos] : report.measurementPhotos.map((p) => ({ ...p, syncedAt: p.syncedAt || timestampMs })),
      quadrosPhotos: currentTowerData ? [...currentTowerData.quadrosPhotos] : report.quadrosPhotos.map((p) => ({ ...p, syncedAt: p.syncedAt || timestampMs })),
      localPhotos: currentTowerData ? [...currentTowerData.localPhotos] : report.localPhotos.map((p) => ({ ...p, syncedAt: p.syncedAt || timestampMs })),
      torresData: updatedTorresData,
    };

    return {
      success: true,
      folderPath: `Documentos/LAUDOS SPDA/${condoName}`,
      syncedPhotos: totalOnDisk,
      totalOnDisk,
      newlySyncedPhotos: newlySyncedCount,
      alreadyExistingPhotos: alreadyExistingCount,
      lastSyncedFormatted: timeFormatted,
      updatedReport,
    };
  } catch (err: any) {
    console.error('Erro ao sincronizar pastas físicas:', err);
    return {
      success: false,
      folderPath: '',
      syncedPhotos: 0,
      totalOnDisk: 0,
      newlySyncedPhotos: 0,
      alreadyExistingPhotos: 0,
      lastSyncedFormatted: '',
      error: err?.message || 'Falha ao sincronizar pastas no disco.',
    };
  }
}

/**
 * Tenta sincronizar as pastas e fotos incrementalmente se a pasta Documentos estiver conectada.
 * Não lança erro se não estiver conectada.
 */
export async function tryAutoSyncReportFolders(
  report: SpdaReport,
  optionsOrProgress?: EnsureFoldersOptions | ((percent: number, message: string) => void)
): Promise<{
  synced: boolean;
  folderPath?: string;
  syncedPhotos?: number;
  totalOnDisk?: number;
  newlySyncedPhotos?: number;
  alreadyExistingPhotos?: number;
  lastSyncedFormatted?: string;
  error?: string;
}> {
  try {
    const handle = await getConnectedDeviceFolderHandle();
    if (!handle) return { synced: false };
    const res = await ensureRealDocumentFoldersCreated(report, optionsOrProgress);
    return {
      synced: res.success,
      folderPath: res.folderPath,
      syncedPhotos: res.syncedPhotos,
      totalOnDisk: res.totalOnDisk,
      newlySyncedPhotos: res.newlySyncedPhotos,
      alreadyExistingPhotos: res.alreadyExistingPhotos,
      lastSyncedFormatted: res.lastSyncedFormatted,
      error: res.error,
    };
  } catch (err: any) {
    return { synced: false, error: err?.message };
  }
}

/**
 * Cria a árvore completa de pastas físicas no disco para o condomínio:
 * LAUDOS SPDA / [Nome do Condomínio] / [Torre] / [spda existente, quadros, pontos de inspeção, Fachada e Vista Aérea]
 */
export async function createCondoFolderTree(
  condoName: string,
  towersList: string[] = ['Torre 1']
): Promise<{ success: boolean; folderPath: string; error?: string }> {
  let rootHandle = await getConnectedDeviceFolderHandle();
  if (!rootHandle) {
    rootHandle = await getOrRequestConnectedDeviceFolderHandle();
  }

  if (!rootHandle) {
    return {
      success: false,
      folderPath: '',
      error: 'Pasta do dispositivo não conectada. Conecte a pasta para criar a árvore física.',
    };
  }

  try {
    const condoFolder = sanitizeFolderName(condoName);
    const laudosSpdaBase = await findOrCreateLaudosSpdaDirectory(rootHandle, true);
    if (!laudosSpdaBase) {
      throw new Error('Não foi possível acessar a pasta LAUDOS SPDA.');
    }
    const condoHandle = await findOrCreateCondoDirectory(laudosSpdaBase, condoFolder, true);
    if (!condoHandle) {
      throw new Error(`Não foi possível acessar a pasta do condomínio ${condoFolder}.`);
    }

    const rawTowers = towersList && towersList.length > 0 ? towersList : ['Torre 1'];
    const safeTowers = Array.from(new Set(['Área Comum', ...rawTowers]));

    for (const tower of safeTowers) {
      const safeTower = sanitizeFolderName(tower, 'Torre 1');
      const towerHandle = await findOrCreateTowerDirectory(condoHandle, safeTower, true);
      if (towerHandle) {
        await Promise.all([
          findOrCreateSectionDirectory(towerHandle, 'spda existente', true),
          findOrCreateSectionDirectory(towerHandle, 'quadros', true),
          findOrCreateSectionDirectory(towerHandle, 'pontos de inspeção', true),
          findOrCreateSectionDirectory(towerHandle, 'Fachada e Vista Aérea', true),
        ]);
      }
    }

    // Grava arquivo índice com os detalhes da estrutura criada
    try {
      const infoFile = await condoHandle.getFileHandle('ESTRUTURA_DO_CONDOMINIO.txt', { create: true });
      const writer = await infoFile.createWritable();
      const txt = [
        `LAUDOS SPDA - ESTRUTURA DO CONDOMÍNIO (NBR 5419:2026)`,
        `Condomínio: ${condoName || 'Condomínio'}`,
        `Data de Criação: ${new Date().toLocaleString('pt-BR')}`,
        `Torres Vistoriadas: ${safeTowers.join(', ')}`,
        ``,
        `Árvore de Pastas Pronta para Salvamento Automático:`,
        `LAUDOS SPDA/`,
        `  └── ${condoFolder}/`,
        ...safeTowers.map(
          (t) =>
            `        ├── ${t}/\n        │     ├── spda existente/\n        │     ├── quadros/\n        │     ├── pontos de inspeção/\n        │     └── Fachada e Vista Aérea/`
        ),
      ].join('\n');
      await writer.write(new Blob([txt], { type: 'text/plain' }));
      await writer.close();
    } catch {
      // ignore
    }

    return {
      success: true,
      folderPath: `Documentos/LAUDOS SPDA/${condoFolder}`,
    };
  } catch (err: any) {
    console.error('Erro ao criar árvore de pastas no disco:', err);
    return {
      success: false,
      folderPath: '',
      error: err?.message || 'Falha ao criar pastas no disco.',
    };
  }
}

/**
 * Salva uma única foto IMEDIATAMENTE no disco assim que é tirada ou importada:
 * LAUDOS SPDA / [Condomínio] / [Torre] / [spda existente | quadros | pontos de inspeção | Fachada e Vista Aérea] / foto_XX.jpg
 */
export async function saveSinglePhotoToDisk(
  photoUrl: string,
  info: {
    condoName?: string;
    towerName?: string;
    section: 'spda' | 'medicao' | 'quadros' | 'local';
    photoIndex: number;
    caption?: string;
    measurementValue?: string;
    photoId?: string;
    diskFileName?: string;
  }
): Promise<{ success: boolean; fileName: string; filePath: string; error?: string }> {
  const condoFolder = sanitizeFolderName(info.condoName);
  const towerFolder = sanitizeFolderName(info.towerName, 'Torre 1');
  const sectionFolder = getSectionSubfolderName(info.section);
  const padIndex = String(info.photoIndex + 1).padStart(2, '0');
  const safeCaption = info.caption
    ? '_' + info.caption.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)
    : '';
  const valSuffix =
    info.section === 'medicao' && info.measurementValue
      ? `_${info.measurementValue.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      : '';

  const fileName = info.diskFileName || `foto_${padIndex}${valSuffix}${safeCaption}.jpg`;
  const relativePath = `Documentos/LAUDOS SPDA/${condoFolder}/${towerFolder}/${sectionFolder}/${fileName}`;

  try {
    let rootHandle = await getConnectedDeviceFolderHandle();
    if (!rootHandle) {
      rootHandle = await getOrRequestConnectedDeviceFolderHandle();
    }
    if (!rootHandle) {
      return { success: false, fileName, filePath: relativePath, error: 'Pasta não conectada' };
    }

    const laudosSpdaBase = await findOrCreateLaudosSpdaDirectory(rootHandle, true);
    if (!laudosSpdaBase) {
      return { success: false, fileName, filePath: relativePath, error: 'Não foi possível acessar a pasta LAUDOS SPDA' };
    }

    const condoHandle = await findOrCreateCondoDirectory(laudosSpdaBase, condoFolder, true);
    if (!condoHandle) {
      return { success: false, fileName, filePath: relativePath, error: `Não foi possível acessar a pasta do condomínio ${condoFolder}` };
    }

    const towerHandle = await findOrCreateTowerDirectory(condoHandle, towerFolder, true);
    if (!towerHandle) {
      return { success: false, fileName, filePath: relativePath, error: `Não foi possível acessar a pasta da torre ${towerFolder}` };
    }

    const sectionHandle = await findOrCreateSectionDirectory(towerHandle, sectionFolder, true);
    if (!sectionHandle) {
      return { success: false, fileName, filePath: relativePath, error: `Não foi possível acessar a subpasta ${sectionFolder}` };
    }

    const fileHandle = await sectionHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    const blob = await dataUrlToBlobAsync(photoUrl);
    await writable.write(blob);
    await writable.close();

    // Atualiza o diário de sincronização
    try {
      const journal = loadSyncJournal(info.condoName);
      const journalKey = `${towerFolder}/${sectionFolder}/${fileName}`;
      const now = new Date();
      journal.files[journalKey] = {
        fileName,
        photoId: info.photoId || `photo-${Date.now()}`,
        section: sectionFolder,
        tower: towerFolder,
        urlLength: photoUrl.length,
        syncedAt: now.toISOString(),
        syncedTimestamp: now.getTime(),
      };
      saveSyncJournal(journal);
    } catch {
      // ignore
    }

    return { success: true, fileName, filePath: relativePath };
  } catch (err: any) {
    console.warn(`Falha na gravação imediata da foto ${fileName} no disco:`, err);
    return { success: false, fileName, filePath: relativePath, error: err?.message };
  }
}

/**
 * Exclui uma foto do disco físico na pasta correspondente do aparelho:
 * Remove o arquivo foto_XX.jpg dentro de LAUDOS SPDA / [Condomínio] / [Torre] / [Seção]
 */
export async function deletePhotoFromDisk(info: {
  condoName?: string;
  towerName?: string;
  section: 'spda' | 'medicao' | 'quadros' | 'local';
  photoIndex: number;
  diskFileName?: string;
  caption?: string;
  measurementValue?: string;
}): Promise<{ success: boolean; deletedFileName?: string; error?: string }> {
  const condoFolder = sanitizeFolderName(info.condoName);
  const towerFolder = sanitizeFolderName(info.towerName, 'Torre 1');
  const sectionFolder = getSectionSubfolderName(info.section);

  try {
    const rootHandle = await getConnectedDeviceFolderHandle();
    if (!rootHandle) {
      return { success: false, error: 'Pasta não conectada' };
    }

    const laudosSpdaBase = await findOrCreateLaudosSpdaDirectory(rootHandle, false);
    if (!laudosSpdaBase) return { success: false };

    const condoHandle = await findOrCreateCondoDirectory(laudosSpdaBase, condoFolder, false);
    if (!condoHandle) return { success: false };

    const towerHandle = await findOrCreateTowerDirectory(condoHandle, towerFolder, false);
    if (!towerHandle) return { success: false };

    const sectionHandle = await findOrCreateSectionDirectory(towerHandle, sectionFolder, false);
    if (!sectionHandle) return { success: false };

    // Lista de candidatos de nomes de arquivo para remover
    const candidates: string[] = [];
    if (info.diskFileName) candidates.push(info.diskFileName);

    const padIndex = String(info.photoIndex + 1).padStart(2, '0');
    const safeCaption = info.caption
      ? '_' + info.caption.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)
      : '';
    const valSuffix =
      info.section === 'medicao' && info.measurementValue
        ? `_${info.measurementValue.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        : '';

    candidates.push(`foto_${padIndex}${valSuffix}${safeCaption}.jpg`);
    candidates.push(`foto_${padIndex}${safeCaption}.jpg`);
    candidates.push(`foto_${padIndex}.jpg`);

    let deletedName: string | undefined;

    for (const cand of candidates) {
      try {
        await sectionHandle.removeEntry(cand);
        deletedName = cand;
        break;
      } catch (err: any) {
        if (err?.name === 'NotFoundError') {
          // Continua para o próximo candidato
          continue;
        }
      }
    }

    // Se nenhum dos candidatos exatos foi encontrado, procura por qualquer arquivo que comece com foto_XX
    if (!deletedName) {
      try {
        const prefix = `foto_${padIndex}`;
        if (typeof sectionHandle.values === 'function') {
          for await (const entry of sectionHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase().startsWith(prefix.toLowerCase())) {
              await sectionHandle.removeEntry(entry.name);
              deletedName = entry.name;
              break;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Remove do diário de sincronização
    try {
      const journal = loadSyncJournal(info.condoName);
      if (deletedName) {
        const journalKey = `${towerFolder}/${sectionFolder}/${deletedName}`;
        delete journal.files[journalKey];
        saveSyncJournal(journal);
      }
    } catch {
      // ignore
    }

    return { success: Boolean(deletedName), deletedFileName: deletedName };
  } catch (err: any) {
    console.warn('Erro ao remover arquivo do disco:', err);
    return { success: false, error: err?.message };
  }
}

/**
 * Salva a foto automaticamente na hierarquia de pastas exata solicitada (wrapper de compatibilidade):
 * Documentos / LAUDOS SPDA / [Condomínio] / [Torre] / [spda existente | quadros | pontos de inspeção] / foto_XX.jpg
 */
export async function autoSavePhotoToDevice(
  photoUrl: string,
  info: PhotoLocationInfo,
  options?: { fallbackDownload?: boolean }
): Promise<{ savedDirectly: boolean; filePath: string }> {
  const res = await saveSinglePhotoToDisk(photoUrl, {
    condoName: info.condoName,
    towerName: info.towerName,
    section: info.section,
    photoIndex: info.photoIndex,
    caption: info.caption,
  });

  if (res.success) {
    return { savedDirectly: true, filePath: res.filePath };
  }

  // 2. Se o usuário ativou o download automático e a gravação direta não estiver ativa
  if (options?.fallbackDownload) {
    try {
      const condoFolder = sanitizeFolderName(info.condoName);
      const towerFolder = sanitizeFolderName(info.towerName, 'Torre 1');
      const sectionFolder = getSectionSubfolderName(info.section);
      const padIndex = String(info.photoIndex + 1).padStart(2, '0');
      const safeCaption = info.caption
        ? '_' + info.caption.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 25)
        : '';
      const fileName = `foto_${padIndex}${safeCaption}.jpg`;
      const downloadName = `LAUDOS_SPDA_${condoFolder}_${towerFolder}_${sectionFolder}_${fileName}`.replace(/\s+/g, '_');
      const blob = dataUrlToBlob(photoUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      // ignore
    }
  }

  return { savedDirectly: false, filePath: res.filePath };
}

/**
 * Gera e faz o download de um arquivo ZIP contendo toda a árvore de pastas exata solicitada:
 * LAUDOS SPDA / [Nome do Condomínio] / [Torre] / [spda existente | quadros | pontos de inspeção] / fotos.jpg
 * Abrange todas as torres vistoriadas do condomínio!
 */
export async function downloadAllPhotosAsOrganizedZip(
  report: SpdaReport,
  onProgress?: (percent: number, message: string) => void
): Promise<{ fileName: string; totalPhotos: number }> {
  const zip = new JSZip();
  const condoName = sanitizeFolderName(report.client?.name);
  const baseDir = `LAUDOS SPDA/${condoName}`;

  // Consolida todos os dados de torres (as torres cadastradas + torresData + torre atual em exibição)
  const currentTower = report.torreAtual || 'Torre 1';
  const allTowersMap: Record<string, RestoredTowerData> = {};

  if (report.client?.torresNomes && Array.isArray(report.client.torresNomes) && report.client.torresNomes.length > 0) {
    report.client.torresNomes.forEach((tNome) => {
      if (tNome && tNome.trim()) {
        allTowersMap[tNome.trim()] = {
          spdaPhotos: [],
          measurementPhotos: [],
          quadrosPhotos: [],
          localPhotos: [],
        };
      }
    });
  } else if (report.client?.quantidadeTorres && report.client.quantidadeTorres > 1) {
    for (let i = 1; i <= report.client.quantidadeTorres; i++) {
      allTowersMap[`Torre ${i}`] = {
        spdaPhotos: [],
        measurementPhotos: [],
        quadrosPhotos: [],
        localPhotos: [],
      };
    }
  }

  if (report.torresData) {
    Object.entries(report.torresData).forEach(([tNome, data]) => {
      allTowersMap[tNome] = {
        spdaPhotos: data.spdaPhotos || [],
        measurementPhotos: data.measurementPhotos || [],
        quadrosPhotos: data.quadrosPhotos || [],
        localPhotos: data.localPhotos || [],
      };
    });
  }

  allTowersMap[currentTower] = {
    spdaPhotos: report.spdaPhotos || [],
    measurementPhotos: report.measurementPhotos || [],
    quadrosPhotos: report.quadrosPhotos || [],
    localPhotos: report.localPhotos || [],
  };

  if (Object.keys(allTowersMap).length === 0) {
    allTowersMap['Torre 1'] = {
      spdaPhotos: report.spdaPhotos || [],
      measurementPhotos: report.measurementPhotos || [],
      quadrosPhotos: report.quadrosPhotos || [],
      localPhotos: report.localPhotos || [],
    };
  }

  let totalPhotos = 0;
  Object.values(allTowersMap).forEach((t) => {
    totalPhotos +=
      t.spdaPhotos.length +
      t.measurementPhotos.length +
      t.quadrosPhotos.length +
      t.localPhotos.length;
  });

  onProgress?.(10, 'Montando estrutura de pastas em LAUDOS SPDA...');

  let processed = 0;

  for (const [towerName, towerData] of Object.entries(allTowersMap)) {
    const safeTower = sanitizeFolderName(towerName, 'Torre 1');

    // Cria as 3 subpastas explicitamente na árvore
    zip.folder(`${baseDir}/${safeTower}/spda existente`);
    zip.folder(`${baseDir}/${safeTower}/quadros`);
    zip.folder(`${baseDir}/${safeTower}/pontos de inspeção`);

    if (towerData.spdaPhotos.length === 0) {
      zip.file(
        `${baseDir}/${safeTower}/spda existente/LEIAME.txt`,
        `Subpasta pronta para fotos de SPDA Existente (${towerName}).`
      );
    }
    if (towerData.measurementPhotos.length === 0) {
      zip.file(
        `${baseDir}/${safeTower}/pontos de inspeção/LEIAME.txt`,
        `Subpasta pronta para fotos de Pontos de Inspeção (${towerName}).`
      );
    }
    if (towerData.quadrosPhotos.length === 0) {
      zip.file(
        `${baseDir}/${safeTower}/quadros/LEIAME.txt`,
        `Subpasta pronta para fotos de Quadros (${towerName}).`
      );
    }

    // 1. spda existente
    towerData.spdaPhotos.forEach((photo, idx) => {
      if (!photo.url) return;
      const pad = String(idx + 1).padStart(2, '0');
      const cap = photo.caption ? `_${photo.caption.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}` : '';
      const path = `${baseDir}/${safeTower}/spda existente/foto_${pad}${cap}.jpg`;
      const blob = dataUrlToBlob(photo.url);
      zip.file(path, blob);
      processed++;
    });

    // 2. pontos de inspeção
    towerData.measurementPhotos.forEach((photo, idx) => {
      if (!photo.url) return;
      const pad = String(idx + 1).padStart(2, '0');
      const val = photo.measurementValue ? `_${photo.measurementValue.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
      const cap = photo.caption ? `_${photo.caption.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}` : '';
      const path = `${baseDir}/${safeTower}/pontos de inspeção/foto_${pad}${val}${cap}.jpg`;
      const blob = dataUrlToBlob(photo.url);
      zip.file(path, blob);
      processed++;
    });

    // 3. quadros
    towerData.quadrosPhotos.forEach((photo, idx) => {
      if (!photo.url) return;
      const pad = String(idx + 1).padStart(2, '0');
      const cap = photo.caption ? `_${photo.caption.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}` : '';
      const path = `${baseDir}/${safeTower}/quadros/foto_${pad}${cap}.jpg`;
      const blob = dataUrlToBlob(photo.url);
      zip.file(path, blob);
      processed++;
    });

    // 4. Fachada e Vista Aérea (se houver)
    towerData.localPhotos.forEach((photo, idx) => {
      if (!photo.url) return;
      const pad = String(idx + 1).padStart(2, '0');
      const cap = photo.caption ? `_${photo.caption.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}` : '';
      const path = `${baseDir}/${safeTower}/Fachada e Vista Aérea/foto_${pad}${cap}.jpg`;
      const blob = dataUrlToBlob(photo.url);
      zip.file(path, blob);
      processed++;
    });

    const percent = totalPhotos === 0 ? 90 : Math.min(90, Math.round((processed / totalPhotos) * 80) + 10);
    onProgress?.(percent, `Adicionando fotos da ${towerName} (${processed}/${totalPhotos})...`);
  }

  // Arquivo LEIA-ME com metadados do laudo
  const infoTxt = [
    `LAUDOS SPDA - ESTRUTURA DE PASTAS`,
    `Condomínio: ${report.client.name || 'Condomínio'}`,
    `Data da Vistoria: ${report.client.periodoAvaliacao || new Date().toLocaleDateString('pt-BR')}`,
    `Total de Fotos: ${totalPhotos}`,
    `Torres: ${Object.keys(allTowersMap).join(', ')}`,
    ``,
    `Estrutura de Pastas em Documentos:`,
    `- Documentos/`,
    `    └── LAUDOS SPDA/`,
    `          └── ${condoName}/`,
    `                ├── [Torre]/`,
    `                │     ├── spda existente/`,
    `                │     ├── quadros/`,
    `                │     └── pontos de inspeção/`,
    `                └── Fachada e Vista Aérea/`,
  ].join('\n');

  zip.file(`${baseDir}/INFORMACOES_DO_LAUDO.txt`, infoTxt);

  onProgress?.(95, 'Compactando arquivo ZIP final...');

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const zipFileName = `LAUDOS_SPDA_${condoName.replace(/\s+/g, '_')}_${dateStr}.zip`;

  const downloadUrl = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = zipFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

  onProgress?.(100, 'Download concluído!');

  return { fileName: zipFileName, totalPhotos };
}

/**
 * Puxa fotos de volta para o aplicativo a partir de um arquivo ZIP ou arquivos soltos
 * Restaura automaticamente por Torre e por Seção (SPDA existente, Pontos de inspeção, Quadros)
 */
export async function parsePhotosFromZipBackup(
  zipFile: File,
  onProgress?: (percent: number, message: string) => void
): Promise<ParsedRestoreResult> {
  onProgress?.(10, 'Lendo arquivo ZIP de backup...');
  const zip = await JSZip.loadAsync(zipFile);

  const result: ParsedRestoreResult = {
    torres: {},
    totalPhotosCount: 0,
  };

  const fileEntries = Object.keys(zip.files).filter((path) => {
    const lower = path.toLowerCase();
    return !zip.files[path].dir && (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp'));
  });

  if (fileEntries.length === 0) {
    throw new Error('Nenhuma imagem encontrada no arquivo ZIP selecionado.');
  }

  let processed = 0;

  for (const filePath of fileEntries) {
    // Exemplo de caminho: Gerador de Laudos/Solar/Torre 1/Quadros/foto_01_barrilete.jpg
    const parts = filePath.split('/').filter(Boolean);

    // Identifica condomínio
    if (!result.condoName && parts.length >= 2) {
      if (parts[0] === 'DCIM' && (parts[1] === 'Gerador de SPDA' || parts[1] === 'Gerador de Laudos') && parts[2]) {
        result.condoName = parts[2];
      } else if ((parts[0] === 'Gerador de SPDA' || parts[0] === 'Gerador de Laudos') && parts[1]) {
        result.condoName = parts[1];
      }
    }

    // Procura pela torre no caminho (ex: "Torre 1", "Torre 2", "Bloco A")
    let detectedTower = 'Torre 1';
    for (const part of parts) {
      if (/torre[\s_-]*\d+/i.test(part) || /bloco[\s_-]*\w+/i.test(part)) {
        detectedTower = part.trim();
        break;
      }
    }

    // Identifica seção pelo nome da pasta
    let detectedSection: 'spda' | 'medicao' | 'quadros' | 'local' = 'spda';
    const pathLower = filePath.toLowerCase();
    if (pathLower.includes('quadro')) {
      detectedSection = 'quadros';
    } else if (pathLower.includes('medi') || pathLower.includes('inspec')) {
      detectedSection = 'medicao';
    } else if (pathLower.includes('spda')) {
      detectedSection = 'spda';
    } else if (pathLower.includes('geral') || pathLower.includes('fachada') || pathLower.includes('local') || pathLower.includes('aerea') || pathLower.includes('aérea')) {
      detectedSection = 'local';
    }

    // Inicializa a torre no resultado se não existir
    if (!result.torres[detectedTower]) {
      result.torres[detectedTower] = {
        spdaPhotos: [],
        measurementPhotos: [],
        quadrosPhotos: [],
        localPhotos: [],
      };
    }

    const file = zip.files[filePath];
    const blob = await file.async('blob');
    const imageFile = new File([blob], parts[parts.length - 1], { type: 'image/jpeg' });
    const url = await optimizeImageFile(imageFile);

    // Extrai possível legenda do nome do arquivo (ex: foto_01_barrilete.jpg)
    const fileNameOnly = parts[parts.length - 1].replace(/\.[^/.]+$/, '');
    let caption = '';
    const captionMatch = fileNameOnly.match(/foto_\d+_(.+)/i);
    if (captionMatch) {
      caption = captionMatch[1].replace(/_/g, ' ');
    }

    const photoSlot: PhotoSlot = {
      id: `restored-${Date.now()}-${processed}-${Math.random().toString(36).substring(2, 6)}`,
      url,
      caption,
      hasRedCircleMarker: detectedSection === 'spda',
      circleX: 50,
      circleY: 50,
      circleRadius: 24,
      towerName: detectedTower,
    };

    if (detectedSection === 'spda') {
      result.torres[detectedTower].spdaPhotos.push(photoSlot);
    } else if (detectedSection === 'medicao') {
      result.torres[detectedTower].measurementPhotos.push(photoSlot);
    } else if (detectedSection === 'quadros') {
      result.torres[detectedTower].quadrosPhotos.push(photoSlot);
    } else {
      result.torres[detectedTower].localPhotos.push(photoSlot);
    }

    processed++;
    result.totalPhotosCount++;

    const percent = Math.min(95, Math.round((processed / fileEntries.length) * 85) + 10);
    onProgress?.(percent, `Restaurando fotos (${processed}/${fileEntries.length})...`);
  }

  onProgress?.(100, `Restauração concluída: ${result.totalPhotosCount} foto(s) recuperadas.`);
  return result;
}

/**
 * Puxa fotos de volta a partir de arquivos soltos ou pastas selecionadas pelo usuário
 */
export async function parsePhotosFromDirectoryOrFiles(
  files: FileList | File[],
  onProgress?: (percent: number, message: string) => void
): Promise<ParsedRestoreResult> {
  const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (fileArray.length === 0) {
    throw new Error('Nenhuma imagem válida foi selecionada.');
  }

  const result: ParsedRestoreResult = {
    torres: {},
    totalPhotosCount: 0,
  };

  let processed = 0;

  for (const file of fileArray) {
    const path = (file as any).webkitRelativePath || file.name;
    const pathLower = path.toLowerCase();

    // Detecta torre no caminho ou no nome do arquivo
    let detectedTower = 'Torre 1';
    const towerMatch = path.match(/torre[\s_-]*(\d+)/i) || path.match(/bloco[\s_-]*(\w+)/i);
    if (towerMatch) {
      detectedTower = `Torre ${towerMatch[1]}`;
    }

    // Detecta seção
    let detectedSection: 'spda' | 'medicao' | 'quadros' | 'local' = 'spda';
    if (pathLower.includes('quadro')) {
      detectedSection = 'quadros';
    } else if (pathLower.includes('medi') || pathLower.includes('inspec')) {
      detectedSection = 'medicao';
    } else if (pathLower.includes('spda')) {
      detectedSection = 'spda';
    } else if (pathLower.includes('geral') || pathLower.includes('fachada') || pathLower.includes('local') || pathLower.includes('aerea') || pathLower.includes('aérea')) {
      detectedSection = 'local';
    }

    if (!result.torres[detectedTower]) {
      result.torres[detectedTower] = {
        spdaPhotos: [],
        measurementPhotos: [],
        quadrosPhotos: [],
        localPhotos: [],
      };
    }

    const url = await optimizeImageFile(file);

    // Extrai legenda se houver
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
    let caption = '';
    const captionMatch = nameWithoutExt.match(/foto_\d+_(.+)/i);
    if (captionMatch) {
      caption = captionMatch[1].replace(/_/g, ' ');
    }

    const photoSlot: PhotoSlot = {
      id: `restored-f-${Date.now()}-${processed}-${Math.random().toString(36).substring(2, 6)}`,
      url,
      caption,
      hasRedCircleMarker: detectedSection === 'spda',
      circleX: 50,
      circleY: 50,
      circleRadius: 24,
      towerName: detectedTower,
    };

    if (detectedSection === 'spda') {
      result.torres[detectedTower].spdaPhotos.push(photoSlot);
    } else if (detectedSection === 'medicao') {
      result.torres[detectedTower].measurementPhotos.push(photoSlot);
    } else if (detectedSection === 'quadros') {
      result.torres[detectedTower].quadrosPhotos.push(photoSlot);
    } else {
      result.torres[detectedTower].localPhotos.push(photoSlot);
    }

    processed++;
    result.totalPhotosCount++;

    const percent = Math.min(95, Math.round((processed / fileArray.length) * 85) + 10);
    onProgress?.(percent, `Importando foto ${processed} de ${fileArray.length}...`);
  }

  onProgress?.(100, `${result.totalPhotosCount} foto(s) importadas.`);
  return result;
}

export interface BatchPhotoSaveItem {
  photo: PhotoSlot;
  section: 'spda' | 'medicao' | 'quadros' | 'local';
  towerName?: string;
  photoIndex?: number;
}

/**
 * Salva um lote de fotos capturadas diretamente na pasta física escolhida:
 * LAUDOS SPDA / [Condomínio] / [Torre] / [spda existente | quadros | pontos de inspeção | Fachada e Vista Aérea] / foto_XX.jpg
 * Executado ao clicar em "CONCLUIR" na câmera.
 */
export async function saveBatchPhotosToDisk(
  items: BatchPhotoSaveItem[],
  condoName?: string,
  onProgress?: (saved: number, total: number, message: string) => void
): Promise<{ success: boolean; savedCount: number; error?: string }> {
  if (!items || items.length === 0) {
    return { success: true, savedCount: 0 };
  }

  let rootHandle = await getConnectedDeviceFolderHandle();
  if (!rootHandle) {
    rootHandle = await getOrRequestConnectedDeviceFolderHandle();
  }

  if (!rootHandle) {
    return {
      success: false,
      savedCount: 0,
      error: 'Pasta do dispositivo não conectada. Conecte a pasta para salvar as fotos fisicamente.',
    };
  }

  const condoFolder = sanitizeFolderName(condoName);
  const laudosSpdaBase = await findOrCreateLaudosSpdaDirectory(rootHandle, true);
  if (!laudosSpdaBase) {
    return { success: false, savedCount: 0, error: 'Não foi possível acessar a pasta LAUDOS SPDA' };
  }

  const condoHandle = await findOrCreateCondoDirectory(laudosSpdaBase, condoFolder, true);
  if (!condoHandle) {
    return { success: false, savedCount: 0, error: `Não foi possível acessar a pasta do condomínio ${condoFolder}` };
  }

  let savedCount = 0;
  const now = new Date();
  const timestampIso = now.toISOString();
  const timestampMs = now.getTime();
  const journal = loadSyncJournal(condoName);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const towerFolder = sanitizeFolderName(item.towerName, 'Torre 1');
    const sectionFolder = getSectionSubfolderName(item.section);
    const photoIdx = item.photoIndex !== undefined ? item.photoIndex : i;
    const padIndex = String(photoIdx + 1).padStart(2, '0');

    const fileName = item.photo.diskFileName || `foto_${padIndex}.jpg`;

    onProgress?.(i + 1, items.length, `Salvando foto ${i + 1} de ${items.length}: ${towerFolder} > ${fileName}...`);

    try {
      const towerHandle = await findOrCreateTowerDirectory(condoHandle, towerFolder, true);
      if (!towerHandle) continue;

      const sectionHandle = await findOrCreateSectionDirectory(towerHandle, sectionFolder, true);
      if (!sectionHandle) continue;

      const fileHandle = await sectionHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      const blob = await dataUrlToBlobAsync(item.photo.url);
      await writable.write(blob);
      await writable.close();

      item.photo.syncedAt = timestampMs;
      item.photo.diskFileName = fileName;

      const journalKey = `${towerFolder}/${sectionFolder}/${fileName}`;
      journal.files[journalKey] = {
        fileName,
        photoId: item.photo.id,
        section: sectionFolder,
        tower: towerFolder,
        urlLength: item.photo.url.length,
        syncedAt: timestampIso,
        syncedTimestamp: timestampMs,
      };

      savedCount++;
    } catch (writeErr) {
      console.warn(`Erro ao salvar foto ${fileName} no disco:`, writeErr);
    }
  }

  journal.condoKey = condoFolder;
  journal.lastSyncedAt = timestampIso;
  journal.lastSyncedTimestamp = timestampMs;
  journal.lastSyncedFormatted = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  saveSyncJournal(journal);

  return {
    success: savedCount > 0 || items.length === 0,
    savedCount,
  };
}

