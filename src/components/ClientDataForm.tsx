import React, { useState, useEffect } from 'react';
import { ClientData, CompanyData, DigitalSignatureData } from '../types/spda';
import { SJC_OFFICIAL_LOGO_DATA_URL } from '../assets/logo';
import { Building2, UserCheck, Phone, MapPin, Calendar, FileText, Shield, Database, FileSignature, Trash2, AlertTriangle } from 'lucide-react';

interface ClientDataFormProps {
  client: ClientData;
  company: CompanyData;
  digitalSignature?: DigitalSignatureData;
  onUpdateClient: (updated: Partial<ClientData>) => void;
  onUpdateCompany: (updated: Partial<CompanyData>) => void;
  onOpenDatabase?: () => void;
  onOpenSignatureModal?: () => void;
  onDeleteTower?: (torre: string) => void;
}

export const ClientDataForm: React.FC<ClientDataFormProps> = ({
  client,
  company,
  digitalSignature,
  onUpdateClient,
  onUpdateCompany,
  onOpenDatabase,
  onOpenSignatureModal,
  onDeleteTower,
}) => {
  const [towerCountInput, setTowerCountInput] = React.useState<string>(String(client.quantidadeTorres || 1));
  const [towerToDelete, setTowerToDelete] = React.useState<string | null>(null);

  React.useEffect(() => {
    setTowerCountInput(String(client.quantidadeTorres || 1));
  }, [client.quantidadeTorres]);
  return (
    <div className="space-y-6">
      {/* Dados do Cliente e da Obra */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                Dados do Cliente & Instalação
              </h3>
            </div>
          </div>
          {onOpenDatabase && (
            <button
              type="button"
              onClick={onOpenDatabase}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer self-start sm:self-auto"
              title="Carregar dados de condomínio ou cliente já cadastrado no banco"
            >
              <Database className="w-4 h-4 text-emerald-600" />
              <span>CARREGAR DO BANCO DE DADOS</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nome do Cliente / Edifício *
            </label>
            <input
              type="text"
              value={client.name}
              onChange={(e) => onUpdateClient({ name: e.target.value })}
              placeholder="Ex: Condomínio Residencial Vista Verde"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              CNPJ ou CPF do Cliente *
            </label>
            <input
              type="text"
              value={client.cnpj}
              onChange={(e) => onUpdateClient({ cnpj: e.target.value })}
              placeholder="Ex: 72.766.736/0003-48"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Local / Endereço Completo *
            </label>
            <input
              type="text"
              value={client.local}
              onChange={(e) => onUpdateClient({ local: e.target.value })}
              placeholder="Ex: Av. Central, 500 - Jardim América"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Município / UF *
            </label>
            <input
              type="text"
              value={client.municipio}
              onChange={(e) => onUpdateClient({ municipio: e.target.value })}
              placeholder="Ex: SÃO JOSÉ DOS CAMPOS - SP"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Ramo de Atividade *
            </label>
            <input
              type="text"
              value={client.ramoAtividade}
              onChange={(e) => onUpdateClient({ ramoAtividade: e.target.value })}
              placeholder="Ex: RESIDENCIAL / COMERCIAL / INDUSTRIAL"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Período de Avaliação / Data da Inspeção *
            </label>
            <div className="relative">
              <input
                type="text"
                value={client.periodoAvaliacao}
                onChange={(e) => onUpdateClient({ periodoAvaliacao: e.target.value })}
                placeholder="Ex: 23/06/2026"
                className="w-full pl-9 pr-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Data de Emissão (Extenso)
            </label>
            <input
              type="text"
              value={client.dataEmissaoExtenso}
              onChange={(e) => onUpdateClient({ dataEmissaoExtenso: e.target.value })}
              placeholder="Ex: 23 de Junho de 2026"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        {/* ========================================================
            CONFIGURAÇÃO DA QUANTIDADE DE TORRES DO CONDOMÍNIO
            ======================================================== */}
        <div className="mt-6 pt-5 border-t border-slate-200">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">
                  Quantidade de Torres do Condomínio *
                </h4>
              </div>
            </div>
            {(client.quantidadeTorres || 1) > 1 && (
              <span className="text-xs font-extrabold bg-blue-100 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-full whitespace-nowrap">
                {client.quantidadeTorres} Torres Cadastradas
              </span>
            )}
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Total de Torres:
                </label>
                <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden shadow-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const current = client.quantidadeTorres || 1;
                      const next = Math.max(1, current - 1);
                      const currentNomes = client.torresNomes || [];
                      const newNomes: string[] = [];
                      for (let i = 1; i <= next; i++) {
                        newNomes.push(currentNomes[i - 1] || `Torre ${i}`);
                      }
                      onUpdateClient({ quantidadeTorres: next, torresNomes: newNomes });
                    }}
                    disabled={(client.quantidadeTorres || 1) <= 1}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-bold transition-colors cursor-pointer"
                    title="Diminuir"
                  >
                    -
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={towerCountInput}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setTowerCountInput(raw);
                      if (raw !== '') {
                        const num = parseInt(raw, 10);
                        if (num >= 1 && num <= 50) {
                          const currentNomes = client.torresNomes || [];
                          const newNomes: string[] = [];
                          for (let i = 1; i <= num; i++) {
                            newNomes.push(currentNomes[i - 1] || `Torre ${i}`);
                          }
                          onUpdateClient({ quantidadeTorres: num, torresNomes: newNomes });
                        }
                      }
                    }}
                    onBlur={() => {
                      if (!towerCountInput || parseInt(towerCountInput, 10) < 1) {
                        setTowerCountInput('1');
                        const currentNomes = client.torresNomes || [];
                        onUpdateClient({ quantidadeTorres: 1, torresNomes: [currentNomes[0] || 'Torre 1'] });
                      } else {
                        const num = Math.min(50, Math.max(1, parseInt(towerCountInput, 10)));
                        setTowerCountInput(String(num));
                      }
                    }}
                    className="w-16 py-1.5 text-center text-sm font-bold text-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const current = client.quantidadeTorres || 1;
                      const next = Math.min(50, current + 1);
                      const currentNomes = client.torresNomes || [];
                      const newNomes: string[] = [];
                      for (let i = 1; i <= next; i++) {
                        newNomes.push(currentNomes[i - 1] || `Torre ${i}`);
                      }
                      onUpdateClient({ quantidadeTorres: next, torresNomes: newNomes });
                    }}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 font-bold transition-colors cursor-pointer"
                    title="Aumentar"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Botões rápidos de quantidade */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[1, 2, 3, 4, 5, 7, 10, 12].map((num) => {
                  const isCurrent = (client.quantidadeTorres || 1) === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        const currentNomes = client.torresNomes || [];
                        const newNomes: string[] = [];
                        for (let i = 1; i <= num; i++) {
                          newNomes.push(currentNomes[i - 1] || `Torre ${i}`);
                        }
                        onUpdateClient({ quantidadeTorres: num, torresNomes: newNomes });
                      }}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                        isCurrent
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {num === 1 ? '1 Torre (Única)' : `${num} Torres`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Alerta explicativo */}
            {(client.quantidadeTorres || 1) > 1 ? (
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-900 p-3 rounded-lg text-xs">
                  <div className="font-bold text-blue-700">✓ Atendimento Multi-Torres Ativo:</div>
                  <div className="text-blue-800">
                    Ao entrar no setor de fotos, o sistema perguntará <strong>qual torre você está analisando</strong> para registrar as vistorias e fotos separadamente no arquivo interno da plataforma.
                  </div>
                </div>

                <div className="pt-1">
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1.5">
                    Torres cadastradas (clique no nome para personalizar se desejar):
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {Array.from({ length: client.quantidadeTorres || 1 }).map((_, idx) => {
                      const torreDefault = `Torre ${idx + 1}`;
                      const torreVal = client.torresNomes && client.torresNomes[idx] !== undefined ? client.torresNomes[idx] : '';
                      return (
                        <div key={idx} className="flex items-center gap-1.5 bg-white border border-slate-200 p-1.5 rounded-lg shadow-2xs">
                          <span className="w-5 h-5 rounded bg-blue-100 text-blue-700 font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={torreVal}
                            onChange={(e) => {
                              const copy = [...(client.torresNomes || [])];
                              while (copy.length < (client.quantidadeTorres || 1)) {
                                copy.push(`Torre ${copy.length + 1}`);
                              }
                              copy[idx] = e.target.value;
                              onUpdateClient({ torresNomes: copy });
                            }}
                            className="w-full text-xs font-semibold text-slate-800 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                            placeholder={torreDefault}
                          />
                          {torreVal !== '' && (
                            <button
                              type="button"
                              onClick={() => {
                                const copy = [...(client.torresNomes || [])];
                                while (copy.length < (client.quantidadeTorres || 1)) {
                                  copy.push(`Torre ${copy.length + 1}`);
                                }
                                copy[idx] = '';
                                onUpdateClient({ torresNomes: copy });
                              }}
                              className="text-slate-400 hover:text-rose-500 px-1 text-xs cursor-pointer"
                              title="Limpar nome"
                            >
                              ✕
                            </button>
                          )}
                          {(client.quantidadeTorres || 1) > 1 && onDeleteTower && (
                            <button
                              type="button"
                              onClick={() => {
                                const targetName = torreVal.trim() || torreDefault;
                                setTowerToDelete(targetName);
                              }}
                              className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                              title={`Excluir ${torreVal.trim() || torreDefault} e todas as suas fotos`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
                    <span className="text-emerald-600 font-bold">✓ Proteção contra fotos órfãs:</span>
                    Ao excluir uma torre, todas as fotos cadastradas nela são automaticamente eliminadas do laudo, do PDF e do DOCX.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Condomínio com torre individual (padrão). Se o condomínio possuir mais de uma torre (ex: 5, 7 ou 10 torres), selecione a quantidade acima.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Responsável Técnico & Emissão */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                Responsável Técnico & ART
              </h3>
            </div>
          </div>

          {onOpenSignatureModal && (
            <button
              type="button"
              onClick={onOpenSignatureModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <FileSignature className="w-4 h-4 text-blue-600" />
              <span>ASSINATURA DIGITAL</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nome do Engenheiro / Técnico *
            </label>
            <input
              type="text"
              value={client.tecnico}
              onChange={(e) => onUpdateClient({ tecnico: e.target.value })}
              placeholder="Ex: JÔNATAS PEREIRA PAVANELO"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Título Profissional *
            </label>
            <input
              type="text"
              value={client.cargo}
              onChange={(e) => onUpdateClient({ cargo: e.target.value })}
              placeholder="Ex: Engenheiro Eletricista"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Registro Profissional (CREA / CFT) *
            </label>
            <input
              type="text"
              value={client.crea}
              onChange={(e) => onUpdateClient({ crea: e.target.value })}
              placeholder="Ex: CREA-SP 5063896203"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Número da ART / RRT
            </label>
            <input
              type="text"
              value={client.art}
              onChange={(e) => onUpdateClient({ art: e.target.value })}
              placeholder="Ex: 28027230230912"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all font-mono"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Cidade de Emissão do Laudo
            </label>
            <input
              type="text"
              value={client.cidadeEmissao}
              onChange={(e) => onUpdateClient({ cidadeEmissao: e.target.value })}
              placeholder="Ex: São José dos Campos"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        {/* Card Informativo e Acesso à Assinatura Digital */}
        {onOpenSignatureModal && (
          <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
                <FileSignature className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs sm:text-sm text-slate-900">
                    Assinatura Digital no Documento
                  </span>
                  <span
                    className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                      digitalSignature?.enabled
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {digitalSignature?.enabled ? 'Ativada no Laudo' : 'Desativada'}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 block">
                  {digitalSignature?.enabled
                    ? `${digitalSignature.signerName || client.tecnico} • ${digitalSignature.signerCrea || client.crea}`
                    : 'Nenhuma assinatura digital anexada'}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenSignatureModal}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5 self-start sm:self-auto"
            >
              <FileSignature className="w-4 h-4" />
              <span>CONFIGURAR ASSINATURA</span>
            </button>
          </div>
        )}
      </div>

      {/* Dados da Empresa Emissora (Cabeçalho e Rodapé de Todas as Folhas) */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100 mb-5">
          <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">
              Dados da Empresa Emissora & Cabeçalho/Rodapé
            </h3>
            <p className="text-xs text-slate-500">
              Logomarca oficial da empresa (SJC Engenharia), timbre, razão social, CNPJ e endereço do rodapé.
            </p>
          </div>
        </div>

        {/* Logomarca Oficial da Empresa */}
        <div className="mb-5 p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide mb-1">
                Logotipo da Empresa no Cabeçalho
              </label>
              <p className="text-xs text-slate-500">
                Logomarca oficial padrão SJC Engenharia & Soluções (utilizada em todas as páginas do modelo). Se desejar alterar ou enviar arquivo próprio, use o botão ao lado.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {/* Preview da Logo atual */}
              <div className="border border-slate-300 rounded p-1 bg-white shadow-xs">
                <img
                  src={company.logoUrl || SJC_OFFICIAL_LOGO_DATA_URL}
                  alt="Logo Empresa"
                  className="h-11 max-w-[150px] object-contain rounded-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="cursor-pointer inline-flex items-center justify-center px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded shadow-xs transition-colors">
                  <span>Alterar Imagem</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (reader.result) {
                            onUpdateCompany({ logoUrl: reader.result as string });
                          }
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
                {company.logoUrl && company.logoUrl !== SJC_OFFICIAL_LOGO_DATA_URL && (
                  <button
                    type="button"
                    onClick={() => onUpdateCompany({ logoUrl: SJC_OFFICIAL_LOGO_DATA_URL })}
                    className="text-[11px] text-red-600 hover:text-red-700 font-medium underline text-center"
                  >
                    Restaurar Logo Padrão
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Razão Social / Nome Fantasia
            </label>
            <input
              type="text"
              value={company.name}
              onChange={(e) => onUpdateCompany({ name: e.target.value })}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              CNPJ da Empresa
            </label>
            <input
              type="text"
              value={company.cnpj}
              onChange={(e) => onUpdateCompany({ cnpj: e.target.value })}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Telefone de Contato
            </label>
            <input
              type="text"
              value={company.phone}
              onChange={(e) => onUpdateCompany({ phone: e.target.value })}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Texto da Marca d'Água
            </label>
            <input
              type="text"
              value={company.watermarkText}
              onChange={(e) => onUpdateCompany({ watermarkText: e.target.value })}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all font-mono"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Endereço Completo no Rodapé
            </label>
            <input
              type="text"
              value={company.address}
              onChange={(e) => onUpdateCompany({ address: e.target.value })}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="watermark-toggle"
              checked={company.showWatermark}
              onChange={(e) => onUpdateCompany({ showWatermark: e.target.checked })}
              className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
            />
            <label htmlFor="watermark-toggle" className="text-xs font-medium text-slate-700">
              Exibir marca d'água diagonal no fundo das páginas
            </label>
          </div>
        </div>
      </div>

      {/* Modal de Confirmação para Excluir Torre */}
      {towerToDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
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
                A <strong>{towerToDelete}</strong> e todas as fotos registradas nela serão <strong>completamente excluídas do laudo</strong>.
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
    </div>
  );
};
