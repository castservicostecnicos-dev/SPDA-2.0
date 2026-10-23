/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClientData, CompanyData, InspectionConditions, TechnicalTexts, PhotoSlot, SpdaReport } from '../types/spda';

export interface CondominioRecord {
  id: string;
  nome: string;
  cnpj?: string;
  endereco: string;
  municipio?: string;
  quantidadeTorres: number;
  torresNomes: string[];
  sindico?: string;
  contato?: string;
  telefone?: string;
  email?: string;
  periodoAvaliacao?: string;
  clienteId?: string;
  totalLaudos?: number;
  totalFotos?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClientRecord {
  id: string;
  name: string;
  cnpj?: string;
  local?: string;
  municipio?: string;
  ramoAtividade?: string;
  tecnico?: string;
  cargo?: string;
  crea?: string;
  art?: string;
  contato?: string;
  telefone?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LaudoRecord {
  id: string;
  title: string;
  condominioId?: string;
  condominioNome: string;
  clienteNome: string;
  client: ClientData;
  company: CompanyData;
  conditions: InspectionConditions;
  texts: TechnicalTexts;
  torreAtual: string;
  torresNomes: string[];
  photoCount: number;
  photoSummary?: {
    spda: number;
    medicoes: number;
    quadros: number;
    local: number;
  };
  lastSyncedAt?: number;
  lastSyncedFormatted?: string;
  status: 'em_andamento' | 'concluido' | 'emitido';
  createdAt: string;
  updatedAt: string;
}

export interface PhotoRecord {
  id: string;
  reportId: string;
  condoName: string;
  towerName: string;
  section: 'spda' | 'medicao' | 'quadros' | 'local';
  photoIndex: number;
  blob?: Blob;
  dataUrl?: string;
  caption: string;
  measurementValue?: string;
  hasRedCircleMarker?: boolean;
  circleX?: number;
  circleY?: number;
  circleRadius?: number;
  diskFileName?: string;
  syncedAt?: number;
  isSyncedToFolder?: boolean;
  createdAt: number;
  updatedAt: number;
}

const MASTER_DB_NAME = 'spda_master_db_v2';
const MASTER_DB_VERSION = 1;

const STORES = {
  CONDOMINIOS: 'condominios',
  CLIENTES: 'clientes',
  LAUDOS: 'laudos',
  FOTOS_CAMPO: 'fotos_campo',
  APP_STATE: 'app_state',
} as const;

let dbInstance: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase> | null = null;

export function openMasterDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB não suportado no ambiente'));
      return;
    }

    const req = window.indexedDB.open(MASTER_DB_NAME, MASTER_DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Condomínios e seus dados
      if (!db.objectStoreNames.contains(STORES.CONDOMINIOS)) {
        const condoStore = db.createObjectStore(STORES.CONDOMINIOS, { keyPath: 'id' });
        condoStore.createIndex('nome', 'nome', { unique: false });
        condoStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 2. Clientes e seus dados
      if (!db.objectStoreNames.contains(STORES.CLIENTES)) {
        const clientStore = db.createObjectStore(STORES.CLIENTES, { keyPath: 'id' });
        clientStore.createIndex('name', 'name', { unique: false });
        clientStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 3. Laudos e seus itens técnicos
      if (!db.objectStoreNames.contains(STORES.LAUDOS)) {
        const laudoStore = db.createObjectStore(STORES.LAUDOS, { keyPath: 'id' });
        laudoStore.createIndex('condominioNome', 'condominioNome', { unique: false });
        laudoStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 4. Fotos realizadas em campo (persistência binária segura, sem travar o Chrome)
      if (!db.objectStoreNames.contains(STORES.FOTOS_CAMPO)) {
        const fotoStore = db.createObjectStore(STORES.FOTOS_CAMPO, { keyPath: 'id' });
        fotoStore.createIndex('reportId', 'reportId', { unique: false });
        fotoStore.createIndex('condoName', 'condoName', { unique: false });
        fotoStore.createIndex('towerName', 'towerName', { unique: false });
        fotoStore.createIndex('section', 'section', { unique: false });
        fotoStore.createIndex('reportSection', ['reportId', 'towerName', 'section'], { unique: false });
        fotoStore.createIndex('syncedAt', 'syncedAt', { unique: false });
      }

      // 5. Estado da aplicação
      if (!db.objectStoreNames.contains(STORES.APP_STATE)) {
        db.createObjectStore(STORES.APP_STATE, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      dbInstance.onclose = () => {
        dbInstance = null;
        dbOpenPromise = null;
      };
      resolve(dbInstance);
    };

    req.onerror = () => {
      dbOpenPromise = null;
      reject(req.error);
    };
  });

  return dbOpenPromise;
}

// ============================================================================
// CONDOMÍNIOS - CRUD & GERENCIAMENTO
// ============================================================================

export async function getAllCondominios(): Promise<CondominioRecord[]> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CONDOMINIOS, 'readonly');
    const store = tx.objectStore(STORES.CONDOMINIOS);
    const req = store.getAll();
    req.onsuccess = () => {
      const list: CondominioRecord[] = req.result || [];
      list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getCondominioById(id: string): Promise<CondominioRecord | null> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CONDOMINIOS, 'readonly');
    const req = tx.objectStore(STORES.CONDOMINIOS).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCondominio(condo: Partial<CondominioRecord> & { nome: string }): Promise<CondominioRecord> {
  const db = await openMasterDatabase();
  const now = new Date().toISOString();
  const id = condo.id || `condo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const record: CondominioRecord = {
    id,
    nome: condo.nome.trim(),
    cnpj: condo.cnpj?.trim() || '',
    endereco: condo.endereco?.trim() || '',
    municipio: condo.municipio?.trim() || '',
    quantidadeTorres: Math.max(1, condo.quantidadeTorres || 1),
    torresNomes: condo.torresNomes && condo.torresNomes.length > 0
      ? condo.torresNomes
      : Array.from({ length: condo.quantidadeTorres || 1 }, (_, i) => `Torre ${i + 1}`),
    sindico: condo.sindico?.trim() || '',
    contato: condo.contato?.trim() || '',
    telefone: condo.telefone?.trim() || '',
    email: condo.email?.trim() || '',
    periodoAvaliacao: condo.periodoAvaliacao?.trim() || '',
    clienteId: condo.clienteId || undefined,
    totalLaudos: condo.totalLaudos || 0,
    totalFotos: condo.totalFotos || 0,
    createdAt: condo.createdAt || now,
    updatedAt: now,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.CONDOMINIOS, 'readwrite');
    tx.objectStore(STORES.CONDOMINIOS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return record;
}

export async function deleteCondominio(id: string): Promise<void> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CONDOMINIOS, 'readwrite');
    tx.objectStore(STORES.CONDOMINIOS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Sincroniza dados do condomínio a partir dos dados do cliente do laudo
export async function syncCondominioFromReport(report: SpdaReport): Promise<CondominioRecord | null> {
  const condoName = report.client?.name?.trim();
  if (!condoName) return null;

  const all = await getAllCondominios();
  const existing = all.find(
    (c) => c.nome.toLowerCase() === condoName.toLowerCase() || (report.id && c.id === report.id)
  );

  const qtdTorres = report.client.quantidadeTorres || 1;
  const torresNomes = report.client.torresNomes && report.client.torresNomes.length > 0
    ? report.client.torresNomes
    : Array.from({ length: qtdTorres }, (_, i) => `Torre ${i + 1}`);

  return await saveCondominio({
    id: existing?.id,
    nome: condoName,
    cnpj: report.client.cnpj,
    endereco: report.client.local,
    municipio: report.client.municipio,
    quantidadeTorres: qtdTorres,
    torresNomes,
    periodoAvaliacao: report.client.periodoAvaliacao,
    totalLaudos: (existing?.totalLaudos || 0) + 1,
  });
}

// ============================================================================
// CLIENTES - CRUD & GERENCIAMENTO
// ============================================================================

export async function getAllClientes(): Promise<ClientRecord[]> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CLIENTES, 'readonly');
    const store = tx.objectStore(STORES.CLIENTES);
    const req = store.getAll();
    req.onsuccess = () => {
      const list: ClientRecord[] = req.result || [];
      list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getClienteById(id: string): Promise<ClientRecord | null> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CLIENTES, 'readonly');
    const req = tx.objectStore(STORES.CLIENTES).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCliente(client: Partial<ClientRecord> & { name: string }): Promise<ClientRecord> {
  const db = await openMasterDatabase();
  const now = new Date().toISOString();
  const id = client.id || `cli-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const record: ClientRecord = {
    id,
    name: client.name.trim(),
    cnpj: client.cnpj?.trim() || '',
    local: client.local?.trim() || '',
    municipio: client.municipio?.trim() || '',
    ramoAtividade: client.ramoAtividade?.trim() || '',
    tecnico: client.tecnico?.trim() || '',
    cargo: client.cargo?.trim() || '',
    crea: client.crea?.trim() || '',
    art: client.art?.trim() || '',
    contato: client.contato?.trim() || '',
    telefone: client.telefone?.trim() || '',
    email: client.email?.trim() || '',
    createdAt: client.createdAt || now,
    updatedAt: now,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.CLIENTES, 'readwrite');
    tx.objectStore(STORES.CLIENTES).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return record;
}

export async function deleteCliente(id: string): Promise<void> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CLIENTES, 'readwrite');
    tx.objectStore(STORES.CLIENTES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
// LAUDOS E SEUS ITENS - CRUD & GERENCIAMENTO
// ============================================================================

export async function getAllLaudos(): Promise<LaudoRecord[]> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LAUDOS, 'readonly');
    const store = tx.objectStore(STORES.LAUDOS);
    const req = store.getAll();
    req.onsuccess = () => {
      const list: LaudoRecord[] = req.result || [];
      list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLaudoById(id: string): Promise<LaudoRecord | null> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LAUDOS, 'readonly');
    const req = tx.objectStore(STORES.LAUDOS).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLaudoRecord(report: SpdaReport): Promise<LaudoRecord> {
  const db = await openMasterDatabase();
  const now = new Date().toISOString();
  const id = report.id || `laudo-spda-${Date.now()}`;
  const condoName = report.client?.name?.trim() || 'Condomínio';

  const totalPhotos =
    (report.spdaPhotos?.length || 0) +
    (report.measurementPhotos?.length || 0) +
    (report.quadrosPhotos?.length || 0) +
    (report.localPhotos?.length || 0) +
    (report.equipmentPhotoUrl ? 1 : 0);

  const photoSummary = {
    spda: report.spdaPhotos?.length || 0,
    medicoes: report.measurementPhotos?.length || 0,
    quadros: report.quadrosPhotos?.length || 0,
    local: report.localPhotos?.length || 0,
  };

  const record: LaudoRecord = {
    id,
    title: report.title || `Laudo SPDA - ${condoName}`,
    condominioNome: condoName,
    clienteNome: condoName,
    client: report.client,
    company: report.company,
    conditions: report.conditions,
    texts: report.texts,
    torreAtual: report.torreAtual || 'Torre 1',
    torresNomes: report.client?.torresNomes || ['Torre 1'],
    photoCount: totalPhotos,
    photoSummary,
    lastSyncedAt: report.lastSyncedAt,
    lastSyncedFormatted: report.lastSyncedFormatted,
    status: 'em_andamento',
    createdAt: now,
    updatedAt: now,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.LAUDOS, 'readwrite');
    tx.objectStore(STORES.LAUDOS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Mantém os cadastros de condomínio e cliente atualizados em segundo plano
  syncCondominioFromReport(report).catch(() => {});
  if (report.client?.name) {
    saveCliente({
      name: report.client.name,
      cnpj: report.client.cnpj,
      local: report.client.local,
      municipio: report.client.municipio,
      ramoAtividade: report.client.ramoAtividade,
      tecnico: report.client.tecnico,
      cargo: report.client.cargo,
      crea: report.client.crea,
      art: report.client.art,
    }).catch(() => {});
  }

  return record;
}

export async function deleteLaudoRecord(id: string): Promise<void> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.LAUDOS, STORES.FOTOS_CAMPO], 'readwrite');
    tx.objectStore(STORES.LAUDOS).delete(id);

    // Opcionalmente remove fotos vinculadas a este laudo
    const photoStore = tx.objectStore(STORES.FOTOS_CAMPO);
    const index = photoStore.index('reportId');
    const req = index.openCursor(IDBKeyRange.only(id));
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
// FOTOS REALIZADAS EM CAMPO - ARMAZENAMENTO SEPARADO E BLOB BINÁRIO
// ============================================================================

/**
 * Converte base64 DataURL para Blob binário nativo
 */
export async function dataUrlToBlobAsync(dataUrl: string): Promise<Blob> {
  if (dataUrl.startsWith('data:')) {
    try {
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch {
      // Fallback
    }
  }
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(parts[1] || '');
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

export async function saveFieldPhoto(photo: {
  id: string;
  reportId: string;
  condoName: string;
  towerName: string;
  section: 'spda' | 'medicao' | 'quadros' | 'local';
  photoIndex: number;
  dataUrl?: string;
  blob?: Blob;
  caption?: string;
  measurementValue?: string;
  hasRedCircleMarker?: boolean;
  circleX?: number;
  circleY?: number;
  circleRadius?: number;
  diskFileName?: string;
  syncedAt?: number;
}): Promise<PhotoRecord> {
  const db = await openMasterDatabase();
  const now = Date.now();

  let blob = photo.blob;
  if (!blob && photo.dataUrl) {
    blob = await dataUrlToBlobAsync(photo.dataUrl);
  }

  const record: PhotoRecord = {
    id: photo.id,
    reportId: photo.reportId,
    condoName: photo.condoName,
    towerName: photo.towerName,
    section: photo.section,
    photoIndex: photo.photoIndex,
    blob,
    dataUrl: photo.dataUrl,
    caption: photo.caption || '',
    measurementValue: photo.measurementValue || '',
    hasRedCircleMarker: photo.hasRedCircleMarker,
    circleX: photo.circleX,
    circleY: photo.circleY,
    circleRadius: photo.circleRadius,
    diskFileName: photo.diskFileName,
    syncedAt: photo.syncedAt,
    isSyncedToFolder: Boolean(photo.syncedAt),
    createdAt: now,
    updatedAt: now,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.FOTOS_CAMPO, 'readwrite');
    tx.objectStore(STORES.FOTOS_CAMPO).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return record;
}

export async function saveFieldPhotosBatch(photos: Array<Parameters<typeof saveFieldPhoto>[0]>): Promise<void> {
  const db = await openMasterDatabase();
  const now = Date.now();

  const prepared: PhotoRecord[] = [];
  for (const p of photos) {
    let blob = p.blob;
    if (!blob && p.dataUrl) {
      blob = await dataUrlToBlobAsync(p.dataUrl);
    }
    prepared.push({
      id: p.id,
      reportId: p.reportId,
      condoName: p.condoName,
      towerName: p.towerName,
      section: p.section,
      photoIndex: p.photoIndex,
      blob,
      dataUrl: p.dataUrl,
      caption: p.caption || '',
      measurementValue: p.measurementValue || '',
      hasRedCircleMarker: p.hasRedCircleMarker,
      circleX: p.circleX,
      circleY: p.circleY,
      circleRadius: p.circleRadius,
      diskFileName: p.diskFileName,
      syncedAt: p.syncedAt,
      isSyncedToFolder: Boolean(p.syncedAt),
      createdAt: now,
      updatedAt: now,
    });
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.FOTOS_CAMPO, 'readwrite');
    const store = tx.objectStore(STORES.FOTOS_CAMPO);
    prepared.forEach((item) => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getFieldPhotosForReport(reportId: string): Promise<PhotoRecord[]> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.FOTOS_CAMPO, 'readonly');
    const store = tx.objectStore(STORES.FOTOS_CAMPO);
    const index = store.index('reportId');
    const req = index.getAll(IDBKeyRange.only(reportId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllFieldPhotos(): Promise<PhotoRecord[]> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.FOTOS_CAMPO, 'readonly');
    const store = tx.objectStore(STORES.FOTOS_CAMPO);
    const req = store.getAll();
    req.onsuccess = () => {
      const list: PhotoRecord[] = req.result || [];
      list.sort((a, b) => b.createdAt - a.createdAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function markPhotoAsSynced(photoId: string, diskFileName?: string): Promise<void> {
  const db = await openMasterDatabase();
  const tx = db.transaction(STORES.FOTOS_CAMPO, 'readwrite');
  const store = tx.objectStore(STORES.FOTOS_CAMPO);
  const req = store.get(photoId);

  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const photo: PhotoRecord = req.result;
      if (photo) {
        photo.syncedAt = Date.now();
        photo.isSyncedToFolder = true;
        if (diskFileName) photo.diskFileName = diskFileName;
        store.put(photo);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFieldPhoto(photoId: string): Promise<void> {
  const db = await openMasterDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.FOTOS_CAMPO, 'readwrite');
    tx.objectStore(STORES.FOTOS_CAMPO).delete(photoId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
// ESTATÍSTICAS E INFORMAÇÕES DO BANCO DE DADOS
// ============================================================================

export interface DatabaseStats {
  totalCondos: number;
  totalClientes: number;
  totalLaudos: number;
  totalFotos: number;
  unsyncedFotos: number;
  storageUsageEstimateMB: number;
}

export async function getDatabaseStats(): Promise<DatabaseStats> {
  try {
    const [condos, clientes, laudos, fotos] = await Promise.all([
      getAllCondominios(),
      getAllClientes(),
      getAllLaudos(),
      getAllFieldPhotos(),
    ]);

    const unsynced = fotos.filter((f) => !f.isSyncedToFolder && !f.syncedAt).length;

    let estimateBytes = 0;
    if (typeof navigator !== 'undefined' && (navigator as any).storage?.estimate) {
      try {
        const est = await (navigator as any).storage.estimate();
        estimateBytes = est.usage || 0;
      } catch {}
    }

    const mb = estimateBytes > 0
      ? Math.round((estimateBytes / (1024 * 1024)) * 10) / 10
      : Math.round(fotos.length * 0.35 * 10) / 10;

    return {
      totalCondos: condos.length,
      totalClientes: clientes.length,
      totalLaudos: laudos.length,
      totalFotos: fotos.length,
      unsyncedFotos: unsynced,
      storageUsageEstimateMB: mb,
    };
  } catch {
    return {
      totalCondos: 0,
      totalClientes: 0,
      totalLaudos: 0,
      totalFotos: 0,
      unsyncedFotos: 0,
      storageUsageEstimateMB: 0,
    };
  }
}
