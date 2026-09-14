# Chart 2.0.1 validation

Validated on 2026-09-14 in disposable ARM64 Kubernetes and the existing Pi K3s cluster. The existing Pi service upgrade was accepted on chart 2.0.0 with the service versions listed in the README. Chart 2.0.1 fixes Helm 4.3 scheduling compatibility while retaining those application versions. No service backup or SSD migration was performed.

| Check | Result |
| --- | --- |
| Dependency download from the current TrueCharts registry | All nine pinned charts downloaded; dependency lock recorded |
| Bun unit and render tests | 18 tests, 141 assertions passed on Helm 3.19.0, 4.1.3 and 4.3.0 |
| Helm lint with CI values | Passed |
| Chart Testing 3.14.0 schema and YAML lint | Passed; skipped dependency rebuilding on the read-only mount after separately verifying downloads |
| Minimal and VPN examples, alternate release/namespace | Rendered successfully |
| Fresh installation | Passed in disposable ARM64 Kubernetes, K3s 1.34.1, with all eight applications ready |
| First-time setup | qBittorrent credentials/categories, Arr integrations, Bazarr connections, Jellyfin administrator/library and Seerr initialization/library selection passed |
| Actual connection checks | Prowlarr to Sonarr/Radarr/FlareSolverr, all three Arr download clients to qBittorrent, and Seerr to Jellyfin passed |
| Repeat setup and Helm upgrade | Passed; saved password, application configuration and a deliberately edited Sonarr client priority were preserved |
| Jellyfin 10.11.11 to 12.0.0 | Separate disposable migration passed; user/library identities and a generated media file were retained |
| Authenticated Jellyfin media read after migration | Same media ID and same 1,024-byte response, SHA256 `2c7387f966120811830783520674175d226a2c32d464bace9b335c51748615a0` |
| Existing Pi upgrade | Jellyfin 10.11.11 to 12.0.0 passed; the other seven applications retained their Pod/container identities and restart counts |
| Pi Jellyfin library scan and preservation | Full scan completed; one user, one library, 42 media identities, media paths, credentials and PVC identities retained |
| Pi authenticated media read | Same media ID and 4,096-byte response, SHA256 `d77c2d3bba2e0d55bd87da0465c24511cdd865bfb236aab2e5562390b171ba93` |
| Pi integrations and VPN | Seerr and Bazarr upstream checks, all three Arr download-client tests, Mullvad exit/DNS/clear-interface denial and all nine stopped torrent states passed |
| Strict TypeScript | Zero diagnostics; explicit `any` types removed |
| Helm package | Built successfully |
| Whitespace/error check | `git diff --check` passed |

The full lifecycle test is reproducible with `bun run test:install`. It creates its own Docker/K3s cluster, uses test credentials and empty volumes, compares API snapshots around an upgrade, and removes the test container and volumes afterward. The disposable clusters were removed after their checks.

Tests cover architecture-neutral scheduling, writable API request fields, library selection, renamed integrations and the optional transcoder setting. The existing Pi uses `setup.enabled=false` and skips hooks because its applications are already initialized.

Jellyfin 12 requires the current Authorization header; the existing saved API key remains valid. Its aggregate `ItemCount` is now populated, whereas 10.11.11 left it at zero. The comparison accounts for that source-verified change while retaining every media-type count and individual media identity check. All six bundled Jellyfin plugins are active at 12.0.0.0.

Limits:

- Local runtime tests use ARM64. [Chart tests](https://github.com/zees-dev/servarr/actions/workflows/chart-test.yaml) check rendering on Helm 3.19.0 and 4.3.0 and run a complete fresh install and repeat upgrade on AMD64 with Helm 4.3.0. The workflow run is the authoritative remote result.
- VPN values were rendered and checked for the external Secret mount, resolver, health gate and restrictive NetworkPolicy. The prior Pi run validated these pinned qBittorrent/Gluetun versions with a real Mullvad profile, including tunnel loss and reconnection. The current profile was also revalidated after the Jellyfin rollout.
- A clean install cannot prove every operator's existing library, plugin, storage provisioner or ingress configuration will migrate. Both synthetic and existing-library Jellyfin migrations passed; third-party plugins, hardware transcoding and real torrent payload transfer were not tested.
- Homarr remains optional and disabled by default. Its legacy automatic dashboard setup was retired; Homarr itself was not upgraded or runtime-tested.
- FlareSolverr's previously observed Cloudflare challenge timeout remains. Indexers default to an empty list so it does not block fresh installation.

Chart source validation and live deployment do not publish an OCI release. Registry publication remains the separate manual release workflow.
