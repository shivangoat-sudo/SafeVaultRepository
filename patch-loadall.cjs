const fs = require('fs');
let content = fs.readFileSync('src/pages/OwnerDashboard.tsx', 'utf8');

content = content.replace('onCreated={loadStats}', 'onCreated={loadAll}');

fs.writeFileSync('src/pages/OwnerDashboard.tsx', content);
console.log('Fixed onCreated binding');
