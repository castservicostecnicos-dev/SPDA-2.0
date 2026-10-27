import React, { useState } from 'react';
import { Building2, Check, X, Camera, Plus, Trash2, AlertTriangle } from 'lucide-react';

interface SelectTowerModalProps {
  isOpen: boolean;
  onClose: () => void;
  torres: string[];
  torreAtual: string;
  onSelectTorre: (torre: string) => void;
  onAddTower?: (nome?: string) => void;
  onDeleteTower?: (torre: string) => void;
  getPhotoCount?: (torre: string) => number;
  condominioNome?: string;
}

export const SelectTowerModal: React.FC<SelectTowerModalProps> = ({
  isOpen,
  onClose,
  torres,
  torreAtual,
  onSelectTorre,
  onAddTower,
  onDeleteTower,
  getPhotoCount,
  condominioNome,
}) => {
  const [newTowerName, setNewTowerName] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const [towerToDelete, setTowerToDelete] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-white relative">
        {/* Header do Modal */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/95">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                Qual torre você está analisando?
              </h2>
              {condominioNome && (
                <p className="text-xs text-slate-400 leading-tight">
                  {condominioNome}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo com Lista de Torres e Área Comum */}
        <div className="p-5 overflow-y-auto space-y-3">
          {/* Card Permanente de Área Comum */}
          {(() => {
            const isAreaSelected = torreAtual === 'Área Comum';
            const areaCount = getPhotoCount ? getPhotoCount('Área Comum') : 0;
            return (
              <div
                onClick={() => {
                  onSelectTorre('Área Comum');
                  onClose();
                }}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                  isAreaSelected
                    ? 'bg-emerald-600/20 border-emerald-500 shadow-md ring-1 ring-emerald-500/50'
                    : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 hover:border-emerald-500/50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                      isAreaSelected ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-emerald-400'
                    }`}
                  >
                    AC
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-white">
                        Área Comum
                      </span>
                      <span className="text-[9px] font-bold uppercase bg-emerald-500/30 text-emerald-300 border border-emerald-400/30 px-1.5 py-0.2 rounded">
                        Comum a todos os laudos
                      </span>
                      {isAreaSelected && (
                        <span className="text-[9px] font-extrabold uppercase bg-emerald-500 text-white px-1.5 py-0.2 rounded">
                          Atual
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                      <Camera className="w-3 h-3 text-slate-500" />
                      <span>{areaCount > 0 ? `${areaCount} foto(s)` : 'Sem fotos'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex-shrink-0">
                  {isAreaSelected ? (
                    <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full border border-slate-600 hover:border-emerald-400 flex items-center justify-center" />
                  )}
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {torres.filter((t) => t !== 'Área Comum').map((torreNome, idx) => {
              const isSelected = (torreAtual || torres[0]) === torreNome;
              const photoCount = getPhotoCount ? getPhotoCount(torreNome) : 0;
              const nonAreaTowers = torres.filter((t) => t !== 'Área Comum');
              const canDelete = Boolean(onDeleteTower && nonAreaTowers.length > 1);

              return (
                <div
                  key={torreNome}
                  onClick={() => {
                    onSelectTorre(torreNome);
                    onClose();
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 group relative ${
                    isSelected
                      ? 'bg-blue-600/20 border-blue-500 shadow-md shadow-blue-900/20 ring-1 ring-blue-500/50'
                      : 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/80 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-700 text-slate-300 group-hover:bg-slate-600 group-hover:text-white'
                      }`}
                    >
                      {idx + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-bold truncate ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                          {torreNome}
                        </span>
                        {isSelected && (
                          <span className="text-[9px] font-extrabold uppercase bg-blue-500 text-white px-1.5 py-0.2 rounded">
                            Atual
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                        <Camera className="w-3 h-3 text-slate-500" />
                        <span>{photoCount > 0 ? `${photoCount} foto(s)` : 'Sem fotos'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canDelete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTowerToDelete(torreNome);
                        }}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer"
                        title={`Excluir ${torreNome} e todas as suas fotos`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}

                    {isSelected ? (
                      <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-xs">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border border-slate-600 group-hover:border-blue-400 flex items-center justify-center transition-colors">
                        <div className="w-2 h-2 rounded-full bg-transparent group-hover:bg-blue-400/50" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Card para Adicionar Nova Torre Diretamente */}
            {onAddTower && (
              <div className="p-3 rounded-xl border border-dashed border-blue-500/50 bg-blue-950/20 hover:bg-blue-950/40 transition-all flex flex-col justify-center">
                {showAddInput ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newTowerName}
                      onChange={(e) => setNewTowerName(e.target.value)}
                      placeholder={`Ex: Torre ${torres.length + 1}`}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-blue-500"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const name = newTowerName.trim() || `Torre ${torres.length + 1}`;
                          onAddTower(name);
                          setNewTowerName('');
                          setShowAddInput(false);
                          onClose();
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const name = newTowerName.trim() || `Torre ${torres.length + 1}`;
                          onAddTower(name);
                          setNewTowerName('');
                          setShowAddInput(false);
                          onClose();
                        }}
                        className="flex-1 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold cursor-pointer"
                      >
                        Salvar e Abrir
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddInput(false)}
                        className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-xs cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 w-full">
                    <button
                      type="button"
                      onClick={() => {
                        const nextName = `Torre ${torres.length + 1}`;
                        onAddTower(nextName);
                        onClose();
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-blue-300 hover:text-white bg-blue-600/20 hover:bg-blue-600 rounded-lg transition-all cursor-pointer"
                    >
                      <Plus className="w-4 h-4 text-amber-300" />
                      <span>+ ADICIONAR TORRE {torres.length + 1}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddInput(true)}
                      className="px-2.5 py-2.5 text-[10px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                      title="Digitar nome personalizado"
                    >
                      Outro nome
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal de Confirmação para Excluir Torre e Suas Fotos */}
        {towerToDelete && (
          <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-sm w-full shadow-2xl text-white space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base leading-snug">
                    Excluir {towerToDelete}?
                  </h3>
                  <p className="text-xs text-rose-300 font-medium">
                    Ação irreversível
                  </p>
                </div>
              </div>

              <div className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-1.5">
                <p>
                  A <strong>{towerToDelete}</strong> e todas as fotos registradas nela ({getPhotoCount ? getPhotoCount(towerToDelete) : 0} foto(s)) serão <strong>eliminadas definitivamente</strong>.
                </p>
                <p className="text-amber-300 text-[11px]">
                  ✓ Nenhuma foto órfã permanecerá no laudo, no PDF ou no documento Word.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTowerToDelete(null)}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const toDel = towerToDelete;
                    setTowerToDelete(null);
                    onDeleteTower?.(toDel);
                  }}
                  className="px-3.5 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir Torre e Fotos</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rodapé do Modal */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {torres.filter((t) => t !== 'Área Comum').length > 1
              ? 'Dica: Você pode excluir uma torre indesejada clicando na lixeira.'
              : 'Pelo menos 1 torre deve permanecer cadastrada.'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
