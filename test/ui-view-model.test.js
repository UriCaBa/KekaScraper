import assert from 'node:assert/strict';

import {
  buildCompletionMessage,
  deriveRunButtonView,
  deriveStatusView,
  formatDuration,
} from '../src/ui/view-model.js';

export const tests = [
  {
    name: 'deriveStatusView distinguishes bootstrap loading from idle',
    run: () => {
      assert.deepEqual(deriveStatusView({ initialized: false, running: false, logsCount: 0 }), {
        phase: 'Loading',
        copy: 'Loading local defaults...',
      });

      assert.deepEqual(deriveStatusView({ initialized: true, running: false, logsCount: 0 }), {
        phase: 'Idle',
        copy: 'Ready to start.',
      });

      assert.equal(deriveStatusView({ initialized: true, running: true, logsCount: 2 }), null);
    },
  },
  {
    name: 'deriveRunButtonView distinguishes loading, running, ready and bootstrap failure',
    run: () => {
      assert.deepEqual(deriveRunButtonView({ initialized: false, formDisabled: true, bootstrapFailed: false }), {
        disabled: true,
        text: 'Loading...',
      });

      assert.deepEqual(deriveRunButtonView({ initialized: true, formDisabled: true, bootstrapFailed: false }), {
        disabled: true,
        text: 'Running...',
      });

      assert.deepEqual(deriveRunButtonView({ initialized: true, formDisabled: false, bootstrapFailed: false }), {
        disabled: false,
        text: 'Start scrape',
      });

      assert.deepEqual(deriveRunButtonView({ initialized: false, formDisabled: true, bootstrapFailed: true }), {
        disabled: false,
        text: 'Reload app',
      });
    },
  },
  {
    name: 'formatDuration and buildCompletionMessage stay user friendly',
    run: () => {
      assert.equal(formatDuration(0), '1s');
      assert.equal(formatDuration(61000), '1m 1s');
      assert.equal(
        buildCompletionMessage({
          outcome: 'partial',
          totalResults: 7,
          outputFiles: ['output.json'],
        }),
        'Run partial. 7 rows exported to 1 file.',
      );
    },
  },
];
