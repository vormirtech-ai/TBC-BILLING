import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ShieldCheck, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Logo } from '@/components/app/Logo';
import { useAuth } from '@/store/auth.store';
import { ApiError } from '@/lib/api';
import { loginSchema, type LoginInput } from '@shared/schemas';

/**
 * Local sign-in screen. No network is involved — the credentials are checked
 * against the SQLite file on this machine.
 */
export function LoginPage(): JSX.Element {
  const login = useAuth((state) => state.login);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = async (values: LoginInput): Promise<void> => {
    setError(null);
    try {
      await login(values.username, values.password);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not sign in. Please try again.');
    }
  };

  return (
    <div className="grid h-full lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-brand-ink lg:block">
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, #BC1F43 0%, #8E1533 55%, #231F20 100%)' }}
        />
        <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-white/5 blur-2xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 512 512" className="h-11 w-11" aria-hidden="true">
              <path d="M96 168 176 122v268l-80 46z" fill="#ffffff" opacity="0.55" />
              <path d="M176 122l88 50v218l-88-0z" fill="#ffffff" />
              <path d="M176 122 264 72l88 50-88 50z" fill="#ffffff" opacity="0.75" />
              <path d="M264 172l88-50v268l-88 0z" fill="none" stroke="#ffffff" strokeWidth="12" strokeLinejoin="round" opacity="0.6" />
              <rect x="96" y="404" width="320" height="18" rx="4" fill="#ffffff" />
            </svg>
            <div className="leading-tight">
              <p className="font-display text-xl font-bold">Aasma</p>
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-white/70">Construction</p>
            </div>
          </div>

          <div className="max-w-md space-y-5">
            <h1 className="font-display text-4xl font-bold leading-tight">
              Every site, every unit, every rupee — in one place.
            </h1>
            <p className="text-white/80">
              Leads and bookings, live stock, labour attendance, daily progress reports and completion forecasts.
              Built to run on the site office laptop.
            </p>
            <div className="flex flex-wrap gap-4 pt-2 text-sm text-white/75">
              <span className="inline-flex items-center gap-2">
                <WifiOff className="h-4 w-4" /> Works with no internet
              </span>
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Data stays on this machine
              </span>
            </div>
          </div>

          <p className="text-xs text-white/50">© {new Date().getFullYear()} Aasma Construction. Aasma Buildcon CRM v1.0</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-sm space-y-8"
        >
          <div className="space-y-6">
            <div className="lg:hidden">
              <Logo />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
              <p className="text-sm text-muted-foreground">Use your local administrator account to continue.</p>
            </div>
          </div>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Field label="Username" error={form.formState.errors.username?.message} required>
              <Input autoFocus autoComplete="username" placeholder="admin" {...form.register('username')} />
            </Field>

            <Field label="Password" error={form.formState.errors.password?.message} required>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pr-10"
                  {...form.register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {error ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>
            ) : null}

            <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
              Sign in
            </Button>
          </form>

          <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            First time here? Sign in with <strong className="text-foreground">admin</strong> /{' '}
            <strong className="text-foreground">admin@123</strong>, then change the password from Settings → Security.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
