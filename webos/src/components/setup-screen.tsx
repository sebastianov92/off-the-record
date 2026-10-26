// First run, or "change server": the address, recent servers and a way into the
// diagnostics. The input only takes real focus when chosen (OK on it), so the
// TV's keyboard does not jump up over the screen on arrival.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { keyOf } from '../keys';
import { DEFAULT_SERVER, normalizeServer } from '../server-url';

interface Props {
  initial: string | null;
  recent: string[];
  onConnect: (server: string) => void;
  onDiagnostics: () => void;
}

// Rows: 0 the address, 1 Connect, 2 recent servers (a row of chips), 3 Diagnostics.
export function SetupScreen({ initial, recent, onConnect, onDiagnostics }: Props) {
  const [value, setValue] = useState(initial ?? DEFAULT_SERVER.replace(/^http:\/\//, ''));
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState({ row: 1, col: 0 });
  const input = useRef<HTMLInputElement>(null);
  const rows = recent.length ? [1, 1, recent.length, 1] : [1, 1, 0, 1];

  const connect = (text = value) => {
    const server = normalizeServer(text);
    if (!server) {
      setError(t('invalidServer'));
      return;
    }
    onConnect(server);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = keyOf(event);
      const typing = document.activeElement === input.current;
      if (typing) {
        if (key === 'back' || key === 'up' || key === 'down') {
          input.current?.blur();
          if (key === 'down') setCursor({ row: 1, col: 0 });
          event.preventDefault();
        }
        return; // Enter submits the form; letters belong to the box
      }
      if (!key) return;
      event.preventDefault();
      if (key === 'up' || key === 'down') {
        const step = key === 'up' ? -1 : 1;
        let row = cursor.row + step;
        while (row >= 0 && row < rows.length && rows[row] === 0) row += step;
        if (row >= 0 && row < rows.length) setCursor({ row, col: 0 });
      } else if (key === 'left' || key === 'right') {
        if (cursor.row === 2) {
          const col = Math.min(rows[2] - 1, Math.max(0, cursor.col + (key === 'left' ? -1 : 1)));
          setCursor({ row: 2, col });
        }
      } else if (key === 'ok') {
        if (cursor.row === 0) input.current?.focus();
        else if (cursor.row === 1) connect();
        else if (cursor.row === 2) connect(recent[cursor.col]);
        else onDiagnostics();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const focus = (row: number, col = 0) => (cursor.row === row && cursor.col === col ? ' is-focused' : '');
  return (
    <div className="setup">
      <form
        className="setup-card"
        onSubmit={(e) => {
          e.preventDefault();
          input.current?.blur();
          connect();
        }}
      >
        <img className="setup-logo" src="./logo-white.svg" alt={t('appName')} />
        <h1>{t('setupTitle')}</h1>
        <p className="hint">{t('setupHint')}</p>
        <div className="field">
          <label htmlFor="server">{t('serverLabel')}</label>
          <input
            id="server"
            ref={input}
            className={focus(0)}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
            // Selected on arrival, so the first key typed replaces the old address.
            onFocus={(e) => {
              setCursor({ row: 0, col: 0 });
              e.currentTarget.select();
            }}
          />
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button type="submit" className={`button is-primary${focus(1)}`} onPointerEnter={() => setCursor({ row: 1, col: 0 })}>
          {t('connect')}
        </button>
        {recent.length ? (
          <div className="recent">
            <span>{t('recent')}</span>
            {recent.map((server, col) => (
              <button
                key={server}
                type="button"
                className={`chip${focus(2, col)}`}
                onPointerEnter={() => setCursor({ row: 2, col })}
                onClick={() => connect(server)}
              >
                {server.replace(/^https?:\/\//, '')}
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className={`chip${focus(3)}`} style={{ alignSelf: 'flex-start' }} onPointerEnter={() => setCursor({ row: 3, col: 0 })} onClick={onDiagnostics}>
          {t('diagnostics')}
        </button>
      </form>
    </div>
  );
}
