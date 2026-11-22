import { useState, useMemo } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Panel } from '../components/Panel';
import { Metric } from '../components/Primitives';
import { useFleet } from '../store/FleetContext';
import { api } from '../lib/api';
import { cn, formatTime } from '../lib/format';
import type { Payment, Shipment } from '../lib/types';

export function PaymentsView() {
  const { snapshot, refresh, session } = useFleet();
  const { shipments, payments = [] } = snapshot;

  // Selected shipment for payment
  const unconfirmedShipments = useMemo(
    () => shipments.filter((s: Shipment) => s.status === 'CAPACITY_RESERVED' || s.status === 'DRAFT'),
    [shipments],
  );

  const [selectedShipmentId, setSelectedShipmentId] = useState<string>(
    unconfirmedShipments[0]?.id || shipments[0]?.id || '',
  );

  const selectedShipment = shipments.find((s: Shipment) => s.id === selectedShipmentId) || shipments[0] || null;

  // Form states
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<Payment | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PAID' | 'PENDING'>('ALL');

  // Use only the price and currency stored on the selected shipment.
  // Do not invent tolls, platform fees, taxes, or a fallback freight price.
  const totalAmount = selectedShipment?.price ?? 0;
  const currency = selectedShipment?.currency ?? 'INR';
  const hasValidAmount = Number.isFinite(totalAmount) && totalAmount > 0;

  // Metrics
  const totalSettled = payments
    .filter((p: Payment) => p.status === 'PAID')
    .reduce((acc: number, p: Payment) => acc + p.amount, 0);

  const pendingCount = payments.filter((p: Payment) => p.status === 'PENDING').length;
  const paidCount = payments.filter((p: Payment) => p.status === 'PAID').length;

  const filteredPayments = useMemo(() => {
    if (filter === 'ALL') return payments;
    return payments.filter((p: Payment) => p.status === filter);
  }, [payments, filter]);

  // Create a real provider checkout. A browser return never marks a payment as paid.
  const handleInitiatePayment = async () => {
    if (!selectedShipment || !hasValidAmount) {
      setCheckoutNotice('A valid agreed shipment price is required before checkout can start.');
      return;
    }
    setIsProcessing(true);
    setCheckoutNotice('');
    try {
      const res = await api.createDodoCheckout({
        shipmentId: selectedShipment.id,
        amount: totalAmount,
        currency,
      });
      await refresh();
      setCheckoutNotice('Payment session created. Complete payment on Dodo’s secure checkout page. FleetGrid will show PAID only after the provider webhook is verified.');
      // Navigate the current tab so browser popup blockers cannot silently block checkout.
      window.location.assign(res.checkoutUrl);
    } catch (err) {
      setCheckoutNotice((err as Error).message || 'Dodo Payments is not configured yet.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="relative z-10 min-h-screen bg-base-950 text-ink-100">
      <AppHeader />

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 lg:px-6">
        {/* Title & Brand Section */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-ink-50">Dodo Payments Hub</h1>
              <span className="rounded-full border border-healthy/40 bg-healthy/10 px-2.5 py-0.5 font-mono text-2xs font-semibold text-healthy">
                Provider Checkout
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-400">
              Secure provider checkout; payment status changes only after verified provider confirmation
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-md border border-base-600 bg-base-850 px-3 py-1.5 font-mono text-2xs text-ink-300">
              <svg className="h-3.5 w-3.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
              Provider: Dodo Payments (INR / USD)
            </span>
          </div>
        </div>

        {/* Top Operational Metrics */}
        <div className="panel grid grid-cols-2 divide-x divide-base-600 sm:grid-cols-4">
          <Metric label="Total Paid" value={`₹${totalSettled.toLocaleString('en-IN')}`} tone="healthy" hint="Provider-confirmed payments" />
          <Metric label="Paid Invoices" value={paidCount} tone="accent" hint="Provider-confirmed receipts" />
          <Metric label="Awaiting Payment" value={pendingCount} tone="warn" hint="Active reservations" />
          <Metric label="Escrow SLA" value="Webhook" tone="neutral" hint="Provider confirmation required" />
        </div>

        {/* Workspace: Checkout & Payment Terminal */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.95fr)]">
          {/* Left Column: Shipment & Bill of Lading Checkout */}
          <div className="space-y-4">
            <Panel
              eyebrow="Payment Terminal"
              title="Freight Capacity Settlement"
              actions={
                <span className="font-mono text-2xs text-healthy">
                  ● Provider connection required
                </span>
              }
            >
              <div className="space-y-4 p-5">
                {/* Select Shipment */}
                <div>
                  <label className="block font-mono text-2xs font-semibold uppercase tracking-wider text-ink-400">
                    Select Shipment / Bill of Lading
                  </label>
                  <select
                    value={selectedShipmentId}
                    onChange={(e) => setSelectedShipmentId(e.target.value)}
                    className="mt-1.5 w-full rounded-md border border-base-600 bg-base-900 px-3.5 py-2.5 text-xs font-mono text-ink-100 focus:border-accent focus:outline-none"
                  >
                    {shipments.map((s: Shipment) => (
                      <option key={s.id} value={s.id}>
                        {s.id} — {s.cargoName} ({s.origin} → {s.destination}, {s.weightT}T) — [Status: {s.status}]
                      </option>
                    ))}
                  </select>
                </div>

                {/* Shipment Summary Card */}
                {selectedShipment && (
                  <div className="rounded-lg border border-base-700 bg-base-850 p-4">
                    <div className="flex items-center justify-between border-b border-base-700 pb-3">
                      <div>
                        <span className="font-mono text-xs font-bold text-accent">{selectedShipment.id}</span>
                        <span className="ml-2 font-mono text-2xs text-ink-400">{selectedShipment.reference}</span>
                      </div>
                      <span
                        className={cn(
                          'rounded px-2 py-0.5 font-mono text-2xs font-semibold uppercase',
                          selectedShipment.status === 'CONFIRMED' || selectedShipment.status === 'IN_TRANSIT'
                            ? 'bg-healthy/20 text-healthy border border-healthy/40'
                            : 'bg-warn/20 text-warn border border-warn/40',
                        )}
                      >
                        {selectedShipment.status}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-2xs sm:grid-cols-4">
                      <div>
                        <div className="text-ink-500">CARGO</div>
                        <div className="mt-0.5 font-semibold text-ink-100">{selectedShipment.cargoName}</div>
                      </div>
                      <div>
                        <div className="text-ink-500">ROUTE</div>
                        <div className="mt-0.5 font-semibold text-ink-100">
                          {selectedShipment.origin} → {selectedShipment.destination}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-500">WEIGHT</div>
                        <div className="mt-0.5 font-semibold text-ink-100">{selectedShipment.weightT} Tonnes</div>
                      </div>
                      <div>
                        <div className="text-ink-500">ASSIGNED TRUCK</div>
                        <div className="mt-0.5 font-semibold text-accent">{selectedShipment.truckId || 'Not assigned'}</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-base-700 bg-base-850 p-3 text-xs text-ink-300">
                  <div className="font-semibold text-ink-100">Payment provider: Dodo Payments</div>
                  <p className="mt-1 text-ink-400">UPI, cards and other supported methods are presented by Dodo on its secure checkout page. FleetGrid does not collect card or UPI credentials.</p>
                </div>

                {/* Display the shipment's stored agreed amount; no invented fee/tax estimates. */}
                <div className="rounded-lg border border-base-700 bg-base-900 p-4 font-mono text-xs">
                  <div className="text-2xs font-semibold uppercase tracking-wider text-ink-400">
                    Agreed Shipment Amount
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm font-bold text-ink-50">
                    <span>Shipment price</span>
                    <span className="text-healthy">
                      {hasValidAmount
                        ? new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(totalAmount)
                        : 'Price not set'}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-ink-500">
                    This is the price recorded on the shipment. Any taxes or additional charges must be agreed and recorded before checkout.
                  </p>
                </div>

                {/* Primary CTA */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={isProcessing || !selectedShipment || !hasValidAmount || session?.user.role !== 'BUSINESS'}
                    onClick={handleInitiatePayment}
                    className="flex-1 rounded-lg bg-healthy px-4 py-3 font-mono text-xs font-bold tracking-wider text-base-950 uppercase shadow-md transition-all hover:bg-healthy/90 active:scale-[0.99] disabled:opacity-50"
                  >
                    {isProcessing ? 'Connecting to Dodo Payments…' : session?.user.role !== 'BUSINESS' ? 'Shipper account required to pay' : hasValidAmount ? `Pay ${new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(totalAmount)} via Dodo` : 'Shipment price required'}
                  </button>
                </div>
              </div>
            </Panel>
          </div>

          {/* Right Column: Ledger / Historical Payments */}
          <div className="space-y-4">
            <Panel
              eyebrow="Audit Trail"
              title="Settled Transactions"
              actions={
                <div className="flex items-center gap-1 rounded bg-base-850 p-0.5 font-mono text-3xs">
                  {(['ALL', 'PAID', 'PENDING'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setFilter(tab)}
                      className={cn(
                        'rounded px-2 py-0.5 uppercase tracking-wider',
                        filter === tab ? 'bg-accent text-base-950 font-bold' : 'text-ink-400 hover:text-ink-200',
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              }
              bodyClassName="p-0"
            >
              <div className="max-h-[560px] divide-y divide-base-700/60 overflow-y-auto">
                {filteredPayments.length === 0 ? (
                  <div className="p-8 text-center font-mono text-xs text-ink-500">
                    No transactions recorded for this filter.
                  </div>
                ) : (
                  filteredPayments.map((p: Payment) => (
                    <div
                      key={p.id}
                      className="p-3.5 transition-colors hover:bg-base-850/60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-ink-100">
                              ₹{p.amount.toLocaleString('en-IN')}
                            </span>
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase',
                                p.status === 'PAID'
                                  ? 'bg-healthy/20 text-healthy border border-healthy/40'
                                  : 'bg-warn/20 text-warn border border-warn/40',
                              )}
                            >
                              {p.status}
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-2xs text-ink-400">
                            ID: {p.id} · {p.shipmentId ? `Shipment ${p.shipmentId}` : 'Direct Escrow'}
                          </div>
                          {p.customerName && (
                            <div className="text-2xs text-ink-400">
                              {p.customerName}
                            </div>
                          )}
                        </div>

                        <div className="text-right">
                          <button
                            type="button"
                            onClick={() => setActiveReceipt(p)}
                            className="rounded border border-base-600 bg-base-800 px-2 py-1 font-mono text-3xs font-semibold uppercase tracking-wider text-accent transition-colors hover:bg-base-700"
                          >
                            Receipt ↗
                          </button>
                          <div className="mt-1 font-mono text-[10px] text-ink-500">
                            {formatTime(p.createdAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </div>
      </main>

      {checkoutNotice && (
        <div className="mx-auto mb-6 max-w-3xl rounded-lg border border-base-600 bg-base-850 p-4 text-sm text-ink-200" role="status">
          {checkoutNotice}
        </div>
      )}

      {/* Checkout status and official receipt */}
      {activeReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-healthy/40 bg-base-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-base-700 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-healthy text-base-950 text-xs font-bold">
                  ✓
                </span>
                <h3 className="font-mono text-sm font-bold text-ink-50">Official Payment Receipt</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveReceipt(null)}
                className="text-ink-400 hover:text-ink-100"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4 font-mono text-xs">
              <div className="rounded-lg border border-base-700 bg-base-850 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-2xs uppercase text-ink-400">Total Settled</span>
                  <span className="text-lg font-bold text-healthy">
                    ₹{activeReceipt.amount.toLocaleString('en-IN')} {activeReceipt.currency}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-2xs">
                  <div>
                    <span className="text-ink-500">TRANSACTION ID</span>
                    <div className="font-semibold text-ink-200">{activeReceipt.id}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">DODO REFERENCE</span>
                    <div className="font-semibold text-accent">{activeReceipt.providerReference}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">STATUS</span>
                    <div className="font-semibold text-healthy">{activeReceipt.status}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">SETTLED AT</span>
                    <div className="font-semibold text-ink-200">{formatTime(activeReceipt.updatedAt)}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">SHIPMENT</span>
                    <div className="font-semibold text-ink-200">{activeReceipt.shipmentId || 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">PAYMENT METHOD</span>
                    <div className="font-semibold text-ink-200">{activeReceipt.paymentMethod || 'Dodo Payments'}</div>
                  </div>
                </div>
              </div>

              <div className="rounded border border-healthy/30 bg-healthy/5 p-3 text-2xs text-healthy">
                This receipt is available only for a payment confirmed by the payment provider.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded border border-base-600 bg-base-800 px-4 py-2 font-mono text-2xs uppercase tracking-wider text-ink-200 hover:bg-base-700"
                >
                  Print Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReceipt(null)}
                  className="rounded bg-accent px-4 py-2 font-mono text-2xs font-bold uppercase tracking-wider text-base-950 hover:bg-accent/90"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
