import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * A dialog wrapped around a form. Every "Add / Edit" screen in the app uses it,
 * so submit handling, the scroll area and the button row behave identically.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitting,
  submitLabel = 'Save',
  size = 'md',
  children,
  footerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSubmit: () => void;
  submitting?: boolean;
  submitLabel?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  footerExtra?: ReactNode;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col gap-4"
          noValidate
        >
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-0.5">{children}</div>
          <DialogFooter className="items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">{footerExtra}</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                {submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
