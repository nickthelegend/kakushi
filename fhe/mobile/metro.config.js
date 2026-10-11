// node_modules is a symlink to a directory outside the project (the project disk is nearly full;
// see scripts/install-deps.sh). Metro must watch the real location to resolve through it.
const { getDefaultConfig } = require("expo/metro-config");
const fs = require("fs");
const path = require("path");

const config = getDefaultConfig(__dirname);
const nm = path.join(__dirname, "node_modules");
const realNm = fs.realpathSync(nm);
if (realNm !== nm) {
  config.watchFolders = [...(config.watchFolders ?? []), realNm];
  config.resolver.nodeModulesPaths = [realNm, ...(config.resolver.nodeModulesPaths ?? [])];
}
config.resolver.unstable_enableSymlinks = true;
module.exports = config;
