import bcrypt from 'bcryptjs';
import { PLACES, type PlaceKey } from '../data/chennaiPlaces';
import type { Capability, ResourceStatus, ResourceType } from '../domain';
import { pool } from './pool';

/**
 * Demo data for Chennai: resources at real locality coordinates and one
 * login per role. WARNING: this wipes all existing data first.
 *
 *   npm run db:seed
 */

interface SeedResource {
  code: string;
  name: string;
  type: ResourceType;
  place: PlaceKey;
  capacity: number;
  currentLoad?: number;
  capabilities?: Capability[];
  status?: ResourceStatus;
}

const RESOURCES: SeedResource[] = [
  // Ambulances (capacity = patients it can carry)
  { code: 'AMB-01', name: 'Ambulance 1', type: 'ambulance', place: 'egmore', capacity: 2, capabilities: ['advanced_life_support', 'trauma_kit'] },
  { code: 'AMB-02', name: 'Ambulance 2', type: 'ambulance', place: 'royapettah', capacity: 2, capabilities: ['advanced_life_support'] },
  { code: 'AMB-03', name: 'Ambulance 3', type: 'ambulance', place: 'kilpauk', capacity: 2, capabilities: ['trauma_kit'] },
  { code: 'AMB-04', name: 'Ambulance 4', type: 'ambulance', place: 'adyar', capacity: 2, capabilities: ['advanced_life_support', 'trauma_kit'] },
  { code: 'AMB-05', name: 'Ambulance 5', type: 'ambulance', place: 'guindy', capacity: 2, status: 'out_of_service' },
  { code: 'AMB-06', name: 'Ambulance 6', type: 'ambulance', place: 'tambaram', capacity: 2, capabilities: ['advanced_life_support'] },
  { code: 'AMB-07', name: 'Ambulance 7', type: 'ambulance', place: 'annaNagar', capacity: 2, capabilities: ['trauma_kit'] },
  { code: 'AMB-08', name: 'Ambulance 8', type: 'ambulance', place: 'perungudi', capacity: 2 },
  { code: 'AMB-09', name: 'Ambulance 9', type: 'ambulance', place: 'vadapalani', capacity: 2, capabilities: ['advanced_life_support'] },

  // Response teams (capacity = people in the team)
  { code: 'FIRE-01', name: 'Fire & Rescue Team, Egmore', type: 'personnel', place: 'egmore', capacity: 8, capabilities: ['fire_fighting', 'search_and_rescue'] },
  { code: 'FIRE-02', name: 'Fire & Rescue Team, Teynampet', type: 'personnel', place: 'teynampet', capacity: 6, capabilities: ['fire_fighting'] },
  { code: 'FIRE-03', name: 'Fire & Rescue Team, Guindy', type: 'personnel', place: 'guindy', capacity: 8, capabilities: ['fire_fighting', 'search_and_rescue'] },
  { code: 'FIRE-04', name: 'Fire & Rescue Team, Tambaram', type: 'personnel', place: 'tambaram', capacity: 6, capabilities: ['fire_fighting'] },
  { code: 'BOAT-01', name: 'Water Rescue Team, Kotturpuram', type: 'personnel', place: 'kotturpuram', capacity: 6, capabilities: ['water_rescue'] },
  { code: 'BOAT-02', name: 'Water Rescue Team, Thoraipakkam', type: 'personnel', place: 'thoraipakkam', capacity: 6, capabilities: ['water_rescue'] },
  { code: 'BOAT-03', name: 'Water Rescue Team, Alandur', type: 'personnel', place: 'alandur', capacity: 6, capabilities: ['water_rescue', 'search_and_rescue'] },
  { code: 'BOAT-04', name: 'Water Rescue Team, Royapuram', type: 'personnel', place: 'royapuram', capacity: 6, capabilities: ['water_rescue'] },
  { code: 'SAR-01', name: 'Search & Rescue Team, Nungambakkam', type: 'personnel', place: 'nungambakkam', capacity: 10, capabilities: ['search_and_rescue', 'heavy_equipment'] },
  { code: 'SAR-02', name: 'Search & Rescue Team, Koyambedu', type: 'personnel', place: 'koyambedu', capacity: 8, capabilities: ['search_and_rescue'] },
  { code: 'ROAD-01', name: 'Road Clearing Crew, Anna Nagar', type: 'personnel', place: 'annaNagar', capacity: 5, capabilities: ['heavy_equipment'] },
  { code: 'ROAD-02', name: 'Road Clearing Crew, Perungudi', type: 'personnel', place: 'perungudi', capacity: 5, capabilities: ['heavy_equipment'] },
  { code: 'ELEC-01', name: 'Electricity Repair Crew, Kodambakkam', type: 'personnel', place: 'kodambakkam', capacity: 4, capabilities: ['electrical_repair'] },
  { code: 'ELEC-02', name: 'Electricity Repair Crew, Sholinganallur', type: 'personnel', place: 'sholinganallur', capacity: 4, capabilities: ['electrical_repair'] },

  // Supply trucks (capacity = relief kits it can carry)
  { code: 'TRK-01', name: 'Supply Truck 1', type: 'supply_truck', place: 'koyambedu', capacity: 400, capabilities: ['food_and_water'] },
  { code: 'TRK-02', name: 'Supply Truck 2', type: 'supply_truck', place: 'perambur', capacity: 400, capabilities: ['food_and_water', 'medical_supplies'] },
  { code: 'TRK-03', name: 'Supply Truck 3', type: 'supply_truck', place: 'chromepet', capacity: 300, capabilities: ['food_and_water'] },
  { code: 'TRK-04', name: 'Supply Truck 4', type: 'supply_truck', place: 'vadapalani', capacity: 300, capabilities: ['medical_supplies'] },

  // Shelters (capacity = people it can house, current load = people there now)
  { code: 'SHL-01', name: 'Relief Camp, Nungambakkam', type: 'shelter', place: 'nungambakkam', capacity: 300, currentLoad: 40 },
  { code: 'SHL-02', name: 'Relief Camp, Ashok Nagar', type: 'shelter', place: 'ashokNagar', capacity: 200, currentLoad: 120 },
  { code: 'SHL-03', name: 'Relief Camp, Thiruvanmiyur', type: 'shelter', place: 'thiruvanmiyur', capacity: 250, currentLoad: 60 },
  { code: 'SHL-04', name: 'Relief Camp, Mogappair', type: 'shelter', place: 'mogappair', capacity: 300, currentLoad: 10 },
  { code: 'SHL-05', name: 'Relief Camp, Washermanpet', type: 'shelter', place: 'washermanpet', capacity: 200, currentLoad: 150 },
  { code: 'SHL-06', name: 'Relief Camp, Chromepet', type: 'shelter', place: 'chromepet', capacity: 250, currentLoad: 30 },
];

interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: 'commander' | 'responder' | 'admin';
  resourceCode?: string;
}

const USERS: SeedUser[] = [
  { name: 'Priya Natarajan', email: 'commander@drrc.local', password: 'Commander@123', role: 'commander' },
  { name: 'Rahul Verma', email: 'admin@drrc.local', password: 'Admin@123', role: 'admin' },
  { name: 'Suresh Kumar', email: 'responder1@drrc.local', password: 'Responder@123', role: 'responder', resourceCode: 'AMB-01' },
  { name: 'Anitha Ravi', email: 'responder2@drrc.local', password: 'Responder@123', role: 'responder', resourceCode: 'FIRE-01' },
  { name: 'Karthik Subramanian', email: 'responder3@drrc.local', password: 'Responder@123', role: 'responder', resourceCode: 'BOAT-01' },
  { name: 'Meena Iyer', email: 'responder4@drrc.local', password: 'Responder@123', role: 'responder', resourceCode: 'TRK-01' },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE audit_log, dispatch_decisions, reports, users, resources, incidents RESTART IDENTITY CASCADE`,
    );

    const resourceIds = new Map<string, number>();
    for (const r of RESOURCES) {
      const place = PLACES[r.place];
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO resources (code, name, type, status, location, home_base, capacity, current_load, capabilities)
         VALUES ($1, $2, $3, $4, ST_MakePoint($5, $6)::geography, $7, $8, $9, $10) RETURNING id`,
        [r.code, r.name, r.type, r.status ?? 'available', place.lng, place.lat, place.name,
         r.capacity, r.currentLoad ?? 0, r.capabilities ?? []],
      );
      resourceIds.set(r.code, rows[0].id);
    }

    for (const u of USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      await client.query(
        `INSERT INTO users (name, email, password_hash, role, resource_id) VALUES ($1, $2, $3, $4, $5)`,
        [u.name, u.email, hash, u.role, u.resourceCode ? resourceIds.get(u.resourceCode) : null],
      );
    }

    await client.query(
      `INSERT INTO audit_log (actor_type, actor_name, action, summary)
       VALUES ('system', 'Seed script', 'system.seeded', 'Demo data for Chennai loaded.')`,
    );

    await client.query('COMMIT');
    console.log(`Seeded ${RESOURCES.length} resources and ${USERS.length} users.`);
    console.log('Logins:');
    for (const u of USERS) console.log(`  ${u.role.padEnd(10)} ${u.email.padEnd(24)} ${u.password}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error) => {
    console.error('Seeding failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
