import { searchWeb } from './tavily';

// Map of common Singapore MRT station names to their LTA station codes
const MRT_STATION_MAP: Record<string, string> = {
  'jurong east': 'EW24',
  'buona vista': 'EW21',
  dover: 'EW22',
  clementi: 'EW23',
  'chinese garden': 'EW25',
  lakeside: 'EW26',
  'boon lay': 'EW27',
  pioneer: 'EW28',
  'joo koon': 'EW29',
  tampines: 'EW2',
  'pasir ris': 'EW1',
  simei: 'EW3',
  'tanah merah': 'EW4',
  bedok: 'EW5',
  kembangan: 'EW6',
  eunos: 'EW7',
  'paya lebar': 'EW8',
  aljunied: 'EW9',
  kallang: 'EW10',
  lavender: 'EW11',
  'city hall': 'EW13',
  'raffles place': 'EW14',
  'tanjong pagar': 'EW15',
  'outram park': 'EW16',
  'tiong bahru': 'EW17',
  redhill: 'EW18',
  queenstown: 'EW19',
  commonwealth: 'EW20',
  orchard: 'NS22',
  somerset: 'NS23',
  'dhoby ghaut': 'NS24',
  braddell: 'NS18',
  bishan: 'NS17',
  'ang mo kio': 'NS16',
  'yio chu kang': 'NS15',
  khatib: 'NS14',
  yishun: 'NS13',
  canberra: 'NS12',
  sembawang: 'NS11',
  woodlands: 'NS9',
  marsiling: 'NS8',
  admiralty: 'NS10',
  newton: 'NS21',
  novena: 'NS20',
  'toa payoh': 'NS19',
  'marina bay': 'NS27',
  'marina south pier': 'NS28',
  harbourfront: 'NE1',
  chinatown: 'NE4',
  'clarke quay': 'NE5',
  'little india': 'NE7',
  'farrer park': 'NE8',
  'boon keng': 'NE9',
  'potong pasir': 'NE10',
  woodleigh: 'NE11',
  serangoon: 'NE12',
  hougang: 'NE14',
  kovan: 'NE13',
  buangkok: 'NE15',
  sengkang: 'NE16',
  punggol: 'NE17',
  'telok blangah': 'CC28',
  'haw par villa': 'CC27',
  'pasir panjang': 'CC26',
  'one-north': 'CC23',
  'kent ridge': 'CC24',
  'labrador park': 'CC25',
  'holland village': 'CC21',
  'farrer road': 'CC20',
  'botanic gardens': 'CC19',
  caldecott: 'CC17',
  marymount: 'CC16',
  'lorong chuan': 'CC14',
  bartley: 'CC12',
  'tai seng': 'CC11',
  macpherson: 'CC10',
  dakota: 'CC8',
  mountbatten: 'CC7',
  stadium: 'CC6',
  'nicoll highway': 'CC5',
  promenade: 'CC4',
  esplanade: 'CC3',
  'bras basah': 'CC2',
  expo: 'CG1',
  'changi airport': 'CG2',
};

const CROWD_LEVEL_LABELS: Record<string, string> = {
  l: 'Low',
  m: 'Moderate',
  h: 'High',
  vh: 'Very High',
};

interface LtaCrowdRecord {
  Station: string;
  StartTime: string;
  EndTime: string;
  CrowdLevel: string;
}

async function getLtaCrowdLevel(location: string): Promise<string> {
  const key = process.env.LTA_DATAMALL_API_KEY;
  if (!key) return '';

  const normalised = location.toLowerCase().trim();
  const stationCode = MRT_STATION_MAP[normalised];
  if (!stationCode) return '';

  try {
    const res = await fetch('https://datamall2.mytransport.sg/ltaodataservice/PCDRealTime', {
      headers: { AccountKey: key },
    });
    if (!res.ok) return '';

    const data = await res.json();
    const records: LtaCrowdRecord[] = data?.value ?? [];

    const match = records.find(r => r.Station === stationCode);
    if (!match) return '';

    const label = CROWD_LEVEL_LABELS[match.CrowdLevel.toLowerCase()] ?? match.CrowdLevel;
    return `LTA Real-Time MRT Crowd (${match.Station}): ${label} (${match.StartTime} – ${match.EndTime})`;
  } catch {
    return '';
  }
}

async function getTavilyCrowdInfo(location: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return '';

  try {
    const now = new Date();
    const day = now.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'long' });
    const time = now.toLocaleTimeString('en-SG', {
      timeZone: 'Asia/Singapore',
      hour: '2-digit',
      minute: '2-digit',
    });
    const query = `"${location}" Singapore crowded busy crowd ${day} ${time}`;
    const results = await searchWeb(query, 3);
    if (!results) return '';
    return `RECENT CROWD REPORTS (searched ${day} ${time} SGT):\n${results}`;
  } catch {
    return '';
  }
}

export async function getCrowdInfo(location: string): Promise<string> {
  const [ltaResult, tavilyResult] = await Promise.allSettled([
    getLtaCrowdLevel(location),
    getTavilyCrowdInfo(location),
  ]);

  const parts: string[] = [];
  if (ltaResult.status === 'fulfilled' && ltaResult.value) parts.push(ltaResult.value);
  if (tavilyResult.status === 'fulfilled' && tavilyResult.value) parts.push(tavilyResult.value);

  return parts.join('\n\n');
}
