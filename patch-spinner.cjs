const fs = require('fs');

let createOrg = fs.readFileSync('src/components/CreateOrganizationModal.tsx', 'utf8');
createOrg = createOrg.replace('import { Spinner } from "@/components/Spinner";', 'import { Spinner } from "@/components/ui";');
fs.writeFileSync('src/components/CreateOrganizationModal.tsx', createOrg);

console.log('Fixed spinner');
