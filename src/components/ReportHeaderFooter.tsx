import React from 'react';
import { CompanyData } from '../types/spda';
import { SJC_OFFICIAL_LOGO_DATA_URL } from '../assets/logo';

interface HeaderProps {
  company: CompanyData;
}

export const ReportHeader: React.FC<HeaderProps> = ({ company }) => {
  const logoSrc = company.logoUrl || SJC_OFFICIAL_LOGO_DATA_URL;

  return (
    <div className="w-full flex justify-end items-center mb-2.5 pt-0 select-none min-h-[16mm]">
      <div className="max-w-[45mm] max-h-[16mm] flex justify-end items-center">
        <img
          src={logoSrc}
          alt={company.name || 'SJC Engenharia & Soluções'}
          className="max-w-[45mm] max-h-[16mm] w-auto h-auto object-contain block rounded-xs shadow-xs"
        />
      </div>
    </div>
  );
};

interface FooterProps {
  company: CompanyData;
  pageNumber?: number;
  totalPages?: number;
}

export const ReportFooter: React.FC<FooterProps> = ({ company, pageNumber, totalPages }) => {
  return (
    <div className="absolute bottom-4 left-[20mm] right-[20mm] text-center select-none">
      <div className="w-full border-t border-black mb-1" />
      <p className="text-[8.5px] font-bold tracking-tight text-black uppercase leading-tight font-sans truncate w-full">
        SJC ENGENHARIA E SOLUÇÕES - CNPJ: 18.472.071/0001-52 – FONE: (12) 98106-3344
      </p>
      <div className="flex justify-between items-center mt-0.5 text-[8px] text-black font-sans">
        <span className="flex-1 text-center font-bold uppercase tracking-tight truncate">
          RUA ISAAC NEWTON, 98 JD. ORIENTE – SÃO JOSE DOS CAMPOS - SP
        </span>
        {pageNumber && totalPages && (
          <span className="text-[7.5px] text-gray-500 font-normal flex-shrink-0 ml-2">
            Página {pageNumber} de {totalPages}
          </span>
        )}
      </div>
    </div>
  );
};

export const ReportWatermark: React.FC<{ text?: string; enabled?: boolean }> = ({
  text = 'SPDA 2026',
  enabled = true,
}) => {
  if (!enabled) return null;
  return (
    <div
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[38deg] text-[115px] font-black tracking-wider text-[#9ca3af]/20 select-none pointer-events-none whitespace-nowrap z-0 font-sans"
      aria-hidden="true"
    >
      {text}
    </div>
  );
};
