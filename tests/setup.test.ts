import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { API, ensureResource, prepareQbit, qbitLogin, schemaFields, setupArr, setupJellyfin, setupProwlarr, setupSeerr, type Integration, type ObjectValue } from '../servarr/config/setup/setup';
const servers: ReturnType<typeof Bun.serve>[] = [], folders: string[] = [];
afterEach(async () => { for (const s of servers.splice(0)) s.stop(true); for (const f of folders.splice(0)) await rm(f, { recursive: true, force: true }); });
function server(handler: (r: Request) => Response | Promise<Response>) { const s = Bun.serve({ port: 0, fetch: handler }); servers.push(s); return s.url.origin; }
test('qBittorrent initialization preserves existing bytes and refuses orphaned data', async () => {
  const dir = await mkdtemp(tmpdir() + '/servarr-setup-'); folders.push(dir);
  expect(await prepareQbit(dir, 'admin', 'test-password', true, true, 10095)).toBe('initialized');
  const path = dir + '/qBittorrent/qBittorrent.conf', original = await Bun.file(path).text();
  expect(original).toContain('Session\\Interface=tun0'); expect(original).not.toContain('test-password');
  expect(await prepareQbit(dir, 'other-user', 'other-password', false, false, 1234)).toBe('preserved');
  expect(await Bun.file(path).text()).toBe(original);
  await rm(path); await Bun.write(dir + '/qBittorrent/saved.fastresume', 'existing data');
  await expect(prepareQbit(dir, 'admin', 'test-password', true, true, 10095)).rejects.toThrow('nonempty');
});
test('resource checks never treat arbitrary HTTP failures as already configured', async () => {
  let posts = 0;
  const url = server(r => { if (r.method === 'POST') posts++; return Response.json({ error: 'unauthorized' }, { status: 401 }); });
  await expect(ensureResource(new API(url), '/client', () => true, async () => ({}))).rejects.toThrow('401'); expect(posts).toBe(0);
});
test('schema defaults survive overrides and unknown fields fail explicitly', () => {
  const schema = { id: 0, fields: [{ name: 'tvCategory', value: '' }, { name: 'newOption', value: 7 }] };
  expect(schemaFields(schema, { tvCategory: 'sonarr' }).fields[1].value).toBe(7);
  expect(() => schemaFields(schema, { movieCategory: 'radarr' })).toThrow('Unsupported');
});
test('Sonarr uses TV category and repeat setup preserves edited settings', async () => {
  const rows: Record<string, unknown[]> & { '/downloadclient': Integration[] } = { '/downloadclient': [], '/rootfolder': [], '/remotepathmapping': [] }; let writes = 0;
  const url = server(async r => { const path = new URL(r.url).pathname; if (path === '/downloadclient/schema') return Response.json([{ implementation: 'QBittorrent', fields: ['host','port','username','password','tvCategory'].map(name => ({ name })) }]); if (r.method === 'GET') return Response.json(rows[path]); const body: ObjectValue = await r.json(); writes++; rows[path].push({ ...body, id: rows[path].length + 1 }); return Response.json(rows[path].at(-1), { status: 201 }); });
  const config = { urls: { qbittorrent: 'http://torrent:10095' }, categories: { sonarr: 'shows' }, paths: { sonarr: '/media/shows', downloads: '/downloads', arrDownloads: '/mnt/downloads' }, mediaManagement: { sonarr: {} } };
  await setupArr('sonarr', new API(url), config, { username: 'admin', password: 'secret' });
  expect(rows['/downloadclient'][0].fields.find((f) => f.name === 'tvCategory')!.value).toBe('shows');
  const count = writes; rows['/downloadclient'][0].priority = 9; rows['/downloadclient'][0].name = 'My downloader';
  await setupArr('sonarr', new API(url), config, { username: 'changed', password: 'different' });
  expect(writes).toBe(count); expect(rows['/downloadclient'][0].priority).toBe(9);
  expect(rows['/downloadclient']).toHaveLength(1);
  expect(rows['/downloadclient'][0].name).toBe('My downloader');
});
test('renamed Prowlarr integrations retain their saved configuration', async () => {
  const rows = {
    '/applications': [
      { implementation: 'Sonarr', name: 'TV', fields: [{ name: 'baseUrl', value: 'http://sonarr:8989' }] },
      { implementation: 'Radarr', name: 'Movies', fields: [{ name: 'baseUrl', value: 'http://radarr:7878' }] },
    ],
    '/downloadclient': [{ implementation: 'QBittorrent', name: 'Downloads', fields: [{ name: 'host', value: 'torrent' }, { name: 'port', value: 10095 }] }],
    '/indexerProxy': [{ implementation: 'FlareSolverr', name: 'Proxy', fields: [{ name: 'host', value: 'http://flaresolverr:8191' }] }],
  };
  let writes = 0;
  const url = server(r => {
    if (r.method !== 'GET') writes++;
    const path = new URL(r.url).pathname;
    return Response.json(rows[path as keyof typeof rows] ?? [], { status: r.method === 'GET' ? 200 : 500 });
  });
  await setupProwlarr(new API(url), { urls: { sonarr: 'http://sonarr:8989', radarr: 'http://radarr:7878', prowlarr: url, qbittorrent: 'http://torrent:10095', flaresolverr: 'http://flaresolverr:8191' }, categories: { prowlarr: 'indexers' }, indexers: [] }, { username: 'admin', password: 'secret' }, { sonarr: 's', radarr: 'r' });
  expect(writes).toBe(0);
});
test('Jellyfin applies transcoder overrides only on enabled fresh setup', async () => {
  for (const fresh of [false, true]) for (const enabled of [false, true]) {
    const encodingWrites: unknown[] = [];
    const url = server(async r => {
      const path = new URL(r.url).pathname;
      if (path === '/System/Info/Public') return Response.json({ StartupWizardCompleted: !fresh });
      if (path === '/Users/AuthenticateByName') return Response.json({ AccessToken: 'secret' });
      if (path === '/Library/VirtualFolders') return Response.json([{ Name: 'Library' }]);
      if (path === '/System/Configuration/encoding') {
        if (r.method === 'POST') encodingWrites.push(await r.json());
        return Response.json({ EncodingThreadCount: -1, ServerDefault: 'preserve' });
      }
      if (path.startsWith('/Startup/')) return Response.json({});
      return new Response(null, { status: 500 });
    });
    await setupJellyfin({ urls: { jellyfin: url }, timeoutSeconds: 1, language: 'en', country: 'NZ', jellyfin: { libraryName: 'Library' }, transcoder: { enabled, body: { EncodingThreadCount: 3 } } }, { username: 'admin', password: 'secret' });
    expect(encodingWrites).toEqual(fresh && enabled ? [{ EncodingThreadCount: 3, ServerDefault: 'preserve' }] : []);
  }
});
test('modern and legacy qBittorrent login require the matching success response and cookie', async () => {
  let mode = 'modern';
  const url = server(r => {
    const port = new URL(r.url).port;
    if (mode === 'modern') return new Response(null, { status: 204, headers: { 'Set-Cookie': `QBT_SID_${port}=test; HttpOnly` } });
    if (mode === 'legacy') return new Response('Ok.', { headers: { 'Set-Cookie': 'SID=test; HttpOnly' } });
    return new Response('Fails.', { headers: { 'Set-Cookie': 'SID=test' } });
  });
  expect((await qbitLogin(url, 'admin', 'secret')).headers.Cookie).toStartWith('QBT_SID_');
  mode = 'legacy'; expect((await qbitLogin(url, 'admin', 'secret')).headers.Cookie).toBe('SID=test');
  mode = 'invalid'; await expect(qbitLogin(url, 'admin', 'secret')).rejects.toThrow('login failed');
});
test('initialized Jellyfin authenticates and skips all startup writes', async () => {
  const writes: string[] = [];
  const url = server(r => { const path = new URL(r.url).pathname; if(r.method === 'POST') writes.push(path); if(path === '/System/Info/Public') return Response.json({ StartupWizardCompleted: true }); if(path === '/Users/AuthenticateByName') return Response.json({ AccessToken: 'secret' }); if(path === '/Library/VirtualFolders') return Response.json([{ Name: 'Library' }]); return new Response(null, { status: 500 }); });
  await setupJellyfin({ urls: { jellyfin: url }, timeoutSeconds: 1, jellyfin: { libraryName: 'Library' }, transcoder: { enabled: false } }, { username: 'admin', password: 'secret' });
  expect(writes).toEqual(['/Users/AuthenticateByName']);
});
test('Seerr sends only writable settings, enables its library and finalizes last', async () => {
  const dir=await mkdtemp(tmpdir()+'/servarr-seerr-');folders.push(dir);
  await Bun.write(dir+'/jellyseerr/settings.json',JSON.stringify({main:{apiKey:'test-key'},jellyfin:{hostname:'',libraries:[]}}));
  const writes:{path:string,body:ObjectValue}[]=[];const integrations:Record<string,ObjectValue[]>={'/api/v1/settings/sonarr':[],'/api/v1/settings/radarr':[]};
  const url=server(async r=>{const u=new URL(r.url),path=u.pathname;
    if(path==='/api/v1/settings/public')return Response.json({initialized:false});
    if(path==='/api/v1/settings/jellyfin/library' && u.searchParams.has('enable') && !u.searchParams.get('enable')) return new Response(null,{status:400});
    if(path==='/api/v1/settings/jellyfin/library')return Response.json([{id:'library-1',name:'Library',enabled:u.searchParams.get('enable')==='library-1'}]);
    if(path==='/qualityprofile')return Response.json([{id:7,name:'HD'}]);
    if(r.method==='GET')return Response.json(integrations[path]??[]);
    const body: ObjectValue=await r.json();writes.push({path,body});
    if(path==='/api/v1/settings/main'&&Object.keys(body).some(k=>k!=='locale'))return new Response(null,{status:400});
    if(integrations[path])integrations[path].push(body);
    return Response.json(body);
  });
  const config={urls:{jellyseerr:url,jellyfin:url,sonarr:url,radarr:url},paths:{sonarr:'/shows',radarr:'/movies'},timeoutSeconds:1,language:'en',telegram:{enabled:false},jellyfin:{libraryName:'Library'},seerr:{sonarrProfile:'HD',radarrProfile:'HD'}};
  await setupSeerr(config,{username:'admin',password:'secret',mail:'test@example.invalid'},dir,{sonarr:'s',radarr:'r'},{sonarr:new API(url),radarr:new API(url)});
  expect(writes.find(w=>w.path.endsWith('/main'))?.body).toEqual({locale:'en'});
  expect(writes.at(-1)?.path).toBe('/api/v1/settings/initialize');
  expect(integrations['/api/v1/settings/sonarr'][0].activeProfileId).toBe(7);
});
