# servarr



![Version: 1.1.0](https://img.shields.io/badge/Version-1.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 1.1.0](https://img.shields.io/badge/AppVersion-1.1.0-informational?style=flat-square) 

Servarr complete Helm Chart for Kubernetes

**Homepage:** <https://github.com/fonzdm/servarr>

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| Alfonso De Masi | <adm220297@proton.me> |  |

## Source Code

* <https://github.com/fonzdm/servarr>

## Requirements

| Repository | Name | Version |
|------------|------|---------|
| oci://tccr.io/truecharts | bazarr | 23.0.0 |
| oci://tccr.io/truecharts | flaresolverr | 16.12.5 |
| oci://tccr.io/truecharts | homarr | 11.0.0 |
| oci://tccr.io/truecharts | jellyfin | 21.12.6 |
| oci://tccr.io/truecharts | jellyseerr | 13.11.3 |
| oci://tccr.io/truecharts | prowlarr | 21.0.0 |
| oci://tccr.io/truecharts | qbittorrent | 24.0.0 |
| oci://tccr.io/truecharts | radarr | 26.0.0 |
| oci://tccr.io/truecharts | sonarr | 25.0.1 |

---

> [!IMPORTANT]  
> Please consider that this chart is a collection of several public helm charts.
> These are included as sub-charts of the Servarr chart and, due to some Helm limitation, some configuration are only possible via values file.
> For this reason, the servarr default [values.yaml](#./values.yaml) included in the chart is quite huge and it used to model the configuration of the subcharts.
> But don't you worry! I provided some handy values, using [yaml anchors](https://medium.com/@kinghuang/docker-compose-anchors-aliases-extensions-a1e4105d70bd), to defined top-level fields.
> Follow the table below and forget everything else. 

> [!CAUTION] 
> Please, do not remove Anchors when you see them (the strage syntax with the `&`) and make sure you include all the parameters that are using the anchors. Check the minimal `values.yaml` reference.

<details><summary>Minimal <code>values.yaml</code> sample</summary>

```yaml
global:
  storageClassName: &storageClassName "<replace-with-your-storage-class-name>"
  ingressClassName: &ingressClassName "<replace-with-your-ingress-class-name>"
  certManagerClusterIssuer: &issuer
  username:
  password:
  mail:
  countryCode: "US"
  preferredLanguage: "en"

metrics:
  enabled: &metricsEnabled false

volumes:
  storageClass: *storageClassName
  downloads:
    name: &downloads-volume downloads-volume
    size: 100Gi
  media:
    name: &media-volume media-volume
    size: 250Gi
  torrentConfig:
    name: &torrentConfig torrent-config
    size: 250Mi

sonarr:
  metrics:
    main:
      enabled: *metricsEnabled
  workload:
    main:
      podSpec:
        containers:
          main:
            env:
              SONARR__API_KEY: *apikey
  ingress:
    sonarr-ing:
      annotations:
        cert-manager.io/cluster-issuer: *issuer
      ingressClassName: *ingressClassName
      hosts:
        - host: sonarr.local
          paths:
            - path: /
              pathType: Prefix
      tls:
        - hosts:
            - sonarr.local
          secretName: sonarr-tls
  persistence:
    config:
      storageClass: *storageClassName
    media:
      existingClaim: *media-volume
    downloads:
      existingClaim: *downloads-volume

radarr:
  metrics:
    main:
      enabled: *metricsEnabled
  workload:
    main:
      podSpec:
        containers:
          main:
            env:
              RADARR__API_KEY: *apikey
  ingress:
    radarr-ing:
      annotations:
        cert-manager.io/cluster-issuer: *issuer
      ingressClassName: *ingressClassName
      hosts:
        - host: radarr.local
          paths:
            - path: /
              pathType: Prefix
      tls:
        - hosts:
            - radarr.local
          secretName: radarr-tls
  persistence:
    config:
      storageClass: *storageClassName
    media:
      existingClaim: *media-volume
    downloads:
      existingClaim: *downloads-volume

bazarr:
  metrics:
    main:
      enabled: *metricsEnabled
  ingress:
    bazarr-ing:
      annotations:
        cert-manager.io/cluster-issuer: *issuer
      ingressClassName: *ingressClassName
      hosts:
        - host: bazarr.local
          paths:
            - path: /
              pathType: Prefix
      tls:
        - hosts:
            - bazarr.local
          secretName: bazarr-tls
  persistence:
    config:
      storageClass: *storageClassName
    media:
      existingClaim: *media-volume
    downloads:
      existingClaim: *downloads-volume

jellyfin:
  metrics:
    main:
      enabled: *metricsEnabled
  ingress:
    jellyfin-ing:
      annotations:
        cert-manager.io/cluster-issuer: *issuer
      ingressClassName: *ingressClassName
      hosts:
        - host: jellyfin.local
          paths:
            - path: /
              pathType: Prefix
      tls:
        - hosts:
            - jellyfin.local
          secretName: jellyfin-tls
  persistence:
    config:
      storageClass: *storageClassName
    media:
      existingClaim: *media-volume

jellyseerr:
  metrics:
    main:
      enabled: *metricsEnabled
  ingress:
    jellyseerr-ing:
      annotations:
        cert-manager.io/cluster-issuer: *issuer
      ingressClassName: *ingressClassName
      hosts:
        - host: jellyseerr.local
          paths:
            - path: /
              pathType: Prefix
      tls:
        - hosts:
            - jellyseerr.local
          secretName: jellyseerr-tls
  persistence:
    config:
      storageClass: *storageClassName
    media:
      existingClaim: *media-volume

homarr:
  metrics:
    main:
      enabled: *metricsEnabled
  ingress:
    homarr-ing:
      annotations:
        cert-manager.io/cluster-issuer: *issuer
      ingressClassName: *ingressClassName
      hosts:
        - host: homarr.local
          paths:
            - path: /
              pathType: Prefix
      tls:
        - hosts:
            - homarr.local
          secretName: homarr-tls
  persistence:
    config:
      storageClass: *storageClassName
    icons:
      storageClass: *storageClassName
    data:
      storageClass: *storageClassName

qbittorrent:
  metrics:
    main:
      enabled: *metricsEnabled
  ingress:
    qbittorrent-ing:
      annotations:
        cert-manager.io/cluster-issuer: *issuer
      ingressClassName: *ingressClassName
      hosts:
        - host: torrent.local
          paths:
            - path: /
              pathType: Prefix
      tls:
        - hosts:
            - torrent.local
          secretName: torrent-tls
  persistence:
    config:
      existingClaim: *torrentConfig
    downloads:
      existingClaim: *downloads-volume

prowlarr:
  metrics:
    main:
      enabled: *metricsEnabled
  workload:
    main:
      podSpec:
        containers:
          main:
            env:
              PROWLARR__API_KEY: *apikey
  ingress:
    prowlarr-ing:
      annotations:
        cert-manager.io/cluster-issuer: *issuer
      ingressClassName: *ingressClassName
      hosts:
        - host: prowlarr.local
          paths:
            - path: /
              pathType: Prefix
      tls:
        - hosts:
            - prowlarr.local
          secretName: prowlarr-tls
  persistence:
    config:
      storageClass: *storageClassName

flaresolverr:
  metrics:
    main:
      enabled: *metricsEnabled
  persistence:
    config:
      storageClass: *storageClassName
```

</details>

---

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| global.certManagerClusterIssuer | string | No default value, leave empty if not required | Insert your cert manager cluster issuer, e.g.: letsencrypt-cloudflare. Do not remove the `&issuer` anchor! @section -- Global |
| global.countryCode | string | US | Insert the Jellyfin country code @section -- Global |
| global.ingressClassName | string | nginx | Insert your ingress class here, e.g.: &ingressClassName nginx. Do not remove the `&ingressCassName` anchor, and do not leave the anchor value empty, otherwise you will face a `null` value error! @section -- Global |
| global.mail | string | `nil` | Insert Jellyfin login mail (also used for Jellyseerr integration) @section -- Global |
| global.password | string | `nil` | Insert the shared Servarr password (used for Jellyfin, Jellyseerr, and qBitTorrent admin) @section -- Global |
| global.preferredLanguage | string | en | Insert the Jellyfin preferred language @section -- Global |
| global.storageClassName | string | `"network-block"` | Insert your storage class here, e.g.: &storageClassName network-block. Do not remove the `&storageClassName` anchor! @section -- Global |
| global.username | string | `nil` | Insert the shared Servarr username (used for Jellyfin, Jellyseerr, and qBitTorrent admin) @section -- Global |
| indexers | list | The body of the 1337x index is provided as default | The indexers list. Each element of the list is the yaml-formatted body of the [Prowlarr API request](https://prowlarr.com/docs/api/#/Indexer/post_api_v1_indexer) to add that index. @section -- Prowlarr |
| issuer | object | See the sub fields | For tracking purpose, not used - replaced with pre-existing cluster issuer @section -- Issuer |
| issuer.cloudFlareKey | string | `nil` | Insert your CloudFlare key @section -- Issuer |
| issuer.email | string | `nil` | Insert your email address @section -- Issuer |
| metrics.enabled | bool | `false` | Anchor to set wether to deploy the export sidecar pods or not. Requires the Prometheus stack. Do not remove the `&metricsEnabled` anchor! @section -- Metrics |
| notifications.telegram.bot_apitoken | string | No default value | Insert your Telegram Bot API token @section -- Jellyseerr |
| notifications.telegram.chat_id | string | No default value | Insert the Telegram Chat id, check @get_id_bot for this @section -- Jellyseerr |
| notifications.telegram.enabled | bool | `true` | Enable the Telegram notifications @section -- Jellyseerr |
| qbittorrent.csrf_protection | bool | false | Whether to enable or disable CSRF Protection on qBitTorrent WebGUI @section -- Torrent |
| volumes.downloads | object | See the sub fields | configuration of the volume used for torrent downloads @section -- Storage |
| volumes.downloads.name | string | `"downloads-volume"` | Name of the download pvc. Do not remove the `&downloads-volume` anchor! @section -- Storage |
| volumes.downloads.size | string | `"100Gi"` | Size of the downloads volume, in Kubernets format @section -- Storage |
| volumes.media | object | See the sub fields | configuration of the volume used for media storage (i.e.: where movies and tv shows file will be permanently stored) @section -- Storage |
| volumes.media.name | string | `"media-volume"` | Name of the media pvc. Do not remove the `&media-volume` anchor! @section -- Storage |
| volumes.media.size | string | `"250Gi"` | Size of the media volume, in Kubernets format @section -- Storage |
| volumes.torrentConfig | object | See the sub fields | configuration of the volume used for qBitTorrent internal configuration @section -- Storage |
| volumes.torrentConfig.name | string | `"torrent-config"` | Name of the torrent configuration pvc. Do not remove the `&torrentConfig` anchor! @section -- Storage |
| volumes.torrentConfig.size | string | `"250Mi"` | Size of the torrent configuration volume, in Kubernets format @section -- Storage |


