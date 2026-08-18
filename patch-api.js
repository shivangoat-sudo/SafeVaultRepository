const fs = require('fs');
const content = fs.readFileSync('src/api.ts', 'utf8');

const routeCode = `
  ownerCreateOrganizationBulk: (data: any) =>
    request<{ ok: boolean }>("/owner/create-organization-bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),
`;

const insertIndex = content.indexOf('ownerCreateUser: (');
if (insertIndex !== -1) {
  const newContent = content.slice(0, insertIndex) + routeCode + '\n  ' + content.slice(insertIndex);
  fs.writeFileSync('src/api.ts', newContent);
  console.log('Patched api.ts successfully');
} else {
  console.log('Failed to find insert location');
}
