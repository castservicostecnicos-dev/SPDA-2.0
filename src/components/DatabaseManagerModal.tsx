/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Database,
  Building2,
  Users,
  FileText,
  Camera,
  X,
  Search,
  Plus,
  Trash2,
  Edit,
  Check,
  HardDrive,
  RefreshCw,
  FolderSync,
  AlertCircle,
  Eye,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  CondominioRecord,
  ClientRecord,
  LaudoRecord,
  PhotoRecord,
  getAllCondominios,
  saveCondominio,
  deleteCondominio,
  getAllClientes,
  saveCliente,
  deleteCliente,
  getAllLaudos,
  deleteLaudoRecord,
  getAllFieldPhotos,
  deleteFieldPhoto,
  getDatabaseStats,
  DatabaseStats,
  markPhotoAsSynced,
} from '../db/spdaDatabase';
import { SpdaReport, PhotoSlot } from '../types/spda';
import {
  saveBatchPhotosToDisk,
  getConnectedDeviceFolderHandle,
  pickAndConnectDeviceFolder,
} from '../utils/photoDeviceSync';
import { deleteSavedReportById } from '../utils/storage';

interface DatabaseManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentReport: SpdaReport;
  onApplyCondoToReport: (condo: CondominioRecord) => void;
  onApplyClientToReport: (client: ClientRecord) => void;
  onLoadReport: (reportId: string) => void;
}

export const DatabaseManagerModal: React.FC<DatabaseManagerModalProps> = ({
  isOpen,
  onClose,
  currentReport,
  onApplyCondoToReport,
  onApplyClientToReport,
  onLoadReport,
}) => {
  const [activeTab, setActiveTab] = useState<'condos' | 'clientes' | 'laudos' | 'fotos'>('condos');
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Dados carregados do banco mestre
  const [condos, setCondos] = useState<CondominioRecord[]>([]);
  const [clientes, setClientes] = useState<ClientRecord[]>([]);
  const [laudos, setLaudos] = useState<LaudoRecord[]>([]);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);

  // Formulário de novo condomínio
  const [editingCondo, setEditingCondo] = useState<Partial<CondominioRecord> | null>(null);
  // Formulário de novo cliente
  const [editingClient, setEditingClient] = useState<Partial<ClientRecord> | null>(null);

  // Visualização de foto ampliada
  const [previewPhoto, setPreviewPhoto] = useState<PhotoRecord | null>(null);

  // Sincronização em lote de fotos pendentes
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState('');
  const [deleteConfirmLaudoId, setDeleteConfirmLaudoId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadAllData();
      setEditingCondo(null);
      setEditingClient(null);
      setFeedback(null);
    }
  }, [isOpen]);

  const loadAllData = async () => {
    try {
      const [allCondos, allClientes, allLaudos, allPhotos, dbStats] = await Promise.all([
        getAllCondominios(),
        getAllClientes(),
        getAllLaudos(),
        getAllFieldPhotos(),
        getDatabaseStats(),
      ]);

      setCondos(allCondos);
      setClientes(allClientes);
      setLaudos(allLaudos);
      setPhotos(allPhotos);
      setStats(dbStats);
    } catch (err) {
      console.warn('Erro ao carregar dados do banco:', err);
    }
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ message, type });
    setTimeout(() => setFeedback(null), 4000);
  };

  // =========================================================================
  // HANDLERS DE CONDOMÍNIOS
  // =========================================================================
  const handleSaveCondo = async () => {
    if (!editingCondo?.nome || !editingCondo.nome.trim()) {
      showToast('O nome do condomínio é obrigatório.', 'error');
      return;
    }

    try {
      await saveCondominio({
        id: editingCondo.id,
        nome: editingCondo.nome,
        cnpj: editingCondo.cnpj,
        endereco: editingCondo.endereco,
        municipio: editingCondo.municipio,
        quantidadeTorres: editingCondo.quantidadeTorres || 1,
        torresNomes: editingCondo.torresNomes,
        sindico: editingCondo.sindico,
        contato: editingCondo.contato,
        telefone: editingCondo.telefone,
        email: editingCondo.email,
      });

      setEditingCondo(null);
      await loadAllData();
      showToast('Condomínio salvo com sucesso no banco de dados!');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao salvar condomínio.', 'error');
    }
  };

  const handleDeleteCondo = async (id: string, nome: string) => {
    if (!confirm(`Tem certeza que deseja excluir o condomínio "${nome}" do banco de dados?`)) return;
    try {
      await deleteCondominio(id);
      await loadAllData();
      showToast(`Condomínio "${nome}" excluído com sucesso!`);
    } catch (err: any) {
      showToast(err?.message || 'Erro ao excluir condomínio.', 'error');
    }
  };

  const handleApplyCondo = (condo: CondominioRecord) => {
    onApplyCondoToReport(condo);
    showToast(`Dados do "${condo.nome}" aplicados no laudo ativo!`);
    onClose();
  };

  // =========================================================================
  // HANDLERS DE CLIENTES
  // =========================================================================
  const handleSaveClient = async () => {
    if (!editingClient?.name || !editingClient.name.trim()) {
      showToast('O nome do cliente é obrigatório.', 'error');
      return;
    }

    try {
      await saveCliente({
        id: editingClient.id,
        name: editingClient.name,
        cnpj: editingClient.cnpj,
        local: editingClient.local,
        municipio: editingClient.municipio,
        ramoAtividade: editingClient.ramoAtividade,
        tecnico: editingClient.tecnico,
        cargo: editingClient.cargo,
        crea: editingClient.crea,
        art: editingClient.art,
        contato: editingClient.contato,
        telefone: editingClient.telefone,
        email: editingClient.email,
      });

      setEditingClient(null);
      await loadAllData();
      showToast('Cliente salvo com sucesso no banco de dados!');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao salvar cliente.', 'error');
    }
  };

  const handleDeleteClient = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja excluir o cliente "${name}" do banco de dados?`)) return;
    try {
      await deleteCliente(id);
      await loadAllData();
      showToast(`Cliente "${name}" excluído com sucesso!`);
    } catch (err: any) {
      showToast(err?.message || 'Erro ao excluir cliente.', 'error');
    }
  };

  const handleApplyClient = (cli: ClientRecord) => {
    onApplyClientToReport(cli);
    showToast(`Dados do cliente "${cli.name}" aplicados no laudo ativo!`);
    onClose();
  };

  // =========================================================================
  // HANDLERS DE LAUDOS
  // =========================================================================
  const handleDeleteLaudo = async (id: string, title: string) => {
    // 1. Otimista imediato: remove na fração de segundo da tela
    setLaudos((prev) => prev.filter((l) => l.id !== id));
    setDeleteConfirmLaudoId(null);
    showToast(`✓ Laudo "${title}" excluído definitivamente!`);

    // 2. Executa a exclusão definitiva em todos os bancos
    try {
      await deleteSavedReportById(id);
      await loadAllData();
    } catch (err: any) {
      await loadAllData();
      showToast(err?.message || 'Erro ao excluir laudo.', 'error');
    }
  };

  // =========================================================================
  // SINCRONIZAR TODAS AS FOTOS PENDENTES NA PASTA DO APARELHO
  // =========================================================================
  const handleSyncAllPendingPhotos = async () => {
    const unsynced = photos.filter((p) => !p.isSyncedToFolder && !p.syncedAt);
    if (unsynced.length === 0) {
      showToast('Todas as fotos já estão sincronizadas na pasta do aparelho!');
      return;
    }

    let rootHandle = await getConnectedDeviceFolderHandle();
    if (!rootHandle) {
      const res = await pickAndConnectDeviceFolder();
      if (!res.success) {
        showToast('Conecte a pasta do aparelho para sincronizar as fotos.', 'error');
        return;
      }
    }

    setIsSyncingAll(true);
    setSyncStatusMsg(`Iniciando sincronização de ${unsynced.length} foto(s)...`);

    try {
      const itemsToSync = unsynced.map((p) => ({
        photo: {
          id: p.id,
          url: p.dataUrl || (p.blob ? URL.createObjectURL(p.blob) : ''),
          caption: p.caption,
          diskFileName: p.diskFileName,
          measurementValue: p.measurementValue,
        } as PhotoSlot,
        section: p.section,
        towerName: p.towerName,
        photoIndex: p.photoIndex,
      }));

      const res = await saveBatchPhotosToDisk(
        itemsToSync,
        currentReport.client?.name || 'Condomínio',
        (saved, total, msg) => {
          setSyncStatusMsg(`${msg} (${saved}/${total})`);
        }
      );

      if (res.success) {
        await Promise.all(unsynced.map((p) => markPhotoAsSynced(p.id, p.diskFileName)));
        await loadAllData();
        showToast(`✓ ${res.savedCount} fotos salvas com sucesso na pasta do aparelho!`);
      } else {
        showToast(res.error || 'Falha ao sincronizar fotos na pasta.', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Erro ao sincronizar fotos.', 'error');
    } finally {
      setIsSyncingAll(false);
      setSyncStatusMsg('');
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!confirm('Deseja excluir esta foto do banco de dados?')) return;
    try {
      await deleteFieldPhoto(photoId);
      await loadAllData();
      showToast('Foto excluída do banco de dados!');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao excluir foto.', 'error');
    }
  };

  if (!isOpen) return null;

  const filteredCondos = condos.filter((c) =>
    (c.nome || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.endereco || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredClientes = clientes.filter((c) =>
    (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.cnpj || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredLaudos = laudos.filter((l) =>
    (l.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (l.condominioNome || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPhotos = photos.filter((p) =>
    (p.condoName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.towerName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.section || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-white animate-in fade-in duration-150">
        {/* CABEÇALHO COM STATS DO BANCO DE DADOS */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/95 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white leading-tight">Banco de Dados SPDA</h2>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                  LOCAL & OFFLINE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Armazenamento de Clientes, Condomínios, Laudos e Fotos realizadas em campo
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BARRA DE ESTATÍSTICAS RÁPIDAS */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-5 py-3 bg-slate-950/60 border-b border-slate-800/80 text-xs">
            <div className="bg-slate-800/40 p-2 rounded-lg border border-slate-700/50">
              <span className="text-[10px] text-slate-400 block font-semibold">Condomínios</span>
              <strong className="text-sm text-blue-400 font-extrabold">{stats.totalCondos}</strong>
            </div>
            <div className="bg-slate-800/40 p-2 rounded-lg border border-slate-700/50">
              <span className="text-[10px] text-slate-400 block font-semibold">Clientes</span>
              <strong className="text-sm text-emerald-400 font-extrabold">{stats.totalClientes}</strong>
            </div>
            <div className="bg-slate-800/40 p-2 rounded-lg border border-slate-700/50">
              <span className="text-[10px] text-slate-400 block font-semibold">Laudos Criados</span>
              <strong className="text-sm text-purple-400 font-extrabold">{stats.totalLaudos}</strong>
            </div>
            <div className="bg-slate-800/40 p-2 rounded-lg border border-slate-700/50">
              <span className="text-[10px] text-slate-400 block font-semibold">Fotos em Campo</span>
              <strong className="text-sm text-amber-400 font-extrabold">{stats.totalFotos}</strong>
            </div>
            <div className="bg-slate-800/40 p-2 rounded-lg border border-slate-700/50 col-span-2 sm:col-span-1">
              <span className="text-[10px] text-slate-400 block font-semibold">Uso no Disco</span>
              <strong className="text-sm text-slate-200 font-extrabold">~{stats.storageUsageEstimateMB} MB</strong>
            </div>
          </div>
        )}

        {/* FEEDBACK TOAST */}
        {feedback && (
          <div
            className={`mx-5 mt-3 p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
                : 'bg-rose-950/70 border border-rose-800 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* ABAS DO BANCO DE DADOS */}
        <div className="px-5 pt-3 border-b border-slate-800 flex items-center justify-between gap-3 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveTab('condos');
                setEditingCondo(null);
              }}
              className={`px-3.5 py-2 text-xs font-bold rounded-t-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'condos'
                  ? 'bg-slate-800 text-blue-400 border-t-2 border-blue-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Condomínios ({condos.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('clientes');
                setEditingClient(null);
              }}
              className={`px-3.5 py-2 text-xs font-bold rounded-t-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'clientes'
                  ? 'bg-slate-800 text-emerald-400 border-t-2 border-emerald-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Clientes ({clientes.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('laudos')}
              className={`px-3.5 py-2 text-xs font-bold rounded-t-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'laudos'
                  ? 'bg-slate-800 text-purple-400 border-t-2 border-purple-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Laudos & Itens ({laudos.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('fotos')}
              className={`px-3.5 py-2 text-xs font-bold rounded-t-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'fotos'
                  ? 'bg-slate-800 text-amber-400 border-t-2 border-amber-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>Fotos de Campo ({photos.length})</span>
            </button>
          </div>

          <div className="relative min-w-[160px] sm:min-w-[200px] mb-2">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar no banco..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-blue-500"
            />
          </div>
        </div>

        {/* CONTEÚDO PRINCIPAL DA ABA */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* ================================================================= */}
          {/* TAB 1: CONDOMÍNIOS */}
          {/* ================================================================= */}
          {activeTab === 'condos' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">Condomínios Cadastrados</h3>
                  <p className="text-xs text-slate-400">
                    Cadastre condomínios com endereço, quantidade de torres e contato para agilizar laudos
                  </p>
                </div>
                {!editingCondo && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingCondo({
                        nome: '',
                        endereco: '',
                        municipio: '',
                        cnpj: '',
                        quantidadeTorres: 1,
                        torresNomes: ['Torre 1'],
                      })
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>NOVO CONDOMÍNIO</span>
                  </button>
                )}
              </div>

              {/* Formulário de Edição / Cadastro */}
              {editingCondo && (
                <div className="bg-slate-800/90 border border-blue-500/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-700">
                    <h4 className="text-xs font-bold text-blue-300 uppercase tracking-wider">
                      {editingCondo.id ? 'Editar Condomínio' : 'Cadastrar Novo Condomínio'}
                    </h4>
                    <button
                      onClick={() => setEditingCondo(null)}
                      className="text-slate-400 hover:text-white text-xs"
                    >
                      Cancelar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Nome do Condomínio *</label>
                      <input
                        type="text"
                        value={editingCondo.nome || ''}
                        onChange={(e) => setEditingCondo({ ...editingCondo, nome: e.target.value })}
                        placeholder="Ex: Condomínio Residencial Parque das Flores"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">CNPJ</label>
                      <input
                        type="text"
                        value={editingCondo.cnpj || ''}
                        onChange={(e) => setEditingCondo({ ...editingCondo, cnpj: e.target.value })}
                        placeholder="Ex: 00.000.000/0001-00"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-slate-300 font-semibold block mb-1">Endereço Completo</label>
                      <input
                        type="text"
                        value={editingCondo.endereco || ''}
                        onChange={(e) => setEditingCondo({ ...editingCondo, endereco: e.target.value })}
                        placeholder="Ex: Rua das Palmeiras, 1500 - Jardim Primavera"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Município / UF</label>
                      <input
                        type="text"
                        value={editingCondo.municipio || ''}
                        onChange={(e) => setEditingCondo({ ...editingCondo, municipio: e.target.value })}
                        placeholder="Ex: São José dos Campos - SP"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Quantidade de Torres</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={editingCondo.quantidadeTorres || 1}
                        onChange={(e) => {
                          const n = Math.max(1, parseInt(e.target.value, 10) || 1);
                          const currentNomes = editingCondo.torresNomes || [];
                          const newNomes: string[] = [];
                          for (let i = 1; i <= n; i++) {
                            newNomes.push(currentNomes[i - 1] || `Torre ${i}`);
                          }
                          setEditingCondo({ ...editingCondo, quantidadeTorres: n, torresNomes: newNomes });
                        }}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Síndico / Responsável</label>
                      <input
                        type="text"
                        value={editingCondo.sindico || ''}
                        onChange={(e) => setEditingCondo({ ...editingCondo, sindico: e.target.value })}
                        placeholder="Ex: Carlos Eduardo Silveira"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Telefone / Contato</label>
                      <input
                        type="text"
                        value={editingCondo.telefone || ''}
                        onChange={(e) => setEditingCondo({ ...editingCondo, telefone: e.target.value })}
                        placeholder="Ex: (12) 99999-0000"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingCondo(null)}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveCondo}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs"
                    >
                      Salvar Condomínio
                    </button>
                  </div>
                </div>
              )}

              {/* Lista de Condomínios */}
              {filteredCondos.length === 0 ? (
                <div className="p-8 text-center bg-slate-800/30 rounded-xl border border-dashed border-slate-700 space-y-2">
                  <Building2 className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-400">Nenhum condomínio encontrado.</p>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingCondo({
                        nome: currentReport.client.name || 'Novo Condomínio',
                        endereco: currentReport.client.local,
                        municipio: currentReport.client.municipio,
                        cnpj: currentReport.client.cnpj,
                        quantidadeTorres: currentReport.client.quantidadeTorres || 1,
                        torresNomes: currentReport.client.torresNomes || ['Torre 1'],
                      })
                    }
                    className="text-xs text-blue-400 hover:underline font-semibold"
                  >
                    + Cadastrar condomínio do laudo atual
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredCondos.map((condo) => (
                    <div
                      key={condo.id}
                      className="p-3.5 bg-slate-800/60 hover:bg-slate-800 border border-slate-700 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{condo.nome}</span>
                          <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.2 rounded-full font-bold">
                            {condo.quantidadeTorres} {condo.quantidadeTorres > 1 ? 'Torres' : 'Torre'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">
                          {condo.endereco || 'Endereço não informado'} {condo.municipio ? `• ${condo.municipio}` : ''}
                        </p>
                        {condo.cnpj && (
                          <p className="text-[11px] text-slate-500 font-mono">CNPJ: {condo.cnpj}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleApplyCondo(condo)}
                          className="px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                          title="Carregar este condomínio no laudo em edição"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          <span>USAR NO LAUDO</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCondo(condo)}
                          className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                          title="Editar dados"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCondo(condo.id, condo.nome)}
                          className="p-1.5 bg-rose-950/40 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-800/40 rounded-lg transition-colors cursor-pointer"
                          title="Excluir condomínio"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: CLIENTES */}
          {/* ================================================================= */}
          {activeTab === 'clientes' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">Clientes & Contratantes</h3>
                  <p className="text-xs text-slate-400">
                    Gerencie o cadastro de clientes, responsáveis técnicos, CREA e ART
                  </p>
                </div>
                {!editingClient && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingClient({
                        name: '',
                        cnpj: '',
                        local: '',
                        municipio: '',
                        ramoAtividade: 'RESIDENCIAL',
                      })
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>NOVO CLIENTE</span>
                  </button>
                )}
              </div>

              {/* Formulário de Cliente */}
              {editingClient && (
                <div className="bg-slate-800/90 border border-emerald-500/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-700">
                    <h4 className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                      {editingClient.id ? 'Editar Cliente' : 'Cadastrar Novo Cliente'}
                    </h4>
                    <button
                      onClick={() => setEditingClient(null)}
                      className="text-slate-400 hover:text-white text-xs"
                    >
                      Cancelar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Nome do Cliente / Empresa *</label>
                      <input
                        type="text"
                        value={editingClient.name || ''}
                        onChange={(e) => setEditingClient({ ...editingClient, name: e.target.value })}
                        placeholder="Ex: Administradora de Bens Silva & Souza"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">CNPJ / CPF</label>
                      <input
                        type="text"
                        value={editingClient.cnpj || ''}
                        onChange={(e) => setEditingClient({ ...editingClient, cnpj: e.target.value })}
                        placeholder="Ex: 00.000.000/0001-00"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Responsável Técnico</label>
                      <input
                        type="text"
                        value={editingClient.tecnico || ''}
                        onChange={(e) => setEditingClient({ ...editingClient, tecnico: e.target.value })}
                        placeholder="Ex: Eng. Roberto Santos"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">CREA</label>
                      <input
                        type="text"
                        value={editingClient.crea || ''}
                        onChange={(e) => setEditingClient({ ...editingClient, crea: e.target.value })}
                        placeholder="Ex: 5061234567/SP"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Número ART</label>
                      <input
                        type="text"
                        value={editingClient.art || ''}
                        onChange={(e) => setEditingClient({ ...editingClient, art: e.target.value })}
                        placeholder="Ex: 28027230260000000"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Telefone / Celular</label>
                      <input
                        type="text"
                        value={editingClient.telefone || ''}
                        onChange={(e) => setEditingClient({ ...editingClient, telefone: e.target.value })}
                        placeholder="Ex: (12) 98888-0000"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingClient(null)}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveClient}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs"
                    >
                      Salvar Cliente
                    </button>
                  </div>
                </div>
              )}

              {/* Lista de Clientes */}
              {filteredClientes.length === 0 ? (
                <div className="p-8 text-center bg-slate-800/30 rounded-xl border border-dashed border-slate-700 space-y-2">
                  <Users className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-400">Nenhum cliente cadastrado.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredClientes.map((cli) => (
                    <div
                      key={cli.id}
                      className="p-3.5 bg-slate-800/60 hover:bg-slate-800 border border-slate-700 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <span className="text-sm font-bold text-white block">{cli.name}</span>
                        <p className="text-xs text-slate-400">
                          {cli.tecnico ? `Técnico: ${cli.tecnico}` : ''} {cli.crea ? `• CREA: ${cli.crea}` : ''} {cli.art ? `• ART: ${cli.art}` : ''}
                        </p>
                        {cli.cnpj && (
                          <p className="text-[11px] text-slate-500 font-mono">CNPJ: {cli.cnpj}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleApplyClient(cli)}
                          className="px-3 py-1.5 bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          <span>USAR NO LAUDO</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingClient(cli)}
                          className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClient(cli.id, cli.name)}
                          className="p-1.5 bg-rose-950/40 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-800/40 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: LAUDOS & ITENS */}
          {/* ================================================================= */}
          {activeTab === 'laudos' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white">Laudos Registrados no Banco</h3>
                <p className="text-xs text-slate-400">
                  Laudos salvos com seus dados técnicos, medições, condições e quantidade de fotos
                </p>
              </div>

              {filteredLaudos.length === 0 ? (
                <div className="p-8 text-center bg-slate-800/30 rounded-xl border border-dashed border-slate-700 space-y-2">
                  <FileText className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-400">Nenhum laudo registrado no banco ainda.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredLaudos.map((laudo) => (
                    <div
                      key={laudo.id}
                      className="p-3.5 bg-slate-800/60 hover:bg-slate-800 border border-slate-700 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <Building2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
                            <span className="font-extrabold text-sm sm:text-base text-amber-300 tracking-wide break-words">
                              {laudo.condominioNome || laudo.clienteNome || 'Condomínio'}
                            </span>
                          </div>
                          {laudo.id === currentReport.id && (
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-bold">
                              EM EDIÇÃO ATUAL
                            </span>
                          )}
                        </div>
                        <div className="text-xs sm:text-sm font-semibold text-white break-words flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                          <span>{laudo.title}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400">
                          <span className="bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-cyan-300 font-semibold">
                            {laudo.photoCount} foto(s) registradas
                          </span>
                          <span className="bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-slate-300">
                            Atualizado em: {new Date(laudo.updatedAt).toLocaleDateString('pt-BR')} às {new Date(laudo.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => {
                            onLoadReport(laudo.id);
                            onClose();
                          }}
                          className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          <span>ABRIR LAUDO</span>
                        </button>
                        {deleteConfirmLaudoId === laudo.id ? (
                          <div className="flex items-center gap-1.5 bg-rose-950/95 border border-rose-600/70 px-2.5 py-1 rounded-lg">
                            <span className="text-[11px] font-bold text-rose-200 whitespace-nowrap">Excluir definitivamente?</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteLaudo(laudo.id, laudo.title)}
                              className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold cursor-pointer shadow-xs"
                            >
                              SIM, EXCLUIR
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmLaudoId(null)}
                              className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-[10px] font-bold cursor-pointer"
                            >
                              CANCELAR
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmLaudoId(laudo.id)}
                            className="p-1.5 bg-rose-950/40 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-800/40 rounded-lg transition-colors cursor-pointer"
                            title="Excluir laudo definitivamente"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: FOTOS DE CAMPO */}
          {/* ================================================================= */}
          {activeTab === 'fotos' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Fotos Realizadas em Campo</h3>
                  <p className="text-xs text-slate-400">
                    Armazenadas em formato binário no banco offline. Imunes a fechamentos e travamentos do Chrome.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleSyncAllPendingPhotos}
                  disabled={isSyncingAll}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-950 font-extrabold rounded-lg text-xs shadow-md cursor-pointer transition-all whitespace-nowrap"
                >
                  <FolderSync className={`w-4 h-4 ${isSyncingAll ? 'animate-spin' : ''}`} />
                  <span>{isSyncingAll ? 'GRAVANDO NA PASTA...' : 'GRAVAR TODAS NA PASTA'}</span>
                </button>
              </div>

              {isSyncingAll && syncStatusMsg && (
                <div className="p-3 rounded-lg bg-amber-950/80 border border-amber-500/50 text-amber-200 text-xs font-semibold flex items-center gap-2 animate-pulse">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  <span>{syncStatusMsg}</span>
                </div>
              )}

              {filteredPhotos.length === 0 ? (
                <div className="p-8 text-center bg-slate-800/30 rounded-xl border border-dashed border-slate-700 space-y-2">
                  <Camera className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-400">Nenhuma foto registrada no banco de dados.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {filteredPhotos.map((photo) => (
                    <div
                      key={photo.id}
                      className="bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden shadow-xs flex flex-col group relative"
                    >
                      <div
                        onClick={() => setPreviewPhoto(photo)}
                        className="aspect-square bg-slate-950 relative cursor-pointer overflow-hidden"
                      >
                        <img
                          src={photo.dataUrl || (photo.blob ? URL.createObjectURL(photo.blob) : '')}
                          alt="Foto"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          loading="lazy"
                        />
                        <div className="absolute top-1 right-1">
                          {photo.isSyncedToFolder || photo.syncedAt ? (
                            <span className="p-1 rounded-full bg-emerald-600 text-white shadow-xs inline-block" title="Gravada na pasta física do aparelho">
                              <CheckCircle2 className="w-3 h-3" />
                            </span>
                          ) : (
                            <span className="p-1 rounded-full bg-amber-600 text-slate-950 shadow-xs inline-block" title="Salva no banco offline (pendente na pasta física)">
                              <Clock className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="p-2 space-y-0.5 text-[10px]">
                        <span className="font-bold text-amber-300 block truncate">{photo.towerName}</span>
                        <span className="text-slate-400 uppercase font-semibold block truncate">{photo.section}</span>
                        <span className="text-slate-500 block font-mono">{photo.diskFileName || 'foto.jpg'}</span>
                      </div>

                      <div className="p-1.5 pt-0 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(photo.id)}
                          className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                          title="Excluir foto do banco"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* MODAL DE PRÉ-VISUALIZAÇÃO DA FOTO */}
        {previewPhoto && (
          <div
            onClick={() => setPreviewPhoto(null)}
            className="fixed inset-0 z-60 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="max-w-2xl w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between text-xs text-white">
                <span className="font-bold">
                  {previewPhoto.towerName} • {previewPhoto.section.toUpperCase()} • {previewPhoto.diskFileName}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewPhoto(null)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
                <img
                  src={previewPhoto.dataUrl || (previewPhoto.blob ? URL.createObjectURL(previewPhoto.blob) : '')}
                  alt="Pré-visualização"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
          </div>
        )}

        {/* RODAPÉ DO MODAL */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between text-xs text-slate-400">
          <span>Banco de dados persistido via IndexedDB nativo (sem limite de 5MB).</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
          >
            FECHAR
          </button>
        </div>
      </div>
    </div>
  );
};
