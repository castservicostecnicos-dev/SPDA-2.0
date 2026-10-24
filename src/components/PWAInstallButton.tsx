import React, { useState } from 'react';
import { Smartphone, Download, CheckCircle2, WifiOff, X, Share } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { AndroidApkModal } from './AndroidApkModal';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isOnline, install } = usePWAInstall();
  const [showAndroidModal, setShowAndroidModal] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Indicador de Status Offline / Online */}
        {!isOnline ? (
          <span
            className="flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold px-2 py-1 rounded-full animate-pulse whitespace-nowrap"
            title="O sistema está operando 100% offline. Todas as fotos, dados e laudos continuam sendo salvos normalmente no aparelho."
          >
            <WifiOff className="w-3 h-3 text-amber-400" />
            <span>OFFLINE (100% ATIVO)</span>
          </span>
        ) : isInstalled ? (
          <button
            type="button"
            onClick={() => setShowAndroidModal(true)}
            className="flex items-center gap-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer"
            title="Aplicativo instalado no celular com suporte offline completo. Clique para opções de APK."
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span className="hidden sm:inline">APP INSTALADO • GERAR APK</span>
            <span className="sm:hidden">INSTALADO (APK)</span>
          </button>
        ) : null}

        {/* Botão Principal de Instalar no Android / Gerar APK */}
        {!isInstalled && (
          <button
            type="button"
            onClick={() => setShowAndroidModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-600 via-teal-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 text-white shadow-sm border border-emerald-400/40 transition-all cursor-pointer whitespace-nowrap"
            title="Instalar no Android (WebAPK) ou gerar arquivo .APK para instalação"
          >
            <Smartphone className="w-3.5 h-3.5 text-emerald-200 shrink-0" />
            <span className="hidden sm:inline">INSTALAR NO ANDROID / APK</span>
            <span className="sm:hidden">ANDROID / APK</span>
            <span className="bg-emerald-400 text-slate-950 text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase">
              App
            </span>
          </button>
        )}

        {/* Botão secundário específico para iPhone (iOS Safari) */}
        {!isInstalled && isIOS && (
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-blue-300 border border-blue-500/30 transition-all cursor-pointer whitespace-nowrap"
            title="Ver como adicionar à tela de início no iPhone"
          >
            <Smartphone className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="hidden sm:inline">IPHONE (IOS)</span>
            <span className="sm:hidden">IOS</span>
          </button>
        )}
      </div>

      {/* Modal Completo de Instalação no Android & Criação de APK */}
      <AndroidApkModal
        isOpen={showAndroidModal}
        onClose={() => setShowAndroidModal(false)}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        onInstallPrompt={install}
      />

      {/* Modal Guia para iOS Safari */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-5 text-white shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-sm text-white">Instalar no iPhone (iOS)</h3>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="text-slate-400 hover:text-white p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Para instalar este aplicativo no seu iPhone e utilizá-lo <strong>100% sem internet</strong> durante a vistoria:
            </p>

            <ol className="space-y-2.5 text-xs text-slate-300 list-decimal pl-4">
              <li>
                Toque no botão <strong>Compartilhar</strong> (<Share className="w-3.5 h-3.5 inline text-blue-400 mx-0.5" />) na barra inferior do Safari.
              </li>
              <li>
                Role para baixo e selecione <strong>"Adicionar à Tela de Início"</strong>.
              </li>
              <li>
                Confirme em <strong>"Adicionar"</strong> no canto superior direito.
              </li>
            </ol>

            <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-lg p-2.5 text-[11px] text-emerald-200">
              ✓ Pronto! O aplicativo será aberto como um app nativo na tela do seu celular e funcionará mesmo em modo avião ou sem sinal de operadora.
            </div>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
