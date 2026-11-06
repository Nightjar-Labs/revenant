import type { Clock } from '@revenant/engine';

/** Wall-clock implementation of the engine's injected `Clock`. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
