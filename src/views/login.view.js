/** Sign-in screen. */

import { el, clear } from '../core/utils.js';
import { signIn } from '../services/auth.service.js';
import { navigate } from '../core/router.js';
import { getSettings } from '../repositories/settings.repo.js';
import { reportError } from '../ui/toast.js';

export function renderLogin({ outlet }) {
  const settings = getSettings();
  document.body.classList.add('is-login');

  const error = el('p.login__error', { role: 'alert' });
  const username = el('input.input', {
    type: 'text',
    id: 'username',
    name: 'username',
    autocomplete: 'username',
    autocapitalize: 'none',
    spellcheck: false,
    required: true,
    placeholder: 'admin',
  });
  const password = el('input.input', {
    type: 'password',
    id: 'password',
    name: 'password',
    autocomplete: 'current-password',
    required: true,
    placeholder: '••••••••',
  });
  const submit = el('button.btn.btn--primary.btn--block', { type: 'submit', text: 'Sign in' });

  async function attempt(event) {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Checking…';

    try {
      const session = await signIn(username.value, password.value);
      password.value = '';
      document.body.classList.remove('is-login');
      navigate(session.role === 'admin' ? '/pos' : '/pos', { replace: true });
    } catch (err) {
      if (err?.name === 'AppError') error.textContent = err.message;
      else reportError(err, 'Sign-in failed on this device.');
      password.focus();
      password.select();
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  }

  const form = el('form.login__form', { onsubmit: attempt, novalidate: true }, [
    el('label.field', {}, [el('span.field__label', { text: 'Username' }), username]),
    el('label.field', {}, [el('span.field__label', { text: 'Password' }), password]),
    error,
    submit,
  ]);

  const card = el('section.login__card', {}, [
    el('img.login__logo', { src: 'assets/logo.jpg', alt: `${settings.cafeName} logo` }),
    el('h1.login__title', { text: settings.cafeName }),
    el('p.login__tagline', { text: settings.tagline || '' }),
    form,
    el('p.login__hint', {
      html:
        'First run on this device? Sign in with <strong>admin</strong> / <strong>baruch@2026</strong> ' +
        'or <strong>cashier</strong> / <strong>cafe@1234</strong>, then change both from Settings.',
    }),
  ]);

  clear(outlet).appendChild(
    el('div.login', {}, [card, el('p.login__foot', { text: 'Bills are stored on this device.' })])
  );

  requestAnimationFrame(() => username.focus());

  return () => document.body.classList.remove('is-login');
}
