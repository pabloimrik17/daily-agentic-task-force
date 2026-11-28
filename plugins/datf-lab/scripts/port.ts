const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * Parses a TCP port from user-supplied text.
 *
 * @param input - the raw text, for example a CLI argument
 * @returns the port number, or undefined when the text is not a valid port
 */
export function parsePort(input: string): number | undefined {
    const value = Number.parseInt(input.trim(), 10);
    if (Number.isNaN(value) || value < MIN_PORT || value > MAX_PORT) {
        return undefined;
    }
    return value;
}

/**
 * Joins a host and a port into a `host:port` endpoint.
 *
 * @param host - the host name or address
 * @param input - the raw port text
 * @returns the endpoint, or undefined when the port is invalid
 */
export function formatEndpoint(host: string, input: string): string | undefined {
    const port = parsePort(input);
    return port === undefined ? undefined : `${host}:${port}`;
}
