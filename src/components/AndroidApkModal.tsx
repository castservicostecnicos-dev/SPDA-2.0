import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Download,
  CheckCircle2,
  Copy,
  ExternalLink,
  X,
  QrCode,
  ShieldCheck,
  Terminal,
  WifiOff,
  Camera,
  Layers,
  HelpCircle,
} from 'lucide-react';
import QRCode from 'qrcode';

interface AndroidApkModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInstallable: boolean;
  isInstalled: boolean;
  onInstallPrompt: () => Promise<boolean>;
}

export const AndroidApkModal: React.FC<AndroidApkModalProps> = ({
  isOpen,
  onClose,
  isInstallable,
  isInstalled,
  onInstallPrompt,
}) => {
  const [activeTab, setActiveTab] = useState<'direto' | 'apk' | 'cli'>('direto');
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [installStatus, setInstallStatus] = useState<string | null>(null);

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  useEffect(() => {
    if (isOpen && currentUrl) {
      QRCode.toDataURL(currentUrl, {
        width: 220,
        margin: 1.5,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      })
        .then(setQrCodeUrl)
        .catch((err) => console.error('Erro ao gerar QRCode:', err));
    }
  }, [isOpen, currentUrl]);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    } catch {
      // Fallback
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    }
  };

  const handleDirectInstall = async () => {
    setInstallStatus('Iniciando instalação no Android...');
    const result = await onInstallPrompt();
    if (result) {
      setInstallStatus('Aplicativo instalado com sucesso no seu Android!');
    } else {
      setInstallStatus('Prompt encerrado ou não confirmado.');
    }
    setTimeout(() => setInstallStatus(null), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl text-slate-100 flex flex-col my-auto max-h-[92vh] overflow-hidden">
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-950/50">
              <Smartphone className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base sm:text-lg text-white">Instalar no Android & Criar APK</h2>
                <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Android Oficial
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Como ter o aplicativo funcionando nativo no celular e gerar o arquivo .APK
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas de Navegação */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-5 pt-2 gap-2 overflow-x-auto scrollbar-thin">
          <button
            onClick={() => setActiveTab('direto')}
            className={`px-3.5 py-2.5 text-xs font-bold rounded-t-lg transition-all border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'direto'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>1. Instalação Direta (WebAPK Nativo)</span>
            <span className="bg-emerald-500 text-slate-950 text-[9px] font-extrabold px-1.5 py-0.2 rounded-full">
              RECOMENDADO
            </span>
          </button>

          <button
            onClick={() => setActiveTab('apk')}
            className={`px-3.5 py-2.5 text-xs font-bold rounded-t-lg transition-all border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'apk'
                ? 'border-blue-500 text-blue-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>2. Gerar Arquivo .APK (PWABuilder)</span>
          </button>

          <button
            onClick={() => setActiveTab('cli')}
            className={`px-3.5 py-2.5 text-xs font-bold rounded-t-lg transition-all border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'cli'
                ? 'border-purple-500 text-purple-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>3. APK via Linha de Comando (Bubblewrap)</span>
          </button>
        </div>

        {/* Conteúdo do Modal */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* ========================================================
              ABA 1: INSTALAÇÃO DIRETA VIA WEBAPK NO ANDROID
             ======================================================== */}
          {activeTab === 'direto' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-emerald-950/40 via-slate-800/40 to-slate-900 border border-emerald-500/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white mb-1">
                      O próprio Android gera um WebAPK nativo oficial no celular!
                    </h3>
                    <p className="text-slate-300 leading-relaxed text-[11.5px]">
                      Você não precisa de computador nem de compilar código. Ao instalar pelo navegador Google Chrome no Android, o sistema operacional cria e assina automaticamente um <strong>WebAPK nativo</strong> com ícone na tela inicial, abertura em tela cheia, câmera de vistoria e <strong>funcionamento 100% offline</strong> sem internet.
                    </p>
                  </div>
                </div>
              </div>

              {/* Botão de instalação imediata se o navegador permitir */}
              {isInstallable && (
                <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-sm text-white flex items-center gap-2">
                      <Download className="w-4 h-4 text-emerald-400" />
                      Instalação Disponível Agora
                    </h4>
                    <p className="text-slate-300 text-[11px]">
                      Seu navegador detectou o aplicativo e está pronto para criar o ícone nativo.
                    </p>
                  </div>
                  <button
                    onClick={handleDirectInstall}
                    className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>INSTALAR AGORA NO ANDROID</span>
                  </button>
                </div>
              )}

              {installStatus && (
                <div className="p-2.5 rounded-lg bg-blue-900/40 border border-blue-500/40 text-blue-200 text-center font-medium">
                  {installStatus}
                </div>
              )}

              {/* Grid: Celular vs Computador */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Lado 1: Passo a passo no Android Chrome */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-white font-bold text-xs pb-2 border-b border-slate-800">
                    <Smartphone className="w-4 h-4 text-emerald-400" />
                    <span>Passo a Passo no Celular (Chrome)</span>
                  </div>

                  <ol className="space-y-2.5 text-slate-300 pl-4 list-decimal text-[11px] leading-relaxed">
                    <li>
                      Abra este aplicativo no <strong>Google Chrome</strong> do seu celular Android.
                    </li>
                    <li>
                      Toque nos <strong>3 pontinhos verticais (⋮)</strong> no canto superior direito do Chrome.
                    </li>
                    <li>
                      Toque na opção <strong>"Instalar aplicativo"</strong> ou <strong>"Adicionar à tela inicial"</strong>.
                    </li>
                    <li>
                      Toque em <strong>"Instalar"</strong> na janela que abrir.
                    </li>
                    <li>
                      O Android criará o <strong>WebAPK nativo</strong> e colocará o ícone na sua tela de início e na gaveta de apps!
                    </li>
                  </ol>

                  <div className="bg-emerald-950/30 border border-emerald-900/40 rounded-lg p-2.5 text-[10.5px] text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>Pronto! Abre como aplicativo de tela cheia, sem barra do navegador.</span>
                  </div>
                </div>

                {/* Lado 2: Se o usuário estiver no Computador agora (QR Code) */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-between space-y-3 text-center">
                  <div className="w-full flex items-center justify-between text-white font-bold text-xs pb-2 border-b border-slate-800">
                    <span className="flex items-center gap-2">
                      <QrCode className="w-4 h-4 text-blue-400" />
                      <span>Está no computador? Abra no Celular</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-normal">Câmera Android</span>
                  </div>

                  <div className="bg-white p-2 rounded-xl shadow-md inline-block">
                    {qrCodeUrl ? (
                      <img src={qrCodeUrl} alt="QR Code para Android" className="w-36 h-36 mx-auto block" />
                    ) : (
                      <div className="w-36 h-36 flex items-center justify-center text-slate-500 text-xs">
                        Gerando QR...
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-300 leading-snug">
                    Aponte a câmera do seu celular Android para o QR Code acima para abrir no Chrome e instalar direto.
                  </p>

                  <button
                    onClick={handleCopyLink}
                    className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-blue-400" />
                    <span>{copiedLink ? '✓ LINK COPIADO!' : 'COPIAR LINK DO APP'}</span>
                  </button>
                </div>
              </div>

              {/* Vantagens do WebAPK */}
              <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3.5">
                <h4 className="font-bold text-xs text-slate-200 mb-2 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Por que o WebAPK é a melhor opção para a vistoria técnica?
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] text-slate-300">
                  <div className="p-2 bg-slate-900/80 rounded-lg border border-slate-800">
                    <div className="font-bold text-white flex items-center gap-1.5 mb-1">
                      <WifiOff className="w-3.5 h-3.5 text-amber-400" /> 100% Offline
                    </div>
                    Funciona mesmo no topo de prédios, subsolos ou em modo avião.
                  </div>
                  <div className="p-2 bg-slate-900/80 rounded-lg border border-slate-800">
                    <div className="font-bold text-white flex items-center gap-1.5 mb-1">
                      <Camera className="w-3.5 h-3.5 text-blue-400" /> Câmera Completa
                    </div>
                    Tira fotos com flash, foco circular NBR 5419 e armazena na memória do celular.
                  </div>
                  <div className="p-2 bg-slate-900/80 rounded-lg border border-slate-800">
                    <div className="font-bold text-white flex items-center gap-1.5 mb-1">
                      <Layers className="w-3.5 h-3.5 text-emerald-400" /> Zero Burocracia
                    </div>
                    Não requer ativar "Fontes Desconhecidas" nem cabo USB para instalar.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================
              ABA 2: GERAR ARQUIVO .APK COM PWABUILDER
             ======================================================== */}
          {activeTab === 'apk' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-blue-950/40 via-slate-800/40 to-slate-900 border border-blue-500/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white mb-1">
                      Como gerar o arquivo físico .APK com o PWABuilder (Oficial Microsoft/Google)
                    </h3>
                    <p className="text-slate-300 leading-relaxed text-[11.5px]">
                      Se você precisa do arquivo <strong>.apk</strong> para enviar por WhatsApp, pen drive ou instalar em dispositivos dedicados sem navegador, o <strong>PWABuilder</strong> gera o pacote APK completo e assinado em menos de 2 minutos.
                    </p>
                  </div>
                </div>
              </div>

              {/* Caixa de Ação Rápida */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="text-slate-300 font-medium text-[11.5px]">
                  <strong>Passo 1:</strong> Copie o endereço (URL) do seu aplicativo:
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={currentUrl}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-xs font-mono select-all focus:outline-hidden"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedLink ? 'Copiado!' : 'Copiar URL'}</span>
                  </button>
                </div>
              </div>

              {/* Passo a Passo */}
              <div className="space-y-2.5">
                <div className="p-3 bg-slate-950/50 border border-slate-800 rounded-xl flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-600/30 text-blue-400 font-bold flex items-center justify-center shrink-0 text-xs">
                    2
                  </span>
                  <div className="flex-1">
                    <p className="font-bold text-white text-xs mb-1">Abra o PWABuilder com 1 Clique</p>
                    <p className="text-slate-300 text-[11px] mb-2.5">
                      O botão abaixo já abre o PWABuilder analisando o seu aplicativo automaticamente:
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`https://www.pwabuilder.com/report?url=${encodeURIComponent(currentUrl)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-md cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-amber-300" />
                        <span>🚀 GERAR APK NO PWABUILDER (1 CLIQUE)</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/50 border border-slate-800 rounded-xl flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-600/30 text-blue-400 font-bold flex items-center justify-center shrink-0 text-xs">
                    3
                  </span>
                  <div>
                    <p className="font-bold text-white text-xs mb-1">Cole a URL e clique em "Start"</p>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      O PWABuilder analisará o manifesto PWA que já configuramos (ícones de 512px, tela cheia, cores NBR 5419 e service worker offline).
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/50 border border-slate-800 rounded-xl flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-600/30 text-blue-400 font-bold flex items-center justify-center shrink-0 text-xs">
                    4
                  </span>
                  <div>
                    <p className="font-bold text-white text-xs mb-1">Clique em "Android" → "Package for Android" / "Download APK"</p>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      Ele gerará o arquivo <strong>.apk</strong> assinado pronto para download! Você também pode baixar o arquivo <strong>.aab</strong> se desejar publicar na Google Play Store.
                    </p>
                  </div>
                </div>
              </div>

              {/* Como Instalar o APK no Android */}
              <div className="bg-amber-950/20 border border-amber-800/40 rounded-xl p-3.5">
                <h4 className="font-bold text-xs text-amber-300 mb-1.5 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-amber-400" />
                  Como instalar o arquivo .APK no seu celular Android:
                </h4>
                <ol className="text-[11px] text-amber-100/90 space-y-1 list-decimal pl-4 leading-relaxed">
                  <li>Envie o arquivo <strong>.apk</strong> baixado para o seu celular (por WhatsApp, e-mail ou cabo USB).</li>
                  <li>No celular, abra o arquivo no aplicativo "Arquivos" ou "Downloads".</li>
                  <li>Se o Android exibir "O Chrome ou Gerenciador não tem permissão para instalar apps desconhecidos", toque em <strong>Configurações</strong> e marque a chave <strong>"Permitir desta fonte"</strong>.</li>
                  <li>Toque em <strong>Instalar</strong> e o aplicativo estará pronto para uso em campo!</li>
                </ol>
              </div>
            </div>
          )}

          {/* ========================================================
              ABA 3: GERAÇÃO VIA BUBBLEWRAP CLI (GOOGLE DEVELOPERS)
             ======================================================== */}
          {activeTab === 'cli' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-purple-950/40 via-slate-800/40 to-slate-900 border border-purple-500/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Terminal className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white mb-1">
                      Geração de APK Nativo via Bubblewrap CLI (Google)
                    </h3>
                    <p className="text-slate-300 leading-relaxed text-[11.5px]">
                      O <strong>Bubblewrap</strong> é a ferramenta de linha de comando oficial da equipe do Google Chrome para transformar Web Apps em APKs Android com tecnologia Trusted Web Activity (TWA).
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 font-mono text-[11px]">
                <p className="text-slate-400 font-sans text-xs">
                  Para gerar o APK no seu terminal (Linux, Mac ou Windows PowerShell):
                </p>

                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-purple-300 overflow-x-auto">
                  <div className="text-slate-500 font-sans text-[10px] mb-1"># 1. Instalar o Bubblewrap CLI do Google</div>
                  <code>npm install -g @bubblewrap/cli</code>
                </div>

                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-purple-300 overflow-x-auto">
                  <div className="text-slate-500 font-sans text-[10px] mb-1"># 2. Inicializar o projeto com o manifesto do SPDA</div>
                  <code>bubblewrap init --manifest="{currentUrl}manifest.webmanifest"</code>
                </div>

                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-purple-300 overflow-x-auto">
                  <div className="text-slate-500 font-sans text-[10px] mb-1"># 3. Compilar o APK assinado para instalação</div>
                  <code>bubblewrap build</code>
                </div>

                <p className="text-slate-400 font-sans text-[11px]">
                  O comando gerará o arquivo <strong>app-release-signed.apk</strong> pronto para instalar em qualquer dispositivo Android com o comando <code className="text-purple-300">adb install app-release-signed.apk</code> ou envio direto.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Manifesto PWA NBR 5419 ativo • Suporte Offline Completo</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg transition-colors cursor-pointer"
            >
              Fechar
            </button>
            {isInstallable && (
              <button
                onClick={handleDirectInstall}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Smartphone className="w-4 h-4" />
                <span>Instalar Agora</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
