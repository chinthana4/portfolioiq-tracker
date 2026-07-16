import { useEffect, useRef, useState } from 'react';

export function useAutoRefresh(fn, intervalMs = 60000, enabled = true) {
  const fnRef = useRef(fn);
  const [secondsLeft, setSecondsLeft] = useState(intervalMs / 1000);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    fnRef.current();
    setSecondsLeft(intervalMs / 1000);

    const refresh = setInterval(() => {
      fnRef.current();
      setSecondsLeft(intervalMs / 1000);
    }, intervalMs);

    const countdown = setInterval(() => {
      setSecondsLeft(s => (s > 1 ? s - 1 : intervalMs / 1000));
    }, 1000);

    return () => { clearInterval(refresh); clearInterval(countdown); };
  }, [intervalMs, enabled]);

  return secondsLeft;
}
