/**
 * stderr-only logger. stdout is the JSON-RPC channel of the stdio transport:
 * a single stray write there corrupts the protocol. Never use console.log
 * under src/.
 */
function write(level: string, message: string, data?: unknown): void {
  const tail = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  console.error(`[${new Date().toISOString()}] ${level} ${message}${tail}`);
}

export const log = {
  info: (message: string, data?: unknown) => write('INFO ', message, data),
  warn: (message: string, data?: unknown) => write('WARN ', message, data),
  error: (message: string, data?: unknown) => write('ERROR', message, data),
};
