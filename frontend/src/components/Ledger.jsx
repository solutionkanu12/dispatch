import LedgerRow from './LedgerRow.jsx';

/**
 * Live ledger panel, matching the prototype exactly: a bordered panel holding
 * either the empty-state copy or the list of real orders (most recent first,
 * as returned by GET /api/orders).
 */
export default function Ledger({ orders, agentsById }) {
  return (
    <div className="rounded-[18px] border border-line bg-panel p-2 shadow-md2">
      {orders.length === 0 ? (
        <div className="px-11 py-11 text-center text-[14px] text-muted2">
          Nothing in transit yet.
        </div>
      ) : (
        orders.map((order) => (
          <LedgerRow key={order.id} order={order} agent={agentsById[order.agent_id]} />
        ))
      )}
    </div>
  );
}
