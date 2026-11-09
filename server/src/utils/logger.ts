/**
 * Tiny logger: timestamps every line and tags it with a level.
 * Kept deliberately simple; can be swapped for a library such as pino later.
 */
function write(level: 'INFO' | 'WARN' | 'ERROR', message: string, extra?: unknown) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}`;
  const output = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  if (extra === undefined) output(line);
  else output(line, extra);
}

export const logger = {
  info: (message: string, extra?: unknown) => write('INFO', message, extra),
  warn: (message: string, extra?: unknown) => write('WARN', message, extra),
  error: (message: string, extra?: unknown) => write('ERROR', message, extra),
};
