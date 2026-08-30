/** Airports Marta can pick from without knowing IATA codes. Codes stay the wire format. */
export interface Airport {
  code: string;
  city: string;
  country: string;
}

const AIRPORTS: Airport[] = [
  { code: 'CCS', city: 'Caracas', country: 'Venezuela' },
  { code: 'COR', city: 'Córdoba', country: 'Argentina' },
  { code: 'EZE', city: 'Buenos Aires (Ezeiza)', country: 'Argentina' },
  { code: 'AEP', city: 'Buenos Aires (Aeroparque)', country: 'Argentina' },
  { code: 'BOG', city: 'Bogotá', country: 'Colombia' },
  { code: 'MDE', city: 'Medellín', country: 'Colombia' },
  { code: 'GRU', city: 'São Paulo', country: 'Brazil' },
  { code: 'GIG', city: 'Rio de Janeiro', country: 'Brazil' },
  { code: 'SCL', city: 'Santiago', country: 'Chile' },
  { code: 'LIM', city: 'Lima', country: 'Peru' },
  { code: 'MEX', city: 'Mexico City', country: 'Mexico' },
  { code: 'PTY', city: 'Panama City', country: 'Panama' },
  { code: 'UIO', city: 'Quito', country: 'Ecuador' },
  { code: 'MVD', city: 'Montevideo', country: 'Uruguay' },
  { code: 'MIA', city: 'Miami', country: 'United States' },
  { code: 'MAD', city: 'Madrid', country: 'Spain' },
];

function airportByCode(code: string | undefined): Airport | undefined {
  if (!code) return undefined;
  return AIRPORTS.find((a) => a.code === code.toUpperCase());
}

/** "Caracas (CCS)" when known, the bare code otherwise. */
export function airportLabel(code: string | undefined): string {
  const airport = airportByCode(code);
  return airport ? `${airport.city} (${airport.code})` : (code ?? '···');
}
