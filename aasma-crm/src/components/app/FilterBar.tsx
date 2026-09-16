import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Search box plus whatever filters a screen needs, in one consistent row. */
export function FilterBar({
  search,
  onSearchChange,
  placeholder = 'Search…',
  children,
  onReset,
  className,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
  onReset?: () => void;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
      {children}
      {onReset ? (
        <Button variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
          <X className="h-4 w-4" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
