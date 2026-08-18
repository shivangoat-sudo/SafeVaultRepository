import { useState } from "react";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/ui";
import { PasswordField } from "@/components/PasswordField";
import { KeyRound, Save, Trash2, UserPlus, AlertTriangle } from "lucide-react";

export function AccountSettingsModal({
  open,
  onClose,
  canChangeName,
}: {
  open: boolean;
  onClose: () => void;
  canChangeName: boolean;
}) {
  const { account, logout } = useAuth();
  const { push } = useToast();
  const [newName, setNewName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Owner deletion state
  const [showDeleteSection, setShowDeleteSection] = useState(false);
  const [checkingOwnerCount, setCheckingOwnerCount] = useState(false);
  const [isLastOwner, setIsLastOwner] = useState(true);
  const [transferName, setTransferName] = useState("");
  const [transferNumber, setTransferNumber] = useState("");
  const [transferPassword, setTransferPassword] = useState("");
  const [transferConfirmPassword, setTransferConfirmPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleSaveName = async () => {
    if (!newName.trim()) return;
    setSavingName(true);
    try {
      await api.changeName(newName.trim());
      push("success", "Naam gewijzigd.");
      setNewName("");
      onClose();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Kon naam niet wijzigen.");
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      push("error", "Wachtwoorden komen niet overeen.");
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 15) {
      push("error", "Wachtwoord moet 8 tot 15 tekens lang zijn.");
      return;
    }
    if (!/^[A-Za-z0-9]+$/.test(newPassword)) {
      push("error", "Wachtwoord mag alleen letters en cijfers bevatten.");
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      push("success", "Wachtwoord gewijzigd.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onClose();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Kon wachtwoord niet wijzigen.");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleOpenDeleteSection = async () => {
    setCheckingOwnerCount(true);
    try {
      const res = await api.ownerCount();
      setIsLastOwner(res.count <= 1);
      setShowDeleteSection(true);
    } catch {
      setIsLastOwner(true);
      setShowDeleteSection(true);
    } finally {
      setCheckingOwnerCount(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLastOwner) {
      if (!transferName.trim() || !transferNumber.trim() || !transferPassword) {
        push("error", "Vul alle gegevens in voor de nieuwe eigenaar.");
        return;
      }
      if (transferPassword !== transferConfirmPassword) {
        push("error", "Wachtwoorden van de nieuwe eigenaar komen niet overeen.");
        return;
      }
      if (transferPassword.length < 8) {
        push("error", "Wachtwoord moet minimaal 8 tekens lang zijn.");
        return;
      }
    }

    setDeleting(true);
    try {
      const res = await api.deleteOwnerAccount(
        isLastOwner
          ? {
              newOwnerName: transferName.trim(),
              newOwnerNumber: transferNumber.trim(),
              newOwnerPassword: transferPassword,
            }
          : undefined
      );

      if (res.ok) {
        push("success", isLastOwner ? "Nieuwe eigenaar ingesteld en oud account verwijderd." : "Account verwijderd.");
        onClose();
        await logout();
      } else if (res.requiresNewOwner) {
        push("error", "Je bent de laatste eigenaar. Vul de gegevens voor een nieuwe eigenaar in.");
        setIsLastOwner(true);
      }
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Fout bij verwijderen van account.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Accountinstellingen" size="md">
      <div className="space-y-6">
        {canChangeName && (
          <div>
            <h3 className="text-sm font-semibold text-ink-900 mb-3">Naam wijzigen</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="input"
                placeholder="Nieuwe naam"
                maxLength={80}
              />
              <button onClick={handleSaveName} disabled={savingName || !newName.trim()} className="btn-primary flex-shrink-0">
                {savingName ? <Spinner /> : <Save className="h-4 w-4" />}
                Opslaan
              </button>
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-ink-900 mb-1">Wachtwoord wijzigen</h3>
          <p className="text-xs text-ink-400 mb-3">8-15 tekens, alleen letters en cijfers.</p>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <PasswordField
              label="Huidig wachtwoord"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              required
            />
            <PasswordField
              label="Nieuw wachtwoord"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              required
            />
            <PasswordField
              label="Herhaal nieuw wachtwoord"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              required
            />
            <button type="submit" disabled={savingPassword} className="btn-primary w-full">
              {savingPassword ? <Spinner /> : <KeyRound className="h-4 w-4" />}
              Wachtwoord wijzigen
            </button>
          </form>
        </div>

        {account?.role === "owner" && (
          <div className="pt-4 border-t border-ink-100">
            <h3 className="text-sm font-semibold text-danger-700 mb-1 flex items-center gap-1.5">
              <Trash2 className="h-4 w-4" /> Account Verwijderen
            </h3>
            <p className="text-xs text-ink-500 mb-3">
              Als je als eigenaar je account verwijdert en je de laatste eigenaar bent, moet je verplicht eerst een nieuwe eigenaar aanstellen.
            </p>

            {!showDeleteSection ? (
              <button
                type="button"
                onClick={handleOpenDeleteSection}
                disabled={checkingOwnerCount}
                className="btn-danger w-full text-xs"
              >
                {checkingOwnerCount ? <Spinner /> : <Trash2 className="h-4 w-4" />}
                Eigenaar account verwijderen
              </button>
            ) : (
              <form onSubmit={handleDeleteAccount} className="p-4 rounded-lg bg-danger-50 border border-danger-200 space-y-3">
                {isLastOwner ? (
                  <>
                    <div className="flex items-start gap-2 text-danger-800 text-xs font-medium">
                      <AlertTriangle className="h-4 w-4 text-danger-600 flex-shrink-0 mt-0.5" />
                      <span>
                        Je kunt het laatste eigenaar-account niet verwijderen zonder eerst een nieuwe eigenaar aan te maken. Vul hieronder de gegevens van de nieuwe eigenaar in:
                      </span>
                    </div>

                    <div>
                      <label className="label text-xs">Naam nieuwe eigenaar</label>
                      <input
                        type="text"
                        value={transferName}
                        onChange={(e) => setTransferName(e.target.value)}
                        className="input text-xs"
                        placeholder="bijv. Jan de Vries"
                        required
                      />
                    </div>

                    <div>
                      <label className="label text-xs">Eigenaarnummer nieuwe eigenaar</label>
                      <input
                        type="text"
                        value={transferNumber}
                        onChange={(e) => setTransferNumber(e.target.value)}
                        className="input text-xs"
                        placeholder="bijv. 8900002"
                        required
                      />
                    </div>

                    <PasswordField
                      label="Wachtwoord nieuwe eigenaar"
                      value={transferPassword}
                      onChange={setTransferPassword}
                      autoComplete="new-password"
                      required
                    />

                    <PasswordField
                      label="Herhaal wachtwoord nieuwe eigenaar"
                      value={transferConfirmPassword}
                      onChange={setTransferConfirmPassword}
                      autoComplete="new-password"
                      required
                    />
                  </>
                ) : (
                  <p className="text-xs text-danger-700">
                    Er is ten minste één andere eigenaar in het systeem. Weet je zeker dat je jouw account definitief wilt verwijderen?
                  </p>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowDeleteSection(false)}
                    className="btn-secondary w-1/2 text-xs"
                  >
                    Annuleren
                  </button>
                  <button
                    type="submit"
                    disabled={deleting}
                    className="btn-danger w-1/2 text-xs"
                  >
                    {deleting ? <Spinner /> : <UserPlus className="h-4 w-4" />}
                    {isLastOwner ? "Overdragen & Verwijderen" : "Account Verwijderen"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
