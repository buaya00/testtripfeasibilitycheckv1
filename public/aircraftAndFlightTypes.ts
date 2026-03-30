export interface AircraftTypeOption {
  type: string;
  mtow: string;
  category: string;
}

export const aircraftTypes: AircraftTypeOption[] = [
  // ── Private Jets — Bombardier ─────────────────────────────
  { type: "Bombardier Challenger 300", mtow: "38,850 lbs", category: "Heavy" },
  { type: "Bombardier Challenger 350", mtow: "40,600 lbs", category: "Heavy" },
  { type: "Bombardier Challenger 3500", mtow: "40,600 lbs", category: "Heavy" },
  { type: "Bombardier Challenger 601-3R", mtow: "44,600 lbs", category: "Heavy" },
  { type: "Bombardier Challenger 604", mtow: "48,200 lbs", category: "Heavy" },
  { type: "Bombardier Challenger 605", mtow: "48,200 lbs", category: "Heavy" },
  { type: "Bombardier Challenger 650", mtow: "49,000 lbs", category: "Heavy" },
  { type: "Bombardier Global Express", mtow: "98,000 lbs", category: "Heavy" },
  { type: "Bombardier Global Express XRS", mtow: "98,000 lbs", category: "Heavy" },
  { type: "Bombardier Global 5000", mtow: "92,500 lbs", category: "Heavy" },
  { type: "Bombardier Global 5500", mtow: "92,500 lbs", category: "Heavy" },
  { type: "Bombardier Global 6000", mtow: "98,000 lbs", category: "Heavy" },
  { type: "Bombardier Global 6500", mtow: "98,000 lbs", category: "Heavy" },
  { type: "Bombardier Global 7500", mtow: "107,600 lbs", category: "Heavy" },
  { type: "Bombardier Global 8000", mtow: "107,600 lbs", category: "Heavy" },
  { type: "Bombardier Learjet 31A", mtow: "17,000 lbs", category: "Medium" },
  { type: "Bombardier Learjet 40", mtow: "21,000 lbs", category: "Medium" },
  { type: "Bombardier Learjet 45", mtow: "21,500 lbs", category: "Medium" },
  { type: "Bombardier Learjet 60", mtow: "23,500 lbs", category: "Medium" },
  { type: "Bombardier Learjet 70", mtow: "21,500 lbs", category: "Medium" },
  { type: "Bombardier Learjet 75", mtow: "21,500 lbs", category: "Medium" },

  // ── Private Jets — Cessna / Textron ───────────────────────
  { type: "Cessna Citation Bravo", mtow: "14,800 lbs", category: "Light" },
  { type: "Cessna Citation CJ1", mtow: "10,600 lbs", category: "Light" },
  { type: "Cessna Citation CJ1+", mtow: "10,700 lbs", category: "Light" },
  { type: "Cessna Citation CJ2", mtow: "12,500 lbs", category: "Light" },
  { type: "Cessna Citation CJ2+", mtow: "12,500 lbs", category: "Light" },
  { type: "Cessna Citation CJ3", mtow: "13,870 lbs", category: "Light" },
  { type: "Cessna Citation CJ3+", mtow: "13,870 lbs", category: "Light" },
  { type: "Cessna Citation CJ4", mtow: "17,110 lbs", category: "Light" },
  { type: "Cessna Citation Encore", mtow: "16,100 lbs", category: "Light" },
  { type: "Cessna Citation Encore+", mtow: "16,100 lbs", category: "Light" },
  { type: "Cessna Citation Excel", mtow: "20,000 lbs", category: "Medium" },
  { type: "Cessna Citation Latitude", mtow: "20,200 lbs", category: "Medium" },
  { type: "Cessna Citation Longitude", mtow: "39,500 lbs", category: "Medium" },
  { type: "Cessna Citation M2", mtow: "10,400 lbs", category: "Light" },
  { type: "Cessna Citation Mustang", mtow: "8,645 lbs", category: "Light" },
  { type: "Cessna Citation Sovereign", mtow: "30,575 lbs", category: "Medium" },
  { type: "Cessna Citation Sovereign+", mtow: "30,575 lbs", category: "Medium" },
  { type: "Cessna Citation V Ultra", mtow: "15,900 lbs", category: "Light" },
  { type: "Cessna Citation X", mtow: "35,700 lbs", category: "Medium" },
  { type: "Cessna Citation X+", mtow: "35,700 lbs", category: "Medium" },
  { type: "Cessna Citation XLS", mtow: "20,000 lbs", category: "Medium" },
  { type: "Cessna Citation XLS+", mtow: "20,200 lbs", category: "Medium" },

  // ── Private Jets — Dassault ───────────────────────────────
  { type: "Dassault Falcon 2000", mtow: "36,450 lbs", category: "Heavy" },
  { type: "Dassault Falcon 2000EX", mtow: "42,800 lbs", category: "Heavy" },
  { type: "Dassault Falcon 2000LXS", mtow: "42,800 lbs", category: "Heavy" },
  { type: "Dassault Falcon 2000S", mtow: "41,890 lbs", category: "Heavy" },
  { type: "Dassault Falcon 50EX", mtow: "39,700 lbs", category: "Heavy" },
  { type: "Dassault Falcon 6X", mtow: "77,160 lbs", category: "Heavy" },
  { type: "Dassault Falcon 7X", mtow: "70,000 lbs", category: "Heavy" },
  { type: "Dassault Falcon 8X", mtow: "73,000 lbs", category: "Heavy" },
  { type: "Dassault Falcon 900C", mtow: "45,500 lbs", category: "Heavy" },
  { type: "Dassault Falcon 900EX", mtow: "48,300 lbs", category: "Heavy" },
  { type: "Dassault Falcon 900LX", mtow: "49,000 lbs", category: "Heavy" },
  { type: "Dassault Falcon 10X", mtow: "77,160 lbs", category: "Heavy" },

  // ── Private Jets — Embraer ────────────────────────────────
  { type: "Embraer Legacy 450", mtow: "37,040 lbs", category: "Medium" },
  { type: "Embraer Legacy 500", mtow: "38,360 lbs", category: "Medium" },
  { type: "Embraer Legacy 600", mtow: "49,604 lbs", category: "Heavy" },
  { type: "Embraer Legacy 650", mtow: "53,572 lbs", category: "Heavy" },
  { type: "Embraer Legacy 650E", mtow: "53,572 lbs", category: "Heavy" },
  { type: "Embraer Lineage 1000E", mtow: "120,152 lbs", category: "Heavy" },
  { type: "Embraer Phenom 100", mtow: "10,472 lbs", category: "Light" },
  { type: "Embraer Phenom 100EV", mtow: "10,582 lbs", category: "Light" },
  { type: "Embraer Phenom 300", mtow: "17,968 lbs", category: "Light" },
  { type: "Embraer Phenom 300E", mtow: "18,739 lbs", category: "Light" },
  { type: "Embraer Praetor 500", mtow: "38,360 lbs", category: "Medium" },
  { type: "Embraer Praetor 600", mtow: "49,604 lbs", category: "Heavy" },

  // ── Private Jets — Gulfstream ─────────────────────────────
  { type: "Gulfstream G100", mtow: "24,000 lbs", category: "Medium" },
  { type: "Gulfstream G150", mtow: "26,100 lbs", category: "Medium" },
  { type: "Gulfstream G200", mtow: "35,450 lbs", category: "Heavy" },
  { type: "Gulfstream G280", mtow: "41,250 lbs", category: "Heavy" },
  { type: "Gulfstream G300", mtow: "74,600 lbs", category: "Heavy" },
  { type: "Gulfstream G350", mtow: "74,600 lbs", category: "Heavy" },
  { type: "Gulfstream G400", mtow: "66,990 lbs", category: "Heavy" },
  { type: "Gulfstream GIV-SP", mtow: "74,600 lbs", category: "Heavy" },
  { type: "Gulfstream G450", mtow: "73,200 lbs", category: "Heavy" },
  { type: "Gulfstream GV", mtow: "91,000 lbs", category: "Heavy" },
  { type: "Gulfstream G500", mtow: "79,600 lbs", category: "Heavy" },
  { type: "Gulfstream G550", mtow: "91,000 lbs", category: "Heavy" },
  { type: "Gulfstream G600", mtow: "93,500 lbs", category: "Heavy" },
  { type: "Gulfstream G650", mtow: "99,600 lbs", category: "Heavy" },
  { type: "Gulfstream G650ER", mtow: "101,800 lbs", category: "Heavy" },
  { type: "Gulfstream G700", mtow: "107,600 lbs", category: "Heavy" },
  { type: "Gulfstream G800", mtow: "107,600 lbs", category: "Heavy" },

  // ── Private Jets — Hawker ─────────────────────────────────
  { type: "Hawker 400XP", mtow: "16,300 lbs", category: "Light" },
  { type: "Hawker 800XP", mtow: "28,000 lbs", category: "Medium" },
  { type: "Hawker 850XP", mtow: "28,000 lbs", category: "Medium" },
  { type: "Hawker 4000", mtow: "39,500 lbs", category: "Heavy" },

  // ── Private Jets — Other ──────────────────────────────────
  { type: "HondaJet", mtow: "10,700 lbs", category: "Light" },
  { type: "HondaJet Elite", mtow: "10,700 lbs", category: "Light" },
  { type: "HondaJet Elite II", mtow: "10,700 lbs", category: "Light" },
  { type: "Pilatus PC-24", mtow: "18,300 lbs", category: "Light" },
  { type: "Cirrus Vision SF50", mtow: "6,000 lbs", category: "Light" },
  { type: "SyberJet SJ30i", mtow: "12,500 lbs", category: "Light" },

  // ── Commercial — Airbus Narrowbody ────────────────────────
  { type: "Airbus A318", mtow: "149,914 lbs", category: "Heavy" },
  { type: "Airbus A319ceo", mtow: "166,449 lbs", category: "Heavy" },
  { type: "Airbus A220-100", mtow: "139,110 lbs", category: "Heavy" },
  { type: "Airbus A220-300", mtow: "149,030 lbs", category: "Heavy" },
  { type: "Airbus A319neo", mtow: "166,449 lbs", category: "Heavy" },
  { type: "Airbus A320", mtow: "171,960 lbs", category: "Heavy" },
  { type: "Airbus A320neo", mtow: "174,165 lbs", category: "Heavy" },
  { type: "Airbus A321ceo", mtow: "206,132 lbs", category: "Heavy" },
  { type: "Airbus A321neo", mtow: "213,848 lbs", category: "Heavy" },
  { type: "Airbus A321XLR", mtow: "222,667 lbs", category: "Heavy" },

  // ── Commercial — Airbus Widebody ──────────────────────────
  { type: "Airbus A330-200", mtow: "533,519 lbs", category: "Heavy" },
  { type: "Airbus A330-300", mtow: "533,519 lbs", category: "Heavy" },
  { type: "Airbus A330-800neo", mtow: "553,360 lbs", category: "Heavy" },
  { type: "Airbus A330-900neo", mtow: "553,360 lbs", category: "Heavy" },
  { type: "Airbus A340-300", mtow: "609,579 lbs", category: "Heavy" },
  { type: "Airbus A340-500", mtow: "820,109 lbs", category: "Heavy" },
  { type: "Airbus A340-600", mtow: "837,756 lbs", category: "Heavy" },
  { type: "Airbus A350-900", mtow: "617,295 lbs", category: "Heavy" },
  { type: "Airbus A350-1000", mtow: "696,659 lbs", category: "Heavy" },
  { type: "Airbus A380-800", mtow: "1,267,658 lbs", category: "Heavy" },

  // ── Commercial — Boeing Narrowbody ────────────────────────
  { type: "Boeing 717-200", mtow: "121,000 lbs", category: "Heavy" },
  { type: "Boeing 737-700", mtow: "154,500 lbs", category: "Heavy" },
  { type: "Boeing 737-800", mtow: "174,200 lbs", category: "Heavy" },
  { type: "Boeing 737-900ER", mtow: "187,700 lbs", category: "Heavy" },
  { type: "Boeing 737 MAX 7", mtow: "160,000 lbs", category: "Heavy" },
  { type: "Boeing 737 MAX 8", mtow: "181,200 lbs", category: "Heavy" },
  { type: "Boeing 737 MAX 9", mtow: "194,700 lbs", category: "Heavy" },
  { type: "Boeing 737 MAX 10", mtow: "197,900 lbs", category: "Heavy" },
  { type: "Boeing 757-200", mtow: "255,000 lbs", category: "Heavy" },
  { type: "Boeing 757-300", mtow: "272,500 lbs", category: "Heavy" },

  // ── Commercial — Boeing Widebody ──────────────────────────
  { type: "Boeing 747-8", mtow: "987,000 lbs", category: "Heavy" },
  { type: "Boeing 747-8F", mtow: "987,000 lbs", category: "Heavy" },
  { type: "Boeing 767-300ER", mtow: "412,775 lbs", category: "Heavy" },
  { type: "Boeing 767-300F", mtow: "412,000 lbs", category: "Heavy" },
  { type: "Boeing 767-400ER", mtow: "450,000 lbs", category: "Heavy" },
  { type: "Boeing 777-200ER", mtow: "656,000 lbs", category: "Heavy" },
  { type: "Boeing 777-200LR", mtow: "766,000 lbs", category: "Heavy" },
  { type: "Boeing 777-300ER", mtow: "775,000 lbs", category: "Heavy" },
  { type: "Boeing 777F", mtow: "766,800 lbs", category: "Heavy" },
  { type: "Boeing 777X-8", mtow: "775,000 lbs", category: "Heavy" },
  { type: "Boeing 777X-9", mtow: "775,000 lbs", category: "Heavy" },
  { type: "Boeing 787-8", mtow: "502,500 lbs", category: "Heavy" },
  { type: "Boeing 787-9", mtow: "560,000 lbs", category: "Heavy" },
  { type: "Boeing 787-10", mtow: "560,000 lbs", category: "Heavy" },
  { type: "McDonnell Douglas MD-11", mtow: "625,500 lbs", category: "Heavy" },

  // ── Commercial — Regional ─────────────────────────────────
  { type: "Bombardier CRJ-200", mtow: "51,000 lbs", category: "Heavy" },
  { type: "Bombardier CRJ-700", mtow: "75,000 lbs", category: "Heavy" },
  { type: "Bombardier CRJ-900", mtow: "84,500 lbs", category: "Heavy" },
  { type: "Bombardier CRJ-1000", mtow: "91,800 lbs", category: "Heavy" },
  { type: "Embraer ERJ-135", mtow: "44,092 lbs", category: "Heavy" },
  { type: "Embraer ERJ-140", mtow: "46,517 lbs", category: "Heavy" },
  { type: "Embraer ERJ-145", mtow: "48,501 lbs", category: "Heavy" },
  { type: "Embraer E170", mtow: "82,012 lbs", category: "Heavy" },
  { type: "Embraer E175", mtow: "89,000 lbs", category: "Heavy" },
  { type: "Embraer E175-E2", mtow: "98,767 lbs", category: "Heavy" },
  { type: "Embraer E190", mtow: "114,199 lbs", category: "Heavy" },
  { type: "Embraer E190-E2", mtow: "124,341 lbs", category: "Heavy" },
  { type: "Embraer E195", mtow: "115,280 lbs", category: "Heavy" },
  { type: "Embraer E195-E2", mtow: "135,584 lbs", category: "Heavy" },
  { type: "Dornier 328JET", mtow: "34,524 lbs", category: "Medium" },
  { type: "BAe Avro RJ85", mtow: "97,000 lbs", category: "Heavy" },
  { type: "BAe Avro RJ100", mtow: "101,500 lbs", category: "Heavy" },
  { type: "Fokker 70", mtow: "84,000 lbs", category: "Heavy" },
  { type: "Fokker 100", mtow: "98,000 lbs", category: "Heavy" },
  { type: "ATR 42-500", mtow: "41,005 lbs", category: "Heavy" },
  { type: "ATR 42-600", mtow: "41,005 lbs", category: "Heavy" },
  { type: "ATR 42-600S", mtow: "41,005 lbs", category: "Heavy" },
  { type: "ATR 72-500", mtow: "50,265 lbs", category: "Heavy" },
  { type: "ATR 72-600", mtow: "50,706 lbs", category: "Heavy" },

  // ── Commercial — Other Manufacturers ──────────────────────
  { type: "COMAC ARJ21-700", mtow: "95,901 lbs", category: "Heavy" },
  { type: "COMAC C919", mtow: "170,417 lbs", category: "Heavy" },
  { type: "Irkut MC-21-300", mtow: "174,716 lbs", category: "Heavy" },
  { type: "Sukhoi Superjet 100", mtow: "109,021 lbs", category: "Heavy" },
  { type: "Sukhoi Superjet New (SJ-100)", mtow: "109,021 lbs", category: "Heavy" },
  { type: "Mitsubishi SpaceJet M90", mtow: "94,358 lbs", category: "Heavy" },

  // ── VIP / Corporate Airliners ─────────────────────────────
  { type: "Airbus ACJ319neo", mtow: "166,449 lbs", category: "Heavy" },
  { type: "Airbus ACJ320neo", mtow: "174,165 lbs", category: "Heavy" },
  { type: "Airbus ACJ330neo", mtow: "533,519 lbs", category: "Heavy" },
  { type: "Airbus ACJ340", mtow: "606,271 lbs", category: "Heavy" },
  { type: "Boeing BBJ 737 MAX", mtow: "181,200 lbs", category: "Heavy" },
  { type: "Boeing BBJ 787", mtow: "502,500 lbs", category: "Heavy" },

  // ── Military — Transport ──────────────────────────────────
  { type: "Boeing C-17 Globemaster III", mtow: "585,000 lbs", category: "Heavy" },
  { type: "Airbus A400M Atlas", mtow: "310,852 lbs", category: "Heavy" },
  { type: "Lockheed Martin C-130J Super Hercules", mtow: "175,000 lbs", category: "Heavy" },
  { type: "Lockheed Martin C-130J-30", mtow: "175,000 lbs", category: "Heavy" },
  { type: "Embraer KC-390 Millennium", mtow: "191,802 lbs", category: "Heavy" },
  { type: "Kawasaki C-2", mtow: "311,073 lbs", category: "Heavy" },
  { type: "Antonov An-178", mtow: "112,436 lbs", category: "Heavy" },
  { type: "Ilyushin Il-76MD-90A", mtow: "462,970 lbs", category: "Heavy" },
  { type: "Xian Y-20", mtow: "485,017 lbs", category: "Heavy" },

  // ── Military — Tanker / MRTT ──────────────────────────────
  { type: "Airbus A330 MRTT", mtow: "513,677 lbs", category: "Heavy" },
  { type: "Boeing KC-46 Pegasus", mtow: "415,000 lbs", category: "Heavy" },

  // ── Military — Maritime Patrol / ISR ──────────────────────
  { type: "Boeing P-8 Poseidon", mtow: "189,200 lbs", category: "Heavy" },
  { type: "Kawasaki P-1", mtow: "175,706 lbs", category: "Heavy" },
  { type: "Airbus C295", mtow: "51,147 lbs", category: "Heavy" },
  { type: "Leonardo C-27J Spartan", mtow: "70,107 lbs", category: "Heavy" },

  // ── Military — Training ───────────────────────────────────
  { type: "Boeing T-7A Red Hawk", mtow: "27,954 lbs", category: "Medium" },
  { type: "Leonardo M-346 Master", mtow: "20,944 lbs", category: "Medium" },
  { type: "KAI T-50 Golden Eagle", mtow: "29,762 lbs", category: "Medium" },
  { type: "Aero L-39NG", mtow: "12,787 lbs", category: "Light" },
  { type: "Pilatus PC-21", mtow: "9,370 lbs", category: "Light" },

  // ── Military — VIP / Government ───────────────────────────
  { type: "Boeing 747-8 (VC-25B)", mtow: "987,000 lbs", category: "Heavy" },
  { type: "Gulfstream C-37B (G550)", mtow: "91,000 lbs", category: "Heavy" },
  { type: "Boeing C-40 Clipper (737)", mtow: "174,200 lbs", category: "Heavy" },
  { type: "Bombardier CC-144 Challenger", mtow: "48,200 lbs", category: "Heavy" },

  // ── Turboprops ────────────────────────────────────────────
  { type: "Beechcraft 1900D", mtow: "16,950 lbs", category: "Light" },
  { type: "Beechcraft King Air 250", mtow: "12,500 lbs", category: "Light" },
  { type: "Beechcraft King Air 350i", mtow: "15,000 lbs", category: "Light" },
  { type: "Daher TBM 960", mtow: "7,394 lbs", category: "Light" },
  { type: "de Havilland Dash 8-400", mtow: "65,200 lbs", category: "Heavy" },
  { type: "Pilatus PC-12 NGX", mtow: "10,450 lbs", category: "Light" },
  { type: "Piaggio Avanti EVO", mtow: "12,100 lbs", category: "Light" },
  { type: "Saab 340B", mtow: "29,000 lbs", category: "Medium" },

  // ── Helicopters ───────────────────────────────────────────
  { type: "Airbus H125", mtow: "5,512 lbs", category: "Light" },
  { type: "Airbus H130", mtow: "5,291 lbs", category: "Light" },
  { type: "Airbus H135", mtow: "6,250 lbs", category: "Light" },
  { type: "Airbus H145", mtow: "8,047 lbs", category: "Light" },
  { type: "Airbus H160", mtow: "13,228 lbs", category: "Medium" },
  { type: "Airbus H175", mtow: "16,535 lbs", category: "Medium" },
  { type: "Airbus H225", mtow: "24,251 lbs", category: "Heavy" },
  { type: "Bell 407GXi", mtow: "5,250 lbs", category: "Light" },
  { type: "Bell 412EPi", mtow: "11,900 lbs", category: "Medium" },
  { type: "Bell 429", mtow: "7,500 lbs", category: "Light" },
  { type: "Bell 505", mtow: "3,680 lbs", category: "Light" },
  { type: "Leonardo AW109 Trekker", mtow: "7,000 lbs", category: "Light" },
  { type: "Leonardo AW139", mtow: "14,110 lbs", category: "Medium" },
  { type: "Leonardo AW169", mtow: "10,582 lbs", category: "Medium" },
  { type: "Leonardo AW189", mtow: "18,960 lbs", category: "Medium" },
  { type: "Sikorsky S-76D", mtow: "13,000 lbs", category: "Medium" },
  { type: "Sikorsky S-92", mtow: "26,500 lbs", category: "Heavy" },
];

export interface FlightTypeOption {
  type: string;
  purpose: string;
}

export const flightTypes: FlightTypeOption[] = [
  { type: "Private (Part 91)", purpose: "Private" },
  { type: "Non Scheduled Commercial (Part 135)", purpose: "Non Scheduled Commercial" },
  { type: "Commercial", purpose: "Commercial" },
  { type: "Military/State", purpose: "Military/State" },
];
