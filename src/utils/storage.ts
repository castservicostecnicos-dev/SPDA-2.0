/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SpdaReport, PhotoSlot } from '../types/spda';
import { loadSyncJournal } from './photoDeviceSync';
import {
  openMasterDatabase,
  saveLaudoRecord,
  getLaudoById,
  getAllLaudos,
  deleteLaudoRecord,
  saveFieldPhotosBatch,
  getFieldPhotosForReport,
  syncCondominioFromReport,
  saveCliente,
} from '../db/spdaDatabase';

const DB_NAME = 'spda_laudo_database';
const DB_VERSION = 1;
const STORE_NAME = 'reports';
const REPORT_KEY = 'active_spda_report';
const BACKUP_REPORT_KEY = 'backup_spda_report_latest';
const EMERGENCY_RECOVERY_KEY = 'spda_emergency_recovery_snapshot';
const LAST_SAVED_TIMESTAMP_KEY = 'spda_last_saved_timestamp';
const SAVED_REPORTS_INDEX_KEY = 'saved_spda_reports_index';

// Open or initialize IndexedDB (base store for active report state)
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Sanitiza o laudo para salvar no IndexedDB sem referências circulares ou pesos desnecessários
 */
function cleanReportForStorage(report: SpdaReport): SpdaReport {
  return {
    ...report,
    id: report.id || `laudo-spda-${Date.now()}`,
    title: report.title || `Laudo SPDA - ${report.client?.name || 'Condomínio'}`,
  };
}

/**
 * Verifica se o laudo possui dados reais produzidos pelo usuário
 */
export function hasUserContent(report?: SpdaReport | null): boolean {
  if (!report) return false;
  const photoCount =
    (report.spdaPhotos?.length || 0) +
    (report.measurementPhotos?.length || 0) +
    (report.quadrosPhotos?.length || 0) +
    (report.localPhotos?.length || 0) +
    (report.equipmentPhotoUrl ? 1 : 0);

  if (photoCount > 0) return true;
  if (report.client?.name && report.client.name.trim() !== '') return true;
  if (report.client?.local && report.client.local.trim() !== '') return true;
  if (report.torresData && Object.keys(report.torresData).length > 0) return true;
  return false;
}

/**
 * Salva o laudo com segurança absoluta e sem travar o navegador:
 * 1. Chave ativa no IndexedDB (leve, rápido, ~5ms)
 * 2. Cópia no banco mestre relacional (Laudos, Condomínios e Clientes) apenas em fullSync
 * 3. Fotos persistidas no store de fotos de campo
 * NUNCA salva fotos em localStorage (elimina QuotaExceededError e memory crash no Chrome)
 */
export async function saveReportToStorage(
  report: SpdaReport,
  options: { fullSync?: boolean } = {}
): Promise<void> {
  const now = new Date();
  const timeStr = now.toISOString();
  const cleaned = cleanReportForStorage(report);
  const isFullSync = options.fullSync ?? false;

  try {
    // 1. Salva na chave ativa e também na chave permanente report_${id} do IndexedDB
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(cleaned, REPORT_KEY);

      if (cleaned.id) {
        store.put(cleaned, `report_${cleaned.id}`);
      }

      if (hasUserContent(cleaned)) {
        store.put(cleaned, BACKUP_REPORT_KEY);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // 2. Grava timestamp leve no localStorage
    try {
      localStorage.setItem(LAST_SAVED_TIMESTAMP_KEY, timeStr);
      localStorage.setItem('spda_last_active_report_id', cleaned.id);
      if (cleaned.client?.name) {
        localStorage.setItem('spda_last_active_condo_name', cleaned.client.name);
      }
    } catch {
      // ignore
    }

    // 3. Atualiza banco mestre relacional para persistência permanente
    saveLaudoRecord(cleaned).catch(() => {});
    syncCondominioFromReport(cleaned).catch(() => {});

    if (cleaned.client?.name) {
      saveCliente({
        name: cleaned.client.name,
        cnpj: cleaned.client.cnpj,
        local: cleaned.client.local,
        municipio: cleaned.client.municipio,
        ramoAtividade: cleaned.client.ramoAtividade,
        tecnico: cleaned.client.tecnico,
        cargo: cleaned.client.cargo,
        crea: cleaned.client.crea,
        art: cleaned.client.art,
      }).catch(() => {});
    }

    // Sincroniza fotos no banco relacional
    if (isFullSync) {
      syncPhotosToFieldStore(cleaned).catch(() => {});
    }
  } catch (err) {
    console.warn('Aviso de salvamento no banco local:', err);
  }
}

/**
 * Sincroniza fotos do laudo para a tabela fotos_campo do banco mestre
 */
async function syncPhotosToFieldStore(report: SpdaReport): Promise<void> {
  const condoName = report.client?.name || 'Condomínio';
  const reportId = report.id || 'current';
  const tower = report.torreAtual || 'Torre 1';

  const photosToSave: Array<{
    id: string;
    reportId: string;
    condoName: string;
    towerName: string;
    section: 'spda' | 'medicao' | 'quadros' | 'local';
    photoIndex: number;
    dataUrl?: string;
    caption?: string;
    measurementValue?: string;
    hasRedCircleMarker?: boolean;
    circleX?: number;
    circleY?: number;
    circleRadius?: number;
    diskFileName?: string;
    syncedAt?: number;
  }> = [];

  report.spdaPhotos?.forEach((p, idx) => {
    if (p.url) {
      photosToSave.push({
        id: p.id,
        reportId,
        condoName,
        towerName: p.towerName || tower,
        section: 'spda',
        photoIndex: idx,
        dataUrl: p.url,
        caption: p.caption,
        hasRedCircleMarker: p.hasRedCircleMarker,
        circleX: p.circleX,
        circleY: p.circleY,
        circleRadius: p.circleRadius,
        diskFileName: p.diskFileName,
        syncedAt: p.syncedAt,
      });
    }
  });

  report.measurementPhotos?.forEach((p, idx) => {
    if (p.url) {
      photosToSave.push({
        id: p.id,
        reportId,
        condoName,
        towerName: p.towerName || tower,
        section: 'medicao',
        photoIndex: idx,
        dataUrl: p.url,
        caption: p.caption,
        measurementValue: p.measurementValue,
        diskFileName: p.diskFileName,
        syncedAt: p.syncedAt,
      });
    }
  });

  report.quadrosPhotos?.forEach((p, idx) => {
    if (p.url) {
      photosToSave.push({
        id: p.id,
        reportId,
        condoName,
        towerName: p.towerName || tower,
        section: 'quadros',
        photoIndex: idx,
        dataUrl: p.url,
        caption: p.caption,
        diskFileName: p.diskFileName,
        syncedAt: p.syncedAt,
      });
    }
  });

  report.localPhotos?.forEach((p, idx) => {
    if (p.url) {
      photosToSave.push({
        id: p.id,
        reportId,
        condoName,
        towerName: p.towerName || tower,
        section: 'local',
        photoIndex: idx,
        dataUrl: p.url,
        caption: p.caption,
        diskFileName: p.diskFileName,
        syncedAt: p.syncedAt,
      });
    }
  });

  if (photosToSave.length > 0) {
    await saveFieldPhotosBatch(photosToSave);
  }
}

/**
 * Executa o salvamento automático periódico.
 */
export async function performPeriodicAutoSave(report: SpdaReport): Promise<{ timestamp: string; timeFormatted: string }> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const timestamp = now.toISOString();

  await saveReportToStorage(report);

  if (hasUserContent(report) && report.id) {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(report, `report_${report.id}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      const totalPhotos =
        (report.spdaPhotos?.length || 0) +
        (report.measurementPhotos?.length || 0) +
        (report.quadrosPhotos?.length || 0) +
        (report.localPhotos?.length || 0) +
        (report.equipmentPhotoUrl ? 1 : 0);

      const clientName = report.client?.name?.trim() || 'Condomínio';
      const meta: SavedReportMeta = {
        id: report.id,
        title: report.title || `Laudo SPDA - ${clientName}`,
        clientName,
        clientLocal: report.client?.local || '',
        updatedAt: timestamp,
        photoCount: totalPhotos,
      };

      const list = await getSavedReportsList();
      const existingIdx = list.findIndex((item) => item.id === report.id);
      if (existingIdx >= 0) {
        list[existingIdx] = meta;
      } else {
        list.unshift(meta);
      }
      localStorage.setItem(SAVED_REPORTS_INDEX_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('Aviso de auto-save:', err);
    }
  }

  return { timestamp, timeFormatted };
}

export function getLastSavedTimeFormatted(): string | null {
  try {
    const raw = localStorage.getItem(LAST_SAVED_TIMESTAMP_KEY);
    if (!raw) return null;
    const date = new Date(raw);
    if (isNaN(date.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  } catch {
    return null;
  }
}

export interface SavedReportMeta {
  id: string;
  title: string;
  clientName: string;
  clientLocal: string;
  updatedAt: string;
  photoCount: number;
}

/**
 * Retorna a lista de laudos salvos de forma resiliente e à prova de falhas:
 * 1. Escaneia o IndexedDB principal (chaves report_* e active_spda_report)
 * 2. Escaneia a tabela laudos do banco mestre relacional
 * 3. Recupera o índice do localStorage
 * Garante que NENHUM laudo criado pelo usuário seja perdido!
 */
export async function getSavedReportsList(): Promise<SavedReportMeta[]> {
  const map = new Map<string, SavedReportMeta>();

  // 1. Escaneia todas as chaves salvas no IndexedDB principal (spda_laudo_database)
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();

      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const key = String(cursor.key);
          const rep = cursor.value as SpdaReport;

          if (rep && typeof rep === 'object') {
            const rawClientName = rep.client?.name?.trim();
            let clientName = rawClientName || '';
            if (!clientName || clientName.toLowerCase() === 'condomínio' || clientName.toLowerCase() === 'condominio') {
              const fromTitle = rep.title?.match(/Laudo\s+SPDA\s*[-–:]\s*([^(]+)/i);
              if (fromTitle && fromTitle[1].trim() && !/condom[íi]nio$/i.test(fromTitle[1].trim())) {
                clientName = fromTitle[1].trim();
              } else {
                clientName = rawClientName || 'Condomínio';
              }
            }

            let totalPhotos =
              (rep.spdaPhotos?.length || 0) +
              (rep.measurementPhotos?.length || 0) +
              (rep.quadrosPhotos?.length || 0) +
              (rep.localPhotos?.length || 0) +
              (rep.equipmentPhotoUrl ? 1 : 0);

            if (rep.torresData) {
              let tCount = (rep.localPhotos?.length || 0) + (rep.equipmentPhotoUrl ? 1 : 0);
              Object.values(rep.torresData).forEach((tData) => {
                tCount += (tData.spdaPhotos?.length || 0) + (tData.measurementPhotos?.length || 0) + (tData.quadrosPhotos?.length || 0);
              });
              if (tCount > totalPhotos) totalPhotos = tCount;
            }

            const cleanTitle = rep.title && !rep.title.startsWith('Laudo de Inspeção SPDA - SPDA-')
              ? rep.title
              : `Laudo SPDA - ${clientName}`;

            if (key.startsWith('report_')) {
              const id = key.replace(/^report_/, '');
              map.set(id, {
                id,
                title: cleanTitle,
                clientName,
                clientLocal: rep.client?.local || '',
                updatedAt: rep.lastSyncedAt ? new Date(rep.lastSyncedAt).toISOString() : new Date().toISOString(),
                photoCount: totalPhotos,
              });
            } else if (key === REPORT_KEY && hasUserContent(rep)) {
              // Garante que o laudo ativo atual sempre apareça se tiver dados
              const activeId = rep.id || 'active_spda_report';
              if (!map.has(activeId)) {
                map.set(activeId, {
                  id: activeId,
                  title: `${cleanTitle} (Em Andamento)`,
                  clientName,
                  clientLocal: rep.client?.local || '',
                  updatedAt: new Date().toISOString(),
                  photoCount: totalPhotos,
                });
              }
            }
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      req.onerror = () => resolve();
    });
  } catch (err) {
    console.warn('Aviso ao consultar IndexedDB primário:', err);
  }

  // 2. Escaneia a tabela laudos do banco mestre relacional (spda_master_db_v2)
  try {
    const masterLaudos = await getAllLaudos();
    if (masterLaudos && masterLaudos.length > 0) {
      masterLaudos.forEach((l) => {
        if (l && l.id && !map.has(l.id)) {
          map.set(l.id, {
            id: l.id,
            title: l.title || `Laudo SPDA - ${l.condominioNome || l.clienteNome || 'Condomínio'}`,
            clientName: l.condominioNome || l.clienteNome || 'Condomínio',
            clientLocal: l.client?.local || '',
            updatedAt: l.updatedAt || new Date().toISOString(),
            photoCount: l.photoCount || 0,
          });
        }
      });
    }
  } catch (err) {
    console.warn('Aviso ao consultar banco mestre:', err);
  }

  // 3. Recupera o índice do localStorage para complementar
  try {
    const raw = localStorage.getItem(SAVED_REPORTS_INDEX_KEY);
    if (raw) {
      const list: SavedReportMeta[] = JSON.parse(raw);
      list.forEach((item) => {
        if (item && item.id && !map.has(item.id)) {
          map.set(item.id, item);
        }
      });
    }
  } catch {}

  // 4. Converte para array ordenado do mais recente para o mais antigo
  const combined = Array.from(map.values()).sort((a, b) => {
    const dateA = new Date(a.updatedAt || 0).getTime();
    const dateB = new Date(b.updatedAt || 0).getTime();
    return dateB - dateA;
  });

  // Atualiza cache do localStorage
  try {
    localStorage.setItem(SAVED_REPORTS_INDEX_KEY, JSON.stringify(combined));
  } catch {}

  return combined;
}

/**
 * Gera um título amigável para o laudo
 */
export function generateSequentialReportTitle(clientName?: string, _date = new Date(), torreName?: string): string {
  const condom = clientName?.trim() || 'Condomínio';
  const torreSuffix = torreName?.trim() ? ` (${torreName.trim()})` : '';
  return `Laudo SPDA - ${condom}${torreSuffix}`;
}

/**
 * Gera um nome de arquivo limpo e seguro para download do PDF
 */
export function generateSequentialPdfFileName(clientName?: string, date = new Date(), torreName?: string): string {
  const condomClean = (clientName?.trim() || 'Condominio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const torreClean = torreName?.trim()
    ? '_' + torreName.trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
    : '';

  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `Laudo_SPDA_${condomClean}${torreClean}_${day}-${month}-${year}_${hours}-${minutes}-${seconds}.pdf`;
}

/**
 * Gera um nome de arquivo limpo e seguro para download do DOCX (Word)
 */
export function generateSequentialDocxFileName(clientName?: string, date = new Date(), torreName?: string): string {
  return generateSequentialPdfFileName(clientName, date, torreName).replace(/\.pdf$/i, '.docx');
}

export type SaveReportResult = SavedReportMeta & { updatedReport: SpdaReport };

/**
 * Salva ou atualiza o laudo no banco.
 */
export async function saveNamedReport(
  report: SpdaReport,
  options?: { forceNew?: boolean; customTitle?: string; torreName?: string }
): Promise<SaveReportResult> {
  const db = await openDatabase();
  const now = new Date();

  const reportId = options?.forceNew === true
    ? `laudo-spda-${now.getTime()}`
    : (report.id || `laudo-spda-${now.getTime()}`);

  const activeTower = options?.torreName || report.torreAtual;
  const clientName = report.client?.name?.trim() || 'Condomínio';

  let reportTitle = options?.customTitle?.trim();
  if (!reportTitle) {
    if (report.title && !report.title.startsWith('Laudo de Inspeção SPDA') && !report.title.startsWith('[Auto-Salvo')) {
      reportTitle = report.title;
    } else {
      reportTitle = `Laudo SPDA - ${clientName}${activeTower && (report.client?.quantidadeTorres || 1) > 1 ? ` (${activeTower})` : ''}`;
    }
  }

  const updatedReport: SpdaReport = {
    ...report,
    id: reportId,
    title: reportTitle,
  };

  // 1. Atualiza no IndexedDB a chave específica deste laudo
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(updatedReport, `report_${reportId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // 2. Atualiza a chave ativa e bancos relacionais
  await saveReportToStorage(updatedReport);

  const totalPhotos =
    (report.spdaPhotos?.length || 0) +
    (report.measurementPhotos?.length || 0) +
    (report.quadrosPhotos?.length || 0) +
    (report.localPhotos?.length || 0) +
    (report.equipmentPhotoUrl ? 1 : 0);

  const meta: SavedReportMeta = {
    id: reportId,
    title: reportTitle,
    clientName,
    clientLocal: report.client?.local || '',
    updatedAt: now.toISOString(),
    photoCount: totalPhotos,
  };

  // 3. Atualiza o mesmo registro no índice de laudos salvos
  const list = await getSavedReportsList();
  const existingIdx = list.findIndex((item) => item.id === reportId);
  if (existingIdx >= 0) {
    list[existingIdx] = meta;
  } else {
    list.unshift(meta);
  }
  localStorage.setItem(SAVED_REPORTS_INDEX_KEY, JSON.stringify(list));

  return { ...meta, updatedReport };
}

export async function loadSavedReportById(id: string): Promise<SpdaReport | null> {
  try {
    const db = await openDatabase();
    const rep = await new Promise<SpdaReport | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(`report_${id}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (rep) {
      const sanitized = sanitizeLoadedReport(rep);
      await saveReportToStorage(sanitized);
      return sanitized;
    }

    // Se não encontrou no store legado, busca na tabela laudos do banco mestre
    const masterLaudo = await getLaudoById(id);
    if (masterLaudo) {
      const reconstructed: SpdaReport = {
        id: masterLaudo.id,
        title: masterLaudo.title,
        company: masterLaudo.company,
        client: masterLaudo.client,
        conditions: masterLaudo.conditions,
        texts: masterLaudo.texts,
        spdaPhotos: [],
        measurementPhotos: [],
        quadrosPhotos: [],
        localPhotos: [],
        torreAtual: masterLaudo.torreAtual || 'Torre 1',
        lastSyncedAt: masterLaudo.lastSyncedAt,
        lastSyncedFormatted: masterLaudo.lastSyncedFormatted,
      };

      // Carrega fotos salvas deste laudo
      const fieldPhotos = await getFieldPhotosForReport(id);
      fieldPhotos.forEach((fp) => {
        const slot: PhotoSlot = {
          id: fp.id,
          url: fp.dataUrl || (fp.blob ? URL.createObjectURL(fp.blob) : ''),
          caption: fp.caption,
          measurementValue: fp.measurementValue,
          hasRedCircleMarker: fp.hasRedCircleMarker,
          circleX: fp.circleX,
          circleY: fp.circleY,
          circleRadius: fp.circleRadius,
          diskFileName: fp.diskFileName,
          syncedAt: fp.syncedAt,
          towerName: fp.towerName,
        };
        if (fp.section === 'spda') reconstructed.spdaPhotos.push(slot);
        else if (fp.section === 'medicao') reconstructed.measurementPhotos.push(slot);
        else if (fp.section === 'quadros') reconstructed.quadrosPhotos.push(slot);
        else if (fp.section === 'local') reconstructed.localPhotos.push(slot);
      });

      return sanitizeLoadedReport(reconstructed);
    }
  } catch (e) {
    console.warn('Erro ao carregar laudo por ID', e);
  }
  return null;
}

export async function deleteSavedReportById(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(`report_${id}`);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Erro ao deletar laudo do IndexedDB:', err);
  }

  // Remove também do banco mestre
  deleteLaudoRecord(id).catch(() => {});

  try {
    const list = await getSavedReportsList();
    const filtered = list.filter((item) => item.id !== id);
    localStorage.setItem(SAVED_REPORTS_INDEX_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error('Erro ao atualizar lista no localStorage:', err);
  }
}

export async function deleteAllSavedReports(): Promise<void> {
  try {
    const list = await getSavedReportsList();
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      list.forEach((item) => {
        store.delete(`report_${item.id}`);
        deleteLaudoRecord(item.id).catch(() => {});
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Erro ao excluir todos os laudos do IndexedDB:', err);
  }

  try {
    localStorage.removeItem(SAVED_REPORTS_INDEX_KEY);
  } catch (err) {
    console.error('Erro ao limpar índice no localStorage:', err);
  }
}

/**
 * Limpa o laudo salvo ativo no IndexedDB
 */
export async function clearReportStorage(): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(REPORT_KEY);
  } catch {
    // Ignora erro
  }
}

/**
 * Carrega o laudo ativo com recuperação em cascata
 */
export async function loadReportFromStorage(): Promise<SpdaReport | null> {
  const getFromDb = async (key: string): Promise<SpdaReport | null> => {
    try {
      const db = await openDatabase();
      return await new Promise<SpdaReport | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  };

  // Nível 1: Chave ativa do IndexedDB
  let candidate = await getFromDb(REPORT_KEY);

  // Nível 2: Backup recente
  if (!candidate || !hasUserContent(candidate)) {
    const backup = await getFromDb(BACKUP_REPORT_KEY);
    if (backup && hasUserContent(backup)) {
      candidate = backup;
      await saveReportToStorage(candidate);
    }
  }

  // Nível 3: Snapshot de Emergência
  if (!candidate || !hasUserContent(candidate)) {
    const emergency = await getFromDb(EMERGENCY_RECOVERY_KEY);
    if (emergency && hasUserContent(emergency)) {
      candidate = emergency;
      await saveReportToStorage(candidate);
    }
  }

  // Nível 4: Se ainda estiver vazio, recupera o laudo mais recente de Meus Laudos
  if (!candidate || !hasUserContent(candidate)) {
    try {
      const savedList = await getSavedReportsList();
      if (savedList && savedList.length > 0) {
        const mostRecent = await loadSavedReportById(savedList[0].id);
        if (mostRecent && hasUserContent(mostRecent)) {
          candidate = mostRecent;
          await saveReportToStorage(mostRecent);
        }
      }
    } catch {
      // ignore
    }
  }

  if (candidate) {
    return sanitizeLoadedReport(candidate);
  }

  return null;
}

// Filtra fotos mock/svg legadas e limpa legendas geradas automaticamente
function sanitizeLoadedReport(report: SpdaReport): SpdaReport {
  const isSvgMock = (url?: string) => !url || url.includes('data:image/svg+xml') || url.includes('createPhotoSvg');

  const cleanPhotoSlot = (p: PhotoSlot): PhotoSlot => {
    let caption = (p.caption || '').trim();
    if (
      caption.match(/^Foto\s*(#\d+|\d+)?$/i) ||
      caption.match(/^Foto\s*Local\s*(#\d+|\d+)?$/i) ||
      caption.match(/^Quadro\s*(#\d+|\d+)?$/i) ||
      caption.match(/^Quadro\s*(de\s*(Energia|Distribuição|Luz)\s*)?(#\d+|\d+)?$/i) ||
      caption.match(/^Ponto\s*(#\d+|\d+)?$/i) ||
      caption.match(/^Ponto\s*(de\s*(Inspeção|Medição|Ensaio)\s*)?(#\d+|\d+)?$/i) ||
      caption.match(/^Medição\s*(#\d+|\d+)?$/i) ||
      caption.match(/^Inspeção\s*(#\d+|\d+)?$/i) ||
      caption.match(/^Local\s*(#\d+|\d+)?$/i)
    ) {
      caption = '';
    }
    let measurementValue = (p.measurementValue || '').trim();
    if (measurementValue === '0,18 Ω' && !caption) {
      measurementValue = '';
    }
    return {
      ...p,
      caption,
      measurementValue,
    };
  };

  const cleaned: SpdaReport = {
    ...report,
    spdaPhotos: (report.spdaPhotos || []).filter((p: PhotoSlot) => !isSvgMock(p.url)).map(cleanPhotoSlot),
    measurementPhotos: (report.measurementPhotos || []).filter((p: PhotoSlot) => !isSvgMock(p.url)).map(cleanPhotoSlot),
    quadrosPhotos: (report.quadrosPhotos || []).filter((p: PhotoSlot) => !isSvgMock(p.url)).map(cleanPhotoSlot),
    localPhotos: (report.localPhotos || []).filter((p: PhotoSlot) => !isSvgMock(p.url)).map(cleanPhotoSlot),
    equipmentPhotoUrl: isSvgMock(report.equipmentPhotoUrl) ? undefined : report.equipmentPhotoUrl,
  };

  return hydrateSyncTimestampsFromJournal(cleaned);
}

/**
 * Hidrata timestamps e nomes de arquivos de fotos já sincronizadas anteriormente no diário local.
 * Garante que fotos salvas continuem marcadas como salvas ao reabrir o aplicativo.
 */
function hydrateSyncTimestampsFromJournal(report: SpdaReport): SpdaReport {
  try {
    const journal = loadSyncJournal(report.client?.name);
    const journalFiles = journal?.files || {};
    const journalLastTime =
      journal?.lastSyncedTimestamp ||
      (journal?.lastSyncedAt ? new Date(journal.lastSyncedAt).getTime() : undefined);

    const journalFileIds = new Set<string>();
    const journalFileNames = new Set<string>();

    Object.values(journalFiles).forEach((f) => {
      if (f.photoId) journalFileIds.add(f.photoId);
      if (f.fileName) journalFileNames.add(f.fileName.toLowerCase());
    });

    const hydrateSlot = (p: PhotoSlot, idx: number): PhotoSlot => {
      const pad = String(idx + 1).padStart(2, '0');
      const defaultDiskName = `foto_${pad}.jpg`;
      const isRecordedInJournal =
        Boolean(p.syncedAt) ||
        (p.id && journalFileIds.has(p.id)) ||
        (p.diskFileName && journalFileNames.has(p.diskFileName.toLowerCase())) ||
        journalFileNames.has(defaultDiskName.toLowerCase()) ||
        Boolean(journalLastTime && p.addedAt && p.addedAt <= journalLastTime);

      if (isRecordedInJournal) {
        return {
          ...p,
          syncedAt: p.syncedAt || journalLastTime || Date.now(),
          diskFileName: p.diskFileName || defaultDiskName,
        };
      }
      return p;
    };

    const updatedTorresData = { ...(report.torresData || {}) };
    Object.entries(updatedTorresData).forEach(([tName, tData]) => {
      updatedTorresData[tName] = {
        ...tData,
        spdaPhotos: (tData.spdaPhotos || []).map((p, i) => hydrateSlot(p, i)),
        measurementPhotos: (tData.measurementPhotos || []).map((p, i) => hydrateSlot(p, i)),
        quadrosPhotos: (tData.quadrosPhotos || []).map((p, i) => hydrateSlot(p, i)),
        localPhotos: (tData.localPhotos || []).map((p, i) => hydrateSlot(p, i)),
      };
    });

    return {
      ...report,
      lastSyncedAt: report.lastSyncedAt || journalLastTime,
      lastSyncedFormatted: report.lastSyncedFormatted || journal.lastSyncedFormatted,
      spdaPhotos: (report.spdaPhotos || []).map((p, i) => hydrateSlot(p, i)),
      measurementPhotos: (report.measurementPhotos || []).map((p, i) => hydrateSlot(p, i)),
      quadrosPhotos: (report.quadrosPhotos || []).map((p, i) => hydrateSlot(p, i)),
      localPhotos: (report.localPhotos || []).map((p, i) => hydrateSlot(p, i)),
      torresData: updatedTorresData,
    };
  } catch {
    return report;
  }
}
