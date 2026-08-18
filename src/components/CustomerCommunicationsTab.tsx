import { useAuth } from "@/auth";
import { ChatInterface } from "@/components/ChatInterface";
import { Spinner } from "@/components/ui";

export function CustomerCommunicationsTab() {
  const { account } = useAuth();

  if (!account) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-6 w-6 text-ink-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-ink-900">Berichten</h2>
      </div>
      <ChatInterface 
        customerId={account.id} 
        customerName={account.name} 
        currentUserRole="customer" 
      />
    </div>
  );
}
