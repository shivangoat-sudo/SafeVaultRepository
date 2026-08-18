import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordFieldProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  icon?: typeof Eye;
  required?: boolean;
};

export function PasswordField({
  value,
  onChange,
  placeholder = "Wachtwoord",
  label,
  autoComplete,
  autoFocus,
  icon: Icon,
  required,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      {label && <label className="block text-sm font-medium text-ink-700 mb-1.5">{label}</label>}
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />}
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`input ${Icon ? "pl-10" : ""} pr-10`}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required={required}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600 transition-colors"
          tabIndex={-1}
          aria-label={visible ? "Wachtwoord verbergen" : "Wachtwoord tonen"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
