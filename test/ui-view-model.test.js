import assert from 'node:assert/strict';

import {
  buildCompletionMessage,
  deriveResultsView,
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
    name: 'deriveResultsView distinguishes no run yet from an empty completed run',
    run: () => {
      assert.deepEqual(deriveResultsView({ lastCompletedSummary: null, results: [] }), {
        hasCompletedRun: false,
        resultsEmptyHidden: false,
        resultsContentHidden: true,
        resultsSummary: '0 rows',
        rowCount: 0,
        previewCount: 0,
        previewLabel: '',
      });

      assert.deepEqual(
        deriveResultsView({
          lastCompletedSummary: { totalResults: 0 },
          results: [],
        }),
        {
          hasCompletedRun: true,
          resultsEmptyHidden: true,
          resultsContentHidden: false,
          resultsSummary: '0 rows',
          rowCount: 0,
          previewCount: 0,
          previewLabel: '',
        },
      );

      assert.equal(
        deriveResultsView({
          lastCompletedSummary: { totalResults: 25 },
          results: new Array(10).fill(null),
        }).resultsSummary,
        '25 rows, showing first 10',
      );
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
