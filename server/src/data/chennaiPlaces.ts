/**
 * Chennai localities used by the seed data and the mock social-media feed.
 * Coordinates were looked up from OpenStreetMap (Nominatim).
 */
export const CHENNAI_CENTER = { lat: 13.0475, lng: 80.2209 };

export const PLACES = {
  adyar: { name: 'Adyar', lat: 13.00645, lng: 80.25778 },
  alandur: { name: 'Alandur', lat: 13.00426, lng: 80.20145 },
  ambattur: { name: 'Ambattur', lat: 13.11409, lng: 80.15286 },
  annaNagar: { name: 'Anna Nagar', lat: 13.08825, lng: 80.20734 },
  ashokNagar: { name: 'Ashok Nagar', lat: 13.03593, lng: 80.21457 },
  besantNagar: { name: 'Besant Nagar', lat: 12.99969, lng: 80.26823 },
  chromepet: { name: 'Chromepet', lat: 12.9575, lng: 80.14351 },
  egmore: { name: 'Egmore', lat: 13.07283, lng: 80.25769 },
  guindy: { name: 'Guindy', lat: 13.00867, lng: 80.21261 },
  kilpauk: { name: 'Kilpauk', lat: 13.08321, lng: 80.23799 },
  kkNagar: { name: 'K.K. Nagar', lat: 13.0408, lng: 80.20298 },
  kodambakkam: { name: 'Kodambakkam', lat: 13.04921, lng: 80.22428 },
  kotturpuram: { name: 'Kotturpuram', lat: 13.01937, lng: 80.24355 },
  koyambedu: { name: 'Koyambedu', lat: 13.07152, lng: 80.19981 },
  madipakkam: { name: 'Madipakkam', lat: 12.96113, lng: 80.20013 },
  mogappair: { name: 'Mogappair', lat: 13.08351, lng: 80.18408 },
  mylapore: { name: 'Mylapore', lat: 13.03165, lng: 80.27002 },
  nungambakkam: { name: 'Nungambakkam', lat: 13.06206, lng: 80.24049 },
  pallikaranai: { name: 'Pallikaranai', lat: 12.93047, lng: 80.20777 },
  perambur: { name: 'Perambur', lat: 13.11212, lng: 80.24502 },
  perungudi: { name: 'Perungudi', lat: 12.97102, lng: 80.24181 },
  porur: { name: 'Porur', lat: 13.03246, lng: 80.15829 },
  royapettah: { name: 'Royapettah', lat: 13.05547, lng: 80.26397 },
  royapuram: { name: 'Royapuram', lat: 13.10429, lng: 80.29361 },
  saidapet: { name: 'Saidapet', lat: 13.02082, lng: 80.22395 },
  sholinganallur: { name: 'Sholinganallur', lat: 12.89354, lng: 80.23206 },
  tambaram: { name: 'Tambaram', lat: 12.94543, lng: 80.11866 },
  teynampet: { name: 'Teynampet', lat: 13.04432, lng: 80.24985 },
  thiruvanmiyur: { name: 'Thiruvanmiyur', lat: 12.98589, lng: 80.26442 },
  thoraipakkam: { name: 'Thoraipakkam', lat: 12.94918, lng: 80.24069 },
  tNagar: { name: 'T. Nagar', lat: 13.03783, lng: 80.23184 },
  tondiarpet: { name: 'Tondiarpet', lat: 13.12752, lng: 80.28192 },
  vadapalani: { name: 'Vadapalani', lat: 13.0503, lng: 80.21183 },
  velachery: { name: 'Velachery', lat: 12.98017, lng: 80.22285 },
  vyasarpadi: { name: 'Vyasarpadi', lat: 13.11305, lng: 80.25872 },
  washermanpet: { name: 'Washermanpet', lat: 13.10896, lng: 80.28201 },
} as const;

export type PlaceKey = keyof typeof PLACES;
