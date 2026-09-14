import { mkdir, open, readdir } from 'node:fs/promises';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

// Shared by every setup phase. Never log request bodies, headers or responses.
export type ObjectValue = Record<string, unknown>;
export interface Field { name: string; value?: unknown; [key: string]: unknown }
export interface Integration { id?: number; implementation: string; name: string; fields: Field[]; priority?: number }
export interface Credentials { username: string; password: string; mail?: string }
export interface Library { id: string; name: string; enabled: boolean }
export interface SeerrConfig { main: { apiKey: string }; jellyfin?: { hostname?: string; libraries?: Library[] } }
export interface BazarrConfig { auth: { apikey: string } }
export type BazarrIntegrations = Record<string, { apikey?: string; ip?: string }>;
export interface Settings {
  urls: Record<string, string>;
  categories: Record<string, string>;
  paths: Record<string, string>;
  mediaManagement: Record<string, ObjectValue>;
  indexers: { name: string; body: ObjectValue }[];
  bazarrSettings: [string, unknown][];
  jellyfin: { libraryName: string; libraryPath?: string; libraryOptions?: ObjectValue };
  transcoder: { enabled: boolean; body?: ObjectValue };
  seerr: Record<string, string | undefined>;
  telegram: { enabled: boolean };
  timeoutSeconds: number;
  language?: string;
  country?: string;
  vpn: boolean;
  csrf: boolean;
  qbitPort: number;
}
export class SetupError extends Error {}
export class API {
  constructor(readonly base: string, readonly headers: Record<string, string> = {}) {}
  async request<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const form = body instanceof URLSearchParams;
    const response = await fetch(this.base + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { ...this.headers, ...(body === undefined ? {} : { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }) },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    if (!response.ok) throw new SetupError(`Setup request failed: ${method} ${new URL(path, this.base).pathname} HTTP ${response.status}`);
    const text = await response.text();
    if (!text) return null as T;
    try { return JSON.parse(text) as T; } catch { return text as T; }
  }
}
export async function waitFor<T>(check: () => Promise<T>, seconds: number) {
  const deadline = Date.now() + seconds * 1000;
  while (true) {
    try { return await check(); } catch {
      if (Date.now() >= deadline) throw new SetupError('Service readiness deadline exceeded');
      await Bun.sleep(2000);
    }
  }
}
export async function ensureResource<T>(api: API, path: string, matches: (row: T) => boolean, create: () => Promise<T>) {
  const rows = await api.request<T[]>(path);
  if (!Array.isArray(rows)) throw new SetupError(`Expected collection at ${path}`);
  const existing = rows.find(matches);
  return existing ?? api.request<T>(path, 'POST', await create());
}
export function schemaFields<T extends { id?: number; fields: Field[] }>(schema: T, values: ObjectValue) {
  const available = new Set(schema.fields.map((f) => f.name));
  for (const key of Object.keys(values)) if (!available.has(key)) throw new SetupError(`Unsupported integration field: ${key}`);
  const { id, ...body } = schema;
  return { ...body, fields: schema.fields.map((f) => Object.hasOwn(values, f.name) ? { ...f, value: values[f.name] } : f) };
}
export async function prepareQbit(directory: string, username: string, password: string, vpn: boolean, csrf: boolean, port: number) {
  if (!username || !password || password.length < 8 || /[\r\n]/.test(username)) throw new SetupError('Valid username and password of at least eight characters required');
  const folder = directory + '/qBittorrent', file = folder + '/qBittorrent.conf';
  if (await Bun.file(file).exists()) {
    const config = await Bun.file(file).text();
    if (!config.includes('[Preferences]') || !config.includes('WebUI\\Password_PBKDF2=')) throw new SetupError('Existing qBittorrent configuration requires manual inspection');
    return 'preserved';
  }
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory);
  if (entries.some(e => e !== 'lost+found' && e !== 'qBittorrent') ||
      entries.includes('qBittorrent') && (await readdir(folder)).length > 0) throw new SetupError('Refusing to initialize a nonempty qBittorrent data directory');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const salt = randomBytes(16), hash = pbkdf2Sync(password, salt, 100000, 64, 'sha512');
  const config = `[BitTorrent]\nSession\\DefaultSavePath=/downloads/\nSession\\TempPath=/downloads/incomplete/\nSession\\TempPathEnabled=true\n${vpn ? 'Session\\Interface=tun0\n' : ''}[Preferences]\nWebUI\\Username=${username}\nWebUI\\Password_PBKDF2="@ByteArray(${salt.toString('base64')}:${hash.toString('base64')})"\nWebUI\\Port=${port}\nWebUI\\Address=*\nWebUI\\LocalHostAuth=true\nWebUI\\AuthSubnetWhitelistEnabled=false\nWebUI\\CSRFProtection=${csrf}\nWebUI\\HostHeaderValidation=false\n`;
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(config); await handle.sync(); } finally { await handle.close(); }
  return 'initialized';
}
export async function qbitLogin(base: string, username: string, password: string) {
  const response = await fetch(base + '/api/v2/auth/login', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Referer: base, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password }) });
  const text = await response.text();
  const cookies = response.headers.getSetCookie().map(c => c.split(';')[0]);
  const expected = 'QBT_SID_' + (new URL(base).port || '80');
  const cookie = cookies.find(c => c.startsWith(expected + '=')) ?? cookies.find(c => c.startsWith('SID='));
  if (!cookie || !(response.status === 204 && text === '' && cookie.startsWith(expected + '=') || response.status === 200 && text.trim() === 'Ok.' && cookie.startsWith('SID='))) throw new SetupError('Saved qBittorrent login failed');
  return new API(base, { Cookie: cookie, Referer: base });
}
async function readKey(app: string, directory: string) {
  const text = await Bun.file(`${directory}/${app}/config.xml`).text();
  const key = text.match(/<ApiKey>([a-zA-Z0-9]+)<\/ApiKey>/)?.[1];
  if (!key) throw new SetupError(`${app} API key unavailable`);
  return key;
}
async function integration(api: API, path: string, implementation: string, name: string, fields: ObjectValue, extras: ObjectValue = {}) {
  const endpointFields = Object.hasOwn(fields, 'baseUrl') ? ['baseUrl'] : Object.hasOwn(fields, 'port') ? ['host', 'port'] : ['host'];
  return ensureResource<Integration>(api, path, row => row.implementation === implementation && (row.name === name || endpointFields.every(key =>
    row.fields?.some((field) => field.name === key && String(field.value) === String(fields[key]))
  )), async () => {
    const schemas = await api.request<Integration[]>(path + '/schema');
    const schema = schemas.find((row) => row.implementation === implementation);
    if (!schema) throw new SetupError(`Integration schema unavailable: ${implementation}`);
    return { ...schemaFields(schema, fields), ...extras, name };
  });
}
export async function setupArr(app: 'sonarr' | 'radarr', api: API, config: Pick<Settings, 'urls' | 'categories' | 'paths' | 'mediaManagement'>, credentials: Credentials) {
  const clients = await api.request<Integration[]>('/downloadclient');
  const roots = await api.request<{ path: string }[]>('/rootfolder');
  const fresh = clients.length === 0 && roots.length === 0;
  const categoryField = app === 'sonarr' ? 'tvCategory' : 'movieCategory';
  const client = await integration(api, '/downloadclient', 'QBittorrent', 'qBittorrent', {
    host: new URL(config.urls.qbittorrent).hostname, port: Number(new URL(config.urls.qbittorrent).port),
    username: credentials.username, password: credentials.password, [categoryField]: config.categories[app],
  }, { enable: true, priority: 1, removeCompletedDownloads: true, removeFailedDownloads: true });
  const host = client.fields.find((field) => field.name === 'host')?.value;
  if (!host) throw new SetupError('Configured qBittorrent client has no host');
  await ensureResource<{ host: unknown; remotePath: string; localPath: string }>(api, '/remotepathmapping', r => r.host === host && r.remotePath.replace(/\/$/, '') === config.paths.downloads.replace(/\/$/, ''), async () => ({ host, remotePath: config.paths.downloads, localPath: config.paths.arrDownloads }));
  await ensureResource<{ path: string }>(api, '/rootfolder', r => r.path.replace(/\/$/, '') === config.paths[app].replace(/\/$/, ''), async () => ({ path: config.paths[app] }));
  if (fresh && Object.keys(config.mediaManagement[app]).length) {
    const existing = await api.request<ObjectValue>('/config/mediamanagement');
    await api.request('/config/mediamanagement', 'PUT', { ...existing, ...config.mediaManagement[app] });
  }
}
export async function setupProwlarr(api: API, config: Pick<Settings, 'urls' | 'categories' | 'indexers'>, credentials: Credentials, keys: Record<string, string>) {
  for (const app of ['radarr', 'sonarr']) await integration(api, '/applications', app === 'sonarr' ? 'Sonarr' : 'Radarr', app === 'sonarr' ? 'Sonarr' : 'Radarr', {
    prowlarrUrl: config.urls.prowlarr, baseUrl: config.urls[app], apiKey: keys[app], syncCategories: app === 'sonarr' ? [5000] : [2000],
  }, { syncLevel: 'fullSync' });
  await integration(api, '/downloadclient', 'QBittorrent', 'qBittorrent', {
    host: new URL(config.urls.qbittorrent).hostname, port: Number(new URL(config.urls.qbittorrent).port), username: credentials.username, password: credentials.password, category: config.categories.prowlarr,
  }, { enable: true, priority: 1 });
  await integration(api, '/indexerProxy', 'FlareSolverr', 'FlareSolverr', { host: config.urls.flaresolverr, requestTimeout: 60 }, { tags: [] });
  for (const indexer of config.indexers) await ensureResource<{ name: string }>(api, '/indexer', r => r.name === indexer.name, async () => ({ ...indexer.body, name: indexer.name }));
}
async function setupBazarr(config: Settings, directory: string, keys: Record<string, string>) {
  const saved = await waitFor(async () => { const value = Bun.YAML.parse(await Bun.file(directory + '/bazarr/config/config.yaml').text()) as BazarrConfig; if (!value?.auth?.apikey) throw new SetupError('Bazarr API key unavailable'); return value; }, config.timeoutSeconds);
  const api = new API(config.urls.bazarr + '/api', { 'X-Api-Key': saved.auth.apikey });
  await waitFor(() => api.request('/system/status'), config.timeoutSeconds);
  const current = await api.request<BazarrIntegrations>('/system/settings');
  const form = new URLSearchParams();
  for (const app of ['sonarr', 'radarr']) {
    if (current[app]?.apikey) continue;
    form.append('settings-general-use_' + app, 'true');
    form.append(`settings-${app}-ip`, new URL(config.urls[app]).hostname);
    form.append(`settings-${app}-port`, new URL(config.urls[app]).port);
    form.append(`settings-${app}-apikey`, keys[app]);
  }
  // Defaults apply only when neither integration has been initialized.
  if (!current.sonarr?.apikey && !current.radarr?.apikey) for (const [key, value] of config.bazarrSettings) form.append(key, String(value));
  if (form.size) await api.request('/system/settings', 'POST', form);
}
export async function setupJellyfin(config: Pick<Settings, 'urls' | 'timeoutSeconds' | 'language' | 'country' | 'jellyfin' | 'transcoder'>, credentials: Credentials) {
  const api = new API(config.urls.jellyfin);
  const publicInfo = await waitFor(() => api.request<{ StartupWizardCompleted?: boolean }>('/System/Info/Public'), config.timeoutSeconds);
  if (typeof publicInfo.StartupWizardCompleted !== 'boolean') throw new SetupError('Jellyfin setup state unavailable');
  const fresh = !publicInfo.StartupWizardCompleted;
  if (fresh) {
    await api.request('/Startup/Configuration', 'POST', { UICulture: config.language, PreferredMetadataLanguage: config.language, MetadataCountryCode: config.country });
    await api.request('/Startup/User');
    await api.request('/Startup/User', 'POST', { Name: credentials.username, Password: credentials.password });
    await api.request('/Startup/RemoteAccess', 'POST', { EnableRemoteAccess: true, EnableAutomaticPortMapping: false });
    await api.request('/Startup/Complete', 'POST', {});
  }
  const authAPI = new API(config.urls.jellyfin, { Authorization: 'MediaBrowser Client="servarr-setup", Device="setup", DeviceId="servarr-setup", Version="2.0.0"' });
  const auth = await authAPI.request<{ AccessToken?: string }>('/Users/AuthenticateByName', 'POST', { Username: credentials.username, Pw: credentials.password });
  if (!auth.AccessToken) throw new SetupError('Jellyfin saved login failed');
  const authenticated = new API(config.urls.jellyfin, { Authorization: `MediaBrowser Token="${auth.AccessToken}"` });
  const folders = await authenticated.request<{ Name: string }[]>('/Library/VirtualFolders');
  if (!folders.some((f) => f.Name === config.jellyfin.libraryName)) {
    await authenticated.request('/Library/VirtualFolders?' + new URLSearchParams({ name: config.jellyfin.libraryName, refreshLibrary: 'false' }), 'POST', { LibraryOptions: { ...config.jellyfin.libraryOptions, PathInfos: [{ Path: config.jellyfin.libraryPath }] } });
  }
  if (fresh && config.transcoder.enabled) {
    const current = await authenticated.request<ObjectValue>('/System/Configuration/encoding');
    await authenticated.request('/System/Configuration/encoding', 'POST', { ...current, ...config.transcoder.body });
  }
}
export async function setupSeerr(config: Pick<Settings, 'urls' | 'paths' | 'timeoutSeconds' | 'language' | 'jellyfin' | 'seerr' | 'telegram'>, credentials: Credentials, directory: string, keys: Record<string, string>, arr: Record<string, API>) {
  const saved = await waitFor(async () => { const value: SeerrConfig = await Bun.file(directory + '/jellyseerr/settings.json').json(); if (!value.main?.apiKey) throw new SetupError('Seerr API key unavailable'); return value; }, config.timeoutSeconds);
  const api = new API(config.urls.jellyseerr + '/api/v1', { 'X-Api-Key': saved.main.apiKey });
  const status = await waitFor(() => api.request<{ initialized?: boolean }>('/settings/public'), config.timeoutSeconds);
  if (typeof status.initialized !== 'boolean') throw new SetupError('Seerr setup state unavailable');
  if (!status.initialized && !saved.jellyfin?.hostname) {
    const host = new URL(config.urls.jellyfin);
    await api.request('/auth/jellyfin', 'POST', { username: credentials.username, password: credentials.password, email: credentials.mail, hostname: host.hostname, port: Number(host.port), useSsl: host.protocol === 'https:', urlBase: '', serverType: 2 });
  }
  if (!status.initialized || !saved.jellyfin?.libraries?.length) {
    const enabled = (saved.jellyfin?.libraries ?? []).filter((l) => l.enabled).map((l) => l.id);
    const libraries = await api.request<Library[]>('/settings/jellyfin/library?' + new URLSearchParams({ sync: 'true', ...(enabled.length ? { enable: enabled.join(',') } : {}) }));
    const selected = libraries.find((l) => l.name === config.jellyfin.libraryName);
    if (!selected) throw new SetupError('Configured Jellyfin library was not discovered by Seerr');
    await api.request('/settings/jellyfin/library?' + new URLSearchParams({ enable: [...new Set([...enabled, selected.id])].join(',') }));
  }
  for (const app of ['sonarr', 'radarr']) await ensureResource<{ hostname: string }>(api, '/settings/' + app, r => r.hostname === new URL(config.urls[app]).hostname, async () => {
    const profiles = await arr[app].request<{ id: number; name: string }[]>('/qualityprofile');
    const wanted = config.seerr[app + 'Profile'];
    const profile = wanted ? profiles.find((p) => p.name === wanted) : profiles[0];
    if (!profile) throw new SetupError(`No matching ${app} quality profile`);
    const host = new URL(config.urls[app]);
    return { name: app === 'sonarr' ? 'Sonarr' : 'Radarr', hostname: host.hostname, port: Number(host.port), apiKey: keys[app], useSsl: false, baseUrl: '', activeProfileId: profile.id, activeProfileName: profile.name, activeDirectory: config.paths[app], is4k: false, isDefault: true, syncEnabled: true, preventSearch: false, tagRequests: false, tags: [], ...(app === 'sonarr' ? { enableSeasonFolders: true, activeAnimeProfileId: profile.id, activeAnimeProfileName: profile.name, activeAnimeDirectory: config.paths.sonarr, animeTags: [] } : { minimumAvailability: 'released' }) };
  });
  if (!status.initialized) {
    await api.request('/settings/main', 'POST', { locale: config.language });
    if (config.telegram.enabled) {
      const token = process.env.TELEGRAM_BOT_APITOKEN, chat = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chat) throw new SetupError('Telegram credentials required when enabled');
      await api.request('/settings/notifications/telegram', 'POST', { enabled: true, types: 4062, options: { botAPI: token, chatId: chat, sendSilently: false } });
    }
    await api.request('/settings/initialize', 'POST', {});
  }
}
export async function configure(config: Settings, credentials: Credentials, directory: string) {
  const keys: Record<string, string> = {}, arr: Record<string, API> = {};
  for (const app of ['sonarr', 'radarr', 'prowlarr']) {
    keys[app] = await waitFor(() => readKey(app, directory), config.timeoutSeconds);
    arr[app] = new API(config.urls[app] + (app === 'prowlarr' ? '/api/v1' : '/api/v3'), { 'X-Api-Key': keys[app] });
    await waitFor(() => arr[app].request('/system/status'), config.timeoutSeconds);
  }
  const qbit = await waitFor(() => qbitLogin(config.urls.qbittorrent, credentials.username, credentials.password), config.timeoutSeconds);
  const categories = await qbit.request<ObjectValue>('/api/v2/torrents/categories');
  for (const category of Object.values(config.categories)) if (!Object.hasOwn(categories, category)) await qbit.request('/api/v2/torrents/createCategory', 'POST', new URLSearchParams({ category, savePath: '' }));
  for (const app of ['sonarr', 'radarr'] as const) { await setupArr(app, arr[app], config, credentials); console.log(`${app}: configuration checked`); }
  await setupProwlarr(arr.prowlarr, config, credentials, keys);
  await setupBazarr(config, directory, keys);
  await setupJellyfin(config, credentials);
  await setupSeerr(config, credentials, directory, keys, arr);
  for (const app of ['sonarr', 'radarr', 'prowlarr']) {
    const clients = await arr[app].request<Integration[]>('/downloadclient');
    for (const client of clients.filter((c) => c.implementation === 'QBittorrent')) await arr[app].request('/downloadclient/test', 'POST', client);
  }
  console.log('Setup and download-client connection tests completed');
}
if (import.meta.main) {
  try {
    const config: Settings = await Bun.file(process.env.SETUP_CONFIG ?? '/setup/settings.json').json();
    const credentials = { username: process.env.SERVARR_USERNAME ?? '', password: process.env.SERVARR_PASSWORD ?? '', mail: process.env.SERVARR_MAIL ?? '' };
    if (!credentials.username || credentials.password.length < 8) throw new SetupError('Setup credentials are missing or invalid');
    if (Bun.argv[2] === 'prepare-qbittorrent') console.log(await prepareQbit('/config', credentials.username, credentials.password, config.vpn, config.csrf, config.qbitPort));
    else await configure(config, credentials, process.env.CONFIG_ROOT ?? '/configs');
  } catch (error) {
    // Library errors may contain tokens or response bodies. Only our fixed messages are exposed.
    console.error(error instanceof SetupError ? error.message : 'Servarr setup failed. Check service readiness, configuration and supplied credentials.');
    process.exitCode = 1;
  }
}
