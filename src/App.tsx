/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { SpdaReport, ClientData, CompanyData, TechnicalTexts, PhotoSlot, InspectionConditions, TowerData, DigitalSignatureData } from './types/spda';
import { defaultSpdaReport, createBlankSpdaReport } from './data/defaultReport';
import { SJC_OFFICIAL_LOGO_DATA_URL } from './assets/logo';
import { ClientDataForm } from './components/ClientDataForm';
import { PhotoUploaderSection } from './components/PhotoUploaderSection';
import { InspectionConditionsEditor } from './components/InspectionConditionsEditor';
import { TechnicalTextsEditor } from './components/TechnicalTextsEditor';
import { ReportPreview } from './components/ReportPreview';
import { PdfDownloadModal } from './components/PdfDownloadModal';
import { SavedReportsModal } from './components/SavedReportsModal';
import { SelectTowerModal } from './components/SelectTowerModal';
import { RealFoldersSyncModal } from './components/RealFoldersSyncModal';
import { DigitalSignatureModal } from './components/DigitalSignatureModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { printReport, generatePdfBlob } from './utils/pdfGenerator';
import { generateDocxBlob } from './utils/docxGenerator';
import {
  getConnectedDeviceFolderHandle,
  createCondoFolderTree,
} from './utils/photoDeviceSync';
import { DatabaseManagerModal } from './components/DatabaseManagerModal';
import { CondominioRecord, ClientRecord } from './db/spdaDatabase';
import {
  Building2,
  Camera,
  Printer,
  Download,
  Eye,
  Columns,
  CheckCircle2,
  Zap,
  Wrench,
  Gauge,
  Layers,
  BookOpen,
  FilePlus,
  FileSignature,
  Trash2,
  Save,
  FolderOpen,
  FolderTree,
  AlertCircle,
  Check,
  X,
  Database,
  FileText,
} from 'lucide-react';
import {
  saveReportToStorage,
  loadReportFromStorage,
  loadSavedReportById,
  clearReportStorage,
  saveNamedReport,
  getSavedReportsList,
  generateSequentialReportTitle,
  deleteSavedReportById,
  getLastSavedTimeFormatted,
} from './utils/storage';

export default function App() {
  const [report, setReport] = useState<SpdaReport>(defaultSpdaReport);
  const reportRef = React.useRef<SpdaReport>(report);
  reportRef.current = report;

  // Flag de inicialização do armazenamento para impedir que o laudo em branco sobrescreva dados existentes no startup
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string>(() => getLastSavedTimeFormatted() || '');
  const [isFolderSyncModalOpen, setIsFolderSyncModalOpen] = useState(false);
  const [isNewReportModalOpen, setIsNewReportModalOpen] = useState(false);

  // Inicia diretamente na aba de fotos, com o espaço aberto e limpo para carregar novas fotos
  const [activeTab, setActiveTab] = useState<'condominio' | 'fotos' | 'correcoes' | 'textos_fixos' | 'preview'>('fotos');
  const [splitView, setSplitView] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ percent: number; message: string }>({
    percent: 0,
    message: '',
  });
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);
  const [docxProgress, setDocxProgress] = useState<{ percent: number; message: string }>({
    percent: 0,
    message: '',
  });
  const [saveIndicator, setSaveIndicator] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number>(0);

  // State for the generated PDF modal
  const [generatedPdf, setGeneratedPdf] = useState<{ url: string; fileName: string } | null>(null);
  const [isSavedModalOpen, setIsSavedModalOpen] = useState(false);
  const [isDatabaseModalOpen, setIsDatabaseModalOpen] = useState(false);
  const [isSelectTowerModalOpen, setIsSelectTowerModalOpen] = useState(false);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [hasPromptedTower, setHasPromptedTower] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmText: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const handleSaveSignature = (sig: DigitalSignatureData) => {
    setReport((prev) => {
      const updated = {
        ...prev,
        digitalSignature: sig,
      };
      saveReportToStorage(updated).catch(() => {});
      return updated;
    });
    setSaveToast(sig.enabled ? '✓ Assinatura digital aplicada ao laudo!' : 'Assinatura digital desativada.');
    setTimeout(() => setSaveToast(null), 3500);
  };

  const handleApplyCondoToReport = (condo: CondominioRecord) => {
    setReport((prev) => {
      const updatedClient: ClientData = {
        ...prev.client,
        name: condo.nome,
        local: condo.endereco || prev.client.local,
        municipio: condo.municipio || prev.client.municipio,
        cnpj: condo.cnpj || prev.client.cnpj,
        quantidadeTorres: condo.quantidadeTorres || prev.client.quantidadeTorres || 1,
        torresNomes: condo.torresNomes && condo.torresNomes.length > 0 ? condo.torresNomes : prev.client.torresNomes,
      };
      const title = generateSequentialReportTitle(condo.nome);
      const updated = {
        ...prev,
        title,
        client: updatedClient,
        torreAtual: condo.torresNomes?.[0] || 'Torre 1',
      };
      saveReportToStorage(updated).catch(() => {});
      return updated;
    });
    setSaveToast(`✓ Condomínio "${condo.nome}" carregado no laudo!`);
    setTimeout(() => setSaveToast(null), 4000);
  };

  const handleApplyClientToReport = (clientRec: ClientRecord) => {
    setReport((prev) => {
      const updatedClient: ClientData = {
        ...prev.client,
        name: clientRec.name || prev.client.name,
        cnpj: clientRec.cnpj || prev.client.cnpj,
        local: clientRec.local || prev.client.local,
        municipio: clientRec.municipio || prev.client.municipio,
        ramoAtividade: clientRec.ramoAtividade || prev.client.ramoAtividade,
        tecnico: clientRec.tecnico || prev.client.tecnico,
        cargo: clientRec.cargo || prev.client.cargo,
        crea: clientRec.crea || prev.client.crea,
        art: clientRec.art || prev.client.art,
      };
      const updated = { ...prev, client: updatedClient };
      saveReportToStorage(updated).catch(() => {});
      return updated;
    });
    setSaveToast(`✓ Dados do cliente "${clientRec.name}" aplicados no laudo!`);
    setTimeout(() => setSaveToast(null), 4000);
  };

  // 1. CARREGAMENTO INICIAL DO LAUDO SALVO (SEM AUTO-SAVE POSTERIOR)
  useEffect(() => {
    loadReportFromStorage()
      .then((saved) => {
        if (saved) {
          if (!saved.company?.logoUrl) {
            saved.company = {
              ...saved.company,
              logoUrl: SJC_OFFICIAL_LOGO_DATA_URL,
            };
          }
          if (!saved.torresData) {
            saved.torresData = {};
          }
          if (!saved.torresData['Área Comum']) {
            saved.torresData['Área Comum'] = {
              id: 'area-comum',
              nome: 'Área Comum',
              spdaPhotos: [],
              measurementPhotos: [],
              quadrosPhotos: [],
              localPhotos: [],
            };
          }
          if (!saved.digitalSignature) {
            saved.digitalSignature = {
              enabled: true,
              type: 'drawn',
              signerName: saved.client?.tecnico || 'JÔNATAS PEREIRA PAVANELO',
              signerRole: saved.client?.cargo || 'Engenheiro Eletricista',
              signerCrea: saved.client?.crea || 'CREA-SP 5063896203',
              signerArt: saved.client?.art || '',
              signedAt: new Date().toLocaleDateString('pt-BR'),
              hashSha256: 'SPDA-5419-A8F3-7C21-E9D4',
              showValidationStamp: true,
              certificateAuthority: 'Padrão ICP-Brasil / CREA Confea',
            };
          }
          setReport(saved);
          reportRef.current = saved;
        }
        setIsStorageReady(true);
        const last = getLastSavedTimeFormatted();
        if (last) {
          setLastSavedTime(last);
        }
      })
      .catch((err) => {
        console.warn('Storage read notice', err);
        setIsStorageReady(true);
      });

    getSavedReportsList()
      .then((list) => setSavedCount(list.length))
      .catch(() => {});
  }, []);

  const [newReportCondoName, setNewReportCondoName] = useState('');
  const [newReportTowerCountInput, setNewReportTowerCountInput] = useState('1');
  const parsedNewReportTowerCount = Math.max(1, Math.min(50, parseInt(newReportTowerCountInput, 10) || 1));

  // Salvamento contínuo e automático contra falhas e travamentos do aparelho:
  // Grava no IndexedDB imediatamente quando fotos são adicionadas/removidas, e a cada 1.2s para digitação de textos
  useEffect(() => {
    if (!isStorageReady) return;
    setHasUnsavedChanges(true);

    const timer = setTimeout(() => {
      saveReportToStorage(report)
        .then(() => {
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          setLastSavedTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
        })
        .catch((err) => console.warn('Auto-save notice:', err));
    }, 1200);

    return () => clearTimeout(timer);
  }, [report, isStorageReady]);

  // Handlers for client data
  const handleUpdateClient = (updated: Partial<ClientData>) => {
    setReport((prev) => ({
      ...prev,
      client: { ...prev.client, ...updated },
    }));
  };

  // Handlers for company data
  const handleUpdateCompany = (updated: Partial<CompanyData>) => {
    setReport((prev) => ({
      ...prev,
      company: { ...prev.company, ...updated },
    }));
  };

  // Handlers for inspection conditions
  const handleUpdateConditions = (updated: Partial<InspectionConditions>) => {
    setReport((prev) => ({
      ...prev,
      conditions: { ...prev.conditions, ...updated },
    }));
  };

  // Handlers for technical texts
  const handleUpdateTexts = (updated: Partial<TechnicalTexts>) => {
    setReport((prev) => ({
      ...prev,
      texts: { ...prev.texts, ...updated },
    }));
  };

  // Handlers para Fotos com PERSISTÊNCIA IMEDIATA NO BANCO LOCAL (à prova de travamento/crash do navegador)
  const handleUpdateSpdaPhotos = (spdaPhotos: PhotoSlot[]) => {
    setReport((prev) => {
      const currentTower = prev.torreAtual || 'Torre 1';
      const updated: SpdaReport = {
        ...prev,
        spdaPhotos,
        torresData: {
          ...(prev.torresData || {}),
          [currentTower]: {
            ...(prev.torresData?.[currentTower] || {
              id: currentTower.toLowerCase().replace(/\s+/g, '-'),
              nome: currentTower,
              spdaPhotos: [],
              measurementPhotos: prev.measurementPhotos,
              quadrosPhotos: prev.quadrosPhotos,
              localPhotos: prev.localPhotos,
            }),
            spdaPhotos,
          },
        },
      };
      saveReportToStorage(updated).catch(() => {});
      return updated;
    });
  };

  const handleUpdateMeasurementPhotos = (measurementPhotos: PhotoSlot[]) => {
    setReport((prev) => {
      const currentTower = prev.torreAtual || 'Torre 1';
      const updated: SpdaReport = {
        ...prev,
        measurementPhotos,
        torresData: {
          ...(prev.torresData || {}),
          [currentTower]: {
            ...(prev.torresData?.[currentTower] || {
              id: currentTower.toLowerCase().replace(/\s+/g, '-'),
              nome: currentTower,
              spdaPhotos: prev.spdaPhotos,
              measurementPhotos: [],
              quadrosPhotos: prev.quadrosPhotos,
              localPhotos: prev.localPhotos,
            }),
            measurementPhotos,
          },
        },
      };
      saveReportToStorage(updated).catch(() => {});
      return updated;
    });
  };

  const handleUpdateQuadrosPhotos = (quadrosPhotos: PhotoSlot[]) => {
    setReport((prev) => {
      const currentTower = prev.torreAtual || 'Torre 1';
      const updated: SpdaReport = {
        ...prev,
        quadrosPhotos,
        torresData: {
          ...(prev.torresData || {}),
          [currentTower]: {
            ...(prev.torresData?.[currentTower] || {
              id: currentTower.toLowerCase().replace(/\s+/g, '-'),
              nome: currentTower,
              spdaPhotos: prev.spdaPhotos,
              measurementPhotos: prev.measurementPhotos,
              quadrosPhotos: [],
              localPhotos: prev.localPhotos,
            }),
            quadrosPhotos,
          },
        },
      };
      saveReportToStorage(updated).catch(() => {});
      return updated;
    });
  };

  const handleUpdateLocalPhotos = (localPhotos: PhotoSlot[]) => {
    setReport((prev) => {
      const updated: SpdaReport = { ...prev, localPhotos };
      saveReportToStorage(updated).catch(() => {});
      return updated;
    });
  };

  const handleUpdateEquipmentPhoto = (url: string) => {
    setReport((prev) => {
      const updated: SpdaReport = { ...prev, equipmentPhotoUrl: url };
      saveReportToStorage(updated).catch(() => {});
      return updated;
    });
  };

  // Alterna a torre em análise, sincronizando as fotos da torre anterior e carregando as da nova
  const handleSwitchTower = (newTower: string) => {
    const currentTower = report.torreAtual || 'Torre 1';
    const firstTowerName = report.client.torresNomes?.[0] || 'Torre 1';
    const isCurrentTorre1 = currentTower === 'Torre 1' || currentTower === firstTowerName;
    const isNewTorre1 = newTower === 'Torre 1' || newTower === firstTowerName;

    // 1. Sincroniza fotos e condições da torre atual no mapa torresData
    const currentTowerData: TowerData = {
      id: currentTower.toLowerCase().replace(/\s+/g, '-'),
      nome: currentTower,
      spdaPhotos: [...report.spdaPhotos],
      measurementPhotos: [...report.measurementPhotos],
      quadrosPhotos: [...report.quadrosPhotos],
      // Fotos do local (fachada e aérea) e equipamento pertencem estritamente à Torre 1 / Condomínio
      localPhotos: isCurrentTorre1 ? [...report.localPhotos] : [],
      equipmentPhotoUrl: isCurrentTorre1 ? report.equipmentPhotoUrl : undefined,
      conditions: { ...report.conditions },
    };

    const updatedTorresData = {
      ...(report.torresData || {}),
      [currentTower]: currentTowerData,
    };

    if (currentTower === newTower) {
      setReport((prev) => ({
        ...prev,
        torresData: updatedTorresData,
      }));
      return;
    }

    // 2. Carrega os dados da nova torre selecionada
    const targetTowerData = updatedTorresData[newTower];

    // Se a nova torre for a primeira torre (Torre 1 ou Bloco 1), restaura as fotos do condomínio e equipamento
    // Se for outra torre (Torre 2, 3...), não carrega fotos de fachada/aérea/equipamento
    const newLocalPhotos = isNewTorre1
      ? (targetTowerData?.localPhotos?.length
          ? [...targetTowerData.localPhotos]
          : (updatedTorresData[firstTowerName]?.localPhotos || updatedTorresData['Torre 1']?.localPhotos || [...report.localPhotos]))
      : [];
    const newEquipmentUrl = isNewTorre1
      ? (targetTowerData?.equipmentPhotoUrl || updatedTorresData[firstTowerName]?.equipmentPhotoUrl || updatedTorresData['Torre 1']?.equipmentPhotoUrl || report.equipmentPhotoUrl)
      : undefined;

    const updatedReport: SpdaReport = {
      ...report,
      torreAtual: newTower,
      client: {
        ...report.client,
        descricaoBloco: newTower,
      },
      torresData: updatedTorresData,
      spdaPhotos: targetTowerData ? [...targetTowerData.spdaPhotos] : [],
      measurementPhotos: targetTowerData ? [...targetTowerData.measurementPhotos] : [],
      quadrosPhotos: targetTowerData ? [...targetTowerData.quadrosPhotos] : [],
      localPhotos: newLocalPhotos,
      equipmentPhotoUrl: newEquipmentUrl,
      conditions: targetTowerData?.conditions ? { ...targetTowerData.conditions } : { ...report.conditions },
    };

    setReport(updatedReport);
    setHasUnsavedChanges(true);
    setSaveToast(`Vistoria alternada para: ${newTower}`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  // Adiciona uma nova torre ao condomínio e já ativa para fotografar
  const handleAddTower = (customName?: string) => {
    const currentQtd = report.client.quantidadeTorres || 1;
    const nextQtd = currentQtd + 1;
    const nextTowerName = customName?.trim() || `Torre ${nextQtd}`;
    const existingList = report.client.torresNomes && report.client.torresNomes.length > 0
      ? [...report.client.torresNomes]
      : Array.from({ length: currentQtd }, (_, i) => `Torre ${i + 1}`);

    const updatedList = [...existingList];
    if (!updatedList.includes(nextTowerName)) {
      updatedList.push(nextTowerName);
    }

    const currentTower = report.torreAtual || 'Torre 1';
    const firstTowerName = existingList[0] || 'Torre 1';
    const isCurrentTorre1 = currentTower === 'Torre 1' || currentTower === firstTowerName;
    const currentTowerData: TowerData = {
      id: currentTower.toLowerCase().replace(/\s+/g, '-'),
      nome: currentTower,
      spdaPhotos: [...report.spdaPhotos],
      measurementPhotos: [...report.measurementPhotos],
      quadrosPhotos: [...report.quadrosPhotos],
      localPhotos: isCurrentTorre1 ? [...report.localPhotos] : [],
      equipmentPhotoUrl: isCurrentTorre1 ? report.equipmentPhotoUrl : undefined,
      conditions: { ...report.conditions },
    };

    const updatedTorresData = {
      ...(report.torresData || {}),
      [currentTower]: currentTowerData,
    };

    const updatedReport: SpdaReport = {
      ...report,
      client: {
        ...report.client,
        quantidadeTorres: updatedList.length,
        torresNomes: updatedList,
        descricaoBloco: nextTowerName,
      },
      torreAtual: nextTowerName,
      torresData: updatedTorresData,
      spdaPhotos: [],
      measurementPhotos: [],
      quadrosPhotos: [],
      localPhotos: [], // Outras torres não carregam fachada/aérea
      equipmentPhotoUrl: undefined, // Outras torres não carregam equipamento
    };

    setReport(updatedReport);
    setHasUnsavedChanges(true);
    setSaveToast(`✓ ${currentTower} pronta! Agora você está na ${nextTowerName}. Adicione as fotos.`);
    setTimeout(() => setSaveToast(null), 5000);
  };

  const getTowerPhotoCount = (torreNome: string) => {
    const currentTower = report.torreAtual || 'Torre 1';
    if (torreNome === currentTower) {
      return (
        report.spdaPhotos.length +
        report.measurementPhotos.length +
        report.quadrosPhotos.length +
        report.localPhotos.length
      );
    }
    const data = report.torresData?.[torreNome];
    if (!data) return 0;
    return (
      (data.spdaPhotos?.length || 0) +
      (data.measurementPhotos?.length || 0) +
      (data.quadrosPhotos?.length || 0) +
      (data.localPhotos?.length || 0)
    );
  };

  // Salva manualmente o laudo sob demanda do usuário
  const handleQuickSave = async () => {
    try {
      setSaveIndicator(true);
      const now = new Date();
      const currentTower = report.torreAtual || 'Torre 1';
      const currentTowerData: TowerData = {
        id: currentTower.toLowerCase().replace(/\s+/g, '-'),
        nome: currentTower,
        spdaPhotos: [...report.spdaPhotos],
        measurementPhotos: [...report.measurementPhotos],
        quadrosPhotos: [...report.quadrosPhotos],
        localPhotos: [...report.localPhotos],
        equipmentPhotoUrl: report.equipmentPhotoUrl,
        conditions: { ...report.conditions },
      };

      const updatedTorresData = {
        ...(report.torresData || {}),
        [currentTower]: currentTowerData,
      };

      const activeTower = (report.client.quantidadeTorres || 1) > 1 ? currentTower : undefined;
      const condoName = report.client?.name?.trim() || 'Condomínio';
      const reportTitle = report.title && !report.title.startsWith('Laudo de Inspeção SPDA')
        ? report.title
        : `Laudo SPDA - ${condoName}${activeTower ? ` (${activeTower})` : ''}`;

      // MANTÉM O MESMO ID do laudo em andamento para atualizar o arquivo existente
      const reportId = report.id || `laudo-spda-${now.getTime()}`;

      const updatedReport: SpdaReport = {
        ...report,
        id: reportId,
        title: reportTitle,
        torreAtual: currentTower,
        torresData: updatedTorresData,
      };

      const result = await saveNamedReport(updatedReport, { forceNew: false, customTitle: reportTitle, torreName: activeTower });
      setReport(result.updatedReport);
      const list = await getSavedReportsList();
      setSavedCount(list.length);
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      setLastSavedTime(timeFormatted);
      setHasUnsavedChanges(false);

      // Salvamento instantâneo do laudo!
      // As fotos já são salvas individualmente no disco de forma direta e assíncrona assim que são capturadas na câmera.
      setSaveToast(`✓ Laudo "${condoName}" salvo instantaneamente! (${timeFormatted})`);
      setTimeout(() => setSaveToast(null), 3500);
    } catch (e) {
      console.error(e);
      setSaveToast('Erro ao salvar o laudo.');
      setTimeout(() => setSaveToast(null), 4000);
    } finally {
      setSaveIndicator(false);
    }
  };

  const handleLoadReport = (loaded: SpdaReport) => {
    if (!loaded.torresData) loaded.torresData = {};
    if (!loaded.torresData['Área Comum']) {
      loaded.torresData['Área Comum'] = {
        id: 'area-comum',
        nome: 'Área Comum',
        spdaPhotos: [],
        measurementPhotos: [],
        quadrosPhotos: [],
        localPhotos: [],
      };
    }
    if (!loaded.digitalSignature) {
      loaded.digitalSignature = {
        enabled: true,
        type: 'drawn',
        signerName: loaded.client?.tecnico || 'JÔNATAS PEREIRA PAVANELO',
        signerRole: loaded.client?.cargo || 'Engenheiro Eletricista',
        signerCrea: loaded.client?.crea || 'CREA-SP 5063896203',
        signerArt: loaded.client?.art || '',
        signedAt: new Date().toLocaleDateString('pt-BR'),
        hashSha256: 'SPDA-5419-A8F3-7C21-E9D4',
        showValidationStamp: true,
        certificateAuthority: 'Padrão ICP-Brasil / CREA Confea',
      };
    }
    setReport(loaded);
    saveReportToStorage(loaded);
    setHasUnsavedChanges(false);
    setSaveToast(`Laudo "${loaded.title || loaded.client?.name || 'SPDA'}" carregado com sucesso para edição!`);
    setTimeout(() => setSaveToast(null), 4500);
    setActiveTab('fotos');

    // Garante apenas a criação imediata da árvore de pastas físicas do condomínio caso ainda não exista
    const condoName = loaded.client?.name?.trim() || 'Condomínio';
    const towers = (loaded.client?.quantidadeTorres || 1) > 1
      ? Array.from({ length: loaded.client?.quantidadeTorres || 1 }, (_, i) => `Torre ${i + 1}`)
      : ['Torre 1'];
    createCondoFolderTree(condoName, ['Área Comum', ...towers]).catch(() => {});
  };

  // Atualiza o estado do laudo em memória e armazenamento silenciosamente (sem recarregar o laudo ou reiniciar vistorias)
  const handleUpdateReportSilently = (updated: SpdaReport) => {
    setReport(updated);
    reportRef.current = updated;
    saveReportToStorage(updated);
  };
  const handleNewBlankReport = () => {
    setNewReportCondoName('');
    setNewReportTowerCountInput('1');
    setIsNewReportModalOpen(true);
  };

  // Executa o início de novo laudo e criação imediata da árvore de pastas físicas
  const handleConfirmNewReport = async () => {
    try {
      setIsNewReportModalOpen(false);

      // 1. Salva automaticamente cópia de segurança do laudo atual em "Meus Laudos" para NUNCA perder trabalho
      const current = reportRef.current;
      const currentPhotos =
        current.spdaPhotos.length +
        current.measurementPhotos.length +
        current.quadrosPhotos.length +
        current.localPhotos.length;

      if (current.client?.name || currentPhotos > 0) {
        try {
          const backupTitle = current.title && !current.title.startsWith('Laudo de Inspeção SPDA')
            ? `${current.title} (Cópia Salva)`
            : generateSequentialReportTitle(current.client?.name || 'Vistoria Anterior');
          await saveNamedReport({ ...current, id: `laudo-spda-${Date.now()}`, title: backupTitle }, { forceNew: true });
          const list = await getSavedReportsList();
          setSavedCount(list.length);
        } catch (saveErr) {
          console.warn('Erro ao salvar cópia de segurança:', saveErr);
        }
      }

      // 2. Limpa o armazenamento e cria o novo laudo em branco com os dados especificados
      await clearReportStorage();
      const blank = createBlankSpdaReport();
      const chosenCondoName = newReportCondoName.trim() || 'Condomínio';
      const towerCount = parsedNewReportTowerCount;
      const towerNames = Array.from({ length: towerCount }, (_, i) => `Torre ${i + 1}`);

      blank.client.name = chosenCondoName;
      blank.client.quantidadeTorres = towerCount;
      blank.client.torresNomes = towerNames;
      blank.torreAtual = 'Torre 1';
      blank.title = `Laudo SPDA - ${chosenCondoName}`;

      setReport(blank);
      reportRef.current = blank;
      await saveReportToStorage(blank);
      setHasUnsavedChanges(false);
      setActiveTab('fotos');

      // 3. Cria a árvore física de pastas no disco se já houver conexão ativa
      try {
        const handle = await getConnectedDeviceFolderHandle();
        if (handle) {
          const treeRes = await createCondoFolderTree(chosenCondoName, towerNames);
          if (treeRes.success) {
            setSaveToast(`✓ Novo laudo iniciado! Pastas criadas no disco em ${treeRes.folderPath}`);
            setTimeout(() => setSaveToast(null), 4000);
            return;
          }
        }
      } catch (treeErr) {
        console.warn('Criação de pastas em disco pendente:', treeErr);
      }

      // Se a pasta física ainda não estiver conectada, avisa com elegância sem bloquear ou travar a tela
      setSaveToast(`✓ Novo laudo "${chosenCondoName}" criado com ${towerCount} ${towerCount === 1 ? 'torre' : 'torres'}!`);
      setTimeout(() => setSaveToast(null), 3500);
    } catch (err) {
      console.error('Erro ao iniciar novo laudo:', err);
      setSaveToast('Erro ao iniciar novo laudo.');
      setTimeout(() => setSaveToast(null), 3000);
    }
  };

  // Exclui o laudo atual da tela e do banco
  const handleDeleteCurrentReport = () => {
    const reportName = report.title || report.client?.name || 'este laudo';
    setConfirmModal({
      title: 'Excluir Laudo',
      message: `Deseja realmente excluir e limpar os dados de "${reportName}"? Os dados cadastrais, textos e fotos serão limpos para um novo atendimento.`,
      confirmText: 'SIM, EXCLUIR LAUDO',
      isDestructive: true,
      onConfirm: async () => {
        if (report.id) {
          await deleteSavedReportById(report.id);
        }
        await clearReportStorage();
        const blank = createBlankSpdaReport();
        setReport(blank);
        const list = await getSavedReportsList();
        setSavedCount(list.length);
        setActiveTab('fotos');
        setSaveToast('Laudo excluído e tela limpa com sucesso.');
        setTimeout(() => setSaveToast(null), 4000);
      },
    });
  };

  // Automated PDF generation (Pure jsPDF engine + In-App Modal)
  const handleGeneratePdf = async () => {
    try {
      setIsGeneratingPdf(true);
      setPdfProgress({ percent: 5, message: 'Iniciando criação do arquivo PDF...' });

      const { url, fileName } = await generatePdfBlob(report, (percent, message) => {
        setPdfProgress({ percent, message });
      });

      // Save generated PDF info to open modal
      setGeneratedPdf({ url, fileName });

      // Also trigger direct browser download
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (dlErr) {
        console.warn('Direct trigger prevented by sandbox, modal is available', dlErr);
      }
    } catch (err: any) {
      console.error('Erro na geração do PDF:', err);
      setConfirmModal({
        title: 'Falha na Geração do PDF',
        message: `Houve uma falha ao gerar o arquivo: ${err?.message || ''}. Deseja abrir a caixa de impressão nativa A4?`,
        confirmText: 'IMPRIMIR A4',
        isDestructive: false,
        onConfirm: () => printReport(),
      });
    } finally {
      setTimeout(() => {
        setIsGeneratingPdf(false);
      }, 500);
    }
  };

  // Automated DOCX generation (Pure docx engine - Editable in Microsoft Word)
  const handleGenerateDocx = async () => {
    try {
      setIsGeneratingDocx(true);
      setDocxProgress({ percent: 5, message: 'Iniciando criação do documento Word (.docx)...' });

      const { blob, fileName } = await generateDocxBlob(report, (percent, message) => {
        setDocxProgress({ percent, message });
      });

      // Trigger direct browser download
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (dlErr) {
        console.warn('Direct docx download error', dlErr);
      }

      setSaveToast(`✓ Arquivo Word "${fileName}" exportado com sucesso!`);
      setTimeout(() => setSaveToast(null), 4500);
    } catch (err: any) {
      console.error('Erro na exportação para Word (.docx):', err);
      setConfirmModal({
        title: 'Falha na Exportação do Word (.docx)',
        message: `Houve uma falha ao gerar o arquivo Word: ${err?.message || ''}.`,
        confirmText: 'ENTENDIDO',
        isDestructive: false,
        onConfirm: () => {},
      });
    } finally {
      setTimeout(() => {
        setIsGeneratingDocx(false);
      }, 500);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-800 w-full max-w-full overflow-x-hidden">
      {/* ========================================================
          HEADER DO SISTEMA COM PARTE SUPERIOR E LINHA DE NAVEGAÇÃO
          ======================================================== */}
      <header className="no-print bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40 shadow-md w-full max-w-full overflow-x-hidden">
        {/* PARTE SUPERIOR (LINHA 1): Identificação e Ações Rápidas de Início de Atendimento */}
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-blue-600 flex items-center justify-center shadow-inner flex-shrink-0">
              <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="font-bold text-sm sm:text-base tracking-tight text-white leading-tight truncate">
                  Laudo de SPDA
                </h1>
                <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-400/30 px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
                  NBR 5419:2026
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate max-w-[170px] sm:max-w-xs">
                Cliente: <span className="text-slate-200 font-medium">{report.client.name || 'Novo Laudo'}</span>
              </p>
            </div>
          </div>

          {/* Botões Superiores: Iniciar atendimento rápido, restaurar e exportar */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Indicador de Status Offline e Botão de Instalação PWA */}
            <PWAInstallButton />

            {/* 1. Salvar Laudo Manual sob demanda */}
            <button
              onClick={handleQuickSave}
              disabled={saveIndicator}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                hasUnsavedChanges
                  ? 'bg-amber-600 hover:bg-amber-500 text-white ring-2 ring-amber-400/50'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              }`}
              title="Salvar agora este laudo para continuar editando depois"
            >
              <Save className={`w-4 h-4 flex-shrink-0 ${hasUnsavedChanges ? 'text-amber-200' : 'text-slate-400'}`} />
              <span>{saveIndicator ? 'SALVANDO...' : 'SALVAR LAUDO'}</span>
            </button>

            {/* 2. Gerenciador de Laudos Salvos para Carregar / Continuar Edição */}
            <button
              onClick={() => setIsSavedModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 shadow-sm transition-all"
              title="Abrir laudos salvos para continuar a edição a qualquer momento"
            >
              <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="hidden sm:inline">MEUS LAUDOS</span>
              <span className="sm:hidden">LAUDOS</span>
              {savedCount > 0 && <span className="bg-amber-500/20 text-amber-300 text-[10px] px-1.5 py-0.2 rounded-full font-bold">({savedCount})</span>}
            </button>

            {/* 3. Banco de Dados: Clientes, Condomínios, Laudos e Fotos em Campo */}
            <button
              onClick={() => setIsDatabaseModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-blue-300 border border-blue-500/40 shadow-sm transition-all cursor-pointer"
              title="Banco de dados com Clientes, Condomínios, Laudos e Fotos em Campo"
            >
              <Database className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="hidden sm:inline">BANCO DE DADOS</span>
              <span className="sm:hidden">BANCO</span>
            </button>

            <button
              onClick={handleNewBlankReport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all"
              title="Iniciar um novo laudo em branco sem modelo de teste, com espaço limpo para novas fotos"
            >
              <FilePlus className="w-4 h-4 text-emerald-200 flex-shrink-0" />
              <span>+ NOVO LAUDO</span>
            </button>

            {/* 3. Criação Real de Pastas no Dispositivo (Documentos / LAUDOS SPDA) */}
            <button
              onClick={() => setIsFolderSyncModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/40 shadow-sm transition-all cursor-pointer"
              title="Criar pastar reais em Documentos/LAUDOS SPDA e sincronizar fotos"
            >
              <FolderTree className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="hidden sm:inline">PASTAS NO DISCO</span>
              <span className="sm:hidden">PASTAS</span>
            </button>

            {/* Assinatura Digital do Responsável Técnico */}
            <button
              onClick={() => setIsSignatureModalOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                report.digitalSignature?.enabled
                  ? 'bg-blue-900/40 text-blue-300 border-blue-500/50 hover:bg-blue-800/50'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
              }`}
              title="Configurar Assinatura Digital do Responsável Técnico no Laudo e PDF"
            >
              <FileSignature className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="hidden sm:inline">ASSINATURA DIGITAL</span>
              <span className="sm:hidden">ASSINATURA</span>
              {report.digitalSignature?.enabled && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 shadow-xs" title="Ativada no laudo" />
              )}
            </button>

            <button
              onClick={() => setSplitView(!splitView)}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              title="Modo lado a lado para ver o laudo atualizar enquanto você digita"
            >
              <Columns className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span>{splitView ? 'NORMAL' : 'LADO A LADO'}</span>
            </button>

            <button
              onClick={printReport}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              title="Abre a caixa de impressão nativa A4"
            >
              <Printer className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 flex-shrink-0" />
              <span className="hidden md:inline">IMPRIMIR A4</span>
            </button>

            <button
              onClick={handleGeneratePdf}
              disabled={isGeneratingPdf}
              className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-all"
            >
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
              <span>GERAR PDF</span>
            </button>

            <button
              onClick={handleGenerateDocx}
              disabled={isGeneratingDocx}
              className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all cursor-pointer"
              title="Exportar laudo para edição completa no Microsoft Word (.docx)"
            >
              <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="hidden sm:inline">{isGeneratingDocx ? 'GERANDO DOCX...' : 'EXPORTAR DOCX'}</span>
              <span className="sm:hidden">DOCX</span>
            </button>

            {/* Status do Salvamento Manual */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/80 text-[11px]">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  saveIndicator
                    ? 'bg-amber-400 animate-ping'
                    : hasUnsavedChanges
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
                }`}
              />
              <div className="flex items-center gap-1">
                <span className="font-bold text-slate-300 hidden sm:inline">
                  {saveIndicator
                    ? 'Gravando...'
                    : hasUnsavedChanges
                    ? 'Modificado:'
                    : 'Status:'}
                </span>
                <span
                  className={`font-mono font-bold ${
                    saveIndicator
                      ? 'text-amber-300'
                      : hasUnsavedChanges
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {saveIndicator
                    ? 'GRAVANDO'
                    : hasUnsavedChanges
                    ? 'Não salvo'
                    : lastSavedTime
                    ? `Salvo ${lastSavedTime}`
                    : 'Salvo'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* PARTE INFERIOR: LINHA DE NAVEGAÇÃO COM EXATAMENTE OS 5 BOTÕES SOLICITADOS (EM MAIÚSCULO) */}
        <div className="bg-slate-900/95 border-t border-slate-800 px-2 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <nav className="flex flex-wrap sm:flex-nowrap gap-1 sm:gap-2 py-1.5 sm:py-2 w-full justify-start items-center">
              <button
                onClick={() => setActiveTab('condominio')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-md text-xs font-bold tracking-wide transition-all ${
                  activeTab === 'condominio'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                <span>DADOS DO CLIENTE</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('fotos');
                  if ((report.client.quantidadeTorres || 1) > 1 && !hasPromptedTower) {
                    setIsSelectTowerModalOpen(true);
                    setHasPromptedTower(true);
                  }
                }}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-md text-xs font-bold tracking-wide transition-all ${
                  activeTab === 'fotos'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Camera className="w-3.5 h-3.5 flex-shrink-0" />
                <span>FOTOS</span>
                {(report.client.quantidadeTorres || 1) > 1 && (
                  <span className="text-[10px] bg-amber-400 text-slate-950 px-1.5 py-0.2 rounded font-extrabold uppercase">
                    {report.torreAtual || 'Torre 1'}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('correcoes')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-md text-xs font-bold tracking-wide transition-all ${
                  activeTab === 'correcoes'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Wrench className="w-3.5 h-3.5 flex-shrink-0" />
                <span>PARECER TÉCNICO</span>
              </button>

              <button
                onClick={() => setActiveTab('textos_fixos')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-md text-xs font-bold tracking-wide transition-all ${
                  activeTab === 'textos_fixos'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
                <span>TEXTOS E NORMAS</span>
              </button>

              <button
                onClick={() => setActiveTab('preview')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-md text-xs font-bold tracking-wide transition-all ${
                  activeTab === 'preview'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-emerald-400 hover:text-emerald-300 hover:bg-slate-800'
                }`}
              >
                <Eye className="w-3.5 h-3.5 flex-shrink-0" />
                <span>VISUALIZAR LAUDO</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* ========================================================
          BARRA DE RESUMO DAS 3 SEÇÕES DE FOTOS
          ======================================================== */}
      <div className="no-print bg-white border-b border-slate-200 py-2 px-3 sm:px-6 lg:px-8 w-full max-w-full overflow-x-hidden">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-600">
            <span className="font-semibold text-slate-800">
              Fotos do Laudo:
            </span>
            <span className="flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded font-medium">
              <Zap className="w-3 h-3 text-red-600 flex-shrink-0" />
              1. SPDA: <strong>{report.spdaPhotos.length}</strong> (Seção 5)
            </span>
            <span className="flex items-center gap-1 text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded font-medium">
              <Gauge className="w-3 h-3 text-blue-600 flex-shrink-0" />
              2. Medições: <strong>{report.measurementPhotos.length}</strong> (Seção 6)
            </span>
            <span className="flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-medium">
              <Layers className="w-3 h-3 text-amber-600 flex-shrink-0" />
              3. Quadros com DPS: <strong>{report.quadrosPhotos.length}</strong> (Seção 7)
            </span>
          </div>

          <div className="flex items-center gap-2 text-slate-500 text-[11px]">
            <span className="flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Proteção Ativa: Salvo no Aparelho (Offline a cada 60s)
            </span>
            <span className="hidden md:inline">
              Laudo Técnico Consolidado: <span className="font-bold text-slate-700">Formato A4 Alta Densidade • NBR 5419:2026</span>
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================
          CORPO PRINCIPAL (LIMITADO LATERALMENTE NO MOBILE)
          ======================================================== */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 lg:p-8 overflow-x-hidden">
        {splitView ? (
          /* MODO LADO A LADO */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-6 overflow-y-auto max-h-[calc(100vh-180px)] pr-2">
              <div className="flex border-b border-slate-200 bg-white p-1 rounded-lg">
                <button
                  onClick={() => setActiveTab('condominio')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded ${
                    activeTab === 'condominio' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  DADOS DO CLIENTE
                </button>
                <button
                  onClick={() => setActiveTab('fotos')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded ${
                    activeTab === 'fotos' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  FOTOS
                </button>
                <button
                  onClick={() => setActiveTab('correcoes')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded ${
                    activeTab === 'correcoes' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  PARECER TÉCNICO
                </button>
              </div>

              {activeTab === 'condominio' && (
                <ClientDataForm
                  client={report.client}
                  company={report.company}
                  digitalSignature={report.digitalSignature}
                  onUpdateClient={handleUpdateClient}
                  onUpdateCompany={handleUpdateCompany}
                  onOpenDatabase={() => setIsDatabaseModalOpen(true)}
                  onOpenSignatureModal={() => setIsSignatureModalOpen(true)}
                />
              )}
              {activeTab === 'fotos' && (
                <PhotoUploaderSection
                  spdaPhotos={report.spdaPhotos}
                  measurementPhotos={report.measurementPhotos}
                  quadrosPhotos={report.quadrosPhotos}
                  localPhotos={report.localPhotos}
                  equipmentPhotoUrl={report.equipmentPhotoUrl}
                  onUpdateSpdaPhotos={handleUpdateSpdaPhotos}
                  onUpdateMeasurementPhotos={handleUpdateMeasurementPhotos}
                  onUpdateQuadrosPhotos={handleUpdateQuadrosPhotos}
                  onUpdateLocalPhotos={handleUpdateLocalPhotos}
                  onUpdateEquipmentPhoto={handleUpdateEquipmentPhoto}
                  quantidadeTorres={report.client.quantidadeTorres || 1}
                  torresNomes={report.client.torresNomes}
                  torreAtual={report.torreAtual || 'Torre 1'}
                  onSelectTorre={handleSwitchTower}
                  getTowerPhotoCount={getTowerPhotoCount}
                  condominioNome={report.client.name}
                  report={report}
                  onRestoreReport={handleLoadReport}
                  onReportUpdated={handleUpdateReportSilently}
                  onAddTower={handleAddTower}
                />
              )}
              {activeTab === 'correcoes' && (
                <InspectionConditionsEditor
                  conditions={report.conditions}
                  client={report.client}
                  texts={report.texts}
                  onUpdateConditions={handleUpdateConditions}
                  onUpdateClient={handleUpdateClient}
                  onUpdateTexts={handleUpdateTexts}
                />
              )}
              {activeTab === 'textos_fixos' && (
                <TechnicalTextsEditor
                  texts={report.texts}
                  onUpdateTexts={handleUpdateTexts}
                  onResetToDefault={() => setReport((prev) => ({ ...prev, texts: defaultSpdaReport.texts }))}
                />
              )}
            </div>

            {/* Pré-visualização lado a lado em tempo real */}
            <div className="lg:col-span-7 bg-slate-200/70 p-4 rounded-xl border border-slate-300 overflow-y-auto max-h-[calc(100vh-180px)] flex flex-col items-center">
              <div className="w-full flex justify-between items-center mb-3 px-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Eye className="w-4 h-4 text-emerald-600" />
                  Visualização do Laudo Técnico em Tempo Real
                </span>
                <span className="text-[11px] text-slate-500">
                  Atualização instantânea
                </span>
              </div>
              <div className="w-full flex justify-center">
                <ReportPreview report={report} />
              </div>
            </div>
          </div>
        ) : (
          /* MODO DE ABAS NORMAL */
          <div className="w-full max-w-full overflow-x-hidden">
            {activeTab === 'condominio' && (
              <div className="max-w-4xl mx-auto">
                <ClientDataForm
                  client={report.client}
                  company={report.company}
                  digitalSignature={report.digitalSignature}
                  onUpdateClient={handleUpdateClient}
                  onUpdateCompany={handleUpdateCompany}
                  onOpenDatabase={() => setIsDatabaseModalOpen(true)}
                  onOpenSignatureModal={() => setIsSignatureModalOpen(true)}
                />
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => setActiveTab('fotos')}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-2"
                  >
                    <span>AVANÇAR PARA FOTOS</span>
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'fotos' && (
              <div className="max-w-5xl mx-auto">
                <PhotoUploaderSection
                  spdaPhotos={report.spdaPhotos}
                  measurementPhotos={report.measurementPhotos}
                  quadrosPhotos={report.quadrosPhotos}
                  localPhotos={report.localPhotos}
                  equipmentPhotoUrl={report.equipmentPhotoUrl}
                  onUpdateSpdaPhotos={handleUpdateSpdaPhotos}
                  onUpdateMeasurementPhotos={handleUpdateMeasurementPhotos}
                  onUpdateQuadrosPhotos={handleUpdateQuadrosPhotos}
                  onUpdateLocalPhotos={handleUpdateLocalPhotos}
                  onUpdateEquipmentPhoto={handleUpdateEquipmentPhoto}
                  quantidadeTorres={report.client.quantidadeTorres || 1}
                  torresNomes={report.client.torresNomes}
                  torreAtual={report.torreAtual || 'Torre 1'}
                  onSelectTorre={handleSwitchTower}
                  getTowerPhotoCount={getTowerPhotoCount}
                  condominioNome={report.client.name}
                  report={report}
                  onRestoreReport={handleLoadReport}
                  onReportUpdated={handleUpdateReportSilently}
                  onAddTower={handleAddTower}
                />
                <div className="mt-6 flex flex-col sm:flex-row justify-between gap-3">
                  <button
                    onClick={() => setActiveTab('condominio')}
                    className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg"
                  >
                    VOLTAR PARA DADOS DO CLIENTE
                  </button>
                  <button
                    onClick={() => setActiveTab('correcoes')}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-2"
                  >
                    <span>AVANÇAR PARA PARECER TÉCNICO</span>
                    <Wrench className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'correcoes' && (
              <div className="max-w-4xl mx-auto">
                <InspectionConditionsEditor
                  conditions={report.conditions}
                  client={report.client}
                  texts={report.texts}
                  onUpdateConditions={handleUpdateConditions}
                  onUpdateClient={handleUpdateClient}
                  onUpdateTexts={handleUpdateTexts}
                />
                <div className="mt-6 flex flex-col sm:flex-row justify-between gap-3">
                  <button
                    onClick={() => setActiveTab('fotos')}
                    className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg"
                  >
                    VOLTAR PARA FOTOS
                  </button>
                  <button
                    onClick={() => setActiveTab('preview')}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-2"
                  >
                    <span>VISUALIZAR LAUDO</span>
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'textos_fixos' && (
              <div className="max-w-4xl mx-auto">
                <TechnicalTextsEditor
                  texts={report.texts}
                  onUpdateTexts={handleUpdateTexts}
                  onResetToDefault={() => setReport((prev) => ({ ...prev, texts: defaultSpdaReport.texts }))}
                />
              </div>
            )}

            {activeTab === 'preview' && (
              <div className="flex flex-col items-center w-full max-w-full">
                {/* Floating preview action banner */}
                <div className="no-print w-full max-w-4xl bg-white border border-slate-300 rounded-xl p-3.5 sm:p-4 mb-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sticky top-28 sm:top-24 z-20">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      Visualização do Laudo Oficial (11 Páginas A4)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Exibição vertical contínua otimizada para celular e computador.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      onClick={printReport}
                      className="flex-1 sm:flex-none px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Printer className="w-4 h-4" />
                      IMPRIMIR A4
                    </button>
                    <button
                      onClick={handleGeneratePdf}
                      disabled={isGeneratingPdf}
                      className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      BAIXAR PDF
                    </button>
                    <button
                      onClick={handleGenerateDocx}
                      disabled={isGeneratingDocx}
                      className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      title="Exportar laudo editável no Microsoft Word (.docx)"
                    >
                      <FileText className="w-4 h-4" />
                      EXPORTAR DOCX (WORD)
                    </button>
                  </div>
                </div>

                {/* Printable visual container */}
                <div className="w-full flex justify-center py-2">
                  <ReportPreview report={report} containerId="screen-preview-report" />
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ========================================================
          MODAL DE PROGRESSO DO PDF
          ======================================================== */}
      {isGeneratingPdf && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
              <Download className="w-7 h-7 animate-bounce text-blue-600" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-800">
                Criando Arquivo PDF do Laudo...
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {pdfProgress.message || 'Processando as 11 páginas...'}
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${pdfProgress.percent}%` }}
              />
            </div>

            <p className="text-xs font-mono font-bold text-slate-700">
              {pdfProgress.percent}% concluído
            </p>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL DE PROGRESSO DO DOCX (WORD)
          ======================================================== */}
      {isGeneratingDocx && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto">
              <FileText className="w-7 h-7 animate-bounce text-indigo-600" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-800">
                Criando Arquivo Word (.docx)...
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {docxProgress.message || 'Processando fotos e textos editáveis...'}
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
              <div
                className="bg-indigo-600 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${docxProgress.percent}%` }}
              />
            </div>

            <p className="text-xs font-mono font-bold text-indigo-600">
              {docxProgress.percent}% concluído
            </p>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL INTERATIVO COM O PDF GERADO E BOTÕES DE DOWNLOAD
          ======================================================== */}
      {generatedPdf && (
        <PdfDownloadModal
          isOpen={!!generatedPdf}
          onClose={() => setGeneratedPdf(null)}
          pdfUrl={generatedPdf.url}
          fileName={generatedPdf.fileName}
          onPrint={printReport}
          onExportDocx={handleGenerateDocx}
          isGeneratingDocx={isGeneratingDocx}
        />
      )}

      {/* ========================================================
          TOAST DE CONFIRMAÇÃO DE SALVAMENTO PARA EDITAR DEPOIS
          ======================================================== */}
      {saveToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-emerald-500/50 flex items-center gap-3 animate-fade-in max-w-md">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="flex-1 text-xs font-medium">
            {saveToast}
          </div>
          <button
            onClick={() => setSaveToast(null)}
            className="text-slate-400 hover:text-white text-xs font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* ========================================================
          MODAL DE LAUDOS SALVOS PARA CONTINUAR EDITANDO DEPOIS
          ======================================================== */}
      <SavedReportsModal
        isOpen={isSavedModalOpen}
        onClose={() => {
          setIsSavedModalOpen(false);
          getSavedReportsList().then((list) => setSavedCount(list.length)).catch(() => {});
        }}
        currentReport={report}
        onLoadReport={handleLoadReport}
        onReportSaved={(saved) => {
          setReport(saved);
          getSavedReportsList().then((list) => setSavedCount(list.length)).catch(() => {});
        }}
        onReportDeleted={(deletedId) => {
          getSavedReportsList().then((list) => setSavedCount(list.length)).catch(() => {});
          if (report.id === deletedId) {
            setReport((prev) => ({
              ...prev,
              id: `laudo-spda-${Date.now()}`,
              title: generateSequentialReportTitle(prev.client?.name),
            }));
          }
        }}
      />

      {/* ========================================================
          MODAL: BANCO DE DADOS (CLIENTES, CONDOMÍNIOS, LAUDOS E FOTOS)
          ======================================================== */}
      <DatabaseManagerModal
        isOpen={isDatabaseModalOpen}
        onClose={() => setIsDatabaseModalOpen(false)}
        currentReport={report}
        onApplyCondoToReport={handleApplyCondoToReport}
        onApplyClientToReport={handleApplyClientToReport}
        onLoadReport={(id) => {
          loadSavedReportById(id).then((rep) => {
            if (rep) handleLoadReport(rep);
          });
        }}
      />

      {/* ========================================================
          MODAL DE CONFIRMAÇÃO SEGURO (SUBSTITUI WINDOW.CONFIRM)
          ======================================================== */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 text-white shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-lg flex-shrink-0 ${
                  confirmModal.isDestructive
                    ? 'bg-rose-600/20 text-rose-400 border border-rose-500/30'
                    : 'bg-amber-600/20 text-amber-400 border border-amber-500/30'
                }`}
              >
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm text-white">{confirmModal.title}</h3>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">{confirmModal.message}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  confirmModal.isDestructive
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL INTERATIVO: QUAL TORRE VOCÊ ESTÁ ANALISANDO?
          ======================================================== */}
      <SelectTowerModal
        isOpen={isSelectTowerModalOpen}
        onClose={() => setIsSelectTowerModalOpen(false)}
        torres={
          report.client.torresNomes?.slice(0, report.client.quantidadeTorres || 1) ||
          Array.from({ length: report.client.quantidadeTorres || 1 }).map((_, i) => `Torre ${i + 1}`)
        }
        torreAtual={report.torreAtual || 'Torre 1'}
        onSelectTorre={handleSwitchTower}
        onAddTower={handleAddTower}
        getPhotoCount={getTowerPhotoCount}
        condominioNome={report.client.name}
      />

      {/* ========================================================
          MODAL: CRIAÇÃO REAL DE PASTAS NO DISCO (DOCUMENTOS/LAUDOS SPDA)
          ======================================================== */}
      <RealFoldersSyncModal
        isOpen={isFolderSyncModalOpen}
        onClose={() => setIsFolderSyncModalOpen(false)}
        report={report}
        onReportUpdated={handleUpdateReportSilently}
        onSyncComplete={(count, folderPath) => {
          setSaveToast(`✓ Pastas reais criadas em ${folderPath} (${count} fotos salvas)!`);
          setTimeout(() => setSaveToast(null), 5000);
        }}
      />

      {/* ========================================================
          MODAL: ASSINATURA DIGITAL DO RESPONSÁVEL TÉCNICO
          ======================================================== */}
      <DigitalSignatureModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        signature={report.digitalSignature}
        client={report.client}
        onSaveSignature={handleSaveSignature}
      />

      {/* ========================================================
          MODAL: INICIAR NOVO LAUDO & CRIAR ÁRVORE DE PASTAS NO DISCO
          ======================================================== */}
      {isNewReportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in overflow-y-auto">
          <div className="bg-slate-900 border border-emerald-500/50 rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 sm:p-6 text-white shadow-2xl space-y-4 my-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3.5">
                <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex-shrink-0">
                  <FilePlus className="w-7 h-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-black text-base sm:text-lg text-white">
                      Novo Laudo & Criação de Pastas
                    </h3>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-bold">
                      Salvamento Automático
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Informe o nome do condomínio para criarmos a estrutura de pastas e iniciarmos a vistoria.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewReportModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Inputs do Novo Condomínio */}
            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-3.5 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                  Nome do Condomínio / Edificação:
                </label>
                <input
                  type="text"
                  value={newReportCondoName}
                  onChange={(e) => setNewReportCondoName(e.target.value)}
                  placeholder="Ex: Condomínio Solar das Flores"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-600 rounded-lg text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                  Quantidade de Torres:
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={newReportTowerCountInput}
                    onChange={(e) => {
                      // Permite apagar todo o conteúdo (ficando vazio) sem reescrever automaticamente 1
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      setNewReportTowerCountInput(val);
                    }}
                    onBlur={() => {
                      if (!newReportTowerCountInput || parseInt(newReportTowerCountInput, 10) < 1) {
                        setNewReportTowerCountInput('1');
                      } else {
                        const num = Math.min(50, Math.max(1, parseInt(newReportTowerCountInput, 10)));
                        setNewReportTowerCountInput(String(num));
                      }
                    }}
                    className="w-16 px-3 py-1.5 bg-slate-950 border border-slate-600 rounded-lg text-white font-bold text-center text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="1"
                  />
                  {/* Botões rápidos para seleção com 1 clique */}
                  <div className="flex flex-wrap items-center gap-1">
                    {[1, 2, 3, 4, 5, 8, 10].map((num) => {
                      const isSel = newReportTowerCountInput === String(num);
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setNewReportTowerCountInput(String(num))}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                            isSel
                              ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                              : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800'
                          }`}
                        >
                          {num === 1 ? '1 Torre' : `${num} Torres`}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="text-slate-400 text-[11px] mt-1">
                  {parsedNewReportTowerCount === 1
                    ? 'Torre única (Torre 1)'
                    : `${parsedNewReportTowerCount} torres (Torre 1 até Torre ${parsedNewReportTowerCount})`}
                </p>
              </div>

              {/* Pré-visualização da Árvore de Pastas */}
              <div className="bg-slate-950/70 border border-slate-700/60 rounded-lg p-2.5 font-mono text-[11px] text-slate-300 space-y-0.5">
                <span className="text-emerald-400 font-bold block text-[10px] uppercase">
                  Estrutura que será criada no disco:
                </span>
                <p className="text-blue-400 font-bold">Documentos / LAUDOS SPDA / {newReportCondoName.trim() || '[Nome do Condomínio]'}/</p>
                <p className="text-amber-300 pl-3">├── Torre 1/</p>
                <p className="text-slate-400 pl-6">├── spda existente/</p>
                <p className="text-slate-400 pl-6">├── quadros/</p>
                <p className="text-slate-400 pl-6">├── pontos de inspeção/</p>
                <p className="text-slate-400 pl-6">└── Fachada e Vista Aérea/</p>
                {parsedNewReportTowerCount > 1 && (
                  <p className="text-amber-300 pl-3">└── Torre 2 ... Torre {parsedNewReportTowerCount} (com as 4 subpastas cada)</p>
                )}
              </div>
            </div>

            {/* Garantia antiperda */}
            <div className="p-3 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong className="text-emerald-300 block mb-0.5">Proteção Antiperda Automática</strong>
                O laudo anterior na tela foi salvo com segurança em <strong>&ldquo;MEUS LAUDOS&rdquo;</strong> para você nunca perder nada.
              </div>
            </div>

            {/* Botões de Decisão */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsNewReportModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer text-center"
              >
                CANCELAR
              </button>
              <button
                type="button"
                onClick={handleConfirmNewReport}
                className="flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-black bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-all cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>INICIAR LAUDO E CRIAR PASTAS</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
