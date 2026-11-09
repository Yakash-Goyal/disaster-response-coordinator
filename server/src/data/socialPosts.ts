import type { PlaceKey } from './chennaiPlaces';

/**
 * Synthetic social-media posts for the demo flood scenario (SRS 4.1, 9).
 * All handles and posts are made up.
 *
 * Several posts describe the SAME event from slightly different spots
 * (small dLat/dLng offsets, roughly 50-150 m). The deduplication step should
 * merge them into one incident and raise its report count.
 * 0.001 degrees of latitude is about 110 metres.
 */
export interface SocialPost {
  handle: string;
  place: PlaceKey;
  dLat?: number;
  dLng?: number;
  text: string;
}

export const SOCIAL_POSTS: SocialPost[] = [
  { handle: '@velachery_resident22', place: 'velachery',
    text: 'Water entered our street in Velachery, almost waist deep now. Elderly couple in the ground floor house next door are trapped, please send help #ChennaiRains' },
  { handle: '@saidapet_updates', place: 'saidapet',
    text: 'Adyar river overflowing near Saidapet bridge. Water rising fast, families moving to terraces. Need rescue boats urgently' },
  { handle: '@tnagar_shopkeeper', place: 'tNagar',
    text: 'Fire in a textile shop in T Nagar, looks like short circuit. Thick smoke coming out, people running out of the building' },
  { handle: '@chennai_weather_watch', place: 'egmore',
    text: 'Chennai rains are something else today! Stay safe everyone #ChennaiRains' },
  { handle: '@velachery_moms', place: 'velachery', dLat: 0.0007, dLng: 0.0005,
    text: 'Velachery main road flooded, our area is cut off. Water is knee deep inside houses, old people stranded on first floor' },
  { handle: '@mylapore_old_town', place: 'mylapore',
    text: 'Old building wall collapsed in Mylapore after heavy rain. Two people may be under the debris, neighbours are trying to help' },
  { handle: '@annanagar_walker', place: 'annaNagar',
    text: 'Huge tree fell across 2nd Avenue Anna Nagar, road blocked completely. Vehicles stuck on both sides' },
  { handle: '@saidapet_volunteer', place: 'saidapet', dLat: -0.0006, dLng: 0.0008,
    text: 'Saidapet low lying area submerged, at least 20 families stranded on rooftops, children among them. Please send boats' },
  { handle: '@tambaram_family', place: 'tambaram',
    text: 'My father is a dialysis patient and our street in Tambaram is flooded. We cannot take him to hospital. Need an ambulance urgently please' },
  { handle: '@perungudi_it_guy', place: 'perungudi',
    text: 'Transformer sparking near Perungudi junction and there is no power in the whole area since morning' },
  { handle: '@royapuram_fisherfolk', place: 'royapuram',
    text: 'Fishermen colony in Royapuram has no food and no drinking water for two days. Many families, small children. Please send food packets' },
  { handle: '@tnagar_traffic', place: 'tNagar', dLat: 0.0005, dLng: -0.0006,
    text: 'Fire still burning in a shop near Usman Road T Nagar, smoke everywhere, fire service not here yet' },
  { handle: '@kknagar_resident', place: 'kkNagar',
    text: 'Pregnant woman in labour pain, our street in KK Nagar is flooded and no auto or cab will come. Please send an ambulance' },
  { handle: '@pallikaranai_watch', place: 'pallikaranai',
    text: 'Pallikaranai marsh overflowing into the residential colonies. Water entered houses, people need to be evacuated' },
  { handle: '@guindy_commuter', place: 'guindy',
    text: 'Guindy subway closed, completely waterlogged. Cars stuck inside, road blocked' },
  { handle: '@mylapore_temple_st', place: 'mylapore', dLat: 0.0004, dLng: 0.0004,
    text: 'Building collapsed near the temple street Mylapore. People trapped under rubble, we can hear someone calling for help' },
  { handle: '@ashoknagar_alert', place: 'ashokNagar',
    text: 'Live wire fell into the flood water on 11th Avenue Ashok Nagar. Very dangerous, power must be cut immediately' },
  { handle: '@thiruvanmiyur_local', place: 'thiruvanmiyur',
    text: 'A hoarding fell on a bike rider near Thiruvanmiyur signal. He is injured and bleeding from the head' },
  { handle: '@madipakkam_residents', place: 'madipakkam',
    text: 'Madipakkam flooding again, water entered houses on many streets. Elderly people need help to move out' },
  { handle: '@royapuram_youth', place: 'royapuram', dLat: -0.0008, dLng: -0.0004,
    text: 'Royapuram coastal huts, families without food since yesterday, drinking water also finished. Please help' },
  { handle: '@kotturpuram_resident', place: 'kotturpuram',
    text: 'Kotturpuram near the river is flooding, water level rising inside the colony. Not yet dangerous but rising' },
  { handle: '@velachery_lake_view', place: 'velachery', dLat: -0.0005, dLng: -0.0007,
    text: 'Velachery lake overflow, water level still rising in our colony. People trapped in houses, children and elderly. SOS' },
  { handle: '@tambaram_helpers', place: 'tambaram', dLat: 0.0006, dLng: 0.0003,
    text: 'Dialysis patient in Tambaram stuck at home because of floods, family needs ambulance help urgently' },
  { handle: '@kodambakkam_camp', place: 'kodambakkam',
    text: 'Relief camp at Kodambakkam school running out of food and drinking water, around 150 people here' },
  { handle: '@madipakkam_helpline', place: 'madipakkam', dLat: 0.0006, dLng: -0.0005,
    text: 'Madipakkam: water inside houses, a bedridden man needs to be shifted out urgently' },
  { handle: '@porur_driver', place: 'porur',
    text: 'Small tree branch fell near Porur junction, minor issue, traffic moving slowly. No injuries' },
];
