import { Flight } from './search-api';

/**
 * Wizz Air's site, for now: a link straight to its flight selection for one adult comes with Wizz
 * Air's booking links (#75), once its URL format is taken from wizzair.com.
 */
export function wizzairLink(_outbound: Flight, _inbound?: Flight): string {
  return 'https://www.wizzair.com/en-gb';
}
