import { useState, useEffect } from "react";
import { useAuth } from "@/auth";
import { api } from "@/api";
import { Shield, Lock, User, Hash, ArrowRight } from "lucide-react";
import { Spinner } from "@/components/ui";
import { PasswordField } from "@/components/PasswordField";
import { SafeVaultIcon } from "@/components/SafeVaultLogo";

export function LoginPage() {
  const { login, verify2fa, setup2faVerify, systemInit } = useAuth();
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [requires2FA, setRequires2FA] = useState(false);
  const [is2FASetup, setIs2FASetup] = useState(false);
  const [tempToken, setTempToken] = useState("");
  const [code2fa, setCode2fa] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [loadingQR, setLoadingQR] = useState(false);

  // Setup state (platform initialisation)
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [setupName, setSetupName] = useState("");
  const [setupNumber, setSetupNumber] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [setupCreatedData, setSetupCreatedData] = useState<{ name: string; number: string; password: string } | null>(null);

  useEffect(() => {
    api.setupStatus().then((r) => setNeedsSetup(!r.initialized)).catch(() => setNeedsSetup(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(name.trim(), number.trim(), password);
      if (res && res.requires_2fa) {
        setRequires2FA(true);
        setTempToken(res.temp_token);
        setCode2fa("");
        if (res.requires_2fa_setup) {
          setIs2FASetup(true);
          setLoadingQR(true);
          try {
            const qrRes = await api.setup2faInit(res.temp_token);
            setQrCodeUrl(qrRes.qrCodeUrl);
          } catch (qrErr) {
            setError(qrErr instanceof Error ? qrErr.message : "Het laden van de QR-code is mislukt. Probeer het opnieuw.");
          } finally {
            setLoadingQR(false);
          }
        } else {
          setIs2FASetup(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Foute gegevens.");
    } finally {
      setLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (is2FASetup) {
        await setup2faVerify(tempToken, code2fa);
      } else {
        await verify2fa(tempToken, code2fa);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "De verificatiecode is onjuist. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError("");
    setSetupLoading(true);
    try {
      const trimmedName = setupName.trim();
      const trimmedNumber = setupNumber.trim();
      await systemInit(trimmedName, trimmedNumber, setupPassword);
      setSetupCreatedData({
        name: trimmedName,
        number: trimmedNumber,
        password: setupPassword
      });
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Initialisatie mislukt.");
    } finally {
      setSetupLoading(false);
    }
  };

  // ===== Setup form (first run) =====
  if (needsSetup === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-50">
        <Spinner className="h-6 w-6 text-ink-400" />
      </div>
    );
  }

  if (needsSetup) {
    if (setupCreatedData) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-ink-50 p-4">
          <div className="w-full max-w-md card p-8 animate-slide-up border-2 border-emerald-500/20">
            <div className="flex items-center justify-center mb-6">
              <SafeVaultIcon className="h-12 w-12" />
            </div>
            <h1 className="text-center text-xl font-semibold text-ink-900">Eerste Eigenaar Aangemaakt</h1>
            <p className="mt-2 text-center text-sm text-ink-600">
              Uw eigenaarsaccount is succesvol aangemaakt in SafeVault. Controleer de onderstaande gegevens en maak eventueel een screenshot.
            </p>

            <div className="mt-6 bg-ink-900 text-white rounded-xl p-5 space-y-3 font-mono text-sm border border-ink-800">
              <div className="flex justify-between items-center border-b border-ink-800 pb-2">
                <span className="text-ink-400 font-sans text-xs">Naam:</span>
                <span className="font-semibold text-emerald-400">{setupCreatedData.name}</span>
              </div>
              <div className="flex justify-between items-center border-b border-ink-800 pb-2">
                <span className="text-ink-400 font-sans text-xs">Eigenaarnummer:</span>
                <span className="font-semibold text-emerald-400">{setupCreatedData.number}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-ink-400 font-sans text-xs">Wachtwoord:</span>
                <span className="font-semibold text-emerald-400">{setupCreatedData.password}</span>
              </div>
            </div>

            <p className="mt-4 text-xs text-ink-500 text-center">
              Ga naar het inlogscherm en voer uw naam, nummer en wachtwoord exact in om in te loggen.
            </p>

            <button
              type="button"
              onClick={() => {
                setNeedsSetup(false);
              }}
              className="mt-6 btn-primary w-full"
            >
              Ga naar inlogscherm
              <ArrowRight className="h-4 w-4 ml-2" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-50 p-4">
        <div className="w-full max-w-md card p-8 animate-slide-up">
          <div className="flex items-center justify-center mb-6">
            <SafeVaultIcon className="h-12 w-12" />
          </div>
          <h1 className="text-center text-xl font-semibold text-ink-900">Platform initialiseren</h1>
          <p className="mt-2 text-center text-sm text-ink-500">
            Dit is de eerste keer dat het platform wordt gestart. Maak het eigenaarsaccount aan om te beginnen.
          </p>
          <form onSubmit={handleSetup} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">Naam eigenaar</label>
              <input
                type="text"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                className="input"
                placeholder="Volledige naam"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">Eigenaarnummer (bijv. 89...)</label>
              <input
                type="text"
                value={setupNumber}
                onChange={(e) => setSetupNumber(e.target.value.replace(/[^0-9]/g, ""))}
                className="input"
                placeholder="Uw eigenaarnummer"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">Wachtwoord</label>
              <PasswordField
                value={setupPassword}
                onChange={setSetupPassword}
                placeholder="Wachtwoord"
                autoComplete="new-password"
                required
              />
            </div>
            {setupError && <p className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{setupError}</p>}
            <button type="submit" disabled={setupLoading || !setupName.trim() || !setupNumber.trim() || setupPassword.length < 6} className="btn-primary w-full">
              {setupLoading ? <Spinner /> : <Shield className="h-4 w-4" />}
              Eigenaar aanmaken
            </button>
            <button type="button" onClick={() => setNeedsSetup(false)} className="btn-secondary w-full">
              Ga naar inlogscherm
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ===== Login form =====
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-ink-50">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-ink-900 text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }} />
        <div className="relative">
          <div className="flex items-center gap-3">
            <SafeVaultIcon className="h-10 w-10" />
            <div>
              <p className="font-semibold text-lg">SafeVault</p>
              <p className="text-xs text-ink-300">Veilige financiële administratie voor boekhouders en klanten</p>
            </div>
          </div>
        </div>
        <div className="relative space-y-4 my-auto py-6">
          <h2 className="text-2xl font-semibold leading-tight">
            Btw-software en veilige documentuitwisseling in één platform.
          </h2>
          <p className="text-ink-300 leading-relaxed text-sm">
            Verwerk bankafschriften en financiële documenten met krachtige btw-software en wissel bestanden veilig uit met klanten. Boekhouders beheren hun eigen dossiers, terwijl klanten eenvoudig documenten kunnen uploaden en inzien.
          </p>
          <div className="space-y-2 pt-2">
            <Feature icon={Shield} text="Slimme btw-verwerking voor financiële documenten" bold />
            <Feature icon={Lock} text="Veilige documentuitwisseling zonder e-mail" bold />
            <Feature icon={User} text="Elke boekhouder en klant werkt uitsluitend met zijn eigen dossiers" bold />
            <Feature icon={Lock} text="Zero Trust-architectuur met server-side autorisatie" bold />
            <Feature icon={Shield} text="Bestanden nooit openbaar toegankelijk" bold />
            <Feature icon={Shield} text="Automatische btw-verwerking volgens Nederlandse btw-regels" bold />
            <Feature icon={User} text="Volledige scheiding tussen boekhouders en klantdossiers" bold />
          </div>
        </div>
        <div className="relative text-xs text-ink-400 space-y-1">
          <div>Alle verbindingen versleuteld · Brute-force-bescherming · Audit-log</div>
          <div>
            gemaakt door{" "}
            <a
              href="https://fluxsites.nl"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-300 hover:text-white underline transition-colors"
            >
              fluxsites.nl
            </a>
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center justify-center mb-8">
            <SafeVaultIcon className="h-12 w-12" />
          </div>
          {requires2FA ? (
            is2FASetup ? (
              <>
                <h1 className="text-2xl font-semibold text-ink-900">Tweestapsverificatie instellen</h1>
                <p className="mt-1.5 text-sm text-ink-500">Beveilig je SafeVault-account met een authenticator-app.</p>

                <div className="mt-6 space-y-4">
                  <ol className="text-xs text-ink-600 space-y-1.5 list-decimal list-inside bg-ink-50 p-3.5 rounded-lg border border-ink-100">
                    <li>Open Google Authenticator op je telefoon.</li>
                    <li>Kies "Account toevoegen" of het plus-icoon.</li>
                    <li>Scan de QR-code hieronder.</li>
                    <li>Voer daarna de 6-cijferige code uit de app hier in.</li>
                  </ol>

                  <div className="flex justify-center p-3 bg-white rounded-xl border border-ink-200 shadow-sm">
                    {loadingQR ? (
                      <div className="h-48 w-48 flex flex-col items-center justify-center gap-2 text-ink-400">
                        <Spinner />
                        <span className="text-xs">QR-code genereren...</span>
                      </div>
                    ) : qrCodeUrl ? (
                      <img src={qrCodeUrl} alt="2FA QR Code" className="h-48 w-48 object-contain" />
                    ) : (
                      <div className="h-48 w-48 flex items-center justify-center text-xs text-ink-400">
                        QR-code kon niet geladen worden.
                      </div>
                    )}
                  </div>
                </div>

                <form onSubmit={handle2FASubmit} className="mt-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink-700 mb-1.5">6-cijferige code</label>
                    <input
                      type="text"
                      value={code2fa}
                      onChange={(e) => setCode2fa(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                      className="input text-center text-lg tracking-widest tabular-nums font-mono"
                      placeholder="000000"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                    />
                  </div>

                  {error && (
                    <div className="rounded-lg bg-danger-50 border border-danger-500/20 px-3.5 py-2.5 text-sm text-danger-700 animate-fade-in">
                      {error}
                    </div>
                  )}

                  <button type="submit" disabled={loading || code2fa.length !== 6} className="btn-primary w-full">
                    {loading ? <Spinner /> : <Shield className="h-4 w-4" />}
                    Verifiëren en instellen
                  </button>
                  <button type="button" onClick={() => { setRequires2FA(false); setIs2FASetup(false); setCode2fa(""); setTempToken(""); setError(""); }} className="btn-ghost w-full mt-2">
                    Annuleren
                  </button>
                </form>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-semibold text-ink-900">Voer je 2FA-code in</h1>
                <p className="mt-1.5 text-sm text-ink-500">Open je authenticator-app en voer de huidige 6-cijferige code in.</p>

                <form onSubmit={handle2FASubmit} className="mt-8 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink-700 mb-1.5">6-cijferige code</label>
                    <input
                      type="text"
                      value={code2fa}
                      onChange={(e) => setCode2fa(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                      className="input text-center text-lg tracking-widest tabular-nums font-mono"
                      placeholder="000000"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                    />
                  </div>

                  {error && (
                    <div className="rounded-lg bg-danger-50 border border-danger-500/20 px-3.5 py-2.5 text-sm text-danger-700 animate-fade-in">
                      {error}
                    </div>
                  )}

                  <button type="submit" disabled={loading || code2fa.length !== 6} className="btn-primary w-full">
                    {loading ? <Spinner /> : <Shield className="h-4 w-4" />}
                    Verifiëren
                  </button>
                  <button type="button" onClick={() => { setRequires2FA(false); setIs2FASetup(false); setCode2fa(""); setTempToken(""); setError(""); }} className="btn-ghost w-full mt-2">
                    Annuleren
                  </button>
                </form>
              </>
            )
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-ink-900">Inloggen</h1>
              <p className="mt-1.5 text-sm text-ink-500">Voer uw naam, nummer en wachtwoord in.</p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink-700 mb-1.5">Naam</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="input pl-10"
                      placeholder="Uw naam"
                      autoComplete="name"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-700 mb-1.5">Nummer</label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                    <input
                      type="text"
                      value={number}
                      onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, ""))}
                      className="input pl-10 tabular-nums"
                      placeholder="Uw nummer"
                      inputMode="numeric"
                      autoComplete="username"
                      required
                    />
                  </div>
                </div>
                <div>
                  <PasswordField
                    label="Wachtwoord"
                    value={password}
                    onChange={setPassword}
                    placeholder="Wachtwoord"
                    autoComplete="current-password"
                    icon={Lock}
                    required
                  />
                </div>

                {error && (
                  <div className="rounded-lg bg-danger-50 border border-danger-500/20 px-3.5 py-2.5 text-sm text-danger-700 animate-fade-in">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? <Spinner /> : <ArrowRight className="h-4 w-4" />}
                  Inloggen
                </button>
              </form>
            </>
          )}

          <p className="mt-6 text-center text-xs text-ink-400">
            Na 5 mislukte pogingen wordt het account geblokkeerd.
          </p>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, text, bold }: { icon: typeof Lock; text: string; bold?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 flex-shrink-0">
        <Icon className="h-3.5 w-3.5 text-brand-300" />
      </span>
      <span className={`text-xs ${bold ? "font-semibold text-white" : "text-ink-200"}`}>{text}</span>
    </div>
  );
}
