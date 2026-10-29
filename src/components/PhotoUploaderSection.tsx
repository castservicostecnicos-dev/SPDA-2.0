import React, { useRef, useState, useEffect } from 'react';
import { PhotoSlot, SpdaReport } from '../types/spda';
import {
  Upload,
  Zap,
  Gauge,
  Layers,
  Building,
  Building2,
  Plus,
  Trash2,
  Image as ImageIcon,
  Target,
  Camera,
  FolderUp,
  Archive,
  FolderCheck,
  FolderSync,
  HardDrive,
  Download,
  Check,
  RefreshCw,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { CircleFocusModal } from './CircleFocusModal';
import { SelectTowerModal } from './SelectTowerModal';
import { RestorePhotosModal } from './RestorePhotosModal';
import { CameraCaptureModal } from './CameraCaptureModal';
import { RealFoldersSyncModal } from './RealFoldersSyncModal';
import { optimizeImageFile, optimizeImageFileToBlob, optimizeHighFidelityPhoto } from '../utils/imageOptimizer';
import { saveFieldPhoto } from '../db/spdaDatabase';
import {
  downloadAllPhotosAsOrganizedZip,
  pickAndConnectDeviceFolder,
  getConnectedDeviceFolderHandle,
  getStoredDeviceFolderInfo,
  disconnectDeviceFolder,
  hasDirectoryPickerSupport,
  getSectionSubfolderName,
  saveSinglePhotoToDisk,
  deletePhotoFromDisk,
  createCondoFolderTree,
  BatchPhotoSaveItem,
} from '../utils/photoDeviceSync';
import { countOrphanPhotos } from '../utils/towerSorter';

/**
 * Lê o arquivo de imagem otimizando para uma resolução nítida de alta fidelidade (máx 1600px)
 * sem cortar nada e preservando 100% da proporção original.
 * Utilizado para miliohmímetro, vista aérea e fachada do condomínio, evitando estouro de RAM no Chrome mobile.
 */
async function readSafeHighQualityPhotoUrl(file: File): Promise<string> {
  try {
    const res = await optimizeHighFidelityPhoto(file, 1600, 0.85);
    return res.dataUrl;
  } catch (err) {
    console.warn('Fallback para otimizador seguro:', err);
    return optimizeImageFile(file, 1280, 1280, 0.82);
  }
}

interface PhotoUploaderSectionProps {
  spdaPhotos: PhotoSlot[];
  measurementPhotos: PhotoSlot[];
  quadrosPhotos: PhotoSlot[];
  localPhotos: PhotoSlot[];
  equipmentPhotoUrl?: string;
  onUpdateSpdaPhotos: (photos: PhotoSlot[]) => void;
  onUpdateMeasurementPhotos: (photos: PhotoSlot[]) => void;
  onUpdateQuadrosPhotos: (photos: PhotoSlot[]) => void;
  onUpdateLocalPhotos: (photos: PhotoSlot[]) => void;
  onUpdateEquipmentPhoto: (url: string) => void;
  // Multi-Tower support
  quantidadeTorres?: number;
  torresNomes?: string[];
  torreAtual?: string;
  onSelectTorre?: (torre: string) => void;
  onAddTower?: (nome?: string) => void;
  onDeleteTower?: (torre: string) => void;
  onPurgeOrphans?: () => void;
  getTowerPhotoCount?: (torre: string) => number;
  condominioNome?: string;
  // Backup & Restore
  report?: SpdaReport;
  onRestoreReport?: (report: SpdaReport) => void;
  onReportUpdated?: (report: SpdaReport) => void;
}

export const PhotoUploaderSection: React.FC<PhotoUploaderSectionProps> = ({
  spdaPhotos,
  measurementPhotos,
  quadrosPhotos,
  localPhotos,
  equipmentPhotoUrl,
  onUpdateSpdaPhotos,
  onUpdateMeasurementPhotos,
  onUpdateQuadrosPhotos,
  onUpdateLocalPhotos,
  onUpdateEquipmentPhoto,
  quantidadeTorres = 1,
  torresNomes,
  torreAtual = 'Torre 1',
  onSelectTorre,
  onAddTower,
  onDeleteTower,
  onPurgeOrphans,
  getTowerPhotoCount,
  condominioNome,
  report,
  onRestoreReport,
  onReportUpdated,
}) => {
  const [activeSection, setActiveSection] = useState<'spda' | 'medicao' | 'quadros' | 'local'>('spda');
  const [isTowerModalOpen, setIsTowerModalOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [exportZipMsg, setExportZipMsg] = useState('');
  const [connectedFolderName, setConnectedFolderName] = useState<string | null>(null);
  const [deviceSyncToast, setDeviceSyncToast] = useState<string | null>(null);
  const [focusModalData, setFocusModalData] = useState<{
    photo: PhotoSlot;
    index: number;
    type: 'spda' | 'medicao' | 'quadros';
  } | null>(null);

  const [isRealFoldersModalOpen, setIsRealFoldersModalOpen] = useState(false);

  const spdaPhotosRef = useRef(spdaPhotos);
  spdaPhotosRef.current = spdaPhotos;
  const measurementPhotosRef = useRef(measurementPhotos);
  measurementPhotosRef.current = measurementPhotos;
  const quadrosPhotosRef = useRef(quadrosPhotos);
  quadrosPhotosRef.current = quadrosPhotos;
  const localPhotosRef = useRef(localPhotos);
  localPhotosRef.current = localPhotos;

  const handleOpenCamera = (section?: 'spda' | 'medicao' | 'quadros' | 'local') => {
    if (section) setActiveSection(section);
    setIsCameraModalOpen(true);
  };

  const handlePhotoCapturedFromCamera = (photoSlot: PhotoSlot, section: 'spda' | 'medicao' | 'quadros' | 'local') => {
    if (section === 'spda') {
      const next = [...spdaPhotosRef.current, photoSlot];
      spdaPhotosRef.current = next;
      onUpdateSpdaPhotos(next);
    } else if (section === 'medicao') {
      const next = [...measurementPhotosRef.current, photoSlot];
      measurementPhotosRef.current = next;
      onUpdateMeasurementPhotos(next);
    } else if (section === 'quadros') {
      const next = [...quadrosPhotosRef.current, photoSlot];
      quadrosPhotosRef.current = next;
      onUpdateQuadrosPhotos(next);
    } else if (section === 'local') {
      const next = [...localPhotosRef.current, photoSlot];
      localPhotosRef.current = next;
      onUpdateLocalPhotos(next);
    }
  };

  // Atualiza as fotos com syncedAt e diskFileName quando salvas no disco após clicar em "Concluir"
  const handlePhotosSavedToDisk = (savedItems: BatchPhotoSaveItem[]) => {
    const savedMap = new Map<string, { syncedAt: number; diskFileName?: string }>();
    savedItems.forEach((it) => {
      savedMap.set(it.photo.id, {
        syncedAt: it.photo.syncedAt || Date.now(),
        diskFileName: it.photo.diskFileName,
      });
    });

    const updateList = (list: PhotoSlot[]) =>
      list.map((p) => {
        const s = savedMap.get(p.id);
        if (s) {
          return { ...p, syncedAt: s.syncedAt, diskFileName: s.diskFileName || p.diskFileName };
        }
        return p;
      });

    const nextSpda = updateList(spdaPhotosRef.current);
    const nextMedicao = updateList(measurementPhotosRef.current);
    const nextQuadros = updateList(quadrosPhotosRef.current);
    const nextLocal = updateList(localPhotosRef.current);

    spdaPhotosRef.current = nextSpda;
    measurementPhotosRef.current = nextMedicao;
    quadrosPhotosRef.current = nextQuadros;
    localPhotosRef.current = nextLocal;

    onUpdateSpdaPhotos(nextSpda);
    onUpdateMeasurementPhotos(nextMedicao);
    onUpdateQuadrosPhotos(nextQuadros);
    onUpdateLocalPhotos(nextLocal);

    if (report && onReportUpdated) {
      const currentTower = torreAtual || 'Torre 1';
      const updatedTorresData = { ...(report.torresData || {}) };
      updatedTorresData[currentTower] = {
        ...(updatedTorresData[currentTower] || {
          id: currentTower.toLowerCase().replace(/\s+/g, '-'),
          nome: currentTower,
          spdaPhotos: [],
          measurementPhotos: [],
          quadrosPhotos: [],
          localPhotos: [],
        }),
        spdaPhotos: nextSpda,
        measurementPhotos: nextMedicao,
        quadrosPhotos: nextQuadros,
        localPhotos: nextLocal,
      };

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

      const updatedRep: SpdaReport = {
        ...report,
        lastSyncedAt: now.getTime(),
        lastSyncedFormatted: timeFormatted,
        spdaPhotos: nextSpda,
        measurementPhotos: nextMedicao,
        quadrosPhotos: nextQuadros,
        localPhotos: nextLocal,
        torresData: updatedTorresData,
      };
      onReportUpdated(updatedRep);
    }

    showSyncToast(`✓ ${savedItems.length} foto(s) salvas no disco físico e marcadas com sucesso!`);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const equipInputRef = useRef<HTMLInputElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const aerialInputRef = useRef<HTMLInputElement>(null);
  const facadeInputRef = useRef<HTMLInputElement>(null);

  // Verifica se já existe uma pasta do celular conectada via File System Access API
  useEffect(() => {
    getStoredDeviceFolderInfo()
      .then((info) => {
        if (info.folderName) {
          setConnectedFolderName(info.folderName);
        }
      })
      .catch(() => {});
  }, []);

  const showSyncToast = (msg: string) => {
    setDeviceSyncToast(msg);
    setTimeout(() => setDeviceSyncToast(null), 4500);
  };

  const handleConnectFolder = () => {
    setIsRealFoldersModalOpen(true);
  };

  const handleDisconnectFolder = async () => {
    await disconnectDeviceFolder();
    setConnectedFolderName(null);
    showSyncToast('Conexão com a pasta do celular desfeita.');
  };

  const handleExportZip = async () => {
    if (!report) {
      showSyncToast('Nenhum laudo ativo para exportar fotos.');
      return;
    }
    setIsExportingZip(true);
    setExportZipMsg('Preparando fotos de todas as torres...');

    try {
      const res = await downloadAllPhotosAsOrganizedZip(report, (_pct, msg) => {
        setExportZipMsg(msg);
      });
      showSyncToast(`Backup baixado com sucesso: ${res.totalPhotos} fotos em pastas separadas por torre!`);
    } catch (err: any) {
      console.error(err);
      showSyncToast(err?.message || 'Erro ao gerar backup ZIP.');
    } finally {
      setIsExportingZip(false);
    }
  };

  // Helper to append new photos dynamically with compression and auto-save into device folder
  const handleAddNewPhotos = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'spda' | 'medicao' | 'quadros'
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files);
    const newItems: PhotoSlot[] = [];
    const currentCount =
      type === 'spda'
        ? spdaPhotos.length
        : type === 'medicao'
        ? measurementPhotos.length
        : quadrosPhotos.length;

    for (let fIndex = 0; fIndex < filesArray.length; fIndex++) {
      const file = filesArray[fIndex];
      try {
        const optimized = await optimizeImageFileToBlob(file, 1280, 1280, 0.8);
        const photoIndex = currentCount + fIndex;
        const padIndex = String(photoIndex + 1).padStart(2, '0');
        const diskFileName = `foto_${padIndex}.jpg`;
        const slotId = `photo-${Date.now()}-${fIndex}-${Math.random().toString(36).substring(2, 7)}`;

        const slot: PhotoSlot = {
          id: slotId,
          url: optimized.dataUrl,
          caption: '', // Legenda vazia por padrão (preenchimento opcional)
          hasRedCircleMarker: type === 'spda',
          circleX: 50,
          circleY: 50,
          circleRadius: 24,
          measurementValue: '', // Medição vazia por padrão (preenchimento opcional)
          towerName: torreAtual,
          addedAt: Date.now(),
          diskFileName,
        };

        // Salva com persistência binária direta no banco de fotos de campo
        saveFieldPhoto({
          id: slotId,
          reportId: 'current',
          condoName: condominioNome || 'Condomínio',
          towerName: torreAtual,
          section: type,
          photoIndex,
          blob: optimized.blob,
          dataUrl: optimized.dataUrl,
          diskFileName,
          hasRedCircleMarker: type === 'spda',
          circleX: 50,
          circleY: 50,
          circleRadius: 24,
        }).catch(() => {});

        // Salva na pasta do disco se estiver conectada
        try {
          const diskRes = await saveSinglePhotoToDisk(optimized.dataUrl, {
            condoName: condominioNome,
            towerName: torreAtual,
            section: type,
            photoIndex,
            diskFileName,
            photoId: slotId,
          });
          if (diskRes.success) {
            slot.syncedAt = Date.now();
          }
        } catch {
          // ignore
        }

        newItems.push(slot);
      } catch (err) {
        console.error('Erro ao otimizar foto', err);
      }
    }

    if (newItems.length > 0) {
      if (type === 'spda') {
        onUpdateSpdaPhotos([...spdaPhotos, ...newItems]);
      } else if (type === 'medicao') {
        onUpdateMeasurementPhotos([...measurementPhotos, ...newItems]);
      } else if (type === 'quadros') {
        onUpdateQuadrosPhotos([...quadrosPhotos, ...newItems]);
      }
      showSyncToast(`✓ ${newItems.length} foto(s) adicionada(s) e salvas no banco de dados!`);
    }

    if (e.target) e.target.value = '';
  };

  // Helper to append new local photo with compression and auto-save
  const handleAddNewLocalPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const optimized = await optimizeImageFileToBlob(file, 1280, 1280, 0.8);
      const photoIndex = localPhotos.length;
      const padIndex = String(photoIndex + 1).padStart(2, '0');
      const diskFileName = `foto_${padIndex}.jpg`;
      const slotId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      const slot: PhotoSlot = {
        id: slotId,
        url: optimized.dataUrl,
        caption: '', // Legenda vazia por padrão (preenchimento opcional)
        towerName: torreAtual,
        addedAt: Date.now(),
        diskFileName,
      };

      saveFieldPhoto({
        id: slotId,
        reportId: 'current',
        condoName: condominioNome || 'Condomínio',
        towerName: torreAtual,
        section: 'local',
        photoIndex,
        blob: optimized.blob,
        dataUrl: optimized.dataUrl,
        diskFileName,
      }).catch(() => {});

      try {
        const diskRes = await saveSinglePhotoToDisk(optimized.dataUrl, {
          condoName: condominioNome,
          towerName: torreAtual,
          section: 'local',
          photoIndex,
          diskFileName,
          photoId: slotId,
        });
        if (diskRes.success) slot.syncedAt = Date.now();
      } catch {
        // ignore
      }

      onUpdateLocalPhotos([...localPhotos, slot]);
      showSyncToast(`✓ Foto do local salva no banco de dados e na pasta!`);
    } catch (err) {
      console.error('Erro ao otimizar foto local', err);
    }

    if (e.target) e.target.value = '';
  };

  // Helper to replace single photo with compression
  const handleReplacePhoto = async (
    e: React.ChangeEvent<HTMLInputElement>,
    index: number,
    type: 'spda' | 'medicao' | 'quadros' | 'local'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await optimizeImageFile(file);
      if (type === 'spda') {
        const copy = [...spdaPhotos];
        copy[index] = { ...copy[index], url, caption: '', updatedAt: Date.now(), syncedAt: undefined };
        onUpdateSpdaPhotos(copy);
      } else if (type === 'medicao') {
        const copy = [...measurementPhotos];
        copy[index] = { ...copy[index], url, caption: '', updatedAt: Date.now(), syncedAt: undefined };
        onUpdateMeasurementPhotos(copy);
      } else if (type === 'quadros') {
        const copy = [...quadrosPhotos];
        copy[index] = { ...copy[index], url, caption: '', updatedAt: Date.now(), syncedAt: undefined };
        onUpdateQuadrosPhotos(copy);
      } else if (type === 'local') {
        const copy = [...localPhotos];
        copy[index] = { ...copy[index], url, caption: '', updatedAt: Date.now(), syncedAt: undefined };
        onUpdateLocalPhotos(copy);
      }
    } catch (err) {
      console.error('Erro ao substituir foto', err);
    }

    if (e.target) e.target.value = '';
  };

  // Direct click on thumbnail to move circle
  const handleDirectClickCircle = (
    e: React.MouseEvent<HTMLDivElement>,
    index: number,
    type: 'spda' | 'medicao' | 'quadros'
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rawX = Math.round(Math.max(8, Math.min(92, ((e.clientX - rect.left) / rect.width) * 100)));
    const rawY = Math.round(Math.max(8, Math.min(92, ((e.clientY - rect.top) / rect.height) * 100)));

    if (type === 'spda') {
      const copy = [...spdaPhotos];
      copy[index] = { ...copy[index], hasRedCircleMarker: true, circleX: rawX, circleY: rawY };
      onUpdateSpdaPhotos(copy);
    } else if (type === 'medicao') {
      const copy = [...measurementPhotos];
      copy[index] = { ...copy[index], hasRedCircleMarker: true, circleX: rawX, circleY: rawY };
      onUpdateMeasurementPhotos(copy);
    } else if (type === 'quadros') {
      const copy = [...quadrosPhotos];
      copy[index] = { ...copy[index], hasRedCircleMarker: true, circleX: rawX, circleY: rawY };
      onUpdateQuadrosPhotos(copy);
    }
  };

  const [photoToDelete, setPhotoToDelete] = useState<{
    photo: PhotoSlot;
    index: number;
    type: 'spda' | 'medicao' | 'quadros' | 'local';
    tower: string;
  } | null>(null);

  // Solicita exclusão com confirmação obrigatória e remoção do arquivo físico na pasta
  const handleDeletePhoto = (index: number, type: 'spda' | 'medicao' | 'quadros' | 'local') => {
    let targetPhoto: PhotoSlot | undefined;
    if (type === 'spda') targetPhoto = spdaPhotos[index];
    else if (type === 'medicao') targetPhoto = measurementPhotos[index];
    else if (type === 'quadros') targetPhoto = quadrosPhotos[index];
    else if (type === 'local') targetPhoto = localPhotos[index];

    if (!targetPhoto) return;

    setPhotoToDelete({
      photo: targetPhoto,
      index,
      type,
      tower: targetPhoto.towerName || torreAtual,
    });
  };

  const handleConfirmDeletePhoto = async () => {
    if (!photoToDelete) return;
    const { photo, index, type, tower } = photoToDelete;

    // 1. Exclui o arquivo físico correspondente da pasta do aparelho
    try {
      await deletePhotoFromDisk({
        condoName: condominioNome,
        towerName: tower,
        section: type,
        photoIndex: index,
        diskFileName: photo.diskFileName,
        caption: photo.caption,
        measurementValue: photo.measurementValue,
      });
    } catch (err) {
      console.warn('Erro ao excluir do disco:', err);
    }

    // 2. Remove do estado na tela
    if (type === 'spda') {
      onUpdateSpdaPhotos(spdaPhotos.filter((_, i) => i !== index));
    } else if (type === 'medicao') {
      onUpdateMeasurementPhotos(measurementPhotos.filter((_, i) => i !== index));
    } else if (type === 'quadros') {
      onUpdateQuadrosPhotos(quadrosPhotos.filter((_, i) => i !== index));
    } else if (type === 'local') {
      onUpdateLocalPhotos(localPhotos.filter((_, i) => i !== index));
    }

    setPhotoToDelete(null);
    showSyncToast(`✓ Foto #${index + 1} excluída do laudo e da pasta em ${tower}!`);
  };

  // Delete equipment photo
  const handleDeleteEquipmentPhoto = () => {
    onUpdateEquipmentPhoto('');
  };

  const [confirmClearType, setConfirmClearType] = useState<'all' | 'spda' | 'medicao' | 'quadros' | 'local' | null>(null);

  // Clear all photos in a category
  const handleClearSection = (type: 'spda' | 'medicao' | 'quadros' | 'local') => {
    if (type === 'spda') onUpdateSpdaPhotos([]);
    if (type === 'medicao') onUpdateMeasurementPhotos([]);
    if (type === 'quadros') onUpdateQuadrosPhotos([]);
    if (type === 'local') onUpdateLocalPhotos([]);
    setConfirmClearType(null);
  };

  // Save changes from CircleFocusModal
  const handleSaveCircleModal = (updated: Partial<PhotoSlot>) => {
    if (!focusModalData) return;
    const { index, type } = focusModalData;

    if (type === 'spda') {
      const copy = [...spdaPhotos];
      copy[index] = { ...copy[index], ...updated, updatedAt: Date.now() };
      onUpdateSpdaPhotos(copy);
    } else if (type === 'medicao') {
      const copy = [...measurementPhotos];
      copy[index] = { ...copy[index], ...updated, updatedAt: Date.now() };
      onUpdateMeasurementPhotos(copy);
    } else if (type === 'quadros') {
      const copy = [...quadrosPhotos];
      copy[index] = { ...copy[index], ...updated, updatedAt: Date.now() };
      onUpdateQuadrosPhotos(copy);
    }
  };

  const totalPhotos = spdaPhotos.length + measurementPhotos.length + quadrosPhotos.length + localPhotos.length + (equipmentPhotoUrl ? 1 : 0);

  const torresList = React.useMemo(() => {
    if (torresNomes && torresNomes.length > 0) return torresNomes.slice(0, quantidadeTorres);
    const list: string[] = [];
    for (let i = 1; i <= (quantidadeTorres || 1); i++) {
      list.push(`Torre ${i}`);
    }
    return list;
  }, [torresNomes, quantidadeTorres]);

  // Regra da solicitação do usuário: Fotos da fachada, vista aérea e miliohmímetro
  // aparecem APENAS na Torre 1. Quando houver mais de uma torre, não exibe nas demais torres.
  const isMultiTower = (quantidadeTorres && quantidadeTorres > 1) || (torresNomes && torresNomes.length > 1) || (torresList && torresList.length > 1);
  const isTorre1 = !torreAtual || torreAtual === 'Torre 1' || (torresList.length > 0 && torreAtual === torresList[0]);
  const shouldShowCondoAndEquipment = !isMultiTower || isTorre1;

  useEffect(() => {
    if (!shouldShowCondoAndEquipment && activeSection === 'local') {
      setActiveSection('spda');
    }
  }, [shouldShowCondoAndEquipment, activeSection]);

  const handleClearAllPhotos = () => {
    onUpdateSpdaPhotos([]);
    onUpdateMeasurementPhotos([]);
    onUpdateQuadrosPhotos([]);
    onUpdateLocalPhotos([]);
    onUpdateEquipmentPhoto('');
    setConfirmClearType(null);
  };

  const currentTowerPhotos =
    spdaPhotos.length +
    measurementPhotos.length +
    quadrosPhotos.length +
    localPhotos.length;

  const currentTowerIdx = torresList.indexOf(torreAtual || 'Torre 1');
  const hasNextExistingTower = currentTowerIdx >= 0 && currentTowerIdx < torresList.length - 1;
  const nextExistingTowerName = hasNextExistingTower ? torresList[currentTowerIdx + 1] : null;
  const nextNewTowerName = `Torre ${torresList.length + 1}`;

  const handleAdvanceNextTower = () => {
    if (hasNextExistingTower && nextExistingTowerName) {
      onSelectTorre?.(nextExistingTowerName);
    } else if (onAddTower) {
      onAddTower(nextNewTowerName);
    }
    window.scrollTo({ top: 80, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      {/* ========================================================
          BARRA DE CONTROLE DA TORRE EM VISTORIA (SEMPRE VISÍVEL)
          Permite ao usuário alternar facilmente entre Torre 1, Torre 2 e adicionar novas torres
          ======================================================== */}
      <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 text-white rounded-xl p-4 shadow-md border border-blue-700/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600/30 border border-blue-500/50 flex items-center justify-center text-blue-300 flex-shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-blue-300 uppercase tracking-wider">
                Vistoriando agora:
              </span>
              <span className={`text-sm font-extrabold px-2.5 py-0.5 rounded shadow-xs ${
                torreAtual === 'Área Comum' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'
              }`}>
                {torreAtual || 'Torre 1'}
              </span>
              <span className="text-xs text-slate-300 font-medium">
                ({currentTowerPhotos} foto(s) registrada(s))
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end flex-wrap">
          {/* Pílulas de acesso rápido: Área Comum + Torres */}
          <div className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-lg border border-slate-800 max-w-full overflow-x-auto">
            {/* Pílula permanente da Área Comum */}
            {(() => {
              const isAreaActive = (torreAtual || 'Torre 1') === 'Área Comum';
              const areaCount = getTowerPhotoCount ? getTowerPhotoCount('Área Comum') : (isAreaActive ? currentTowerPhotos : 0);
              return (
                <button
                  type="button"
                  onClick={() => onSelectTorre?.('Área Comum')}
                  className={`px-2.5 py-1 text-xs font-bold rounded transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 ${
                    isAreaActive
                      ? 'bg-emerald-500 text-slate-950 shadow-xs'
                      : 'text-emerald-300 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Alternar para Área Comum"
                >
                  <span>Área Comum</span>
                  {areaCount > 0 && <span className="ml-1 text-[10px] opacity-80 font-normal">({areaCount})</span>}
                </button>
              );
            })()}

            {torresList.filter((t) => t !== 'Área Comum').map((tNome) => {
              const isActive = (torreAtual || 'Torre 1') === tNome;
              const count = getTowerPhotoCount ? getTowerPhotoCount(tNome) : (isActive ? currentTowerPhotos : 0);
              return (
                <button
                  key={tNome}
                  type="button"
                  onClick={() => onSelectTorre?.(tNome)}
                  className={`px-2.5 py-1 text-xs font-bold rounded transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                  title={`Alternar para ${tNome}`}
                >
                  {tNome}
                  {count > 0 && <span className="ml-1 text-[10px] opacity-80 font-normal">({count})</span>}
                </button>
              );
            })}
          </div>

          {/* Botão rápido para adicionar a próxima torre (ex: Torre 2) */}
          {onAddTower && (
            <button
              type="button"
              onClick={() => onAddTower(nextNewTowerName)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              title={`Adicionar ${nextNewTowerName} e começar a fotografar`}
            >
              <Plus className="w-3.5 h-3.5 text-emerald-200" />
              <span>+ {nextNewTowerName.toUpperCase()}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsTowerModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
            title="Escolher qual torre vistoriar"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>QUAL TORRE?</span>
          </button>
        </div>
      </div>

      {/* ========================================================
          ALERTA DE FOTOS ÓRFÃS DE TORRES APAGADAS / EXCLUÍDAS
          Aparece caso existam fotos de torres que não existem mais
          ======================================================== */}
      {(() => {
        const orphanCount = report ? countOrphanPhotos(report) : 0;
        if (orphanCount === 0) return null;
        return (
          <div className="bg-amber-950/80 border-2 border-amber-500/80 text-amber-100 rounded-xl p-4 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-bold text-amber-300">
                  ⚠️ Foram detectadas {orphanCount} foto(s) de torre(s) que foram apagadas do laudo!
                </p>
                <p className="text-[11px] sm:text-xs text-amber-200/90 mt-0.5">
                  Fotos de torres excluídas não devem aparecer no PDF ou Word. Clique no botão ao lado para eliminá-las permanentemente.
                </p>
              </div>
            </div>
            {onPurgeOrphans && (
              <button
                type="button"
                onClick={onPurgeOrphans}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-lg shadow-md transition-all cursor-pointer whitespace-nowrap self-stretch sm:self-auto"
              >
                <Trash2 className="w-4 h-4 text-slate-950" />
                <span>ELIMINAR {orphanCount} FOTO(S) ÓRFÃS AGORA</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* ========================================================
          BANNER DE TRANSIÇÃO RÁPIDA: CONCLUIU ESTA TORRE? AVANÇAR
          Aparece assim que o usuário tira ou envia fotos na torre atual
          ======================================================== */}
      {currentTowerPhotos > 0 && (
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-blue-950 text-white rounded-xl p-3.5 sm:p-4 border border-emerald-500/40 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600/30 border border-emerald-500/50 flex items-center justify-center text-emerald-300 flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-300 uppercase tracking-wide">
                  ✓ {torreAtual} ({currentTowerPhotos} foto(s))
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAdvanceNextTower}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold text-xs sm:text-sm rounded-lg shadow-md transition-all cursor-pointer whitespace-nowrap self-stretch sm:self-auto justify-center"
          >
            <span>{hasNextExistingTower ? `IR PARA A ${nextExistingTowerName?.toUpperCase()} ➔` : `+ ADICIONAR E IR PARA ${nextNewTowerName.toUpperCase()} ➔`}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================
          BARRA DE PASTAS E SEGURANÇA DE FOTOS NO CELULAR
          Salva na hierarquia: Gerador de Laudos / [Condomínio] / [Torre] / [Seção]
          ======================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex-shrink-0 mt-0.5">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-slate-800">
                  Sincronização com Pastas do Dispositivo (Documentos / LAUDOS SPDA)
                </h3>
                <span className="flex items-center gap-1.5 text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-0.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  Sincronização Incremental (Apenas Faltantes)
                </span>
                {connectedFolderName && (
                  <span className="flex items-center gap-1 text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300 px-2 py-0.5 rounded-full">
                    <FolderCheck className="w-3.5 h-3.5 text-blue-600" />
                    Pasta Conectada: {connectedFolderName}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-600 mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md">
                <span className="text-slate-400">Caminho Real no Dispositivo:</span>
                <span className="font-bold text-blue-700">Documentos</span>
                <span className="text-slate-400">/</span>
                <span className="font-bold text-emerald-700">LAUDOS SPDA</span>
                <span className="text-slate-400">/</span>
                <span className="font-bold text-amber-700">{condominioNome || 'Condomínio'}</span>
                <span className="text-slate-400">/</span>
                <span className="font-bold text-indigo-700">{torreAtual || 'Torre 1'}</span>
                <span className="text-slate-400">/</span>
                <span className="font-bold text-slate-800">{getSectionSubfolderName(activeSection)}</span>
              </div>
            </div>
          </div>

          {/* Botões de Ação para Celular e Disco */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsRealFoldersModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white shadow-xs transition-colors cursor-pointer"
              title="Criar pastar reais em Documentos/LAUDOS SPDA e sincronizar arquivos"
            >
              <FolderSync className="w-3.5 h-3.5 text-emerald-400" />
              <span>{connectedFolderName ? 'SINCRONIZAR PASTAS NO DISCO' : 'CRIAR PASTAS EM DOCUMENTOS'}</span>
            </button>

            {connectedFolderName && (
              <button
                type="button"
                onClick={handleDisconnectFolder}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors cursor-pointer"
                title="Desconectar pasta"
              >
                Desconectar
              </button>
            )}

            {/* 1. Baixar Todas as Fotos do Condomínio em Pastas Organizadas (ZIP) */}
            <button
              type="button"
              onClick={handleExportZip}
              disabled={isExportingZip}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              title="Baixar todas as fotos de todas as torres em arquivo ZIP já organizado nas pastas certas"
            >
              {isExportingZip ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-200" />
                  <span>{exportZipMsg || 'GERANDO ZIP...'}</span>
                </>
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5 text-amber-200" />
                  <span>BAIXAR FOTOS EM PASTAS (ZIP)</span>
                </>
              )}
            </button>

            {/* 2. Puxar Fotos de Volta */}
            <button
              type="button"
              onClick={() => setIsRestoreModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white shadow-xs transition-colors cursor-pointer"
              title="Puxar fotos de volta da pasta do celular ou arquivo ZIP caso precise recuperar a vistoria"
            >
              <FolderUp className="w-3.5 h-3.5 text-emerald-200" />
              <span>PUXAR FOTOS DE VOLTA</span>
            </button>
          </div>
        </div>

        {/* Notificação / Toast de Sincronização */}
        {deviceSyncToast && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-2.5 text-xs text-emerald-900 flex items-center justify-between gap-2 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="font-medium">{deviceSyncToast}</span>
            </div>
            <button
              onClick={() => setDeviceSyncToast(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* BARRA DE DESTAQUE: ESPAÇO PARA ADIÇÃO DE NOVAS FOTOS */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl p-4 shadow-sm border border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-600 text-white">
              <Camera className="w-4 h-4" />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
              FOTOS DA VISTORIA
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-700 border border-slate-600 text-slate-200">
              {totalPhotos === 0 ? 'Nenhuma foto carregada' : `${totalPhotos} foto(s) no laudo`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleOpenCamera(activeSection)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs sm:text-sm font-extrabold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-md transition-all cursor-pointer whitespace-nowrap"
            title="Abrir a câmera do aplicativo para tirar fotos em sequência desta torre"
          >
            <Camera className="w-4 h-4 text-slate-950" />
            <span>TIRAR FOTOS (CÂMERA)</span>
          </button>
        </div>
      </div>

      {/* 3 SELETORES PRINCIPAIS DE FOTOS */}
      <div className="bg-white p-2 rounded-xl shadow-xs border border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {/* SEPARAÇÃO 1: SPDA EXISTENTE */}
          <button
            onClick={() => setActiveSection('spda')}
            className={`p-3.5 rounded-lg text-left transition-all flex items-center justify-between border ${
              activeSection === 'spda'
                ? 'bg-red-50/80 border-red-500 shadow-sm ring-1 ring-red-400'
                : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-md ${activeSection === 'spda' ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <span className="font-extrabold text-xs sm:text-sm text-slate-900 block leading-tight">
                  1. SPDA EXISTENTE
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  Facultativo
                </span>
              </div>
            </div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
              spdaPhotos.length > 0 ? 'bg-red-100 text-red-800 border-red-200' : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}>
              {spdaPhotos.length}
            </span>
          </button>

          {/* SEPARAÇÃO 2: PONTOS DE MEDIÇÃO */}
          <button
            onClick={() => setActiveSection('medicao')}
            className={`p-3.5 rounded-lg text-left transition-all flex items-center justify-between border ${
              activeSection === 'medicao'
                ? 'bg-blue-50/80 border-blue-500 shadow-sm ring-1 ring-blue-400'
                : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-md ${activeSection === 'medicao' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                <Gauge className="w-5 h-5" />
              </div>
              <div>
                <span className="font-extrabold text-xs sm:text-sm text-slate-900 block leading-tight">
                  2. PONTOS DE MEDIÇÃO
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  Facultativo
                </span>
              </div>
            </div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
              measurementPhotos.length > 0 ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}>
              {measurementPhotos.length}
            </span>
          </button>

          {/* SEPARAÇÃO 3: QUADROS COM DPS */}
          <button
            onClick={() => setActiveSection('quadros')}
            className={`p-3.5 rounded-lg text-left transition-all flex items-center justify-between border ${
              activeSection === 'quadros'
                ? 'bg-amber-50/80 border-amber-500 shadow-sm ring-1 ring-amber-400'
                : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-md ${activeSection === 'quadros' ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <span className="font-extrabold text-xs sm:text-sm text-slate-900 block leading-tight">
                  3. QUADROS COM DPS
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  Facultativo
                </span>
              </div>
            </div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
              quadrosPhotos.length > 0 ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}>
              {quadrosPhotos.length}
            </span>
          </button>
        </div>

        {/* Botão para fotos do condomínio e miliohmímetro (exclusivo para Torre 1 quando houver múltiplas torres) */}
        {shouldShowCondoAndEquipment ? (
          <div className="mt-2 pt-2 border-t border-slate-100 flex justify-end">
            <button
              onClick={() => setActiveSection('local')}
              className={`text-xs font-bold px-3 py-1.5 rounded-md flex items-center gap-1.5 cursor-pointer ${
                activeSection === 'local'
                  ? 'bg-purple-100 text-purple-800 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Building className="w-3.5 h-3.5" />
              <span>FOTOS DO CONDOMÍNIO (FACHADA / AÉREA) & MILIOHMÍMETRO</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* ========================================================
          1. SEPARAÇÃO: SPDA EXISTENTE (QUANTIDADE LIVRE)
          ======================================================== */}
      {activeSection === 'spda' && (
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  1. Fotos de Vistoria do SPDA Existente (Facultativo)
                </h3>
                <span className="text-xs font-bold px-2 py-0.5 bg-red-100 text-red-700 rounded-md">
                  {spdaPhotos.length} foto(s)
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => handleAddNewPhotos(e, 'spda')}
                multiple
                accept="image/*"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => handleOpenCamera('spda')}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold rounded-lg shadow-xs transition-colors cursor-pointer"
                title="Abrir câmera para fotografar captores, descidas e conexões"
              >
                <Camera className="w-4 h-4" />
                <span>TIRAR FOTOS (CÂMERA)</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg border border-slate-300 shadow-2xs transition-colors cursor-pointer"
                title="Carregar fotos já salvas na galeria ou arquivos"
              >
                <Upload className="w-3.5 h-3.5 text-slate-600" />
                <span>GALERIA / ARQUIVOS</span>
              </button>
            </div>
          </div>

          {/* Area para soltar fotos se estiver vazia */}
          {spdaPhotos.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => handleOpenCamera('spda')}
                className="border-2 border-dashed border-red-300 hover:border-red-500 bg-red-50/50 hover:bg-red-50/80 rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group shadow-2xs"
              >
                <div className="w-12 h-12 rounded-xl bg-red-100 text-red-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Camera className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-red-950">
                    Tirar Fotos com a Câmera
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-1 px-4 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold pointer-events-none"
                >
                  ABRIR CÂMERA DO SPDA
                </button>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-slate-400 bg-slate-50 hover:bg-slate-100/80 rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    Selecionar da Galeria / Arquivos
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-1 px-4 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-bold pointer-events-none"
                >
                  SELECIONAR ARQUIVOS
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-2">
              {spdaPhotos.map((photo, index) => {
                const hasCircle = photo.hasRedCircleMarker ?? true;
                const circleX = photo.circleX ?? 50;
                const circleY = photo.circleY ?? 50;
                const circleRadius = photo.circleRadius ?? 24;

                return (
                  <div
                    key={photo.id || index}
                    className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col justify-between space-y-2.5 shadow-2xs hover:border-slate-400 transition-all"
                  >
                    {/* Imagem com destaque e botão de exclusão visível */}
                    <div
                      onClick={(e) => {
                        if (hasCircle) handleDirectClickCircle(e, index, 'spda');
                      }}
                      className={`relative aspect-[38.5/48] rounded-lg overflow-hidden bg-slate-200 flex items-center justify-center ${
                        hasCircle ? 'cursor-crosshair' : ''
                      }`}
                      title={hasCircle ? 'Clique para mover o círculo para este ponto da foto' : undefined}
                    >
                      <img
                        src={photo.url}
                        alt={`Foto SPDA ${index + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover select-none pointer-events-none"
                      />

                      {/* Círculo vermelho móvel renderizado na posição exata */}
                      {hasCircle && (
                        <div
                          className="absolute pointer-events-none transition-all"
                          style={{
                            left: `${circleX}%`,
                            top: `${circleY}%`,
                            width: `${circleRadius * 2.2}%`,
                            height: `${circleRadius * 1.8}%`,
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          <div className="w-full h-full border-2 border-red-600 rounded-full shadow-[0_0_4px_rgba(239,68,68,0.9)] flex items-center justify-center">
                            <div className="w-1.5 h-1.5 bg-red-600 rounded-full opacity-80" />
                          </div>
                        </div>
                      )}

                      {/* Identificador numérico da foto */}
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 text-white text-[10px] font-bold rounded pointer-events-none">
                        #{index + 1}
                      </span>

                      {/* BOTÃO EXCLUIR SUPERIOR PERMANENTEMENTE VISÍVEL */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePhoto(index, 'spda');
                        }}
                        className="absolute top-1.5 right-1.5 p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-md z-10 transition-colors flex items-center justify-center"
                        title="EXCLUIR ESTA FOTO"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={photo.caption || ''}
                        onChange={(e) => {
                          const copy = [...spdaPhotos];
                          copy[index] = { ...copy[index], caption: e.target.value };
                          onUpdateSpdaPhotos(copy);
                        }}
                        placeholder="Legenda (opcional)"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-red-500"
                      />

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-1 text-[10px] text-red-700 font-bold cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={hasCircle}
                              onChange={(e) => {
                                const copy = [...spdaPhotos];
                                copy[index] = { ...copy[index], hasRedCircleMarker: e.target.checked };
                                onUpdateSpdaPhotos(copy);
                              }}
                              className="w-3.5 h-3.5 text-red-600 rounded border-slate-300"
                            />
                            <span>CÍRCULO DE DESTAQUE</span>
                          </label>

                          {hasCircle && (
                            <span className="text-[9px] font-mono text-slate-500">
                              {circleX}%, {circleY}%
                            </span>
                          )}
                        </div>

                        {/* Botão em destaque para mover/ajustar o círculo */}
                        {hasCircle && (
                          <button
                            type="button"
                            onClick={() => setFocusModalData({ photo, index, type: 'spda' })}
                            className="w-full py-1 px-2 text-[10px] font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-md flex items-center justify-center gap-1 transition-colors"
                            title="Abrir tela ampliada para mover o círculo"
                          >
                            <Target className="w-3 h-3 text-red-600" />
                            <span>AJUSTAR CÍRCULO</span>
                          </button>
                        )}
                      </div>

                      {/* LINHA DE AÇÕES INFERIORES: TROCAR E EXCLUIR CLARAMENTE VISÍVEIS */}
                      <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200">
                        <label className="flex-1 py-1 px-2 text-[10px] font-bold bg-white hover:bg-slate-100 text-slate-700 rounded border border-slate-300 flex items-center justify-center gap-1 cursor-pointer transition-colors">
                          <Upload className="w-3 h-3 text-slate-500" />
                          <span>TROCAR</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleReplacePhoto(e, index, 'spda')}
                            className="hidden"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(index, 'spda')}
                          className="flex-1 py-1 px-2 text-[10px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 rounded border border-rose-200 flex items-center justify-center gap-1 transition-colors"
                          title="Excluir esta foto"
                        >
                          <Trash2 className="w-3 h-3 text-rose-600" />
                          <span>EXCLUIR</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          2. SEPARAÇÃO: PONTOS DE MEDIÇÃO (QUANTIDADE LIVRE)
          ======================================================== */}
      {activeSection === 'medicao' && (
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  2. Fotos de Pontos de Inspeção e Medição (Facultativo)
                </h3>
                <span className="text-xs font-bold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md">
                  {measurementPhotos.length} foto(s)
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => handleAddNewPhotos(e, 'medicao')}
                multiple
                accept="image/*"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => handleOpenCamera('medicao')}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-lg shadow-xs transition-colors cursor-pointer"
                title="Abrir câmera para fotografar caixas de inspeção, aterramento e miliohmímetro"
              >
                <Camera className="w-4 h-4" />
                <span>TIRAR FOTOS (CÂMERA)</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg border border-slate-300 shadow-2xs transition-colors cursor-pointer"
                title="Carregar fotos já salvas na galeria ou arquivos"
              >
                <Upload className="w-3.5 h-3.5 text-slate-600" />
                <span>GALERIA / ARQUIVOS</span>
              </button>
            </div>
          </div>

          {measurementPhotos.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => handleOpenCamera('medicao')}
                className="border-2 border-dashed border-blue-300 hover:border-blue-500 bg-blue-50/50 hover:bg-blue-50/80 rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group shadow-2xs"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Camera className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-blue-950">
                    Tirar Fotos de Medição com a Câmera
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-1 px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold pointer-events-none"
                >
                  ABRIR CÂMERA DE MEDIÇÕES
                </button>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-slate-400 bg-slate-50 hover:bg-slate-100/80 rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    Selecionar da Galeria / Arquivos
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-1 px-4 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-bold pointer-events-none"
                >
                  SELECIONAR ARQUIVOS
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {measurementPhotos.map((photo, index) => (
                <div
                  key={photo.id || index}
                  className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5 shadow-2xs hover:border-slate-400 transition-all flex flex-col justify-between"
                >
                  <div className="relative aspect-[38.5/42] rounded-lg overflow-hidden bg-slate-200 flex items-center justify-center">
                    <img
                      src={photo.url}
                      alt={`Ponto de Medição ${index + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 text-white text-[10px] font-bold rounded">
                      #{index + 1}
                    </span>

                    {/* BOTÃO EXCLUIR SUPERIOR VISÍVEL */}
                    <button
                      type="button"
                      onClick={() => handleDeletePhoto(index, 'medicao')}
                      className="absolute top-1.5 right-1.5 p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-md z-10 transition-colors"
                      title="EXCLUIR FOTO"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600">
                        LEGENDA (OPCIONAL):
                      </label>
                      <input
                        type="text"
                        value={photo.caption || ''}
                        onChange={(e) => {
                          const copy = [...measurementPhotos];
                          copy[index] = { ...copy[index], caption: e.target.value };
                          onUpdateMeasurementPhotos(copy);
                        }}
                        placeholder="Legenda (opcional)"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-blue-700">
                        VALOR MEDIDO (OPCIONAL):
                      </label>
                      <input
                        type="text"
                        value={photo.measurementValue || ''}
                        onChange={(e) => {
                          const copy = [...measurementPhotos];
                          copy[index] = { ...copy[index], measurementValue: e.target.value };
                          onUpdateMeasurementPhotos(copy);
                        }}
                        placeholder="Ex: 0,18 Ω (opcional)"
                        className="w-full px-2.5 py-1.5 text-xs font-mono font-bold text-blue-800 bg-blue-50/50 border border-blue-200 rounded-md"
                      />
                    </div>

                    {/* LINHA DE AÇÕES INFERIORES: TROCAR E EXCLUIR */}
                    <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200">
                      <label className="flex-1 py-1 px-2 text-[10px] font-bold bg-white hover:bg-slate-100 text-slate-700 rounded border border-slate-300 flex items-center justify-center gap-1 cursor-pointer transition-colors">
                        <Upload className="w-3 h-3 text-slate-500" />
                        <span>TROCAR</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleReplacePhoto(e, index, 'medicao')}
                          className="hidden"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => handleDeletePhoto(index, 'medicao')}
                        className="flex-1 py-1 px-2 text-[10px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 rounded border border-rose-200 flex items-center justify-center gap-1 transition-colors"
                        title="Excluir esta foto"
                      >
                        <Trash2 className="w-3 h-3 text-rose-600" />
                        <span>EXCLUIR</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          3. SEPARAÇÃO: QUADROS DO SPDA COM DPS (QUANTIDADE LIVRE)
          ======================================================== */}
      {activeSection === 'quadros' && (
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  3. Fotos dos Quadros do SPDA (com DPS) (Facultativo)
                </h3>
                <span className="text-xs font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md">
                  {quadrosPhotos.length} foto(s)
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => handleAddNewPhotos(e, 'quadros')}
                multiple
                accept="image/*"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => handleOpenCamera('quadros')}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded-lg shadow-xs transition-colors cursor-pointer"
                title="Abrir câmera para fotografar quadros elétricos, barramentos e DPS"
              >
                <Camera className="w-4 h-4" />
                <span>TIRAR FOTOS (CÂMERA)</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg border border-slate-300 shadow-2xs transition-colors cursor-pointer"
                title="Carregar fotos já salvas na galeria ou arquivos"
              >
                <Upload className="w-3.5 h-3.5 text-slate-600" />
                <span>GALERIA / ARQUIVOS</span>
              </button>
            </div>
          </div>

          {quadrosPhotos.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => handleOpenCamera('quadros')}
                className="border-2 border-dashed border-amber-300 hover:border-amber-500 bg-amber-50/50 hover:bg-amber-50/80 rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group shadow-2xs"
              >
                <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Camera className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-950">
                    Tirar Fotos dos Quadros com a Câmera
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-1 px-4 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold pointer-events-none"
                >
                  ABRIR CÂMERA DOS QUADROS
                </button>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-slate-400 bg-slate-50 hover:bg-slate-100/80 rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    Selecionar da Galeria / Arquivos
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-1 px-4 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-bold pointer-events-none"
                >
                  SELECIONAR ARQUIVOS
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
              {quadrosPhotos.map((photo, index) => {
                const hasCircle = !!photo.hasRedCircleMarker;
                const circleX = photo.circleX ?? 50;
                const circleY = photo.circleY ?? 50;
                const circleRadius = photo.circleRadius ?? 24;

                return (
                  <div
                    key={photo.id || index}
                    className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5 shadow-2xs hover:border-slate-400 transition-all flex flex-col justify-between"
                  >
                    <div
                      onClick={(e) => {
                        if (hasCircle) handleDirectClickCircle(e, index, 'quadros');
                      }}
                      className={`relative aspect-[38.5/42] rounded-lg overflow-hidden bg-slate-200 flex items-center justify-center ${
                        hasCircle ? 'cursor-crosshair' : ''
                      }`}
                    >
                      <img
                        src={photo.url}
                        alt={`Quadro ${index + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover select-none pointer-events-none"
                      />

                      {hasCircle && (
                        <div
                          className="absolute pointer-events-none transition-all"
                          style={{
                            left: `${circleX}%`,
                            top: `${circleY}%`,
                            width: `${circleRadius * 2.2}%`,
                            height: `${circleRadius * 1.8}%`,
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          <div className="w-full h-full border-2 border-red-600 rounded-full shadow-[0_0_4px_rgba(239,68,68,0.9)] flex items-center justify-center">
                            <div className="w-1.5 h-1.5 bg-red-600 rounded-full opacity-80" />
                          </div>
                        </div>
                      )}

                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 text-white text-[10px] font-bold rounded pointer-events-none">
                        #{index + 1}
                      </span>

                      {/* BOTÃO EXCLUIR SUPERIOR VISÍVEL */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePhoto(index, 'quadros');
                        }}
                        className="absolute top-1.5 right-1.5 p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-md z-10 transition-colors"
                        title="EXCLUIR FOTO"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600">
                          DESCRIÇÃO DO QUADRO (OPCIONAL):
                        </label>
                        <input
                          type="text"
                          value={photo.caption || ''}
                          onChange={(e) => {
                            const copy = [...quadrosPhotos];
                            copy[index] = { ...copy[index], caption: e.target.value };
                            onUpdateQuadrosPhotos(copy);
                          }}
                          placeholder="Descrição / legenda (opcional)"
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                        />
                      </div>

                      <div className="flex items-center justify-between pt-0.5">
                        <label className="flex items-center gap-1 text-[10px] text-red-700 font-bold cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={hasCircle}
                            onChange={(e) => {
                              const copy = [...quadrosPhotos];
                              copy[index] = { ...copy[index], hasRedCircleMarker: e.target.checked };
                              onUpdateQuadrosPhotos(copy);
                            }}
                            className="w-3.5 h-3.5 text-red-600 rounded border-slate-300"
                          />
                          <span>CÍRCULO DE DESTAQUE</span>
                        </label>

                        {hasCircle && (
                          <button
                            type="button"
                            onClick={() => setFocusModalData({ photo, index, type: 'quadros' })}
                            className="text-[9px] font-bold text-red-700 bg-red-50 hover:bg-red-100 px-1.5 py-0.5 rounded border border-red-200 flex items-center gap-1"
                          >
                            <Target className="w-2.5 h-2.5" />
                            AJUSTAR
                          </button>
                        )}
                      </div>

                      {/* LINHA DE AÇÕES INFERIORES: TROCAR E EXCLUIR */}
                      <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200">
                        <label className="flex-1 py-1 px-2 text-[10px] font-bold bg-white hover:bg-slate-100 text-slate-700 rounded border border-slate-300 flex items-center justify-center gap-1 cursor-pointer transition-colors">
                          <Upload className="w-3 h-3 text-slate-500" />
                          <span>TROCAR</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleReplacePhoto(e, index, 'quadros')}
                            className="hidden"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(index, 'quadros')}
                          className="flex-1 py-1 px-2 text-[10px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 rounded border border-rose-200 flex items-center justify-center gap-1 transition-colors"
                          title="Excluir esta foto"
                        >
                          <Trash2 className="w-3 h-3 text-rose-600" />
                          <span>EXCLUIR</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          FOTOS AUXILIARES: CONDOMÍNIO (FACHADA/AÉREA) & MILIOHMÍMETRO
          Aparece exclusivamente na Torre 1 quando houver múltiplas torres
          ======================================================== */}
      {/* ========================================================
          FOTOS AUXILIARES: CONDOMÍNIO (FACHADA/AÉREA) & MILIOHMÍMETRO
          Aparece exclusivamente na Torre 1 quando houver múltiplas torres
          ======================================================== */}
      {activeSection === 'local' && shouldShowCondoAndEquipment && (
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 sm:p-6 space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              Fotos do Local em Destaque (Vista Aérea e Fachada) & Instrumento de Medição
            </h3>
          </div>

          {/* SESSÃO 3.1: VISTA AÉREA DA EDIFICAÇÃO (EM GRANDE DESTAQUE) */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block flex-shrink-0" />
                <h4 className="text-sm font-bold text-slate-900 uppercase">
                  Sessão 3.1: Vista Aérea da Edificação / Imagem Satélite
                </h4>
              </div>
              <span className="text-[11px] font-semibold text-slate-500">
                Página 3 do Laudo Técnico
              </span>
            </div>

            <input
              type="file"
              ref={aerialInputRef}
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const url = await readSafeHighQualityPhotoUrl(file);
                  const copy = [...localPhotos];
                  copy[0] = {
                    id: copy[0]?.id || `aerial-${Date.now()}`,
                    url,
                    caption: copy[0]?.caption || 'Vista aérea da edificação, circunvizinhança e posicionamento geográfico do condomínio.',
                    towerName: torreAtual,
                  };
                  onUpdateLocalPhotos(copy);
                } catch (err) {
                  console.error('Erro ao salvar foto aérea', err);
                }
                if (e.target) e.target.value = '';
              }}
              className="hidden"
            />

            {localPhotos[0]?.url ? (
              <div className="space-y-3">
                <div className="relative w-full h-56 sm:h-72 bg-slate-900 rounded-lg overflow-hidden border border-slate-300 flex items-center justify-center p-2 shadow-inner">
                  <img
                    src={localPhotos[0].url}
                    alt={localPhotos[0].caption || 'Vista Aérea'}
                    loading="lazy"
                    decoding="async"
                    className="max-w-full max-h-full object-contain rounded"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const copy = [...localPhotos];
                      if (copy[0]) {
                        copy[0] = { ...copy[0], url: '' };
                        onUpdateLocalPhotos(copy);
                      }
                    }}
                    className="absolute top-2.5 right-2.5 p-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-md transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                    title="Excluir Foto Aérea"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Excluir</span>
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-700 uppercase mb-1">
                      Legenda da Vista Aérea:
                    </label>
                    <input
                      type="text"
                      value={localPhotos[0].caption || ''}
                      onChange={(e) => {
                        const copy = [...localPhotos];
                        if (copy[0]) {
                          copy[0] = { ...copy[0], caption: e.target.value };
                          onUpdateLocalPhotos(copy);
                        }
                      }}
                      placeholder="Ex: Vista aérea da edificação, circunvizinhança e posicionamento geográfico do condomínio."
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => aerialInputRef.current?.click()}
                    className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold rounded-lg border border-slate-300 flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer self-end"
                  >
                    <Upload className="w-3.5 h-3.5 text-slate-600" />
                    <span>Trocar Foto Aérea</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => aerialInputRef.current?.click()}
                className="border-2 border-dashed border-blue-300 hover:border-blue-500 bg-blue-50/40 hover:bg-blue-50/70 rounded-xl p-8 sm:p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Building className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-blue-950">
                    Carregar Foto da Vista Aérea (Satélite / Drone)
                  </p>
                  <p className="text-xs text-blue-700/80 mt-0.5">
                    Imagem de satélite (Google Earth / Maps) ou foto panorâmica de drone da cobertura
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold shadow-xs hover:bg-blue-500 transition-colors pointer-events-none"
                >
                  SELECIONAR FOTO AÉREA
                </button>
              </div>
            )}
          </div>

          {/* SESSÃO 3.2: FACHADA PRINCIPAL DA EDIFICAÇÃO (EM GRANDE DESTAQUE) */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block flex-shrink-0" />
                <h4 className="text-sm font-bold text-slate-900 uppercase">
                  Sessão 3.2: Fachada Principal da Edificação / Condomínio
                </h4>
              </div>
              <span className="text-[11px] font-semibold text-slate-500">
                Página 4 do Laudo Técnico
              </span>
            </div>

            <input
              type="file"
              ref={facadeInputRef}
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const url = await readSafeHighQualityPhotoUrl(file);
                  const copy = [...localPhotos];
                  if (!copy[0]) {
                    copy[0] = {
                      id: `aerial-${Date.now()}`,
                      url: '',
                      caption: '',
                      towerName: torreAtual,
                    };
                  }
                  copy[1] = {
                    id: copy[1]?.id || `facade-${Date.now()}`,
                    url,
                    caption: copy[1]?.caption || 'Fachada principal da edificação, estrutura predial e acessos vistoriados.',
                    towerName: torreAtual,
                  };
                  onUpdateLocalPhotos(copy);
                } catch (err) {
                  console.error('Erro ao salvar foto da fachada', err);
                }
                if (e.target) e.target.value = '';
              }}
              className="hidden"
            />

            {localPhotos[1]?.url ? (
              <div className="space-y-3">
                <div className="relative w-full h-56 sm:h-72 bg-slate-900 rounded-lg overflow-hidden border border-slate-300 flex items-center justify-center p-2 shadow-inner">
                  <img
                    src={localPhotos[1].url}
                    alt={localPhotos[1].caption || 'Fachada'}
                    loading="lazy"
                    decoding="async"
                    className="max-w-full max-h-full object-contain rounded"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const copy = [...localPhotos];
                      if (copy[1]) {
                        copy[1] = { ...copy[1], url: '' };
                        onUpdateLocalPhotos(copy);
                      }
                    }}
                    className="absolute top-2.5 right-2.5 p-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-md transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                    title="Excluir Foto da Fachada"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Excluir</span>
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-700 uppercase mb-1">
                      Legenda da Fachada:
                    </label>
                    <input
                      type="text"
                      value={localPhotos[1].caption || ''}
                      onChange={(e) => {
                        const copy = [...localPhotos];
                        if (copy[1]) {
                          copy[1] = { ...copy[1], caption: e.target.value };
                          onUpdateLocalPhotos(copy);
                        }
                      }}
                      placeholder="Ex: Fachada principal da edificação, estrutura predial e acessos vistoriados."
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => facadeInputRef.current?.click()}
                    className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold rounded-lg border border-slate-300 flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer self-end"
                  >
                    <Upload className="w-3.5 h-3.5 text-slate-600" />
                    <span>Trocar Foto da Fachada</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => facadeInputRef.current?.click()}
                className="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/70 rounded-xl p-8 sm:p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-950">
                    Carregar Foto da Fachada Principal
                  </p>
                  <p className="text-xs text-emerald-700/80 mt-0.5">
                    Registro frontal da edificação, portaria ou acessos do condomínio
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold shadow-xs hover:bg-emerald-500 transition-colors pointer-events-none"
                >
                  SELECIONAR FOTO DA FACHADA
                </button>
              </div>
            )}
          </div>

          {/* SESSÃO 3.3: INSTRUMENTO DE MEDIÇÃO (MILIOHMÍMETRO HTM-01) */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block flex-shrink-0" />
                <h4 className="text-sm font-bold text-slate-900 uppercase">
                  Instrumento de Medição: Miliohmímetro HTM-01 (HI-TECH)
                </h4>
              </div>
              <span className="text-[11px] font-semibold text-slate-500">
                Seção 6 (Medições de Continuidade)
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:w-56 h-36 bg-slate-100 rounded-lg border border-slate-300 overflow-hidden flex items-center justify-center relative p-1.5 shadow-inner">
                {equipmentPhotoUrl ? (
                  <>
                    <img
                      src={equipmentPhotoUrl}
                      alt="HTM-01"
                      loading="lazy"
                      decoding="async"
                      className="max-w-full max-h-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={handleDeleteEquipmentPhoto}
                      className="absolute top-1.5 right-1.5 p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-md z-10 transition-colors cursor-pointer"
                      title="Excluir Foto do Equipamento"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <div className="text-slate-400 text-xs italic text-center p-3">
                    Nenhuma foto do Miliohmímetro anexada
                  </div>
                )}
              </div>

              <div className="flex-1 text-xs text-slate-700 space-y-2">
                <div>
                  <p className="font-bold text-sm text-slate-900">Miliohmímetro Portátil HTM-01 - HI-TECH</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    Instrumento utilizando o método dos 4 terminais (método de Kelvin) para eliminar erros provocados pelos cabos de ensaio.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg border border-slate-300 cursor-pointer flex items-center gap-1.5 transition-colors shadow-2xs">
                    <Upload className="w-3.5 h-3.5 text-slate-500" />
                    <span>{equipmentPhotoUrl ? 'Trocar Foto do Instrumento' : 'Carregar Foto do Miliohmímetro'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      ref={equipInputRef}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const url = await readSafeHighQualityPhotoUrl(file);
                          onUpdateEquipmentPhoto(url);
                        } catch (err) {
                          console.error('Erro ao salvar foto do instrumento', err);
                        }
                        if (e.target) e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>

                  {equipmentPhotoUrl && (
                    <button
                      type="button"
                      onClick={handleDeleteEquipmentPhoto}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg border border-rose-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span>Excluir</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          RODAPÉ DA ABA DE FOTOS: BOTÃO DESTACADO PARA PRÓXIMA TORRE
          Permite ao usuário concluir a torre atual e avançar para a próxima torre com 1 clique
          ======================================================== */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 border border-blue-800/50 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-white shadow-xl">
        <div className="flex items-center gap-3.5 w-full sm:w-auto">
          <div className="w-11 h-11 rounded-xl bg-blue-600/30 text-blue-400 border border-blue-500/40 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Vistoria da {torreAtual}</span>
              <span className="text-[11px] font-semibold bg-blue-600/60 text-blue-200 px-2 py-0.5 rounded-full">
                {currentTowerPhotos} foto(s)
              </span>
            </h4>
            <p className="text-xs text-slate-300 mt-0.5">
              {hasNextExistingTower
                ? `Próxima torre cadastrada: ${nextExistingTowerName}. Concluiu esta torre?`
                : `Concluiu a ${torreAtual}? Adicione a próxima torre do condomínio.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setIsTowerModalOpen(true)}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            QUAL TORRE?
          </button>
          <button
            type="button"
            onClick={handleAdvanceNextTower}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs sm:text-sm font-extrabold shadow-md transition-all cursor-pointer whitespace-nowrap"
          >
            <span>{hasNextExistingTower ? `IR PARA A ${nextExistingTowerName?.toUpperCase()} ➔` : `+ ADICIONAR E IR PARA ${nextNewTowerName.toUpperCase()} ➔`}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Modal interativo para focar e redimensionar o círculo vermelho de destaque */}
      {focusModalData && (
        <CircleFocusModal
          isOpen={!!focusModalData}
          photo={focusModalData.photo}
          photoIndex={focusModalData.index}
          type={focusModalData.type}
          onClose={() => setFocusModalData(null)}
          onSave={handleSaveCircleModal}
        />
      )}

      {/* Modal interativo para perguntar qual torre o usuário está analisando */}
      <SelectTowerModal
        isOpen={isTowerModalOpen}
        onClose={() => setIsTowerModalOpen(false)}
        torres={torresList}
        torreAtual={torreAtual}
        onSelectTorre={(t) => onSelectTorre?.(t)}
        onAddTower={onAddTower}
        onDeleteTower={onDeleteTower}
        getPhotoCount={getTowerPhotoCount}
        condominioNome={condominioNome}
      />

      {/* Modal para puxar fotos de volta da pasta ou ZIP do celular */}
      {report && (
        <RestorePhotosModal
          isOpen={isRestoreModalOpen}
          onClose={() => setIsRestoreModalOpen(false)}
          currentReport={report}
          onApplyRestoredPhotos={(updatedReport) => {
            if (onRestoreReport) {
              onRestoreReport(updatedReport);
            } else {
              onUpdateSpdaPhotos(updatedReport.spdaPhotos);
              onUpdateMeasurementPhotos(updatedReport.measurementPhotos);
              onUpdateQuadrosPhotos(updatedReport.quadrosPhotos);
              onUpdateLocalPhotos(updatedReport.localPhotos);
            }
            showSyncToast('Fotos puxadas e carregadas com sucesso em suas respectivas torres!');
          }}
        />
      )}

      {/* Modal para tirar fotos diretamente com a câmera do celular */}
      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        condominioNome={condominioNome}
        torreAtual={torreAtual}
        activeSection={activeSection}
        onChangeSection={(sec) => setActiveSection(sec)}
        onPhotoCaptured={handlePhotoCapturedFromCamera}
        onPhotosSavedToDisk={handlePhotosSavedToDisk}
        torresList={torresList}
        onChangeTower={(t) => onSelectTorre?.(t)}
        getSectionPhotoCount={(sec, t) => {
          const tower = t || torreAtual;
          if (tower === torreAtual) {
            if (sec === 'spda') return spdaPhotos.length;
            if (sec === 'medicao') return measurementPhotos.length;
            if (sec === 'quadros') return quadrosPhotos.length;
            return localPhotos.length;
          }
          const tData = report?.torresData?.[tower];
          if (!tData) return 0;
          if (sec === 'spda') return tData.spdaPhotos?.length || 0;
          if (sec === 'medicao') return tData.measurementPhotos?.length || 0;
          if (sec === 'quadros') return tData.quadrosPhotos?.length || 0;
          return tData.localPhotos?.length || 0;
        }}
      />

      {/* Modal para criar pastar reais no dispositivo e sincronizar fotos do laudo */}
      {report && (
        <RealFoldersSyncModal
          isOpen={isRealFoldersModalOpen}
          onClose={() => setIsRealFoldersModalOpen(false)}
          report={report}
          onReportUpdated={(updated: SpdaReport) => onReportUpdated?.(updated)}
          onSyncComplete={(count: number, folderPath: string) => {
            showSyncToast(`✓ Pastas criadas em ${folderPath} (${count} fotos gravadas no disco)!`);
            getConnectedDeviceFolderHandle().then((h) => {
              if (h) setConnectedFolderName(h.name);
            });
          }}
        />
      )}

      {/* ========================================================
          MODAL DE CONFIRMAÇÃO OBRIGATÓRIA: EXCLUIR FOTO DO LAUDO E DO DISCO
          ======================================================== */}
      {photoToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-rose-500/50 rounded-2xl max-w-md w-full p-5 text-white shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex-shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">
                  Excluir Foto do Laudo e da Pasta?
                </h3>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Tem certeza que deseja excluir esta foto da <strong>{photoToDelete.tower}</strong> &gt; <strong>{getSectionSubfolderName(photoToDelete.type)}</strong>?
                </p>
              </div>
            </div>

            {/* Pré-visualização da foto */}
            <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800 flex items-center gap-3">
              <div className="w-16 h-20 rounded-lg overflow-hidden bg-slate-800 border border-slate-700 flex-shrink-0 flex items-center justify-center">
                <img
                  src={photoToDelete.photo.url}
                  alt="Foto a excluir"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1 text-xs space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-200">Foto #{photoToDelete.index + 1}</span>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 font-mono">
                    {photoToDelete.photo.diskFileName || `foto_${String(photoToDelete.index + 1).padStart(2, '0')}.jpg`}
                  </span>
                </div>
                {photoToDelete.photo.caption && (
                  <p className="text-slate-400 truncate text-[11px]">
                    Legenda: {photoToDelete.photo.caption}
                  </p>
                )}
                <p className="text-[11px] text-amber-300 font-medium">
                  Esta foto será removida do laudo e também será excluída permanentemente da pasta física do condomínio no seu aparelho.
                </p>
              </div>
            </div>

            {/* Botões de Ação */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPhotoToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              >
                CANCELAR
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePhoto}
                className="px-4 py-2 rounded-xl text-xs font-black bg-rose-600 hover:bg-rose-500 text-white shadow-md transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>SIM, EXCLUIR FOTO E DA PASTA</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
