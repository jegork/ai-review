import type { TicketInfo, TicketProvider, TicketRef, TicketResolutionStatus } from "../types.js";

const MAX_TICKETS = 3;

export async function resolveTicketsWithStatus(
  refs: TicketRef[],
  providers: Map<string, TicketProvider>,
): Promise<{ tickets: TicketInfo[]; status: TicketResolutionStatus }> {
  const results: TicketInfo[] = [];
  const refsToConsider = refs.slice(0, MAX_TICKETS);
  let missingProvider = 0;
  let fetchFailed = 0;

  for (const ref of refsToConsider) {
    const provider = providers.get(ref.source);
    if (!provider) {
      missingProvider++;
      continue;
    }

    try {
      const info = await provider.fetchTicket(ref.id);
      if (info) {
        results.push(info);
      } else {
        fetchFailed++;
      }
    } catch (err) {
      fetchFailed++;
      console.warn(`failed to fetch ticket ${ref.id} from ${ref.source}:`, err);
    }
  }

  return {
    tickets: results,
    status: {
      refsFound: refs.length,
      refsConsidered: refsToConsider.length,
      fetched: results.length,
      missingProvider,
      fetchFailed,
    },
  };
}

export async function resolveTickets(
  refs: TicketRef[],
  providers: Map<string, TicketProvider>,
): Promise<TicketInfo[]> {
  const { tickets } = await resolveTicketsWithStatus(refs, providers);
  return tickets;
}
