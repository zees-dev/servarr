# Servarr chart

Servarr installs Sonarr, Radarr, Prowlarr, Bazarr, qBittorrent, Jellyfin, Seerr and FlareSolverr. Homarr remains an optional dependency, disabled by default, with manual setup. The existing `jellyseerr` values key and resource names are retained for Seerr so upgrades keep the same configuration claim.

## Versions

Chart 2.0.0 pins the latest stable application versions checked on 2026-09-14 by version and digest. These versions passed the Pi service upgrades and disposable fresh-install tests. Enable Renovate for this repository to receive image, chart and GitHub Action update PRs; validate and deploy each accepted update.

| Component | Default |
| --- | --- |
| Sonarr | 4.0.19.2979 |
| Radarr | 6.3.0.10514 |
| Prowlarr | 2.5.2.5491 |
| Bazarr | 1.6.0 |
| qBittorrent | 5.2.3 |
| Gluetun | 3.41.3 |
| Jellyfin | 12.0 |
| Seerr | 3.4.1 |
| FlareSolverr | 3.5.2 |

Subchart versions are independently pinned in Chart.yaml. Their current registry is `oci://oci.trueforge.org/truecharts`. Override any application's `image.repository` and `image.tag` through values when validating another version.

## Installation

Use Kubernetes with a storage provisioner. A cluster that enforces NetworkPolicy is required for VPN protection. Configure ingress and certificates for your environment; an ingress controller is not installed by this chart. Local storage requires every application and setup job that mounts a shared claim to run on the same node. For storage that supports mounting from multiple nodes, choose the appropriate access modes.

Create a Secret in the intended namespace with keys `username`, `password` and `mail`. Set `setup.existingSecret` to its name. The password must contain at least eight characters. The older `global.username/password/mail` values remain supported, but Helm stores those values in release metadata. The setup code never prints credentials or response bodies.

Start with [examples/minimal.yaml](examples/minimal.yaml). Change its storage class, capacities and credentials Secret name. YAML anchors apply within one file only; changing `global.storageClassName` in an overlay does not update aliases that were already expanded from another file. The example explicitly sets the affected claims.

```sh
helm dependency build servarr/
helm install servarr servarr/ --namespace servarr --create-namespace \
  --values servarr/examples/minimal.yaml --timeout 20m
```

The example uses direct networking for qBittorrent. To enable VPN, also supply [examples/vpn.yaml](examples/vpn.yaml) with your relay's IPv4 /32, UDP port, VPN DNS resolver and required local subnets. Create the referenced Secret containing `wg0.conf` yourself. Its endpoint must match the policy address and port. The chart does not generate or register provider credentials.

```sh
kubectl -n servarr create secret generic servarr-wireguard --from-file=wg0.conf=/path/to/wg0.conf
helm upgrade --install servarr servarr/ -n servarr \
  -f servarr/examples/minimal.yaml -f servarr/examples/vpn.yaml --timeout 20m
```

With VPN enabled, fresh qBittorrent configuration binds to `tun0`. Application startup waits for Gluetun health. Gluetun filters traffic, and a separate NetworkPolicy permits only the specified relay UDP endpoint. Configure VPN DNS in both Gluetun and the pod as shown in the example. Existing installations must already bind qBittorrent to `tun0` before enabling VPN; the startup check fails instead of silently changing saved configuration. Changes to a mounted WireGuard Secret require a qBittorrent pod restart to load the new profile.

The original `qbittorrent.addons.gluetun.secret` inline profile mechanism remains available for compatibility, although an externally managed Secret is preferred. Do not enable two competing profile mounts.

## Setup behavior

Two bounded Bun jobs replace the Python hooks and runtime pip installations. The pre-install/pre-upgrade job creates qBittorrent configuration only when its data directory is empty. Existing configuration is read and preserved byte for byte. An inconsistent nonempty directory fails setup rather than being reset.

The post-install/post-upgrade job reads API keys from read-only application config mounts, authenticates using the supplied credentials, creates missing integrations and categories, then tests qBittorrent connections from Sonarr, Radarr and Prowlarr. Existing integrations are preserved. Sonarr uses its TV category. Integration request fields come from each application's own API schema.

Seerr discovers and enables the selected Jellyfin library during initial setup. Existing library selections are preserved. Jellyfin's startup state is checked explicitly; setup creates its administrator only when the startup wizard is incomplete. Seerr uses that Jellyfin account and discovers available Sonarr/Radarr quality profiles. Choose profiles by name through `setup.seerr.sonarrProfile` and `radarrProfile`. The first available profile is used when no name is specified.

Useful settings:

- `setup.enabled`: disable all setup jobs for externally initialized applications. Pre-create valid qBittorrent configuration before starting it.
- `setup.onUpgrade`: run setup checks on upgrade, enabled by default. Set false to run hooks only on installation.
- `setup.timeoutSeconds`: bound each job's runtime; use a longer Helm timeout for initial image downloads.
- `setup.paths`: Sonarr/Radarr root folders and remote path mapping. Match these to your actual volume mounts.
- `setup.categories`: qBittorrent categories for each client.
- `setup.mediaManagement`: optional Sonarr/Radarr defaults, applied only when no clients or root folders exist.
- `setup.jellyfin`: library name, path and optional library settings.
- `bazarrSettings`: form field/value pairs applied only before either Arr integration is configured. Providers requiring accounts must be configured by the operator.
- `indexers`: explicit Prowlarr API request bodies. Defaults are empty; installation does not depend on a public indexer or a Cloudflare challenge succeeding.

Changing setup values does not rotate an existing password or overwrite user-edited integrations. Perform deliberate changes in the application's UI/API. Setup mounts must point to the same config claims as the applications; `persistence.config.existingClaim` overrides are respected. HostPath config storage and configuration stored outside these claims require external setup with `setup.enabled=false`.

## Upgrading from 1.x

This is a major chart version because setup behavior and defaults changed. If you currently use Homarr, explicitly keep `homarr.enabled: true` in your upgrade values; otherwise the new disabled default removes its chart-managed resources. Check existing claim retention before disabling it. Preserve existing claim names, volume mappings, API keys and application placement. Compare a server dry run against fresh installed values before applying. Do not reuse a historical full values snapshot over newer configuration.

Jellyfin 12 changes the database and authorization behavior. Changing the image back does not undo that migration. Review plugin compatibility and perform a full library scan after upgrading, as described in the [Jellyfin release notes](https://github.com/jellyfin/jellyfin/releases/tag/v12.0). The isolated migration test used a synthetic media file; it does not establish compatibility for every external plugin or library.

Removed code includes eight duplicated Python scripts, seven per-application jobs, an inactive issuer template, a bundled public-indexer response and a sample Homarr dashboard. The Gluetun control service retains its existing name and selector, with a guard against duplicate emission by the port-forwarding subchart. Homarr automatic owner/dashboard setup was retired with that legacy dashboard code; use Homarr's own setup UI if you enable the optional chart. Homarr itself was not upgraded or runtime-validated in this run. Existing dashboards and claims are not reset by the new setup code.

Sonarr and Bazarr retain UID/GID 568 with read-only roots using a dedicated writable S6 runtime directory. Their publisher does not generally support combined nonroot and read-only mode; repeat startup tests when changing images. Seerr has a dedicated writable image-cache directory. Bazarr's discontinued Podnapisi provider is no longer supplied as a default. FlareSolverr's existing Cloudflare challenge timeout remains a known limitation.

The old shared PVCs were created as hooks and remain retained hooks to preserve ownership. They are not deleted on hook failure. Existing claims are reused; disabling creation does not delete an existing claim. Removing a Helm release does not automatically clean up retained hook resources. Setup Secret/ConfigMap/jobs use release-prefixed names in 2.0; old fixed-name setup hooks may be removed manually after a successful upgrade when no other release uses them.

## Validation and development

Use Bun for scripts and tests. No runtime package installation is required.

```sh
helm dependency build servarr/
bun test tests
helm lint servarr/ -f .github/ci/ci-values.yaml
helm template servarr servarr/ -f .github/ci/ci-values.yaml
helm package servarr/
```

Unit and render tests check repeated setup, saved configuration, authentication, API schema compatibility, release/namespace portability, Secret references and VPN policy rendering. The CI workflow also runs `bun run test:install`, which owns and removes a disposable Docker/K3s cluster. Full installation results are recorded in [VALIDATION.md](VALIDATION.md). Runtime acceptance of the Pi overlay does not substitute for a fresh-install check of this chart.
