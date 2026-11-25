export interface ParsedSshTarget {
  username?: string;
  host?: string;
  port?: number;
}

/**
 * Parses quick SSH connection strings such as:
 * - `test@192.128.0.1`
 * - `test@192.128.0.1:2222`
 * - `ssh test@192.128.0.1 -p 2222`
 * - `192.128.0.1:2222`
 * - `192.128.0.1`
 */
export function parseSshTarget(raw: string): ParsedSshTarget | null {
  let text = raw.trim();
  if (!text) return null;

  if (text.toLowerCase().startsWith('ssh ')) {
    text = text.slice(4).trim();
  }

  let port: number | undefined;
  const pFlagMatch = text.match(/(?:^|\s)-p\s+(\d+)(?:\s|$)/i);
  if (pFlagMatch) {
    const parsedPort = Number(pFlagMatch[1]);
    if (parsedPort > 0 && parsedPort <= 65535) {
      port = parsedPort;
    }
    text = text.replace(pFlagMatch[0], ' ').trim();
  }

  // Take first token if extra whitespace remains
  const target = text.split(/\s+/)[0];
  if (!target) return null;

  let username: string | undefined;
  let hostPort = target;
  const atIdx = target.indexOf('@');
  if (atIdx !== -1) {
    const userPart = target.slice(0, atIdx).trim();
    if (userPart) username = userPart;
    hostPort = target.slice(atIdx + 1).trim();
  }

  if (!hostPort) {
    return username ? { username, port } : null;
  }

  let host = hostPort;
  // Handle IPv6 bracketed `[::1]:22` or standard `host:port`
  if (hostPort.startsWith('[')) {
    const closeBracket = hostPort.indexOf(']');
    if (closeBracket !== -1) {
      host = hostPort.slice(1, closeBracket);
      const rest = hostPort.slice(closeBracket + 1);
      if (rest.startsWith(':')) {
        const p = Number(rest.slice(1));
        if (p > 0 && p <= 65535 && port === undefined) port = p;
      }
    }
  } else {
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx !== -1) {
      const maybePort = Number(hostPort.slice(colonIdx + 1));
      if (maybePort > 0 && maybePort <= 65535) {
        host = hostPort.slice(0, colonIdx);
        if (port === undefined) port = maybePort;
      }
    }
  }

  if (!host) return null;
  return { username, host, port };
}
