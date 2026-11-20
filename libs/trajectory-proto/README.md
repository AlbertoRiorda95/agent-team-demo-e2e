# @albertoriorda95/trajectory-proto

The TypeScript types of the Protobuf messages in `proto/`, generated with
`npx buf generate`, as an npm package. The web apps use it as a workspace
dependency; other projects install it from GitHub Packages
(`@albertoriorda95:registry=https://npm.pkg.github.com`).

Released on a `v*` tag by `.github/workflows/publish.yml`; on this machine
with `./ci/registry.sh local`. The package itself (`package.json`, the
generated sources, the build) comes with the foundations task
(`docs/design/foundations.md`).
