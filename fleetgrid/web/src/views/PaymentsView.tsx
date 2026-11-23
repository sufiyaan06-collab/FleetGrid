import { useState, useMemo, useEffect } from 'react';
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

  // Payment is collected only after the driver accepts the shipment.
  const payableShipments = useMemo(
    () => shipments.filter((s: Shipment) => s.status === 'CONFIRMED'),
    [shipments],
  );
  const [selectedShipmentId, setSelectedShipmentId] = useState<string>('');
  useEffect(() => {
    if (!payableShipments.some((s) => s.id === selectedShipmentId) && payableShipments[0]) {
      setSelectedShipmentId(payableShipments[0].id);
    }
  }, [payableShipments, selectedShipmentId]);
  const selectedShipment = payableShipments.find((s: Shipment) => s.id === selectedShipmentId) || null;

  // Form states
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<Payment | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState('');
  const [providerStatus, setProviderStatus] = useState<{ ready: boolean; provider: string; mode: string; realMoney: false } | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'PAID' | 'PENDING' | 'FAILED'>('ALL');

  useEffect(() => {
    void api.demoPaymentStatus().then(setProviderStatus).catch(() => setProviderStatus(null));
  }, []);

  // Use only the price and currency stored on the selected shipment.
  // Do not invent tolls, platform fees, taxes, or a fallback freight price.
  const totalAmount = selectedShipment?.price ?? 0;
  const currency = selectedShipment?.currency ?? 'INR';
  const hasValidAmount = Number.isFinite(totalAmount) && totalAmount > 0;

  // Metrics
  const totalSettled = payments
    .filter((p: Payment) => p.status === 'PAID' && p.currency === currency)
    .reduce((acc: number, p: Payment) => acc + p.amount, 0);
  const formatMoney = (amount: number, code: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: code }).format(amount);

  const pendingCount = payments.filter((p: Payment) => p.status === 'PENDING').length;
  const paidCount = payments.filter((p: Payment) => p.status === 'PAID').length;

  const filteredPayments = useMemo(() => {
    if (filter === 'ALL') return payments;
    return payments.filter((p: Payment) => p.status === filter);
  }, [payments, filter]);

  // Create a server-recorded demo payment. This does not move real money.
  const handleInitiatePayment = async () => {
    if (!selectedShipment || !hasValidAmount) {
      setCheckoutNotice('A valid agreed shipment price is required before a demo payment can start.');
      return;
    }
    setIsProcessing(true);
    setCheckoutNotice('');
    try {
      const res = await api.createDemoPayment({ shipmentId: selectedShipment.id });
      setActiveReceipt(res.payment);
      await refresh();
      setCheckoutNotice('Demo payment created. No money has been collected. Open the payment record and explicitly simulate the successful test result.');
    } catch (err) {
      setCheckoutNotice((err as Error).message || 'Unable to create demo payment.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSettleDemoPayment = async () => {
    if (!activeReceipt) return;
    setIsProcessing(true);
    try {
      const res = await api.settleDemoPayment(activeReceipt.id);
      setActiveReceipt(res.payment);
      await refresh();
      setCheckoutNotice('Demo payment marked successful by the FleetGrid server. This is a simulated result; no money moved.');
    } catch (err) {
      setCheckoutNotice((err as Error).message || 'Unable to settle demo payment.');
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
              <h1 className="text-xl font-semibold tracking-tight text-ink-50">FleetGrid Payments Hub</h1>
              <span className="rounded-full border border-healthy/40 bg-healthy/10 px-2.5 py-0.5 font-mono text-2xs font-semibold text-healthy">
                DEMO / TEST MODE
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-400">
              Demonstration payment workflow for project evaluation. No real payment is processed.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-md border border-base-600 bg-base-850 px-3 py-1.5 font-mono text-2xs text-ink-300">
              <svg className="h-3.5 w-3.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
              Provider: FleetGrid Demo Simulator
            </span>
          </div>
        </div>

        {/* Top Operational Metrics */}
        <div className="panel grid grid-cols-2 divide-x divide-base-600 sm:grid-cols-4">
          <Metric label={`Demo Settled (${currency})`} value={formatMoney(totalSettled, currency)} tone="healthy" hint="Simulated demo records only" />
          <Metric label="Settled Demo Records" value={paidCount} tone="accent" hint="Provider-confirmed receipts" />
          <Metric label="Pending Demo Payments" value={pendingCount} tone="warn" hint="Active reservations" />
          <Metric label="Payment Mode" value="DEMO" tone="neutral" hint="No real money movement" />
        </div>

        {/* Workspace: Checkout & Payment Terminal */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.95fr)]">
          {/* Left Column: Shipment & Bill of Lading Checkout */}
          <div className="space-y-4">
            <Panel
              eyebrow="Payment Terminal"
              title="Freight Capacity Settlement"
              actions={
                <span className={cn('font-mono text-2xs', providerStatus?.ready ? 'text-healthy' : 'text-warn')}>
                  ● {providerStatus?.ready ? 'Demo simulator ready' : 'Demo simulator unavailable'}
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
                    {payableShipments.map((s: Shipment) => (
                      <option key={s.id} value={s.id}>
                        {s.id} — {s.cargoName} ({s.origin} → {s.destination}, {s.weightT}T) — [Status: {s.status}]
                      </option>
                    ))}
                  </select>
                  {payableShipments.length === 0 && <p className="mt-2 text-2xs text-warn">No driver-confirmed shipment is ready for payment yet. Payment becomes available after the assigned driver accepts a shipment.</p>}
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
                  <div className="font-semibold text-ink-100">Payment provider: FleetGrid Demo Simulator</div>
                  <p className="mt-1 text-ink-400">This is a controlled project demonstration. It records a pending payment and lets the signed-in shipper simulate settlement. No bank, card, wallet, or payment gateway is contacted.</p>
                  {!providerStatus?.ready && <p className="mt-2 text-warn">The demo payment simulator is currently unavailable.</p>}
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
                        ? formatMoney(totalAmount, currency)
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
                    disabled={isProcessing || !providerStatus?.ready || !selectedShipment || !hasValidAmount || session?.user.role !== 'BUSINESS'}
                    onClick={handleInitiatePayment}
                    className="flex-1 rounded-lg bg-healthy px-4 py-3 font-mono text-xs font-bold tracking-wider text-base-950 uppercase shadow-md transition-all hover:bg-healthy/90 active:scale-[0.99] disabled:opacity-50"
                  >
                    {isProcessing ? 'Creating demo payment…' : !providerStatus?.ready ? 'Demo simulator unavailable' : session?.user.role !== 'BUSINESS' ? 'Shipper account required to pay' : hasValidAmount ? `Create demo payment · ${new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(totalAmount)}` : 'Shipment price required'}
                  </button>
                </div>
              </div>
            </Panel>
          </div>

          {/* Right Column: Ledger / Historical Payments */}
          <div className="space-y-4">
            <Panel
              eyebrow="Audit Trail"
              title="Demo Payment Ledger"
              actions={
                <div className="flex items-center gap-1 rounded bg-base-850 p-0.5 font-mono text-3xs">
                  {(['ALL', 'PAID', 'PENDING', 'FAILED'] as const).map((tab) => (
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
                              {formatMoney(p.amount, p.currency)}
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
                            ID: {p.id} · {p.shipmentId ? `Shipment ${p.shipmentId}` : 'Unlinked payment'}
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
                            Details ↗
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
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold', activeReceipt.status === 'PAID' ? 'bg-healthy text-base-950' : 'bg-warn text-base-950')}>
                  {activeReceipt.status === 'PAID' ? '✓' : '…'}
                </span>
                <h3 className="font-mono text-sm font-bold text-ink-50">FleetGrid Payment Record</h3>
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
                  <span className="text-2xs uppercase text-ink-400">Agreed Amount</span>
                  <span className="text-lg font-bold text-healthy">
                    {formatMoney(activeReceipt.amount, activeReceipt.currency)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-2xs">
                  <div>
                    <span className="text-ink-500">TRANSACTION ID</span>
                    <div className="font-semibold text-ink-200">{activeReceipt.id}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">DEMO REFERENCE</span>
                    <div className="font-semibold text-accent">{activeReceipt.providerReference || 'Not applicable — simulated record'}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">STATUS</span>
                    <div className={cn('font-semibold', activeReceipt.status === 'PAID' ? 'text-healthy' : 'text-warn')}>{activeReceipt.status}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">{activeReceipt.status === 'PAID' ? 'SETTLED AT' : 'LAST UPDATED'}</span>
                    <div className="font-semibold text-ink-200">{formatTime(activeReceipt.updatedAt)}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">SHIPMENT</span>
                    <div className="font-semibold text-ink-200">{activeReceipt.shipmentId || 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-ink-500">PAYMENT METHOD</span>
                    <div className="font-semibold text-ink-200">{activeReceipt.paymentMethod || 'FleetGrid Demo Simulator'}</div>
                  </div>
                </div>
              </div>

              <div className={cn('rounded border p-3 text-2xs', activeReceipt.status === 'PAID' ? 'border-healthy/30 bg-healthy/5 text-healthy' : 'border-warn/30 bg-warn/5 text-warn')}>
                {activeReceipt.status === 'PAID' ? 'Demo settlement recorded by FleetGrid. No real money moved; this is not a bank or provider receipt.' : 'This demo payment is pending. Use the simulation action below to demonstrate settlement. No real money will move.'}
              </div>

              {activeReceipt.status === 'PENDING' && activeReceipt.provider === 'FleetGrid Demo Simulator' && (
                <div className="rounded-lg border border-warn/30 bg-warn/5 p-3">
                  <p className="text-2xs text-warn">DEMO ACTION — this records a simulated successful payment only. It does not contact a payment provider or move money.</p>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => void handleSettleDemoPayment()}
                    className="mt-3 w-full rounded bg-healthy px-4 py-2.5 font-mono text-2xs font-bold uppercase tracking-wider text-base-950 disabled:opacity-50"
                  >
                    {isProcessing ? 'Recording demo result…' : 'Simulate successful demo payment'}
                  </button>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded border border-base-600 bg-base-800 px-4 py-2 font-mono text-2xs uppercase tracking-wider text-ink-200 hover:bg-base-700"
                >
                  Print Demo Record
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
