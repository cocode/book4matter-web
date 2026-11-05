// Safari's Error.stack can contain only locations, without the actual message.
export function describeBuildError(error, stage) {
  const message = error?.message || String(error);
  const stack = error?.stack;
  const detail = stack && !stack.includes(message) ? `${message}\n\n${stack}` : stack || message;
  return stage ? `Could not finish ${stage}.\n${detail}` : detail;
}

// Lua and Python errors cross the worker boundary as text. Keep actionable file
// references in a small JSON record instead of guessing from stack traces.
export function referencedFileProblems(message) {
  const marker = 'BOOK4MATTER_FILES:';
  for (const line of String(message).split('\n')) {
    const start = line.indexOf(marker);
    if (start < 0) continue;
    try {
      const payload = JSON.parse(line.slice(start + marker.length).trim());
      const problems = payload.problems;
      if (!Array.isArray(problems)) continue;
      return problems.filter(item => item && ['missing', 'ambiguous', 'remote'].includes(item.kind) && typeof item.reference === 'string');
    } catch { /* Retain the generic error if a runtime changes its formatting. */ }
  }
  return [];
}

export function missingBookSettings(message) {
  const text = String(message);
  return text.match(/uses kind '([^'\n]+)', which is not registered in book_metadata\.yaml/)?.[1]
    || text.match(/unknown tracked kind in \{index:([^}\n]+)\}/)?.[1]
    || null;
}

export function missingFontFamilies(diagnostics) {
  const text = Array.isArray(diagnostics) ? diagnostics.join('\n') : String(diagnostics || '');
  return [...new Set([...text.matchAll(/unknown font family:\s*([^\r\n]+)/gi)].map(match => match[1].trim()))];
}
