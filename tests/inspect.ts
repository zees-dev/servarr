// Runs in the disposable test cluster with the setup job's read-only mounts.
import { API, qbitLogin, type Settings, type Integration, type ObjectValue, type SeerrConfig, type BazarrConfig, type BazarrIntegrations } from '/setup/setup.ts';
const config: Settings = await Bun.file('/setup/settings.json').json();
const credentials = { username: process.env.SERVARR_USERNAME!, password: process.env.SERVARR_PASSWORD! };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable((value as ObjectValue)[k])])) : value;
const hash = (value: unknown) => new Bun.CryptoHasher('sha256').update(JSON.stringify(stable(value))).digest('hex');
const snapshot: Record<string, ObjectValue> = {};
for (const app of ['sonarr','radarr','prowlarr']) {
  const text = await Bun.file(`/configs/${app}/config.xml`).text();
  const key = text.match(/<ApiKey>([a-zA-Z0-9]+)<\/ApiKey>/)?.[1]; if(!key)throw Error('missing key');
  const api = new API(config.urls[app]+(app==='prowlarr'?'/api/v1':'/api/v3'),{'X-Api-Key':key});
  const clients = await api.request<Integration[]>('/downloadclient');
  // Deliberately edit a user setting. A repeat setup must retain it.
  if(process.env.EDIT_SETTING==='true'&&app==='sonarr'){const c=clients.find((c)=>c.implementation==='QBittorrent')!;await api.request('/downloadclient/'+c.id,'PUT',{...c,priority:9});}
  snapshot[app]={version:(await api.request<{ version: string }>('/system/status')).version,clients:hash(await api.request('/downloadclient'))};
  if(app!=='prowlarr'){snapshot[app].roots=hash((await api.request<{ id: number; path: string }[]>('/rootfolder')).map((r)=>({id:r.id,path:r.path})));snapshot[app].mapping=hash(await api.request('/remotepathmapping'));}
  else {
    for(const client of await api.request<unknown[]>('/applications'))await api.request('/applications/test','POST',client);
    for(const proxy of await api.request<unknown[]>('/indexerProxy'))await api.request('/indexerProxy/test','POST',proxy);
    snapshot[app].applications=hash(await api.request('/applications'));snapshot[app].proxies=hash(await api.request('/indexerProxy'));}
}
const q=await qbitLogin(config.urls.qbittorrent,credentials.username,credentials.password);
snapshot.qbittorrent={version:await q.request('/api/v2/app/version'),categories:hash(await q.request('/api/v2/torrents/categories')),torrents:hash(await q.request('/api/v2/torrents/info'))};
const jf=new API(config.urls.jellyfin,{Authorization:'MediaBrowser Client="servarr-test", Device="test", DeviceId="test", Version="2.0.0"'});
const auth=await jf.request<{ AccessToken: string }>('/Users/AuthenticateByName','POST',{Username:credentials.username,Pw:credentials.password});
const jfa=new API(config.urls.jellyfin,{Authorization:`MediaBrowser Token="${auth.AccessToken}"`});
snapshot.jellyfin={initialized:(await jf.request<{ StartupWizardCompleted: boolean }>('/System/Info/Public')).StartupWizardCompleted,users:hash((await jfa.request<{ Id: string; Name: string }[]>('/Users')).map((u)=>({id:u.Id,name:u.Name}))),libraries:hash((await jfa.request<{ Name: string; Locations: string[] }[]>('/Library/VirtualFolders')).map((f)=>({name:f.Name,locations:f.Locations})))};
const seerrConfig: SeerrConfig=await Bun.file('/configs/jellyseerr/settings.json').json();const seerr=new API(config.urls.jellyseerr+'/api/v1',{'X-Api-Key':seerrConfig.main.apiKey});
await seerr.request('/settings/jellyfin','POST',{});
if(!seerrConfig.jellyfin!.libraries!.some((l)=>l.enabled))throw Error('Seerr library selection is missing');
snapshot.seerr={libraries:hash(seerrConfig.jellyfin!.libraries),initialized:(await seerr.request<{ initialized: boolean }>('/settings/public')).initialized,sonarr:hash(await seerr.request('/settings/sonarr')),radarr:hash(await seerr.request('/settings/radarr'))};
const bazarrConfig=Bun.YAML.parse(await Bun.file('/configs/bazarr/config/config.yaml').text())as BazarrConfig;const bazarr=new API(config.urls.bazarr+'/api',{'X-Api-Key':bazarrConfig.auth.apikey});const settings=await bazarr.request<BazarrIntegrations>('/system/settings');for(const app of ['sonarr','radarr'])if(!settings[app]?.apikey||settings[app]?.ip!==new URL(config.urls[app]).hostname)throw Error('Bazarr integration is missing');snapshot.bazarr={sonarr:hash(settings.sonarr),radarr:hash(settings.radarr)};

if(process.env.SCAN_FIXTURE==='true'){
  await jfa.request('/Library/Refresh','POST',{});
  let item: { Id: string; Path?: string; Name: string } | undefined;
  for(let i=0;i<60;i++){const results=await jfa.request<{ Items: { Id: string; Path?: string; Name: string }[] }>('/Items?Recursive=true&IncludeItemTypes=Movie,Video&Fields=MediaSources');item=results.Items.find((r)=>r.Path?.endsWith('chart-fixture.mp4')||r.Name==='chart-fixture');if(item)break;await Bun.sleep(2000);}
  if(!item)throw Error('Fixture was not scanned');
  const response=await fetch(config.urls.jellyfin+'/Videos/'+item.Id+'/stream?static=true',{headers:{...jfa.headers,Range:'bytes=0-1023'},signal:AbortSignal.timeout(30000)});
  if(response.status!==206)throw Error('Media range failed');
  const data=await response.arrayBuffer();snapshot.media={id:item.Id,bytes:data.byteLength,sha256:new Bun.CryptoHasher('sha256').update(data).digest('hex')};
}

if(!snapshot.jellyfin.initialized || !snapshot.seerr.initialized)throw Error('Setup did not complete');
console.log(JSON.stringify(snapshot));
