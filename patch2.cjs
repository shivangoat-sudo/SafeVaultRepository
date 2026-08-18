const fs = require('fs');
let content = fs.readFileSync('src/pages/OwnerDashboard.tsx', 'utf8');

// Pass onCreateOrg to OwnerUsersTab component call
content = content.replace(
  '<OwnerUsersTab users={users} onCreateUser={() => setShowCreateUser(true)} onCreateCustomers={(u) => setCreateCustomersFor(u)} onManageCustomers={(u) => setManageCustomersFor(u)} onRefresh={loadStats} onBack={() => setTab("overview")} />',
  '<OwnerUsersTab users={users} onCreateUser={() => setShowCreateUser(true)} onCreateOrg={() => setShowCreateOrg(true)} onCreateCustomers={(u) => setCreateCustomersFor(u)} onManageCustomers={(u) => setManageCustomersFor(u)} onRefresh={loadStats} onBack={() => setTab("overview")} />'
);

// Add onCreateOrg to OwnerUsersTab definition
content = content.replace(
  'function OwnerUsersTab({ users, onCreateUser, onCreateCustomers, onManageCustomers, onRefresh, onBack }: {',
  'function OwnerUsersTab({ users, onCreateUser, onCreateOrg, onCreateCustomers, onManageCustomers, onRefresh, onBack }: {'
);
content = content.replace(
  '  onCreateUser: () => void;',
  '  onCreateUser: () => void;\n  onCreateOrg: () => void;'
);

// Add the button to PageHeader
content = content.replace(
  'action={<button onClick={onCreateUser} className="btn-primary"><UserPlus className="h-4 w-4" /> Gebruiker aanmaken</button>}',
  'action={ <div className="flex gap-2"> <button onClick={onCreateUser} className="btn-primary"><UserPlus className="h-4 w-4 mr-2" /> Gebruiker aanmaken</button> <button onClick={onCreateOrg} className="btn-secondary"><UserPlus className="h-4 w-4 mr-2" /> Organisatie aanmaken</button> </div> }'
);

fs.writeFileSync('src/pages/OwnerDashboard.tsx', content);
