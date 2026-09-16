import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time failures so a single broken screen never takes the whole
 * application down — the requirement is that the app must not crash.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] a screen failed to render:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="card-surface max-w-lg space-y-4 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">This screen ran into a problem</h2>
            <p className="text-sm text-muted-foreground">
              Your data is safe — nothing was saved or lost. Reload the screen to carry on.
            </p>
          </div>
          <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
          <Button onClick={() => this.setState({ error: null })}>
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
