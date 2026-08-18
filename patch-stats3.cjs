const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  'const { data: users } = await supabase.from("accounts").select("id, number, name, status, role, created_at, last_login_at").eq("role", "user");',
  'const { data: users } = await supabase.from("accounts").select("id, number, name, status, role, owner_id, created_at, last_login_at").eq("role", "user");'
);

content = content.replace(
  '        id: u.id,\n        number: u.number,',
  '        id: u.id,\n        number: u.number,\n        owner_id: u.owner_id,'
);

fs.writeFileSync('server.ts', content);
console.log('Patched server stats 3');

let typeContent = fs.readFileSync('src/types.ts', 'utf8');
typeContent = typeContent.replace(
  '  storageBytes: number;\n  createdAt: string;',
  '  storageBytes: number;\n  owner_id?: string | null;\n  createdAt: string;'
);
fs.writeFileSync('src/types.ts', typeContent);
