import { DEFAULT_STAGES } from '@shared/constants';
import type { Database } from './types';

/**
 * Demo data for a browser that has never opened the app before.
 *
 * Same shape and spirit as the desktop seed: two live sites, a full sales
 * pipeline, six weeks of attendance, material movements and daily reports — so
 * every chart, report and forecast has something real to show immediately.
 */

function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const FIRST_NAMES = ['Rajesh', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anita', 'Suresh', 'Kavita', 'Manish', 'Deepa', 'Arun', 'Pooja', 'Ravi', 'Neha', 'Sanjay', 'Meera', 'Rohit', 'Divya', 'Nitin', 'Shalini'];
const LAST_NAMES = ['Sharma', 'Patel', 'Verma', 'Joshi', 'Nair', 'Reddy', 'Desai', 'Kulkarni', 'Mehta', 'Gupta', 'Shah', 'Iyer'];
const WORKER_NAMES = ['Ramesh', 'Shyam', 'Mohan', 'Dinesh', 'Kailash', 'Bhola', 'Ganesh', 'Prakash', 'Santosh', 'Vijay', 'Lakhan', 'Om Prakash', 'Jagdish', 'Naresh', 'Sunil', 'Chandan', 'Devi Lal', 'Hari', 'Kishan', 'Mahesh', 'Nandu', 'Pappu', 'Raju', 'Sohan', 'Tej Singh', 'Umesh', 'Yashpal', 'Ashok', 'Balram', 'Chetan'];
const CONTRACTORS = ['Shree Balaji Labour', 'M. K. Contractors', 'Aasma Direct', 'Vishwakarma Enterprises'];

export function buildDemoData(target: Database): void {
  const random = makeRandom(20260828);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const between = (min: number, max: number): number => Math.round(min + random() * (max - min));
  const personName = (): string => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const phoneNumber = (): string => `9${between(100000000, 899999999)}`;

  const daysAgo = (days: number): Date => {
    const date = new Date();
    date.setHours(9, 0, 0, 0);
    date.setDate(date.getDate() - days);
    return date;
  };

  const counters: Record<string, number> = {};
  const id = (table: string): number => {
    counters[table] = (counters[table] ?? 0) + 1;
    return counters[table];
  };
  const now = new Date();

  // ---------------------------------------------------------------- projects
  const projectSeeds = [
    {
      name: 'Aasma Greens — Site A',
      code: 'AG-A',
      location: 'Super Corridor, Indore',
      startDate: daysAgo(220),
      expectedEndDate: daysAgo(-160),
      budget: 185_000_000,
      contractor: 'M. K. Contractors',
      engineer: 'Er. Ashish Rathore',
      description: 'Two towers of 2 and 3 BHK apartments with a clubhouse.',
      pace: 1,
      towers: ['A', 'B'],
      floors: 8,
      unitsPerFloor: 4,
    },
    {
      name: 'Aasma Heights — Site B',
      code: 'AH-B',
      location: 'Rau, Indore',
      startDate: daysAgo(140),
      expectedEndDate: daysAgo(-40),
      budget: 96_000_000,
      contractor: 'Vishwakarma Enterprises',
      engineer: 'Er. Sunita Rane',
      description: 'Single tower of compact 1 and 2 BHK homes.',
      pace: 0.62,
      towers: ['T1'],
      floors: 6,
      unitsPerFloor: 4,
    },
  ];

  for (const seed of projectSeeds) {
    const projectId = id('projects');
    target.projects.push({
      id: projectId,
      name: seed.name,
      code: seed.code,
      location: seed.location,
      startDate: seed.startDate,
      expectedEndDate: seed.expectedEndDate,
      actualEndDate: null,
      budget: seed.budget,
      contractor: seed.contractor,
      engineer: seed.engineer,
      status: 'ACTIVE',
      description: seed.description,
      createdAt: seed.startDate,
      updatedAt: now,
    });

    DEFAULT_STAGES.forEach((stage, index) => {
      const ceiling = Math.max(0, 100 - index * 16);
      const progress = Math.min(100, Math.round(ceiling * seed.pace));
      const stageId = id('projectStages');
      target.projectStages.push({
        id: stageId,
        projectId,
        name: stage.name,
        weight: stage.weight,
        progress,
        sortOrder: index,
        createdAt: seed.startDate,
        updatedAt: now,
      });

      const points = 6;
      for (let step = 1; step <= points; step += 1) {
        target.stageProgressLogs.push({
          id: id('stageProgressLogs'),
          stageId,
          progress: Math.round((progress / points) * step),
          recordedOn: daysAgo(Math.round((points - step) * 12) + 2),
          note: step === points ? 'Latest site update' : null,
          createdAt: now,
        });
      }
    });

    ['Foundation certified', 'Slab casting complete', 'Brick work handover', 'Internal plaster complete', 'Possession ready'].forEach(
      (title, index) => {
        const dueDate = daysAgo(160 - index * 55);
        const done = dueDate < now && index < 2;
        target.milestones.push({
          id: id('milestones'),
          projectId,
          title,
          dueDate,
          completedOn: done ? dueDate : null,
          status: done ? 'DONE' : dueDate < now ? 'DELAYED' : 'PENDING',
          notes: null,
          createdAt: now,
          updatedAt: now,
        });
      },
    );

    const unitTypes = ['2BHK', '3BHK', '2BHK', '1BHK'];
    for (const tower of seed.towers) {
      for (let floor = 1; floor <= seed.floors; floor += 1) {
        for (let unitIndex = 0; unitIndex < seed.unitsPerFloor; unitIndex += 1) {
          const unitType = unitTypes[unitIndex % unitTypes.length];
          const size = unitType === '3BHK' ? 1450 : unitType === '2BHK' ? 1080 : 640;
          const roll = random();
          target.properties.push({
            id: id('properties'),
            projectId,
            tower,
            floor,
            unit: `${floor}0${unitIndex + 1}`,
            unitType,
            sizeSqft: size,
            price: Math.round(size * between(4200, 5200)),
            facing: pick(['EAST', 'WEST', 'NORTH', 'SOUTH', 'NORTH_EAST', 'SOUTH_WEST']),
            status: roll < 0.34 ? 'SOLD' : roll < 0.46 ? 'RESERVED' : 'AVAILABLE',
            notes: null,
            createdAt: seed.startDate,
            updatedAt: now,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------- clients
  for (const property of target.properties.filter((row) => row.status === 'SOLD')) {
    const clientId = id('clients');
    target.clients.push({
      id: clientId,
      name: personName(),
      phone: phoneNumber(),
      email: `owner${property.id}@example.com`,
      address: `${between(10, 900)}, ${pick(['Vijay Nagar', 'Palasia', 'Rau', 'Bicholi', 'Mhow Naka'])}, Indore`,
      panNo: `ABCPD${between(1000, 9999)}K`,
      aadhaarNo: null,
      notes: null,
      createdAt: daysAgo(between(20, 200)),
      updatedAt: now,
    });

    const bookingDate = daysAgo(between(10, 190));
    const agreementValue = property.price;
    const bookingId = id('bookings');
    target.bookings.push({
      id: bookingId,
      clientId,
      propertyId: property.id,
      projectId: property.projectId,
      bookingDate,
      agreementValue,
      bookingAmount: Math.round(agreementValue * 0.1),
      status: 'ACTIVE',
      agreementNo: `AGR/${property.tower}${property.unit}/${bookingDate.getFullYear()}`,
      notes: null,
      createdAt: bookingDate,
      updatedAt: now,
    });

    const instalments = between(2, 4);
    for (let step = 0; step < instalments; step += 1) {
      target.payments.push({
        id: id('payments'),
        clientId,
        bookingId,
        amount: Math.round(agreementValue * (step === 0 ? 0.1 : 0.15)),
        mode: pick(['BANK', 'CHEQUE', 'UPI', 'LOAN']),
        paidOn: daysAgo(Math.max(1, between(5, 180) - step * 20)),
        reference: `TXN${between(100000, 999999)}`,
        notes: null,
        createdAt: now,
      });
    }

    target.interactions.push({
      id: id('interactions'),
      clientId,
      type: 'SITE_VISIT',
      detail: `Site visit for ${property.tower}-${property.unit} before booking.`,
      happenedOn: daysAgo(between(30, 200)),
      createdAt: now,
    });
  }

  // ---------------------------------------------------------------- leads
  const statuses = ['NEW', 'CONTACTED', 'INTERESTED', 'SITE_VISIT', 'NEGOTIATION', 'WON', 'LOST'] as const;
  const available = target.properties.filter((row) => row.status !== 'SOLD');

  for (let index = 0; index < 64; index += 1) {
    const status = index < 46 ? pick(statuses.slice(0, 5)) : pick(statuses);
    const property = pick(available);
    const createdAt = daysAgo(between(1, 150));
    const leadId = id('leads');
    target.leads.push({
      id: leadId,
      name: personName(),
      phone: phoneNumber(),
      email: random() > 0.35 ? `lead${index}@example.com` : null,
      source: pick(['WALK_IN', 'REFERRAL', 'WEBSITE', 'CALL', 'BROKER', 'CAMPAIGN']),
      budget: between(2500000, 9500000),
      interestedPropertyId: property?.id ?? null,
      projectId: property?.projectId ?? null,
      followUpDate: ['WON', 'LOST'].includes(status) ? null : daysAgo(between(-12, 6)),
      status,
      assignedTo: pick(['Neha Sales', 'Rohit Sales', 'Front Desk']),
      notes: pick([
        'Looking for an east-facing unit on a higher floor.',
        'Bank loan pre-approved, wants possession within a year.',
        'Comparing with a competing project nearby.',
        'Family of four, needs two parking slots.',
      ]),
      convertedClientId: null,
      createdAt,
      updatedAt: now,
    });

    target.leadActivities.push({
      id: id('leadActivities'),
      leadId,
      type: 'CALL',
      detail: 'First call — shared price list and floor plans.',
      happenedOn: createdAt,
      createdAt,
    });
    if (['SITE_VISIT', 'NEGOTIATION', 'WON'].includes(status) && property) {
      target.leadActivities.push({
        id: id('leadActivities'),
        leadId,
        type: 'VISIT',
        detail: `Visited ${property.tower}-${property.unit}.`,
        happenedOn: daysAgo(between(1, 40)),
        createdAt: now,
      });
    }
  }

  // ---------------------------------------------------------------- inventory
  const materialSeeds = [
    { name: 'OPC 53 Grade Cement', category: 'CEMENT', unit: 'Bag', rate: 395, openingStock: 400, reorderLevel: 150 },
    { name: 'River Sand', category: 'SAND', unit: 'Brass', rate: 4800, openingStock: 40, reorderLevel: 15 },
    { name: 'TMT Steel Fe500 12mm', category: 'STEEL', unit: 'Ton', rate: 62500, openingStock: 22, reorderLevel: 8 },
    { name: 'TMT Steel Fe500 8mm', category: 'STEEL', unit: 'Ton', rate: 63200, openingStock: 14, reorderLevel: 6 },
    { name: 'Red Clay Bricks', category: 'BRICKS', unit: 'Nos', rate: 9, openingStock: 60000, reorderLevel: 15000 },
    { name: 'AAC Blocks 600x200', category: 'BRICKS', unit: 'Nos', rate: 58, openingStock: 4200, reorderLevel: 1200 },
    { name: '20mm Aggregate', category: 'GRAVEL', unit: 'Brass', rate: 5200, openingStock: 26, reorderLevel: 10 },
    { name: 'Interior Emulsion Paint', category: 'PAINT', unit: 'Litre', rate: 235, openingStock: 900, reorderLevel: 300 },
    { name: 'CPVC Pipe 25mm', category: 'PIPES', unit: 'Metre', rate: 145, openingStock: 1800, reorderLevel: 600 },
    { name: 'PVC Drain Pipe 110mm', category: 'PIPES', unit: 'Metre', rate: 310, openingStock: 700, reorderLevel: 250 },
    { name: 'Copper Wire 2.5 sqmm', category: 'ELECTRICAL', unit: 'Coil', rate: 2150, openingStock: 85, reorderLevel: 30 },
    { name: 'Modular Switch Board', category: 'ELECTRICAL', unit: 'Nos', rate: 640, openingStock: 320, reorderLevel: 120 },
  ];

  for (const seed of materialSeeds) {
    const materialId = id('materials');
    target.materials.push({
      id: materialId,
      name: seed.name,
      category: seed.category,
      unit: seed.unit,
      openingStock: seed.openingStock,
      reorderLevel: seed.reorderLevel,
      rate: seed.rate,
      active: true,
      createdAt: daysAgo(200),
      updatedAt: now,
    });

    for (let step = 0; step < between(2, 3); step += 1) {
      const quantity = Math.round(seed.openingStock * (0.4 + random() * 0.8));
      target.purchases.push({
        id: id('purchases'),
        materialId,
        projectId: pick(target.projects).id,
        quantity,
        rate: seed.rate,
        amount: Math.round(quantity * seed.rate),
        supplier: pick(['Shree Traders', 'Balaji Suppliers', 'Indore Cement Depot', 'Metro Hardware']),
        invoiceNo: `INV-${between(1000, 9999)}`,
        purchasedOn: daysAgo(between(10, 150)),
        notes: null,
        createdAt: now,
      });
    }

    for (let day = 45; day >= 0; day -= 1) {
      if (random() > 0.55) continue;
      target.materialUsages.push({
        id: id('materialUsages'),
        materialId,
        projectId: pick(target.projects).id,
        quantity: Math.max(1, Math.round(seed.openingStock * (0.005 + random() * 0.02))),
        usedOn: daysAgo(day),
        issuedTo: pick(['Site Store', 'Mason Team A', 'Mason Team B', 'Electrical Team']),
        notes: null,
        createdAt: now,
      });
    }

    if (random() > 0.7) {
      target.stockAdjustments.push({
        id: id('stockAdjustments'),
        materialId,
        quantity: -Math.round(seed.openingStock * 0.01),
        reason: pick(['DAMAGE', 'WASTAGE']),
        adjustedOn: daysAgo(between(3, 60)),
        notes: 'Recorded during monthly stock verification.',
        createdAt: now,
      });
    }
  }

  // ---------------------------------------------------------------- labour
  WORKER_NAMES.forEach((name, index) => {
    const skill = pick(['MASON', 'CARPENTER', 'ELECTRICIAN', 'PLUMBER', 'PAINTER', 'HELPER', 'OPERATOR', 'SUPERVISOR']);
    const wage = skill === 'SUPERVISOR' ? 950 : skill === 'HELPER' ? 480 : between(600, 820);
    target.workers.push({
      id: id('workers'),
      name: `${name} ${pick(LAST_NAMES)}`,
      mobile: phoneNumber(),
      skill,
      contractor: pick(CONTRACTORS),
      dailyWage: wage,
      projectId: target.projects[index % target.projects.length].id,
      active: true,
      joinedOn: daysAgo(between(60, 200)),
      createdAt: daysAgo(between(60, 200)),
      updatedAt: now,
    });
  });

  for (let day = 45; day >= 0; day -= 1) {
    const date = daysAgo(day);
    if (date.getDay() === 0) continue;
    for (const worker of target.workers) {
      const roll = random();
      const status = roll < 0.82 ? 'PRESENT' : roll < 0.9 ? 'HALF_DAY' : 'ABSENT';
      target.attendances.push({
        id: id('attendances'),
        workerId: worker.id,
        projectId: worker.projectId,
        markedOn: date,
        status,
        overtimeHours: status === 'PRESENT' && random() > 0.82 ? between(1, 3) : 0,
        notes: null,
        createdAt: now,
      });
    }
  }

  // ---------------------------------------------------------------- dpr
  for (const project of target.projects) {
    for (let day = 21; day >= 0; day -= 1) {
      const date = daysAgo(day);
      if (date.getDay() === 0) continue;
      const dprId = id('dprs');
      target.dprs.push({
        id: dprId,
        projectId: project.id,
        reportDate: date,
        weather: pick(['CLEAR', 'CLOUDY', 'RAIN', 'HOT']),
        workCompleted: pick([
          'Slab shuttering completed for the fifth floor; reinforcement tied and checked.',
          'Brick work in progress on floors two and three, four masons deployed.',
          'Internal plaster completed for eight units; curing under way.',
          'Electrical conduiting completed on the second floor.',
          'Plumbing risers installed and pressure tested up to the third floor.',
          'External painting primer coat applied on the north elevation.',
        ]),
        labourCount: between(24, 48),
        machinery: pick(['1 concrete mixer, 1 lift', '2 vibrators, 1 mixer', '1 JCB (half day)', '1 mixer, 1 hoist']),
        siteIssues:
          random() > 0.72
            ? pick(['Cement delivery delayed by two hours.', 'Rain stopped work after 3 pm.', 'Power outage for one hour.'])
            : null,
        safetyNotes: pick([
          'Toolbox talk conducted; helmets checked.',
          'Safety nets inspected on the outer face.',
          'No incidents reported.',
        ]),
        preparedBy: pick(['Er. Ashish Rathore', 'Er. Sunita Rane', 'Site Supervisor']),
        createdAt: date,
        updatedAt: now,
      });

      for (const material of target.materials.slice(0, 4)) {
        if (random() > 0.5) continue;
        target.dprMaterials.push({
          id: id('dprMaterials'),
          dprId,
          materialId: material.id,
          quantity: Math.max(1, Math.round(material.openingStock * 0.01)),
        });
      }
    }
  }
}
