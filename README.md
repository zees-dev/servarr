# Servarr

A Helm chart for Sonarr, Radarr, Prowlarr, Bazarr, qBittorrent, Jellyfin, Seerr and FlareSolverr. Homarr is optional and disabled by default.

Chart 2.0.1 brings the validated service versions into public defaults and replaces duplicated setup hooks with repeatable Bun automation. It preserves existing credentials and configuration. VPN settings and Secrets are supplied by the operator.

Read the [chart documentation](servarr/README.md), start with [example values](servarr/examples/minimal.yaml), and review [validation results](servarr/VALIDATION.md) before upgrading. Image defaults are pinned to tested versions. Jellyfin 12.0 passed both disposable migration tests and the existing Pi library upgrade.

This fork is maintained by zees-dev and is based on [fonzdm/servarr](https://github.com/fonzdm/servarr). Thanks to the upstream authors and contributors.

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Contributors

<a href="https://github.com/fonzdm/servarr/graphs/contributors" title="Original upstream contributors">
  <img src="https://contrib.rocks/image?repo=fonzdm/servarr" />
</a>
<a href="https://github.com/zees-dev/servarr/graphs/contributors" title="Fork contributors">
  <img src="https://contrib.rocks/image?repo=zees-dev/servarr" />
</a>

See the full list of contributors - [upstream](https://github.com/fonzdm/servarr/contributors) + [fork](https://github.com/zees-dev/servarr/contributors).

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [releases on this repository](https://github.com/zees-dev/servarr/releases). 

###### Keep in mind that each dependency has its own author and their contributors. Please, reach them out on their repositories.

## License

This project is licensed under the GNU AGPL v3 License - see the [LICENSE](LICENSE) file for details.
