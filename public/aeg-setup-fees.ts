// AEG Set Up Fees - Predefined Services
// Export file for reference / cross-project use

export interface AegPredefinedService {
  id: string;
  name: string;
  costUsd: number;
}

export const AEG_PREDEFINED_SERVICES: AegPredefinedService[] = [
  { id: 'flight-planning',           name: 'Flight Planning',            costUsd: 135 },
  { id: 'handling-setup',            name: 'Handling Set Up',            costUsd: 170 },
  { id: 'overflight-permit',         name: 'Overflight Permit',          costUsd: 255 },
  { id: 'landing-permit',            name: 'Landing Permit',             costUsd: 255 },
  { id: 'ppr',                       name: 'PPR',                        costUsd: 190 },
  { id: 'slot-coordination',         name: 'Slot Coordination',          costUsd: 90  },
  { id: 'ground-transport',          name: 'Ground Transport',           costUsd: 70  },
  { id: 'hotel-reservation',         name: 'Hotel Reservation',          costUsd: 85  },
  { id: 'catering',                  name: 'Catering',                   costUsd: 90  },
  { id: 'us-customs-notification',   name: 'US Customs Notification',    costUsd: 70  },
  { id: 'inbound-apis',              name: 'Inbound APIS',               costUsd: 125 },
  { id: 'outbound-apis',             name: 'Outbound APIS',              costUsd: 125 },
];
