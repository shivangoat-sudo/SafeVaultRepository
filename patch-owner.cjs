const fs = require('fs');
const content = fs.readFileSync('src/pages/OwnerDashboard.tsx', 'utf8');

const importStatement = `import { CreateOrganizationModal } from "@/components/CreateOrganizationModal";\n`;
let newContent = importStatement + content;

const stateCode = `  const [showCreateOrg, setShowCreateOrg] = useState(false);\n`;
const stateInsert = newContent.indexOf('  const [showCreateUser, setShowCreateUser] = useState(false);');
if (stateInsert !== -1) {
  newContent = newContent.slice(0, stateInsert) + stateCode + newContent.slice(stateInsert);
}

const buttonHtml = `
            <button onClick={() => setShowCreateOrg(true)} className="btn-secondary">
              <UserPlus className="mr-2 h-4 w-4" /> Organisatie aanmaken
            </button>
`;
const buttonInsert = newContent.indexOf('<button onClick={() => setShowCreateUser(true)} className="btn-primary">');
if (buttonInsert !== -1) {
  newContent = newContent.slice(0, buttonInsert) + buttonHtml + newContent.slice(buttonInsert);
}

const modalHtml = `      <CreateOrganizationModal open={showCreateOrg} onClose={() => setShowCreateOrg(false)} onCreated={loadStats} />\n`;
const modalInsert = newContent.indexOf('<CreateUserModal open={showCreateUser}');
if (modalInsert !== -1) {
  newContent = newContent.slice(0, modalInsert) + modalHtml + newContent.slice(modalInsert);
}

fs.writeFileSync('src/pages/OwnerDashboard.tsx', newContent);
console.log('Patched OwnerDashboard.tsx');
