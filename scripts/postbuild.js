const fs = require('fs')
const path = require('path')

const buildDir = path.join(__dirname, '..', 'build')

// Rename index.html to app-shell.html so it doesn't compete at root
fs.renameSync(
  path.join(buildDir, 'index.html'),
  path.join(buildDir, 'app-shell.html')
)

// Write _redirects so Netlify knows how to route
fs.writeFileSync(
  path.join(buildDir, '_redirects'),
  `/cpanel   https://cpanel.gzci.ca   301!
/webmail  https://webmail.gzci.ca  301!
/mail     https://privateemail.com 301!
/api/*    /.netlify/functions/:splat  200
/app/*    /app-shell.html  200
/*        /landing.html  200
`
)

console.log('postbuild: index.html → app-shell.html, _redirects updated')
