/** Public product name. Do not change package ids, storage keys, or API product ids. */
export const APP_NAME_AR = 'مستودعي';
export const APP_NAME_EN = 'Mostawdaee';

export function appName(isRtl: boolean): string {
  return isRtl ? APP_NAME_AR : APP_NAME_EN;
}
