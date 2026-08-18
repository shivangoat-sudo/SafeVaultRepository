const fs = require('fs');

let typesContent = fs.readFileSync('src/types.ts', 'utf8');
typesContent = typesContent.replace('totalUsers: number;', 'totalUsers: number;\n  totalOrganizations?: number;');
fs.writeFileSync('src/types.ts', typesContent);

let serverContent = fs.readFileSync('server.ts', 'utf8');
serverContent = serverContent.replace(
  'const { count: userCount } = await supabase.from("accounts").select("id", { count: "exact" }).eq("role", "user");',
  'const { count: orgCount } = await supabase.from("accounts").select("id", { count: "exact" }).eq("role", "user").like("number", "2%");\n    const { count: userCount } = await supabase.from("accounts").select("id", { count: "exact" }).eq("role", "user").like("number", "89%");'
);
serverContent = serverContent.replace(
  'totalUsers: userCount || 0,',
  'totalUsers: userCount || 0,\n      totalOrganizations: orgCount || 0,'
);
fs.writeFileSync('server.ts', serverContent);

console.log('Patched stats');
