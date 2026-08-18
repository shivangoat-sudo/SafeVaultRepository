import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/ui";
import { ChatInterface } from "@/components/ChatInterface";
import { Search, ArrowLeft, MessageSquare, ChevronRight } from "lucide-react";
import type { CustomerRow } from "@/types";

interface UserMessagesTabProps {
  onBack: () => void;
}

export function UserMessagesTab({ onBack }: UserMessagesTabProps) {
  const { push } = useToast();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);

  // Load all customers
  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.userCustomers();
      setCustomers(res.customers);
    } catch {
      push("error", "Laden van klanten mislukt.");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // Filter customers based on search
  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.number.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-1.5 rounded-lg" title="Terug naar overzicht">
            <ArrowLeft className="h-5 w-5 text-ink-600" />
          </button>
          <div>
            <h2 className="text-xl font-medium text-ink-900">Berichten</h2>
            <p className="text-xs text-ink-500">Beheer de communicatie en chat in real-time met uw klanten</p>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-[640px]">
        {/* Left Column: Customer List */}
        <div 
          className={`col-span-1 md:col-span-4 flex flex-col bg-white border border-ink-200 rounded-xl overflow-hidden shadow-sm ${
            selectedCustomer ? "hidden md:flex" : "flex"
          }`}
        >
          {/* Search Bar */}
          <div className="p-3 border-b border-ink-150">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
              <input
                type="text"
                placeholder="Zoek klant op naam of nr..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-ink-50 border border-ink-250 focus:border-brand-500 focus:bg-white rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Customer Scroll List */}
          <div className="flex-1 overflow-y-auto divide-y divide-ink-100">
            {loading ? (
              <div className="flex justify-center items-center py-12">
                <Spinner className="h-6 w-6 text-ink-400" />
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-6 text-center text-ink-400">
                <p className="text-xs">Geen klanten gevonden</p>
              </div>
            ) : (
              filteredCustomers.map((customer) => {
                const isActive = selectedCustomer?.id === customer.id;
                return (
                  <button
                    key={customer.id}
                    onClick={() => setSelectedCustomer(customer)}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors ${
                      isActive 
                        ? "bg-brand-50/50 border-r-2 border-brand-600" 
                        : "hover:bg-ink-50/30"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900 text-sm truncate">{customer.name}</p>
                      <p className="text-[11px] text-ink-400 mt-0.5">Klantnr: {customer.number}</p>
                    </div>
                    <ChevronRight className={`h-4 w-4 text-ink-400 transition-transform ${isActive ? "translate-x-1" : ""}`} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Chat Window */}
        <div 
          className={`col-span-1 md:col-span-8 flex flex-col h-full bg-white rounded-xl ${
            !selectedCustomer ? "hidden md:flex" : "flex"
          }`}
        >
          {selectedCustomer ? (
            <div className="relative flex flex-col h-full">
              {/* Mobile Back Button */}
              <button 
                onClick={() => setSelectedCustomer(null)}
                className="md:hidden flex items-center gap-1.5 text-xs text-brand-600 font-medium mb-3 px-1.5 py-1 hover:bg-ink-100 rounded self-start"
              >
                <ArrowLeft className="h-4 w-4" /> Toon klantenlijst
              </button>
              <ChatInterface
                customerId={selectedCustomer.id}
                customerName={selectedCustomer.name}
                currentUserRole="user"
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center border border-ink-200 border-dashed rounded-xl bg-ink-50/10 p-6 text-center">
              <div className="h-14 w-14 bg-ink-100 rounded-full flex items-center justify-center text-ink-400 mb-3">
                <MessageSquare className="h-6 w-6" />
              </div>
              <p className="font-medium text-ink-800 text-sm">Selecteer een gesprek</p>
              <p className="text-xs text-ink-500 max-w-xs mt-1">
                Kies een klant uit de lijst aan de linkerkant om eerdere berichten te bekijken of een live chat te starten.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
