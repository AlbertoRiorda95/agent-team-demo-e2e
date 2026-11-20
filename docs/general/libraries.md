# The team's libraries

The libraries the team maintains and that this project reuses. Agents read
this before writing something one of them already does
(`docs/agents/dependencies.md`), and design-studio before planning it.

The connection to the registry is `ci/registry.sh` (settings in
`ci/registry.env`): run `./ci/registry.sh login` once, with your token in
`REGISTRY_TOKEN`, before installing the dependencies. Without a registry, a
library released with `./ci/registry.sh local` on this machine is found in the
package manager's local repository (`~/.m2`, Conan's cache, or the folder in
`LOCAL_REPOSITORY` for npm and Python).

None yet. This project publishes its own package,
`@albertoriorda95/trajectory-proto` (`libs/trajectory-proto/`), but uses no
other team library.
