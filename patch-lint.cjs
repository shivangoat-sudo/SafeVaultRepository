const fs = require('fs');

let createOrg = fs.readFileSync('src/components/CreateOrganizationModal.tsx', 'utf8');
createOrg = createOrg.replace('X } from "lucide-react"', '} from "lucide-react"');
createOrg = createOrg.replace('err: any', 'err');
createOrg = createOrg.replace('err.message', 'err instanceof Error ? err.message : "Fout"');
createOrg = createOrg.replace('(doc as any).lastAutoTable', '(doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable');
fs.writeFileSync('src/components/CreateOrganizationModal.tsx', createOrg);

let ownerDash = fs.readFileSync('src/pages/OwnerDashboard.tsx', 'utf8');
ownerDash = ownerDash.replace('(u: any)', '(u: OwnerUser)');
ownerDash = ownerDash.replace('(u: any)', '(u: OwnerUser)');
fs.writeFileSync('src/pages/OwnerDashboard.tsx', ownerDash);

console.log('Fixed linting');
