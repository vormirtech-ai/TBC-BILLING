import { cn } from '@/lib/utils';

/**
 * The Aasma Construction mark, drawn inline so it stays crisp at any size and
 * needs no network request. Geometry follows the brand guidelines: an extruded
 * crimson volume, a light steel roof plane and the crimson baseline rule.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 512 512" className="h-9 w-9 shrink-0" aria-hidden="true">
        <defs>
          <linearGradient id="aasma-crimson" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#EE3A43" />
            <stop offset="100%" stopColor="#BC1F43" />
          </linearGradient>
          <linearGradient id="aasma-steel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="55%" stopColor="#C7C8CA" />
            <stop offset="100%" stopColor="#818286" />
          </linearGradient>
        </defs>
        <path d="M96 168 176 122v268l-80 46z" fill="#8E1533" />
        <path d="M176 122l88 50v218l-88-0z" fill="url(#aasma-crimson)" />
        <path d="M176 122 264 72l88 50-88 50z" fill="url(#aasma-steel)" />
        <path d="M264 172l88-50v268l-88 0z" fill="none" stroke="#C7C8CA" strokeWidth="12" strokeLinejoin="round" />
        <rect x="96" y="404" width="320" height="18" rx="4" fill="#BC1F43" />
      </svg>
      {!compact ? (
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-base font-bold tracking-tight">Aasma</p>
          <p className="truncate text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Construction
          </p>
        </div>
      ) : null}
    </div>
  );
}
