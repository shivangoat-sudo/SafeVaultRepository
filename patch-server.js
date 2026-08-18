const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');

const routeCode = `
  app.post("/api/owner/create-organization-bulk", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });

    const { org, users, ownerPassword } = req.body;
    if (!org || !org.number || !org.password || !ownerPassword) {
      return res.status(400).json({ error: "Ontbrekende velden." });
    }

    // Verify owner password
    const { data: ownerCreds } = await supabase.from("credentials").select("password_hash").eq("account_id", req.user.id).single();
    if (!ownerCreds) return res.status(500).json({ error: "Eigenaar inloggegevens niet gevonden." });
    const isMatch = await bcrypt.compare(ownerPassword, ownerCreds.password_hash);
    if (!isMatch) return res.status(401).json({ error: "Onjuist wachtwoord." });

    // Verify org number doesn't exist
    const { data: existingOrg } = await supabase.from("accounts").select("id").eq("number", org.number).single();
    if (existingOrg) return res.status(400).json({ error: "Organisatienummer is al in gebruik." });

    try {
      // 1. Create Org
      const orgHash = await bcrypt.hash(org.password, 10);
      const { data: orgAccount, error: orgErr } = await supabase.from("accounts").insert({
        number: org.number, name: org.name, role: "user", status: "active", owner_id: req.user.id
      }).select().single();
      if (orgErr || !orgAccount) throw new Error(orgErr?.message || "Fout bij aanmaken organisatie.");
      
      await supabase.from("credentials").insert({ account_id: orgAccount.id, password_hash: orgHash });
      dataStore.setTempPassword(orgAccount.id, org.password);

      // 2. Create Users and Customers
      for (const u of users || []) {
        const uHash = await bcrypt.hash(u.password, 10);
        const { data: userAcc, error: uErr } = await supabase.from("accounts").insert({
          number: u.number, name: u.name, role: "user", status: "active", owner_id: orgAccount.id
        }).select().single();
        if (uErr || !userAcc) throw new Error(uErr?.message || "Fout bij aanmaken gebruiker.");
        
        await supabase.from("credentials").insert({ account_id: userAcc.id, password_hash: uHash });
        dataStore.setTempPassword(userAcc.id, u.password);

        // 3. Create Customers
        for (const c of u.customers || []) {
          const cHash = await bcrypt.hash(c.password, 10);
          const { data: custAcc, error: cErr } = await supabase.from("accounts").insert({
            number: c.number, name: c.name, role: "customer", status: "active", owner_id: userAcc.id
          }).select().single();
          if (cErr || !custAcc) throw new Error(cErr?.message || "Fout bij aanmaken klant.");
          
          await supabase.from("credentials").insert({ account_id: custAcc.id, password_hash: cHash });
          dataStore.setTempPassword(custAcc.id, c.password);
        }
      }

      await supabase.from("access_logs").insert({
        account_id: req.user.id,
        event: "organization_bulk_created",
        ip: req.ip || "127.0.0.1",
        metadata: { orgNumber: org.number, usersCount: (users||[]).length }
      });

      res.json({ ok: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message || "Interne fout bij aanmaken organisatie." });
    }
  });
`;

const insertIndex = content.indexOf('app.post("/api/owner/create-user"');
if (insertIndex !== -1) {
  const newContent = content.slice(0, insertIndex) + routeCode + '\n' + content.slice(insertIndex);
  fs.writeFileSync('server.ts', newContent);
  console.log('Patched server.ts successfully');
} else {
  console.log('Failed to find insert location');
}
