const fs = require('fs');
let content = fs.readFileSync('src/pages/OwnerDashboard.tsx', 'utf8');

content = content.replace(/loadStats/g, 'loadAll');

fs.writeFileSync('src/pages/OwnerDashboard.tsx', content);
console.log('Fixed all loadStats occurrences');
