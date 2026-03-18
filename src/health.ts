export const HEALTH_PATH = '/health';
export const HEALTH_RESPONSE_BODY = 'OK';

export function isHealthRequest(url?: string): boolean {
  return url === HEALTH_PATH || url?.startsWith(`${HEALTH_PATH}?`) === true;
}
