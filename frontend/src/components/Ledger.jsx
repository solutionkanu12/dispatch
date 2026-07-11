import React, { useState } from 'react';
import LedgerRow from './LedgerRow.jsx';

const PAGE_SIZE = 5;

/**
 * Live ledger panel, matching the prototype exactly: a bordered panel holding
 * either the empty-state copy or the list of real orders (most recent first,
 * as returned by GET /api/orders). Paginated client side, 5 per page: the
 * full order list still comes from useOrders unchanged (polling needs the
 * full list to decide whether any order is non-terminal), this just slices
 * what gets rendered so the panel does not grow without bound.
 */
export default function Ledger({ orders, agentsById }) {
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageOrders = orders.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="rounded-[18px] border border-line bg-panel p-2 shadow-md2">
      {orders.length === 0 ? (
        <div className="px-11 py-11 text-center text-[14px] text-muted2">
          Nothing in transit yet.
        </div>
      ) : (
        <>
          {pageOrders.map((order) => (
            <LedgerRow key={order.id} order={order} agent={agentsById[order.agent_id]} />
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                className="rounded-lg border border-line2 px-3 py-1.5 text-[12.5px] font-medium text-cream2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:border-ember enabled:hover:text-ember"
              >
                Previous
              </button>
              <span className="text-[12px] text-muted2">
                Page {safePage + 1} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                disabled={safePage >= totalPages - 1}
                className="rounded-lg border border-line2 px-3 py-1.5 text-[12.5px] font-medium text-cream2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:border-ember enabled:hover:text-ember"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
