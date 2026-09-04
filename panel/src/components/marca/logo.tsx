import { cn } from '@/lib/utils';

/**
 * Marca de Binario Dev Labs. Es el mismo SVG que sirve el sitio, inline para
 * que no dependa de una request extra.
 */
export function LogoMarca({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="Binario Dev Labs" className={cn('size-8', className)}>
      <rect x="1" y="1" width="62" height="62" rx="8" fill="#0a0a0a" stroke="#3a3a36" strokeWidth="2" />
      <text
        x="11"
        y="46"
        fontFamily="var(--fuente-mono), ui-monospace, monospace"
        fontWeight="700"
        fontSize="38"
        fill="#f2f2ed"
      >
        B
      </text>
      <rect x="44" y="14" width="10" height="10" rx="2" fill="#3b82f6" />
    </svg>
  );
}

export function LogoCompleto({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMarca className="size-8 shrink-0" />
      <div className="leading-tight">
        <div className="font-marca text-[0.9375rem] font-bold tracking-tight">Binario Dev Labs</div>
        <div className="text-muted-foreground text-xs">Panel de administración</div>
      </div>
    </div>
  );
}
