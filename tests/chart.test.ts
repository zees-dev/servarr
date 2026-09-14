import { expect, test } from 'bun:test';
import type { Settings } from '../servarr/config/setup/setup';
type Container = { name: string; image: string; args?: string[]; env?: { name: string; value?: string; valueFrom?: { secretKeyRef: { name: string } } }[]; readinessProbe?: { exec?: { command: string[] } }; lifecycle?: unknown };
type Pod = { containers: Container[]; volumes: { secret?: { secretName: string } }[]; dnsPolicy?: string; dnsConfig?: { nameservers: string[] }; nodeSelector?: Record<string, string>; automountServiceAccountToken?: boolean };
type Deployment = { kind: 'Deployment'; spec: { template: { spec: Pod } } };
type ConfigMap = { kind: 'ConfigMap'; data: Record<string, string> };
type Service = { kind: 'Service'; spec: { ports: { port: number }[] } };
type Manifest = { metadata: { name: string } } & (Deployment | ConfigMap | Service | { kind: 'Job'; spec: { activeDeadlineSeconds: number; template: { spec: Pod } } } | { kind: 'NetworkPolicy'; spec: { egress: unknown[] } } | { kind: 'Secret' | 'PersistentVolumeClaim' | 'Ingress' });
function render(extra: string[] = []) { const p = Bun.spawnSync(['helm','template','custom-release','servarr/','-n','custom-namespace','-f','.github/ci/ci-values.yaml',...extra]); return { code: p.exitCode, error: p.stderr.toString(), docs: p.exitCode ? [] : p.stdout.toString().split(/^---\s*$/m).map(s=>Bun.YAML.parse(s)).filter(Boolean) as Manifest[] }; }
test('render uses accepted images and scoped setup jobs without duplicate services', () => {
  const r=render(); expect(r.error).toBe(''); expect(r.code).toBe(0);
  const ids=r.docs.map(d=>d.kind+'/'+d.metadata.name); expect(new Set(ids).size).toBe(ids.length);
  const deployments=r.docs.filter(d=>d.kind==='Deployment'); expect(deployments).toHaveLength(8);
  const images=deployments.flatMap(d=>d.spec.template.spec.containers.map((c)=>c.image));
  for(const version of ['4.0.19.2979','6.3.0.10514','1.6.0','2.5.2.5491','5.2.3','12.0','3.4.1','3.5.2']) expect(images.some(i=>i.includes(version))).toBe(true);
  const jobs=r.docs.filter(d=>d.kind==='Job'); expect(jobs).toHaveLength(2);
  for(const job of jobs){expect(job.metadata.name).toStartWith('custom-release-setup-');expect(job.spec.activeDeadlineSeconds).toBeGreaterThan(0);expect(job.spec.template.spec.automountServiceAccountToken).toBe(false);}
  const settings: Settings=JSON.parse(r.docs.find((d): d is Manifest & ConfigMap=>d.kind==='ConfigMap'&&d.metadata.name==='custom-release-setup')!.data['settings.json']);
  expect(settings.urls.sonarr).toBe('http://custom-release-sonarr.custom-namespace.svc.cluster.local:8989');
  expect(JSON.stringify(settings)).not.toContain('str0ngP4ssw0rd');
});
test('VPN policy, resolver, secret mount and health gating render together',()=>{
  const r=render(['-f','servarr/examples/vpn.yaml']);expect(r.error).toBe('');expect(r.code).toBe(0);
  const policy=r.docs.find(d=>d.kind==='NetworkPolicy')!;expect(policy.spec.egress).toEqual([{to:[{ipBlock:{cidr:'192.0.2.10/32'}}],ports:[{protocol:'UDP',port:51820}]}]);
  const pod=r.docs.find((d): d is Manifest & Deployment=>d.kind==='Deployment'&&d.metadata.name==='custom-release-qbittorrent')!.spec.template.spec;
  expect(pod.dnsPolicy).toBe('None');expect(pod.dnsConfig!.nameservers).toEqual(['10.64.0.1']);
  const glue=pod.containers.find((c)=>c.name.endsWith('-gluetun'))!;
  expect(glue.env!.find((e)=>e.name==='FIREWALL')!.value).toBe('on');
  expect(glue.readinessProbe!.exec!.command).toEqual(['/gluetun-entrypoint','healthcheck']);expect(glue.lifecycle).toBeUndefined();
  expect(pod.volumes.some((v)=>v.secret?.secretName==='servarr-wireguard')).toBe(true);
  expect(pod.containers.find((c)=>c.name==='custom-release-qbittorrent')!.args![0]).toContain('127.0.0.1:9999');
});
test('external credentials and disabled setup avoid chart-generated credentials',()=>{
  const r=render(['--set','setup.existingSecret=operator-secret']);expect(r.code).toBe(0);
  expect(r.docs.some(d=>d.kind==='Secret'&&d.metadata.name==='custom-release-setup-credentials')).toBe(false);
  const job=r.docs.find(d=>d.kind==='Job')!;expect(job.spec.template.spec.containers[0].env!.every((e)=>e.valueFrom!.secretKeyRef.name==='operator-secret')).toBe(true);
  const off=render(['--set','setup.enabled=false']);expect(off.code).toBe(0);expect(off.docs.filter(d=>d.kind==='Job')).toHaveLength(0);
});
test('VPN refuses a missing relay policy address',()=>{const r=render(['--set','qbittorrent.addons.gluetun.enabled=true']);expect(r.code).not.toBe(0);expect(r.error).toContain('endpointCIDR');});
test('default scheduling is portable across ARM64 and AMD64, including optional Homarr',()=>{
  for(const enabled of [false,true]){
    const r=render(['--set','homarr.enabled='+enabled]);expect(r.code).toBe(0);
    const deployments=r.docs.filter(d=>d.kind==='Deployment');expect(deployments).toHaveLength(enabled?9:8);
    for(const d of deployments)expect(d.spec.template.spec.nodeSelector??{}).toEqual({});
  }
});
test('operator selectors preserve architecture and hostname without inheriting a default architecture',()=>{
  const apps=['sonarr','radarr','bazarr','prowlarr','qbittorrent','jellyfin','jellyseerr','flaresolverr','homarr'];
  for(const arch of [undefined,'arm64','amd64']){
    const selector={'kubernetes.io/hostname':'operator-node',...(arch?{'kubernetes.io/arch':arch}:{})};
    const r=render(['--set','homarr.enabled=true','--set-json','global.nodeSelector='+JSON.stringify(selector),...apps.flatMap(app=>['--set-json',app+'.podOptions.nodeSelector='+JSON.stringify(selector)])]);
    expect(r.code).toBe(0);
    const workloads=r.docs.filter(d=>d.kind==='Deployment'||d.kind==='Job');expect(workloads).toHaveLength(11);
    for(const d of workloads)expect(d.spec.template.spec.nodeSelector).toEqual(selector);
  }
});
test('invalid VPN address and resolver configuration fail rendering',()=>{
  for(const args of [['--set','qbittorrent.vpn.endpointCIDR=999.1.1.1/32'],['--set','qbittorrent.podOptions.dnsPolicy=ClusterFirst']]){const r=render(['-f','servarr/examples/vpn.yaml',...args]);expect(r.code).not.toBe(0);}
});
test('transcoder bootstrap follows the persistence toggle and preserves the request body', () => {
  for (const enabled of [false, true]) {
    const r = render(['--set', `jellyfin.persistence.transcode.enabled=${enabled}`, '--set', 'jellyfin.transcoder.body.EncodingThreadCount=3']);
    expect(r.code).toBe(0);
    const settings: Settings = JSON.parse(r.docs.find((d): d is Manifest & ConfigMap => d.kind === 'ConfigMap' && d.metadata.name === 'custom-release-setup')!.data['settings.json']);
    expect(settings.transcoder.enabled).toBe(enabled);
    expect(settings.transcoder.body!.EncodingThreadCount).toBe(3);
    expect(settings.transcoder.body!.TranscodingTempPath).toBe('/config/transcodes');
  }
});
test('Gluetun control service exists exactly once with or without port forwarding',()=>{
  for(const enabled of [false,true]){
    const r=render(['-f','servarr/examples/vpn.yaml','--set','qbittorrent.qbitportforward.enabled='+enabled]);
    expect(r.code).toBe(0);
    const services=r.docs.filter((d): d is Manifest & Service=>d.kind==='Service'&&d.metadata.name==='custom-release-qbittorrent-gluetun');
    expect(services).toHaveLength(1);
    expect(services[0].spec.ports[0].port).toBe(8000);
  }
});
