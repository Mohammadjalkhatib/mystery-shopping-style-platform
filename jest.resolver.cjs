const fs = require('node:fs');
const path = require('node:path');

/**
 * ESM source imports carry explicit `.js` extensions (see D-007) but the files on disk are
 * `.ts`. Jest has to be told how to bridge that.
 *
 * A blanket `moduleNameMapper` of `^(\.{1,2}/.*)\.js$` -> `$1` does bridge it, but it also
 * rewrites relative requests made from INSIDE node_modules, which breaks packages that ship
 * real `.js`/`.mjs` files. So this resolver applies the rewrite only when the importer lives
 * in our own source tree and the corresponding `.ts` actually exists.
 */
module.exports = (request, options) => {
  if (
    request.endsWith('.js') &&
    /^\.{1,2}\//.test(request) &&
    !options.basedir.includes('node_modules')
  ) {
    const candidate = path.resolve(options.basedir, `${request.slice(0, -3)}.ts`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return options.defaultResolver(request, options);
};
