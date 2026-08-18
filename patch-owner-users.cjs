const fs = require('fs');
let content = fs.readFileSync('src/pages/OwnerDashboard.tsx', 'utf8');

const filterState = `  const [filterType, setFilterType] = useState<"all" | "orgs" | "users">("all");\n  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);\n`;

let stateInsert = content.indexOf('const [resetTarget, setResetTarget] = useState');
content = content.slice(0, stateInsert) + filterState + content.slice(stateInsert);

const displayedUsers = `
  const displayedUsers = users.filter(u => {
    if (selectedOrgId) return u.owner_id === selectedOrgId;
    if (filterType === "orgs") return String(u.number).startsWith("2");
    if (filterType === "users") return String(u.number).startsWith("89");
    return !u.owner_id || String(u.number).startsWith("2") || (String(u.number).startsWith("89") && u.owner_id === account?.id);
  });
  
  const selectedOrg = users.find(u => u.id === selectedOrgId);
`;

const handleActionInsert = content.indexOf('const handleDelete = async');
content = content.slice(0, handleActionInsert) + displayedUsers + '\n  ' + content.slice(handleActionInsert);

const tabsHtml = `
      {selectedOrgId ? (
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setSelectedOrgId(null)} className="btn-ghost px-2">← Terug</button>
          <span className="text-sm font-medium">Gebruikers van {selectedOrg?.name}</span>
        </div>
      ) : (
        <div className="flex gap-2 mb-4">
          <button onClick={() => setFilterType("all")} className={\`px-3 py-1.5 rounded-md text-sm font-medium \${filterType === "all" ? "bg-ink-100 text-ink-900" : "text-ink-600 hover:bg-ink-50"}\`}>Alle</button>
          <button onClick={() => setFilterType("orgs")} className={\`px-3 py-1.5 rounded-md text-sm font-medium \${filterType === "orgs" ? "bg-ink-100 text-ink-900" : "text-ink-600 hover:bg-ink-50"}\`}>Organisaties</button>
          <button onClick={() => setFilterType("users")} className={\`px-3 py-1.5 rounded-md text-sm font-medium \${filterType === "users" ? "bg-ink-100 text-ink-900" : "text-ink-600 hover:bg-ink-50"}\`}>Boekhouders</button>
        </div>
      )}
`;

const tableInsert = content.indexOf('<div className="card overflow-hidden">');
content = content.slice(0, tableInsert) + tabsHtml + content.slice(tableInsert);

// Replace mapping to use displayedUsers
content = content.replace(
  'users.map((user) => (',
  'displayedUsers.map((user) => ('
);
content = content.replace(
  'users.length === 0',
  'displayedUsers.length === 0'
);

// Add Type column and view users button
content = content.replace(
  '<th className="px-5 py-3">Naam</th>',
  '<th className="px-5 py-3">Type</th>\n                  <th className="px-5 py-3">Naam</th>'
);

content = content.replace(
  '<td className="px-5 py-4 whitespace-nowrap">',
  '<td className="px-5 py-4 whitespace-nowrap">\n                      {String(user.number).startsWith("2") ? <span className="badge badge-brand">Organisatie</span> : <span className="badge badge-neutral">Boekhouder</span>}\n                    </td>\n                    <td className="px-5 py-4 whitespace-nowrap">'
);

const actionHtml = `
                          {String(user.number).startsWith("2") && (
                            <button onClick={() => setSelectedOrgId(user.id)} className="text-ink-400 hover:text-ink-700 transition-colors" title="Bekijk gebruikers">
                              <Users className="h-4 w-4" />
                            </button>
                          )}
`;
content = content.replace(
  '<button onClick={() => setResetTarget(user)}',
  actionHtml + '\n                          <button onClick={() => setResetTarget(user)}'
);

// We need to bring account from useAuth into OwnerUsersTab to check account?.id
const accountInsert = content.indexOf('const { push } = useToast();');
content = content.slice(0, accountInsert) + 'const { account } = useAuth();\n  ' + content.slice(accountInsert);

fs.writeFileSync('src/pages/OwnerDashboard.tsx', content);
console.log('Patched OwnerUsersTab');
