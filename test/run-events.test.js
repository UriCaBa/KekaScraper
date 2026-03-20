import assert from 'node:assert/strict';

import { createRunEmitter, emitRunEvent, RUN_EVENT_TYPES } from '../src/lib/run-events.js';

export const tests = [
  {
    name: 'createRunEmitter stamps events with a fresh timestamp',
    run: () => {
      let received;
      const emit = createRunEmitter((event) => {
        received = event;
      });

      emit({
        type: RUN_EVENT_TYPES.RUN_STARTED,
        timestamp: '2000-01-01T00:00:00.000Z',
        city: 'Barcelona',
      });

      assert.equal(received.type, RUN_EVENT_TYPES.RUN_STARTED);
      assert.equal(received.city, 'Barcelona');
      assert.notEqual(received.timestamp, '2000-01-01T00:00:00.000Z');
      assert.match(received.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    },
  },
  {
    name: 'emitRunEvent merges the type with the event payload',
    run: () => {
      let received;
      const emit = createRunEmitter((event) => {
        received = event;
      });

      emitRunEvent(emit, RUN_EVENT_TYPES.CITY_COMPLETED, {
        city: 'Bilbao',
        cityResultCount: 3,
      });

      assert.deepEqual(received, {
        type: RUN_EVENT_TYPES.CITY_COMPLETED,
        city: 'Bilbao',
        cityResultCount: 3,
        timestamp: received.timestamp,
      });
    },
  },
];
