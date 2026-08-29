/**
 * Server clock with an optional demo offset (spec §12 `POST /api/demo/time`). Production
 * time is never altered: the offset is only honoured when the demo clock is enabled.
 */
export interface Clock {
  now(): Date;
  offsetMs(): number;
  setOffset(ms: number): void;
}

export function createClock(options: { demoClockEnabled: boolean }): Clock {
  let offset = 0;
  return {
    now: () => new Date(Date.now() + offset),
    offsetMs: () => offset,
    setOffset: (ms: number) => {
      if (!options.demoClockEnabled) throw new Error('demo clock is disabled');
      offset = ms;
    },
  };
}

export function fixedClock(at: Date | string): Clock {
  const base = new Date(at);
  let offset = 0;
  return {
    now: () => new Date(base.getTime() + offset),
    offsetMs: () => offset,
    setOffset: (ms) => {
      offset = ms;
    },
  };
}
