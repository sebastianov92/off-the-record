// The two dialogs: leaving the app, and the admin password when the server wants it.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

export function ExitDialog({ focus, onHover, onChoose }: { focus: 0 | 1; onHover: (i: 0 | 1) => void; onChoose: (i: 0 | 1) => void }) {
  return (
    <div className="scrim">
      <div className="dialog" role="alertdialog" aria-labelledby="exit-title">
        <h2 id="exit-title">{t('exitTitle')}</h2>
        <p className="hint">{t('exitHint')}</p>
        <div className="row">
          <button
            className={`button is-primary${focus === 0 ? ' is-focused' : ''}`}
            onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(0)}
            onClick={() => onChoose(0)}
          >
            {t('keepSinging')}
          </button>
          <button
            className={`button${focus === 1 ? ' is-focused' : ''}`}
            onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(1)}
            onClick={() => onChoose(1)}
          >
            {t('exit')}
          </button>
        </div>
      </div>
    </div>
  );
}

// The password goes to the splash once, which trades it for a device token; only
// the token is kept. The input has real focus so the TV's keyboard comes up.
export function PasswordDialog({ error, busy, onSubmit, onCancel }: { error: string; busy: boolean; onSubmit: (password: string) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="scrim">
      <form
        className="dialog"
        role="dialog"
        aria-labelledby="password-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (password && !busy) onSubmit(password);
        }}
      >
        <h2 id="password-title">{t('passwordTitle')}</h2>
        <p className="hint">{t('passwordHint')}</p>
        <div className="field">
          <label htmlFor="admin-password">{t('password')}</label>
          <input
            id="admin-password"
            ref={input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="row">
          <button className="button is-primary" type="submit" disabled={!password || busy}>
            {t('enter')}
          </button>
          <button className="button" type="button" onClick={onCancel}>
            {t('cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
