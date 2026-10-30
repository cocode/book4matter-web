// Safari's Error.stack can contain only locations, without the actual message.
export function describeBuildError(error, stage) {
  const message = error?.message || String(error);
  const stack = error?.stack;
  const detail = stack && !stack.includes(message) ? `${message}\n\n${stack}` : stack || message;
  return stage ? `Could not finish ${stage}.\n${detail}` : detail;
}
