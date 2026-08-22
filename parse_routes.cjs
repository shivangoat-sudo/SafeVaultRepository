const fs = require('fs');
const code = fs.readFileSync('server.ts', 'utf8');
const routes = [];
const regex = /app\.(get|post|put|delete)\(\s*["']([^"']+)["']/g;
let match;
while ((match = regex.exec(code)) !== null) {
  routes.push(match[2].replace('/api', ''));
}
fs.writeFileSync('/tmp/b_urls2.txt', routes.sort().join('\n'));
