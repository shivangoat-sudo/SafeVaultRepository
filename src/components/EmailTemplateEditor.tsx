import { useState, useEffect } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { Edit3, Save, Eye, HelpCircle, ArrowLeft, RotateCcw } from "lucide-react";
import { SafeVaultIcon } from "@/components/SafeVaultLogo";

export type EmailTemplate = {
  key: string;
  subject: string;
  body: string;
  updated_at?: string;
};

const PLACEHOLDERS = [
  { key: "{{klant_naam}}", description: "Naam van de klant (bijv. Jan Jansen)" },
  { key: "{{bedrijfsnaam}}", description: "Bedrijfsnaam (bijv. Acme B.V.)" },
  { key: "{{boekhouder_naam}}", description: "Naam van de ingelogde boekhouder" },
  { key: "{{kwartaal}}", description: "Geselecteerd kwartaal (bijv. Q1, Q2)" },
  { key: "{{deadline}}", description: "Uiterste inleverdatum (bijv. 15 april)" },
  { key: "{{maand}}", description: "Deadline maand (bijv. april)" },
  { key: "{{jaar}}", description: "Huidig jaartal (bijv. 2026)" },
  { key: "{{openstaand_bedrag}}", description: "Openstaand bedrag (bijv. € 0,00)" },
];

const DEFAULT_SUBJECT = "Herinnering – gegevens aanleveren voor {{kwartaal}}";
const DEFAULT_BODY = `Beste {{klant_naam}},

Dit is een vriendelijke herinnering om uw gegevens voor {{kwartaal}} aan te leveren.

Wilt u alstublieft vóór {{deadline}} uw gegevens en relevante documenten voor dit kwartaal aanleveren? Op basis hiervan kan ik uw btw-aangifte voor {{kwartaal}} voorbereiden en tijdig verzorgen.

U kunt uw gegevens en benodigde documenten eenvoudig via uw SafeVault-klantomgeving aanleveren. Controleer daarbij of alle relevante inkomsten, uitgaven en overige documenten van het betreffende kwartaal zijn toegevoegd.

Heeft u de gegevens al aangeleverd? Dan kunt u deze herinnering als niet verzonden beschouwen.

Mocht u vragen hebben over welke gegevens of documenten u moet aanleveren, neem dan gerust contact met mij op via de gebruikelijke weg of stuur een bericht via de chat in SafeVault.

Alvast bedankt voor het tijdig aanleveren van uw gegevens.

Met vriendelijke groet,

{{boekhouder_naam}}
SafeVault
Uw beveiligde omgeving voor het aanleveren en verwerken van uw boekhoudgegevens`;

type Props = {
  activeQuarter: string;
  activeMonthLabel: string;
  onBack: () => void;
  onSaved: (template: EmailTemplate) => void;
};

export function EmailTemplateEditor({ activeQuarter, activeMonthLabel, onBack, onSaved }: Props) {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await api.getEmailTemplate("reminder");
        if (mounted && res.template) {
          if (res.template.subject) setSubject(res.template.subject);
          if (res.template.body) setBody(res.template.body);
        }
      } catch (err) {
        console.error("Fout bij laden e-mailtemplate:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  const validate = () => {
    const errs: string[] = [];
    if (!subject.trim()) errs.push("Onderwerp mag niet leeg zijn.");
    if (!body.trim()) errs.push("E-mailtekst mag niet leeg zijn.");
    setValidationErrors(errs);
    return errs.length === 0;
  };

  const insertPlaceholder = (ph: string, target: "subject" | "body") => {
    if (target === "subject") {
      setSubject((prev) => prev + " " + ph);
    } else {
      setBody((prev) => prev + " " + ph);
    }
  };

  const handleResetToDefault = () => {
    setSubject(DEFAULT_SUBJECT);
    setBody(DEFAULT_BODY);
    push("info", "Standaardformat hersteld.");
  };

  const handleSave = async () => {
    if (!validate()) {
      push("error", "Corrigeer de fouten in de template.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.saveEmailTemplate(subject.trim(), body.trim(), "reminder");
      push("success", "E-mailformat succesvol opgeslagen.");
      onSaved(res.template);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Opslaan van e-mailtemplate mislukt.");
    } finally {
      setSaving(false);
    }
  };

  // Render preview with sample customer data
  const sampleCustomerName = "Jan Jansen (Voorbeeld Klant)";
  const sampleCompany = "Jansen Consultancy B.V.";
  const sampleBookkeeper = "SafeVault Boekhouder";
  const sampleYear = new Date().getFullYear().toString();

  const quarterMonths: Record<string, string> = {
    Q1: "april",
    Q2: "juli",
    Q3: "oktober",
    Q4: "januari",
  };
  const normQ = (activeQuarter || "Q1").toUpperCase().trim();
  const targetMonth = quarterMonths[normQ] || "april";
  const deadlineStr = activeMonthLabel || `15 ${targetMonth}`;

  const previewSubject = subject
    .replace(/\{\{klant_naam\}\}/gi, sampleCustomerName)
    .replace(/\{\{klantnaam\}\}/gi, sampleCustomerName)
    .replace(/\{\{bedrijfsnaam\}\}/gi, sampleCompany)
    .replace(/\{\{boekhouder_naam\}\}/gi, sampleBookkeeper)
    .replace(/\{\{kwartaal\}\}/gi, normQ)
    .replace(/\{\{maand\}\}/gi, targetMonth)
    .replace(/\{\{deadline\}\}/gi, deadlineStr)
    .replace(/\{\{jaar\}\}/gi, sampleYear)
    .replace(/\{\{openstaand_bedrag\}\}/gi, "€ 0,00");

  const previewBody = body
    .replace(/\{\{klant_naam\}\}/gi, sampleCustomerName)
    .replace(/\{\{klantnaam\}\}/gi, sampleCustomerName)
    .replace(/\{\{bedrijfsnaam\}\}/gi, sampleCompany)
    .replace(/\{\{boekhouder_naam\}\}/gi, sampleBookkeeper)
    .replace(/\{\{kwartaal\}\}/gi, normQ)
    .replace(/\{\{maand\}\}/gi, targetMonth)
    .replace(/\{\{deadline\}\}/gi, deadlineStr)
    .replace(/\{\{jaar\}\}/gi, sampleYear)
    .replace(/\{\{openstaand_bedrag\}\}/gi, "€ 0,00");

  if (loading) {
    return (
      <div className="py-12 text-center text-ink-500">
        <div className="inline-block animate-spin h-6 w-6 border-2 border-brand-600 border-t-transparent rounded-full mb-2"></div>
        <p className="text-sm">E-mailformat laden...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-ink-200">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Terug naar voorvertoning
        </button>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-ink-200 p-0.5 bg-ink-50">
            <button
              type="button"
              onClick={() => setActiveTab("edit")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
                activeTab === "edit"
                  ? "bg-white dark:bg-ink-800 text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <Edit3 className="h-3.5 w-3.5" /> Editor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
                activeTab === "preview"
                  ? "bg-white dark:bg-ink-800 text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <Eye className="h-3.5 w-3.5" /> Voorbeeld
            </button>
          </div>

          <button
            type="button"
            onClick={handleResetToDefault}
            className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800 px-2 py-1 rounded hover:bg-ink-100"
            title="Herstel naar standaardtekst"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Standaard</span>
          </button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700">
          {validationErrors.map((err, i) => (
            <p key={i}>• {err}</p>
          ))}
        </div>
      )}

      {activeTab === "edit" ? (
        <div className="space-y-4">
          {/* Subject Field */}
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">
              Onderwerp van de e-mail
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="input text-sm w-full font-medium"
              placeholder="Bijv. Herinnering BTW aangifte {{kwartaal}}"
            />
          </div>

          {/* Placeholders Toolbar */}
          <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-700 flex items-center gap-1.5">
                <HelpCircle className="h-3.5 w-3.5 text-brand-600" /> Beschikbare dynamische variabelen
              </span>
              <span className="text-[10px] text-ink-400">Klik om in te voegen</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map((ph) => (
                <button
                  key={ph.key}
                  type="button"
                  onClick={() => insertPlaceholder(ph.key, "body")}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono bg-white dark:bg-ink-800 border border-ink-200 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 rounded transition-all cursor-pointer"
                  title={ph.description}
                >
                  <span className="text-brand-600">+</span> {ph.key}
                </button>
              ))}
            </div>
          </div>

          {/* Body Field */}
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">
              E-mailtekst / Inhoud
            </label>
            <textarea
              rows={9}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="input text-sm w-full font-mono text-ink-800 leading-relaxed"
              placeholder="Typ hier de e-mailinhoud..."
            />
            <p className="text-[11px] text-ink-400 mt-1">
              Regelovergangen en alinea&apos;s worden automatisch behouden in de verstuurde e-mail.
            </p>
          </div>
        </div>
      ) : (
        /* Live Rendered Preview Pane */
        <div className="space-y-3">
          <div className="rounded-lg border border-ink-200 bg-white dark:bg-ink-900 p-5 shadow-sm space-y-4">
            <div className="border-b border-ink-100 pb-3">
              <span className="text-xs font-semibold text-ink-400 uppercase tracking-wider block mb-1">
                E-mail Voorbeeld (Met voorbeeldklant gegevens)
              </span>
              <p className="text-sm font-semibold text-ink-900">
                <span className="text-ink-500 font-normal">Onderwerp:</span> {previewSubject}
              </p>
            </div>

            {/* Email Header Representation */}
            <div className="flex items-center gap-3 pb-3 border-b-2 border-ink-900">
              <SafeVaultIcon className="h-9 w-9 shrink-0" />
              <div>
                <span className="text-base font-bold text-ink-900 leading-tight block">SafeVault</span>
                <span className="text-xs text-ink-500">Uw beveiligde klantomgeving</span>
              </div>
            </div>

            <div className="text-sm text-ink-800 whitespace-pre-wrap leading-relaxed py-2">
              {previewBody}
            </div>

            {/* Email Footer Representation */}
            <div className="pt-4 border-t border-ink-100 space-y-3 text-center">
              <div className="rounded-lg border border-ink-200 bg-ink-50/70 p-3 text-center">
                <p className="text-xs text-ink-600 leading-normal">
                  <strong>Let op (no-reply):</strong> Dit is een automatisch verzonden e-mail vanuit een onbeheerd adres. Reacties op dit bericht worden niet gelezen of beantwoord. Neem voor vragen rechtstreeks contact op met uw boekhouder via uw beveiligde omgeving.
                </p>
              </div>
              <p className="text-[11px] font-semibold text-ink-800">
                SafeVault – Uw veilige omgeving voor het aanleveren en verwerken van uw boekhoudgegevens
              </p>
            </div>
          </div>
          <p className="text-xs text-ink-400 italic">
            * De variabelen zoals {"{{klant_naam}}"} worden tijdens het verzenden automatisch vervangen door de echte gegevens van de geselecteerde klant(en).
          </p>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-ink-200">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary text-xs"
        >
          Annuleren / Terug
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-xs inline-flex items-center gap-1.5"
          >
            {saving ? (
              <span className="inline-block animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Format opslaan
          </button>
        </div>
      </div>
    </div>
  );
}
