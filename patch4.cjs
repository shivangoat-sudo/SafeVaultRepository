const fs = require('fs');
let content = fs.readFileSync('src/pages/OwnerDashboard.tsx', 'utf8');

content = content.replace(
  'organizationCount: 0,',
  'organizationCount: usersList.filter((u: any) => String(u.number).startsWith("2")).length,'
);

content = content.replace(
  'userCount: usersList.length,',
  'userCount: usersList.filter((u: any) => String(u.number).startsWith("89")).length,'
);

fs.writeFileSync('src/pages/OwnerDashboard.tsx', content);
console.log('Patched overview tab dynamically');
