import { useState, useEffect } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { api } from "@/api";
import { Spinner } from "@/components/ui";
import { Download, Edit2, Save, ArrowRight, CheckCircle2, RefreshCw, AlertCircle } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type DraftCustomer = {
  name: string;
  number: string;
  password: string;
};

type DraftUser = {
  id: string;
  name: string;
  number: string;
  password: string;
  customerCount: number;
  customers: DraftCustomer[];
  isEditing?: boolean;
};

function getRandomDigit(): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % 10;
}

function generateOrgNumber(usedNumbers: Set<string>): string {
  let attempts = 0;
  while (attempts < 1000) {
    let num = "2";
    for (let i = 0; i < 7; i++) {
      num += getRandomDigit().toString();
    }
    if (!usedNumbers.has(num)) {
      usedNumbers.add(num);
      return num;
    }
    attempts++;
  }
  return "2" + Math.floor(1000000 + Math.random() * 9000000).toString();
}

function generateUserNumber(usedNumbers: Set<string>): string {
  let attempts = 0;
  while (attempts < 1000) {
    let num = "89";
    for (let i = 0; i < 6; i++) {
      num += getRandomDigit().toString();
    }
    if (!usedNumbers.has(num)) {
      usedNumbers.add(num);
      return num;
    }
    attempts++;
  }
  return "89" + Math.floor(100000 + Math.random() * 900000).toString();
}

function generateCustomerNumber(usedNumbers: Set<string>): string {
  let attempts = 0;
  while (attempts < 1000) {
    let num = "6";
    for (let i = 0; i < 7; i++) {
      num += getRandomDigit().toString();
    }
    if (!usedNumbers.has(num)) {
      usedNumbers.add(num);
      return num;
    }
    attempts++;
  }
  return "6" + Math.floor(1000000 + Math.random() * 9000000).toString();
}

function generateSecurePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const array = new Uint8Array(10);
  crypto.getRandomValues(array);
  let password = "";
  for (let i = 0; i < 10; i++) {
    password += chars[array[i] % chars.length];
  }
  return password;
}

export function CreateOrganizationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { push } = useToast();
  const [step, setStep] = useState(1);

  // Step 1: Organisatiegegevens
  const [orgName, setOrgName] = useState("");
  const [orgNumber, setOrgNumber] = useState("");
  const [orgPassword, setOrgPassword] = useState("");
  const [orgNumberError, setOrgNumberError] = useState("");

  // Step 2: Aantal gebruikers
  const [numUsers, setNumUsers] = useState(1);

  // Step 3 & 4: Users & Customers state
  const [users, setUsers] = useState<DraftUser[]>([]);

  // Step 4: Finalize
  const [ownerPassword, setOwnerPassword] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      const used = new Set<string>();
      setStep(1);
      setOrgName("");
      setOrgNumber(generateOrgNumber(used));
      setOrgPassword(generateSecurePassword());
      setOrgNumberError("");
      setNumUsers(1);
      setUsers([]);
      setOwnerPassword("");
    }
  }, [open]);

  const handleOrgNumberChange = (val: string) => {
    setOrgNumber(val);
    if (!val) {
      setOrgNumberError("Organisatienummer is verplicht.");
    } else if (!/^\d{8}$/.test(val) || !val.startsWith("2")) {
      setOrgNumberError("Een organisatienummer moet uit precies 8 cijfers bestaan en met 2 beginnen.");
    } else {
      setOrgNumberError("");
    }
  };

  const handleNextFromStep1 = () => {
    if (!orgName.trim()) {
      push("error", "Vul een organisatienaam in.");
      return;
    }
    if (!/^\d{8}$/.test(orgNumber) || !orgNumber.startsWith("2")) {
      setOrgNumberError("Een organisatienummer moet uit precies 8 cijfers bestaan en met 2 beginnen.");
      push("error", "Ongeldig organisatienummer.");
      return;
    }
    if (!orgPassword) {
      push("error", "Vul een wachtwoord voor de organisatie in.");
      return;
    }
    setStep(2);
  };

  const handleNextFromStep2 = () => {
    if (numUsers < 1 || numUsers > 100) {
      push("error", "Selecteer tussen 1 en 100 gebruikers.");
      return;
    }

    const used = new Set<string>();
    used.add(orgNumber);

    const generatedUsers: DraftUser[] = Array.from({ length: numUsers }).map((_, i) => {
      const uNum = generateUserNumber(used);
      const uName = `Gebruiker ${i + 1} (${orgName})`;
      return {
        id: crypto.randomUUID(),
        name: uName,
        number: uNum,
        password: generateSecurePassword(),
        customerCount: 0,
        customers: [],
        isEditing: false,
      };
    });

    setUsers(generatedUsers);
    setStep(3);
  };

  const handleCustomerCountChange = (userId: string, count: number) => {
    const validCount = Math.min(500, Math.max(0, count));
    const used = new Set<string>();
    used.add(orgNumber);
    users.forEach((u) => {
      used.add(u.number);
      u.customers.forEach((c) => used.add(c.number));
    });

    setUsers(
      users.map((u) => {
        if (u.id === userId) {
          let newCustomers = [...u.customers];
          if (validCount > newCustomers.length) {
            const toAdd = validCount - newCustomers.length;
            for (let i = 0; i < toAdd; i++) {
              newCustomers.push({
                name: `Klant ${newCustomers.length + 1} (${u.name})`,
                number: generateCustomerNumber(used),
                password: generateSecurePassword(),
              });
            }
          } else if (validCount < newCustomers.length) {
            newCustomers = newCustomers.slice(0, validCount);
          }
          return { ...u, customerCount: validCount, customers: newCustomers };
        }
        return u;
      })
    );
  };

  const handleNextFromStep3 = () => {
    setStep(4);
  };

  const downloadUserPDF = (user: DraftUser) => {
    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text("SafeVault — Inloggegevens Gebruiker", 14, 20);

    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text(`Organisatie: ${orgName} (${orgNumber})`, 14, 30);
    doc.text(`Gebruikersnaam: ${user.name}`, 14, 37);
    doc.text(`Inlognummer (89...): ${user.number}`, 14, 44);
    doc.text(`Wachtwoord: ${user.password}`, 14, 51);

    if (user.customers.length > 0) {
      doc.setFontSize(13);
      doc.setTextColor(30, 41, 59);
      doc.text(`Bijbehorende Klanten (${user.customers.length}):`, 14, 65);

      autoTable(doc, {
        startY: 70,
        head: [["Klantnaam", "Inlognummer (6...)", "Wachtwoord"]],
        body: user.customers.map((c) => [c.name, c.number, c.password]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [51, 65, 85] },
      });
    }

    doc.save(`inloggegevens_gebruiker_${user.number}.pdf`);
  };

  const downloadOrganizationPDF = () => {
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.setTextColor(30, 41, 59);
    doc.text("SafeVault — Organisatie Totaaloverzicht", 14, 20);

    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105);
    doc.text(`Organisatienaam: ${orgName}`, 14, 32);
    doc.text(`Organisatienummer (2...): ${orgNumber}`, 14, 40);
    doc.text(`Organisatiewachtwoord: ${orgPassword}`, 14, 48);
    doc.text(`Totaal Gebruikers: ${users.length}`, 14, 56);
    doc.text(
      `Totaal Klanten: ${users.reduce((acc, u) => acc + u.customerCount, 0)}`,
      14,
      64
    );

    let startY = 76;

    users.forEach((u, idx) => {
      if (startY > 250) {
        doc.addPage();
        startY = 20;
      }

      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `Gebruiker ${idx + 1}: ${u.name} | Nummer: ${u.number} | Wachtwoord: ${u.password}`,
        14,
        startY
      );
      startY += 6;

      if (u.customers.length > 0) {
        autoTable(doc, {
          startY: startY,
          head: [["Klantnaam", "Inlognummer", "Wachtwoord"]],
          body: u.customers.map((c) => [c.name, c.number, c.password]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [71, 85, 105] },
        });

        const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
        startY = lastY ? lastY + 12 : startY + 30;
      } else {
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text("Geen klanten gekoppeld aan deze gebruiker.", 18, startY);
        startY += 10;
      }
    });

    doc.save(`inloggegevens_organisatie_${orgNumber}.pdf`);
  };

  const handleFinalize = async () => {
    if (!ownerPassword) {
      push("error", "Voer uw eigenaarswachtwoord in ter bevestiging.");
      return;
    }

    try {
      setCreating(true);
      const payload = {
        org: { name: orgName, number: orgNumber, password: orgPassword },
        users,
        ownerPassword,
      };

      await api.ownerCreateOrganizationBulk(payload);
      push("success", "Organisatie succesvol aangemaakt!");
      onCreated();
      onClose();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Fout bij afronden organisatie.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Organisatie aanmaken" size={step >= 3 ? "4xl" : "lg"}>
      {/* Wizard Step Indicator */}
      <div className="flex items-center justify-between mb-6 border-b border-ink-200 pb-4">
        {[
          { num: 1, label: "1. Organisatie" },
          { num: 2, label: "2. Gebruikers" },
          { num: 3, label: "3. Klanten" },
          { num: 4, label: "4. Controle" },
        ].map((s) => (
          <div
            key={s.num}
            className={`flex items-center gap-2 text-xs font-semibold ${
              step === s.num
                ? "text-brand-600 border-b-2 border-brand-600 pb-1"
                : step > s.num
                ? "text-ink-900"
                : "text-ink-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                step === s.num
                  ? "bg-brand-600 text-white"
                  : step > s.num
                  ? "bg-emerald-500 text-white"
                  : "bg-ink-100 text-ink-500"
              }`}
            >
              {step > s.num ? "✓" : s.num}
            </span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* STAP 1 — Organisatiegegevens */}
      {step === 1 && (
        <div className="space-y-5 py-2">
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">
              Organisatienaam
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="input"
              placeholder="Bijv. Accountantskantoor Jansen"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">
                Organisatienummer (begint met 2)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={orgNumber}
                  onChange={(e) => handleOrgNumberChange(e.target.value)}
                  className={`input font-mono ${orgNumberError ? "border-red-500" : ""}`}
                  maxLength={8}
                />
                <button
                  type="button"
                  onClick={() => {
                    const newNum = generateOrgNumber(new Set());
                    setOrgNumber(newNum);
                    setOrgNumberError("");
                  }}
                  className="btn-secondary px-3 flex items-center gap-1 text-xs"
                  title="Genereer willekeurig organisatienummer"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Randomise
                </button>
              </div>
              {orgNumberError && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {orgNumberError}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">
                Organisatiewachtwoord
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={orgPassword}
                  onChange={(e) => setOrgPassword(e.target.value)}
                  className="input font-mono"
                />
                <button
                  type="button"
                  onClick={() => setOrgPassword(generateSecurePassword())}
                  className="btn-secondary px-3 flex items-center gap-1 text-xs"
                  title="Genereer nieuw wachtwoord"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Randomise
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-ink-100">
            <button
              type="button"
              onClick={handleNextFromStep1}
              disabled={!orgName || !!orgNumberError}
              className="btn-primary"
            >
              Verder <ArrowRight className="ml-2 h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STAP 2 — Gebruikers */}
      {step === 2 && (
        <div className="space-y-5 py-2">
          <p className="text-sm text-ink-600">
            Geef op hoeveel gebruikers (boekhouders) u wilt toevoegen aan organisatie <strong>{orgName}</strong>.
            Iedere gebruiker krijgt een uniek 8-cijferig inlognummer dat begint met <strong>89</strong>.
          </p>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">
              Aantal gebruikers (boekhouders)
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={numUsers}
              onChange={(e) => setNumUsers(Math.max(1, Math.min(100, Number(e.target.value))))}
              className="input w-36"
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-ink-100">
            <button type="button" onClick={() => setStep(1)} className="btn-ghost">
              Terug
            </button>
            <button type="button" onClick={handleNextFromStep2} className="btn-primary">
              Verder <ArrowRight className="ml-2 h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STAP 3 — Klanten per gebruiker */}
      {step === 3 && (
        <div className="space-y-5 py-2">
          <p className="text-sm text-ink-600">
            Stel per gebruiker het gewenste aantal klanten in. Iedere klant krijgt een willekeurig 8-cijferig inlognummer dat begint met <strong>6</strong>.
          </p>

          <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-1">
            {users.map((u) => (
              <div key={u.id} className="border border-ink-200 rounded-lg p-3.5 bg-ink-50/50 flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm font-semibold text-ink-900 block">{u.name}</span>
                  <span className="text-xs text-ink-500 font-mono">Nummer: {u.number}</span>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-ink-600">Aantal klanten:</label>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={u.customerCount}
                    onChange={(e) => handleCustomerCountChange(u.id, Number(e.target.value))}
                    className="input text-sm py-1 px-2.5 w-24 text-center"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-ink-100">
            <button type="button" onClick={() => setStep(2)} className="btn-ghost">
              Terug
            </button>
            <button type="button" onClick={handleNextFromStep3} className="btn-primary">
              Verder <ArrowRight className="ml-2 h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STAP 4 — Controle & Definitief aanmaken */}
      {step === 4 && (
        <div className="space-y-6 py-2 flex flex-col max-h-[75vh]">
          <div className="bg-brand-50/50 border border-brand-200 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-ink-500 block">Organisatie</span>
              <span className="font-semibold text-ink-900 text-sm">{orgName}</span>
            </div>
            <div>
              <span className="text-ink-500 block">Organisatienummer</span>
              <span className="font-mono text-ink-900 text-sm font-semibold">{orgNumber}</span>
            </div>
            <div>
              <span className="text-ink-500 block">Totaal Gebruikers</span>
              <span className="font-semibold text-ink-900 text-sm">{users.length}</span>
            </div>
            <div>
              <span className="text-ink-500 block">Totaal Klanten</span>
              <span className="font-semibold text-ink-900 text-sm">{users.reduce((acc, u) => acc + u.customerCount, 0)}</span>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 space-y-4 pr-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Gebruikers & Klanten Controle
            </h4>

            {users.map((user) => (
              <div key={user.id} className="border border-ink-200 rounded-lg p-4 bg-white space-y-3">
                <div className="flex items-center justify-between gap-4">
                  {user.isEditing ? (
                    <div className="flex-1 grid grid-cols-2 gap-3 items-end">
                      <div>
                        <label className="block text-xs font-medium text-ink-500 mb-1">Naam</label>
                        <input
                          type="text"
                          value={user.name}
                          onChange={(e) =>
                            setUsers(
                              users.map((u) => (u.id === user.id ? { ...u, name: e.target.value } : u))
                            )
                          }
                          className="input text-sm py-1 px-2"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-ink-500 mb-1">Wachtwoord</label>
                        <input
                          type="text"
                          value={user.password}
                          onChange={(e) =>
                            setUsers(
                              users.map((u) => (u.id === user.id ? { ...u, password: e.target.value } : u))
                            )
                          }
                          className="input text-sm py-1 px-2 font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-ink-500 block">Gebruiker</span>
                        <span className="font-semibold text-ink-900">{user.name}</span>
                      </div>
                      <div>
                        <span className="text-ink-500 block">Nummer (89...)</span>
                        <span className="font-mono text-ink-800">{user.number}</span>
                      </div>
                      <div>
                        <span className="text-ink-500 block">Wachtwoord</span>
                        <span className="font-mono text-ink-800">{user.password}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setUsers(
                          users.map((u) => (u.id === user.id ? { ...u, isEditing: !u.isEditing } : u))
                        )
                      }
                      className="btn-secondary px-2 py-1 text-xs"
                      title={user.isEditing ? "Opslaan" : "Bewerken"}
                    >
                      {user.isEditing ? <Save className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => downloadUserPDF(user)}
                      className="btn-secondary px-2.5 py-1 text-xs text-brand-700"
                      title="Download PDF van deze gebruiker en diens klanten"
                    >
                      <Download className="h-3.5 w-3.5 mr-1" /> PDF
                    </button>
                  </div>
                </div>

                {/* Customers list preview for this user */}
                {user.customers.length > 0 && (
                  <div className="bg-ink-50/70 rounded p-2.5 space-y-1.5 text-xs border border-ink-100">
                    <span className="font-medium text-ink-600 block mb-1">
                      Klanten ({user.customers.length}):
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto pr-1">
                      {user.customers.map((c, cIdx) => (
                        <div key={cIdx} className="bg-white p-1.5 rounded border border-ink-100 flex items-center justify-between">
                          <span className="truncate max-w-[120px] font-medium text-ink-800">{c.name}</span>
                          <span className="font-mono text-ink-600 text-[11px]">{c.number}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-ink-200 pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={downloadOrganizationPDF}
                className="btn-secondary text-brand-700 border-brand-200 bg-brand-50 hover:bg-brand-100 text-xs"
              >
                <Download className="mr-1.5 h-4 w-4" /> Download Organisatie PDF
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-700 mb-1">
                Bevestig met uw Wachtwoord (Eigenaar)
              </label>
              <input
                type="password"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                className="input text-sm"
                placeholder="Voer uw eigenaarswachtwoord in"
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={creating}
                className="btn-ghost text-xs"
              >
                Terug
              </button>

              <button
                type="button"
                onClick={handleFinalize}
                disabled={creating || !ownerPassword}
                className="btn-primary"
              >
                {creating ? <Spinner className="mr-2" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {creating ? "Organisatie wordt aangemaakt..." : "Definitief aanmaken"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
