const fs = require('fs');
let content = fs.readFileSync('src/pages/OwnerDashboard.tsx', 'utf8');

content = content.replace(
  'userCount: usersList.length,',
  'userCount: usersList.length,\n        organizationCount: 0,'
);

content = content.replace(
  '<StatCard label="Gebruikers" value={String(stats.userCount)} icon={Users} tone="brand" onClick={() => onTab("users")} />',
  '<StatCard label="Organisaties" value={String(stats.organizationCount || 0)} icon={Users} tone="brand" onClick={() => onTab("users")} />\n        <StatCard label="Gebruikers" value={String(stats.userCount)} icon={Users} tone="brand" onClick={() => onTab("users")} />'
);

fs.writeFileSync('src/pages/OwnerDashboard.tsx', content);
console.log('Patched overview tab');
