export function deriveStatusView({ initialized, running, logsCount }) {
  if (!initialized && logsCount === 0) {
    return {
      phase: 'Loading',
      copy: 'Loading local defaults...',
    };
  }

  if (!running && logsCount === 0) {
    return {
      phase: 'Idle',
      copy: 'Ready to start.',
    };
  }

  return null;
}

export function deriveRunButtonView({ initialized, formDisabled, bootstrapFailed }) {
  if (bootstrapFailed) {
    return {
      disabled: false,
      text: 'Reload app',
    };
  }

  if (!initialized) {
    return {
      disabled: true,
      text: 'Loading...',
    };
  }

  if (formDisabled) {
    return {
      disabled: true,
      text: 'Running...',
    };
  }

  return {
    disabled: false,
    text: 'Start scrape',
  };
}

export function deriveResultsView({ lastCompletedSummary, results }) {
  const hasCompletedRun = Boolean(lastCompletedSummary);

  if (!hasCompletedRun) {
    return {
      hasCompletedRun: false,
      resultsEmptyHidden: false,
      resultsContentHidden: true,
      resultsSummary: '0 rows',
      rowCount: 0,
      previewCount: 0,
      previewLabel: '',
    };
  }

  const rowCount = lastCompletedSummary.totalResults ?? 0;
  const previewCount = results?.length ?? 0;
  const previewLabel = rowCount > previewCount ? `, showing first ${previewCount}` : '';

  return {
    hasCompletedRun: true,
    resultsEmptyHidden: true,
    resultsContentHidden: false,
    resultsSummary: `${rowCount} ${rowCount === 1 ? 'row' : 'rows'}${previewLabel}`,
    rowCount,
    previewCount,
    previewLabel,
  };
}

export function buildCompletionMessage(summary) {
  const fileCount = summary.outputFiles.length;
  return `Run ${summary.outcome}. ${summary.totalResults} rows exported to ${fileCount} ${fileCount === 1 ? 'file' : 'files'}.`;
}

export function formatDuration(durationMs) {
  const numericDurationMs = Number(durationMs);
  const totalSeconds = Number.isFinite(numericDurationMs) ? Math.round(numericDurationMs / 1000) : 0;
  const seconds = Math.max(1, totalSeconds);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
