// Full lifecycle test. Owns only a new Docker container and its disposable cluster.
// No user's kubeconfig is loaded and no real VPN credentials are used.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
type App = 'sonarr' | 'radarr' | 'bazarr' | 'prowlarr' | 'qbittorrent' | 'jellyfin' | 'jellyseerr' | 'flaresolverr';
type TestValues = Record<App, { resources?: { requests: Record<string, string>; limits: Record<string, string> }; persistence: { config?: { size: string } } }> & {
  setup: { existingSecret: string; timeoutSeconds: number };
  global: { username: string; password: string; mail: string };
  volumes: Record<string, { size: string }>;
};
type InspectPod = {
  containers: { command: string[]; env: { name: string; value?: string }[]; volumeMounts: { name: string; mountPath: string; readOnly?: boolean }[] }[];
  volumes: { name: string; configMap?: { name: string } }[];
};
const root = await mkdtemp(tmpdir() + '/servarr-chart-install-');
const name = 'servarr-chart-' + crypto.randomUUID().slice(0, 8);
const env = { ...process.env, KUBECONFIG: root + '/kubeconfig' };
async function run(args: string[], options: { capture?: boolean } = {}) {
  const p = Bun.spawn(args, { env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if (await p.exited) throw new Error(`${args[0]} ${args[1]} failed: ${err.slice(-1500)}`);
  if (!options.capture && out.trim()) console.log(out.trim());
  return out;
}
async function inspect(label: string, edit: boolean) {
  const source: { spec: { template: { spec: InspectPod } } }=JSON.parse(await run(['kubectl','-n','chart-test','get','job','chart-test-setup-configure','-o','json'],{capture:true}));
  const name='test-inspect-'+label, spec=source.spec.template.spec;
  spec.containers[0].command=['bun','/test/inspect.ts'];
  spec.containers[0].env.push({name:'EDIT_SETTING',value:String(edit)});
  spec.containers[0].volumeMounts.push({name:'test-script',mountPath:'/test',readOnly:true});
  spec.volumes.push({name:'test-script',configMap:{name}});
  const cm={apiVersion:'v1',kind:'ConfigMap',metadata:{name,namespace:'chart-test'},data:{'inspect.ts':await Bun.file('tests/inspect.ts').text()}};
  const job={apiVersion:'batch/v1',kind:'Job',metadata:{name,namespace:'chart-test'},spec:{backoffLimit:0,activeDeadlineSeconds:180,template:{metadata:{labels:{test:'servarr'}},spec}}};
  const file=root+'/'+name+'.json';await Bun.write(file,JSON.stringify({apiVersion:'v1',kind:'List',items:[cm,job]}));
  await run(['kubectl','create','-f',file],{capture:true});
  await run(['kubectl','-n','chart-test','wait','job/'+name,'--for=condition=complete','--timeout=180s'],{capture:true});
  return JSON.parse((await run(['kubectl','-n','chart-test','logs','job/'+name],{capture:true})).trim()) as unknown;
}
let created = false;
try {
  await run(['docker','run','-d','--name',name,'--label','servarr.chart-test=true','--privileged','-p','127.0.0.1::6443','-e','K3S_KUBECONFIG_MODE=644','rancher/k3s:v1.34.1-k3s1','server','--disable=traefik','--disable=metrics-server','--disable=servicelb','--tls-san=127.0.0.1']); created = true;
  const port = (await run(['docker','port',name,'6443'], { capture:true })).trim().split(':').at(-1);
  for(let i=0;;i++){try{await run(['docker','cp',name+':/etc/rancher/k3s/k3s.yaml',root+'/kubeconfig'],{capture:true});break;}catch{if(i===60)throw Error('K3s did not start');await Bun.sleep(1000);}}
  await Bun.write(env.KUBECONFIG,(await Bun.file(env.KUBECONFIG).text()).replace('127.0.0.1:6443','127.0.0.1:'+port));
  for(let i=0;;i++){try{await run(['kubectl','get','nodes'],{capture:true});break;}catch{if(i===60)throw Error('K3s API not ready');await Bun.sleep(1000);}}
  const values = Bun.YAML.parse(await Bun.file('servarr/examples/minimal.yaml').text()) as TestValues;
  values.setup.existingSecret='';values.setup.timeoutSeconds=900;
  values.global.username='chart-test';values.global.password=crypto.randomUUID();values.global.mail='chart-test@example.invalid';
  for(const volume of ['downloads','media','torrentConfig'])values.volumes[volume].size='128Mi';
  for(const app of ['sonarr','radarr','bazarr','prowlarr','qbittorrent','jellyfin','jellyseerr','flaresolverr'] as const){values[app].resources={requests:{cpu:'10m',memory:'128Mi'},limits:{cpu:'1500m',memory:'1Gi'}};if(values[app].persistence.config)values[app].persistence.config.size='512Mi';}
  await Bun.write(root+'/values.yaml',Bun.YAML.stringify(values,null,2));
  await run(['helm','install','chart-test','servarr/','-n','chart-test','--create-namespace','-f',root+'/values.yaml','--timeout','20m']);
  await run(['kubectl','-n','chart-test','wait','deployment','--all','--for=condition=Available','--timeout=300s']);
  const qbitConfig=()=>run(['kubectl','-n','chart-test','exec','deployment/chart-test-qbittorrent','--','cat','/config/qBittorrent/qBittorrent.conf'],{capture:true});
  const before=await qbitConfig();
  const firstSnapshot=await inspect("before",true);
  await run(['helm','upgrade','chart-test','servarr/','-n','chart-test','-f',root+'/values.yaml','--timeout','20m']);
  await run(['kubectl','-n','chart-test','wait','deployment','--all','--for=condition=Available','--timeout=300s']);
  const after=await qbitConfig();
  const secondSnapshot=await inspect("after",false);
  if(JSON.stringify(firstSnapshot)!==JSON.stringify(secondSnapshot))throw Error("Service configuration changed during repeat setup");
  const credential=(s:string)=>s.split('\n').find(l=>l.startsWith('WebUI\\Password_PBKDF2='));
  if(!credential(before)||credential(before)!==credential(after))throw Error('Saved qBittorrent password changed during upgrade');
  console.log(JSON.stringify({pass:true,freshInstall:true,repeatedSetupAndUpgrade:true,passwordPreserved:true,applicationConfigurationAndUserEditPreserved:true,productionClusterAccessed:false}));
} finally {
  if(created)await run(['docker','rm','-f','-v',name]);
  await rm(root,{recursive:true,force:true});
}
