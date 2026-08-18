const fs = require('fs');
let content = fs.readFileSync('src/pages/OwnerDashboard.tsx', 'utf8');

// Revert type state
content = content.replace('  const [type, setType] = useState<"user" | "organization">("user");\n', '');
content = content.replace('      setType("user");\n', '');

// Revert validity check
content = content.replace(
  '  const isValidNumber = type === "user" ? /^\\d{8}$/.test(number) && number.startsWith("89") : /^\\d{8}$/.test(number) && number.startsWith("2");\n' +
  '  const canSubmit = name.trim() && name.length <= 80 && isValidNumber && password.length >= 8 && password.length <= 15 && /^[A-Za-z0-9]+$/.test(password) && customerCount >= 0 && customerCount <= 500;',
  '  const canSubmit = name.trim() && /^\\d{8}$/.test(number) && number.startsWith("89") && password.length >= 8 && password.length <= 15 && /^[A-Za-z0-9]+$/.test(password) && customerCount >= 0 && customerCount <= 500;'
);

// Revert radio buttons
const radioStart = content.indexOf('<label className="block text-sm font-medium text-ink-700 mb-1.5">Type Account</label>');
if (radioStart !== -1) {
  const divStart = content.lastIndexOf('<div>', radioStart);
  const divEnd = content.indexOf('</div>', radioStart) + 6;
  const nextDivEnd = content.indexOf('</div>', divEnd) + 6; // because there are nested divs
  
  // Let's just use regex to remove the type account div
  content = content.replace(/<div>\s*<label className="block text-sm font-medium text-ink-700 mb-1\.5">Type Account<\/label>[\s\S]*?<\/p>\s*<\/div>/, '');
}

fs.writeFileSync('src/pages/OwnerDashboard.tsx', content);
