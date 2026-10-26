// What the app can tell about this TV: the browser engine, whether webOS services
// and root work, the CPU, whether the microphone engine answers, and the codes the
// remote's keys send. Kept in the app for good: it is the first stop when
// something does not work on a new TV or firmware.
import { useEffect, useState } from 'react';
import { ENGINE_PORT } from '../engine';
import type { EngineInfo } from '../engine';
import { t } from '../i18n';
import { keyOf } from '../keys';
import { execText, isTV } from '../native';

export function Diagnostics({ engine, onBack }: { engine: EngineInfo; onBack: () => void }) {
  const [root, setRoot] = useState(t('checking'));
  const [arch, setArch] = useState(t('checking'));
  const [socket, setSocket] = useState(t('checking'));
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!isTV()) {
      setRoot(t('no'));
      setArch('—');
    } else {
      execText('id -u; uname -m')
        .then((out) => {
          const [uid, machine] = out.trim().split('\n');
          setRoot(uid === '0' ? t('yes') : `uid ${uid}`);
          setArch(machine || '—');
        })
        .catch((e: Error) => {
          setRoot(e.message);
          setArch('—');
        });
    }
    // Can this page reach a socket on the TV itself? (The engine's channel.)
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${ENGINE_PORT}`);
      const timer = setTimeout(() => {
        setSocket(t('no'));
        ws.close();
      }, 3000);
      ws.onopen = () => {
        clearTimeout(timer);
        setSocket(t('yes'));
        ws.close();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        setSocket(t('no'));
      };
    } catch (e) {
      setSocket((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      setKeys((k) => [`${event.keyCode} ${event.key}`, ...k].slice(0, 6));
      if (keyOf(event) === 'back') {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const chrome = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '—';
  return (
    <div className="diag">
      <h1>{t('diagnostics')}</h1>
      <dl>
        <dt>{t('diagUa')}</dt>
        <dd>Chromium {chrome}</dd>
        <dt>{t('diagBridge')}</dt>
        <dd>{isTV() ? t('yes') : t('no')}</dd>
        <dt>{t('diagRoot')}</dt>
        <dd>{root}</dd>
        <dt>{t('diagArch')}</dt>
        <dd>{arch}</dd>
        <dt>ws://127.0.0.1:{ENGINE_PORT}</dt>
        <dd>{socket}</dd>
        <dt>{t('diagEngine')}</dt>
        <dd>
          {engine.state}
          {engine.error ? ` — ${engine.error}` : ''}
          {engine.input ? ` — ${engine.input.name}` : ''}
          {engine.status ? ` — xruns ${engine.status.xruns}, slips ${engine.status.slips}, cpu ${engine.status.cpu}%` : ''}
        </dd>
        <dt>{t('diagKeys')}</dt>
        <dd>{keys.join(' · ') || '—'}</dd>
        <dt>User agent</dt>
        <dd style={{ fontSize: 24 }}>{navigator.userAgent}</dd>
      </dl>
      <p className="hint">{t('back')}: ← / Back</p>
    </div>
  );
}
