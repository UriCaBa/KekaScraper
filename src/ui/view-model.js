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
